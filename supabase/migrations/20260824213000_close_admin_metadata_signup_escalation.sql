begin;

-- Emergency, data-preserving closure for two legacy privilege-escalation
-- paths. This migration is deliberately independent from the broader backend
-- hardening so it can be applied immediately after the protected allowlist.
-- It is repeat-safe (CREATE OR REPLACE plus DROP TRIGGER IF EXISTS), performs
-- no row mutations and is atomic: any failed preflight or DDL statement rolls
-- the complete transaction back to the previous function definitions.
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'O hotfix de cadastro administrativo exige public.profiles.'
      using errcode = '55000';
  end if;

  if to_regclass('public.protected_access_accounts') is null then
    raise exception 'O hotfix de cadastro administrativo exige a allowlist protegida.'
      using errcode = '55000',
            hint = 'Aplique primeiro 20260821185000_create_protected_access_allowlist.sql e confira cada conta pelo runbook.';
  end if;
end;
$$;

-- Close the preflight/DDL race without interrupting reads. If a concurrent
-- signup or staff write is in progress, lock_timeout aborts the whole hotfix
-- instead of validating one state and installing functions for another.
lock table auth.users, public.profiles, public.protected_access_accounts
  in share row exclusive mode;

do $$
declare
  unprotected_profile_count bigint;
  orphan_allowlist_count bigint;
  permission_mismatch_count bigint;
  protected_admin_count bigint;
begin
  select count(*)
    into unprotected_profile_count
    from public.profiles as profile
    left join auth.users as auth_user
      on auth_user.id = profile.id
    left join public.protected_access_accounts as protected_account
      on protected_account.email = lower(trim(auth_user.email))
     and protected_account.role = profile.role
     and protected_account.active is true
   where profile.active is true
     and (
       auth_user.id is null
       or nullif(trim(auth_user.email), '') is null
       or protected_account.email is null
       or lower(nullif(trim(profile.email), '')) is distinct from lower(trim(auth_user.email))
     );

  if unprotected_profile_count > 0 then
    raise exception
      'O hotfix foi interrompido: há % perfil(is) ativo(s) sem correspondência exata entre Auth, perfil e allowlist.',
      unprotected_profile_count
      using errcode = '55000',
            hint = 'Confirme individualmente as identidades pelo runbook; nenhum dado ou função foi alterado.';
  end if;

  -- An active orphan could let a future public signup claim a pre-authorized
  -- e-mail. Provision Auth/profile first through the trusted management flow.
  select count(*)
    into orphan_allowlist_count
    from public.protected_access_accounts as protected_account
    left join auth.users as auth_user
      on lower(trim(auth_user.email)) = protected_account.email
    left join public.profiles as profile
      on profile.id = auth_user.id
     and profile.role = protected_account.role
     and profile.active is true
     and lower(nullif(trim(profile.email), '')) = lower(trim(auth_user.email))
   where protected_account.active is true
     and profile.id is null;

  if orphan_allowlist_count > 0 then
    raise exception
      'O hotfix foi interrompido: há % entrada(s) ativa(s) órfã(s) na allowlist.',
      orphan_allowlist_count
      using errcode = '55000',
            hint = 'Revogue ou conclua cada vínculo pelo fluxo administrativo confiável antes de repetir; nada foi alterado.';
  end if;

  -- ensure_current_user_profile synchronizes permissions from the allowlist.
  -- Abort on drift so applying this hotfix cannot silently change an existing
  -- staff account the next time it signs in.
  select count(*)
    into permission_mismatch_count
    from public.profiles as profile
    join auth.users as auth_user
      on auth_user.id = profile.id
    join public.protected_access_accounts as protected_account
      on protected_account.email = lower(trim(auth_user.email))
     and protected_account.role = profile.role
     and protected_account.active is true
   where profile.active is true
     and (
       jsonb_typeof(coalesce(profile.permissions, '[]'::jsonb)) is distinct from 'array'
       or jsonb_typeof(coalesce(protected_account.permissions, '[]'::jsonb)) is distinct from 'array'
       or not (
         coalesce(profile.permissions, '[]'::jsonb) @> coalesce(protected_account.permissions, '[]'::jsonb)
         and coalesce(protected_account.permissions, '[]'::jsonb) @> coalesce(profile.permissions, '[]'::jsonb)
       )
     );

  if permission_mismatch_count > 0 then
    raise exception
      'O hotfix foi interrompido: há % conta(s) com permissões divergentes entre perfil e allowlist.',
      permission_mismatch_count
      using errcode = '55000',
            hint = 'Reconcilie as permissões mínimas no runbook; nenhum dado ou função foi alterado.';
  end if;

  select count(*)
    into protected_admin_count
    from public.profiles as profile
    join auth.users as auth_user
      on auth_user.id = profile.id
    join public.protected_access_accounts as protected_account
      on protected_account.email = lower(trim(auth_user.email))
     and protected_account.role = profile.role
     and protected_account.active is true
   where profile.active is true
     and profile.role = 'admin';

  if protected_admin_count = 0 then
    raise exception 'O hotfix foi interrompido: não há administrador ativo confirmado na allowlist.'
      using errcode = '55000',
            hint = 'Confirme ao menos um administrador pelo runbook; nenhum dado ou função foi alterado.';
  end if;
end;
$$;

-- A profile row is not a trust source. Authorization requires the current Auth
-- identity, the active profile and an active allowlist record with the same
-- normalized e-mail and role.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select profile.role
    from public.profiles as profile
    join auth.users as auth_user
      on auth_user.id = profile.id
    join public.protected_access_accounts as protected_account
      on protected_account.email = lower(trim(auth_user.email))
     and protected_account.role = profile.role
     and protected_account.active is true
   where profile.id = (select auth.uid())
     and profile.active is true
   limit 1
$$;

revoke all on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated;

-- raw_user_meta_data is controlled by the person signing up. It must never
-- choose an administrative role. The trusted allowlist is the sole source for
-- staff identity, role and permissions.
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  protected_account public.protected_access_accounts%rowtype;
begin
  if nullif(trim(new.email), '') is null then
    return new;
  end if;

  select account.*
    into protected_account
    from public.protected_access_accounts as account
   where account.email = lower(trim(new.email))
     and account.active is true;

  if not found then
    return new;
  end if;

  insert into public.profiles (
    id, full_name, email, role, active, permissions, updated_at
  ) values (
    new.id,
    protected_account.full_name,
    protected_account.email,
    protected_account.role,
    true,
    coalesce(protected_account.permissions, '[]'::jsonb),
    now()
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        role = excluded.role,
        active = excluded.active,
        permissions = excluded.permissions,
        updated_at = excluded.updated_at;

  return new;
end;
$$;

revoke all on function public.handle_new_user_profile()
  from public, anon, authenticated;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();

-- Calling the legacy RPC directly used to create secretaria access for every
-- authenticated account without a profile. It now fails closed unless the Auth
-- e-mail is already active in the trusted allowlist.
create or replace function public.ensure_current_user_profile()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_row public.profiles%rowtype;
  protected_account public.protected_access_accounts%rowtype;
  auth_email text;
begin
  if (select auth.uid()) is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  select lower(trim(auth_user.email))
    into auth_email
    from auth.users as auth_user
   where auth_user.id = (select auth.uid());

  if not found or auth_email is null then
    raise exception 'Usuário de autenticação não encontrado.' using errcode = '42501';
  end if;

  select account.*
    into protected_account
    from public.protected_access_accounts as account
   where account.email = auth_email
     and account.active is true;

  if not found then
    raise exception 'Seu perfil ainda não está liberado no clube.' using errcode = '42501';
  end if;

  insert into public.profiles (
    id, full_name, email, role, active, permissions, updated_at
  ) values (
    (select auth.uid()),
    protected_account.full_name,
    protected_account.email,
    protected_account.role,
    true,
    coalesce(protected_account.permissions, '[]'::jsonb),
    now()
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        role = excluded.role,
        active = excluded.active,
        permissions = excluded.permissions,
        updated_at = excluded.updated_at
  returning * into profile_row;

  return profile_row;
end;
$$;

revoke all on function public.ensure_current_user_profile()
  from public, anon;
grant execute on function public.ensure_current_user_profile()
  to authenticated;

comment on function public.handle_new_user_profile() is
  'Cria perfil de equipe somente a partir de uma entrada ativa na allowlist protegida; metadados de cadastro não concedem acesso.';
comment on function public.ensure_current_user_profile() is
  'Sincroniza o perfil da equipe somente para a identidade Auth já autorizada na allowlist protegida.';
comment on function public.current_user_role() is
  'Retorna papel ativo somente quando Auth, perfil e allowlist protegida coincidem.';

commit;
