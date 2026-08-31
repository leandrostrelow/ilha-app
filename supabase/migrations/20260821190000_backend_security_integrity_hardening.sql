begin;

-- Fail and roll back instead of waiting indefinitely behind production writes.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- API roles never need to create database objects. This also reduces the
-- attack surface of legacy SECURITY DEFINER routines that still use a public
-- search path while their fully-qualified replacements are migrated safely.
revoke create on schema public from public, anon, authenticated;

-- Keep the privileged-account allowlist in canonical migration history. Older
-- installations created it from a manual script; fresh/partially migrated
-- installations must not depend on that script or copy profiles into it.
create table if not exists public.protected_access_accounts (
  email text primary key,
  full_name text not null,
  role text not null check (role in ('admin', 'secretaria', 'professor', 'bar')),
  permissions jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  last_recovery_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.protected_access_accounts enable row level security;
revoke all on table public.protected_access_accounts from public, anon, authenticated;
grant select, insert, update on table public.protected_access_accounts to service_role;

-- Do not replace authorization with an empty/unusable allowlist. This check is
-- intentionally fail-closed: an operator must bootstrap a trusted admin with
-- service-role credentials and retry the migration. Runbook: apply migration
-- 20260821185000 first, insert every trusted active staff account in
-- protected_access_accounts using a service-role/admin-only channel, confirm
-- Auth + profiles use the same normalized e-mail and role, then apply this one.
do $$
declare
  missing_relations text;
  missing_columns text;
  unprotected_staff_count bigint;
  orphaned_protected_count bigint;
  ambiguous_staff_permission_count bigint;
  mismatched_staff_permission_count bigint;
  duplicate_athlete_cpf_groups bigint;
  duplicate_client_cpf_groups bigint;
begin
  select string_agg(required_relation.name, ', ' order by required_relation.name)
    into missing_relations
    from (
      values
        ('public.app_client_notification_dispatches'),
        ('public.app_client_notifications'),
        ('public.app_clients'),
        ('public.app_court_bookings'),
        ('public.app_court_schedule_days'),
        ('public.app_announcements'),
        ('public.app_payment_invoices'),
        ('public.app_plan_requests'),
        ('public.app_plans'),
        ('public.app_push_subscriptions'),
        ('public.app_store_requests'),
        ('public.bar_customers'),
        ('public.bar_events'),
        ('public.bar_financial_entries'),
        ('public.bar_inventory_movements'),
        ('public.bar_order_items'),
        ('public.bar_order_payment_parts'),
        ('public.bar_orders'),
        ('public.bar_products'),
        ('public.bar_public_cards'),
        ('public.bar_push_subscriptions'),
        ('public.bar_runtime_settings'),
        ('public.bar_service_requests'),
        ('public.bar_tables'),
        ('public.club_agenda_events'),
        ('public.communication_audiences'),
        ('public.communication_campaigns'),
        ('public.communication_templates'),
        ('public.courts'),
        ('public.financial_transactions'),
        ('public.lesson_enrollments'),
        ('public.lesson_slots'),
        ('public.profiles'),
        ('public.student_interactions'),
        ('public.students'),
        ('public.teachers'),
        ('public.tournament_audit_log'),
        ('public.tournament_athletes'),
        ('public.tournament_matches'),
        ('public.tournament_registrations'),
        ('public.tournaments'),
        ('storage.objects')
    ) as required_relation(name)
   where to_regclass(required_relation.name) is null;

  if missing_relations is not null then
    raise exception 'Pré-requisitos ausentes para a migração: %.', missing_relations
      using errcode = '55000',
            hint = 'Aplique primeiro o schema-base e as migrations funcionais correspondentes; nenhuma alteração de autorização foi aplicada.';
  end if;

  select string_agg(
           required_column.relation_name || '.' || required_column.column_name,
           ', ' order by required_column.relation_name, required_column.column_name
         )
    into missing_columns
    from (
      values
        ('public.app_clients', 'birth_date'),
        ('public.app_clients', 'cpf'),
        ('public.app_clients', 'declared_lesson_slots'),
        ('public.app_clients', 'declared_plan_code'),
        ('public.app_clients', 'declared_plan_name'),
        ('public.app_clients', 'email_verified_at'),
        ('public.app_clients', 'guardian_name'),
        ('public.app_clients', 'guardian_phone'),
        ('public.app_clients', 'registration_completed_at'),
        ('public.app_push_subscriptions', 'auth_key'),
        ('public.app_push_subscriptions', 'enabled'),
        ('public.app_push_subscriptions', 'endpoint'),
        ('public.app_push_subscriptions', 'p256dh'),
        ('public.app_push_subscriptions', 'user_id')
    ) as required_column(relation_name, column_name)
   where not exists (
     select 1
       from pg_catalog.pg_attribute as attribute_row
      where attribute_row.attrelid = pg_catalog.to_regclass(required_column.relation_name)
        and attribute_row.attname = required_column.column_name
        and attribute_row.attnum > 0
        and attribute_row.attisdropped is false
   );

  if missing_columns is not null then
    raise exception 'Colunas obrigatórias ausentes para a migração: %.', missing_columns
      using errcode = '55000',
            hint = 'Reaplique o schema-base de cadastro/Push antes do hardening; nenhuma alteração de autorização foi aplicada.';
  end if;

  if to_regprocedure('public.is_valid_cpf(text)') is null then
    raise exception 'Pré-requisito ausente para a migração: public.is_valid_cpf(text).'
      using errcode = '55000',
            hint = 'Aplique primeiro a migration de cadastro de clientes; nenhuma alteração foi aplicada.';
  end if;

  select count(*)
    into unprotected_staff_count
    from public.profiles as profile
    left join auth.users as auth_user
      on auth_user.id = profile.id
    left join public.protected_access_accounts as protected_account
      on protected_account.email = lower(trim(auth_user.email))
     and protected_account.role = profile.role
     and protected_account.active is true
   where profile.active is true
     and profile.role in ('admin', 'secretaria', 'professor', 'bar')
     and (
       protected_account.email is null
       or lower(nullif(trim(profile.email), '')) is distinct from lower(trim(auth_user.email))
     );

  if unprotected_staff_count > 0 then
    raise exception 'A migração de autorização foi interrompida: % perfil(is) ativo(s) de equipe não consta(m) na allowlist.', unprotected_staff_count
      using errcode = '55000',
            hint = 'Revise cada perfil ativo, inclua somente contas confiáveis em protected_access_accounts ou desative perfis indevidos; depois repita a migração.';
  end if;

  select count(*)
    into orphaned_protected_count
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

  if orphaned_protected_count > 0 then
    raise exception 'A migração de autorização foi interrompida: % entrada(s) ativa(s) da allowlist não possui(em) Auth e perfil ativo correspondentes.', orphaned_protected_count
      using errcode = '55000',
            hint = 'Corrija e-mail/role do perfil ou revogue a entrada órfã. Não mantenha allowlist ativa para conta ausente ou inativa; depois repita a migração.';
  end if;

  select count(*)
    into ambiguous_staff_permission_count
    from public.profiles as profile
    join auth.users as auth_user
      on auth_user.id = profile.id
    join public.protected_access_accounts as protected_account
      on protected_account.email = lower(trim(auth_user.email))
     and protected_account.role = profile.role
     and protected_account.active is true
   where profile.active is true
     and profile.role in ('secretaria', 'professor', 'bar')
     and (
       case
         when jsonb_typeof(coalesce(profile.permissions, '[]'::jsonb)) = 'array'
           then jsonb_array_length(coalesce(profile.permissions, '[]'::jsonb)) = 0
         else true
       end
       or (
         coalesce(profile.permissions, '[]'::jsonb) ? 'bar'
         and not exists (
           select 1
             from jsonb_array_elements_text(
               case
                 when jsonb_typeof(coalesce(profile.permissions, '[]'::jsonb)) = 'array'
                   then coalesce(profile.permissions, '[]'::jsonb)
                 else '[]'::jsonb
               end
             ) as permission(value)
            where permission.value like 'bar.%'
         )
       )
       or (
         profile.role = 'bar'
         and not exists (
           select 1
             from jsonb_array_elements_text(
               case
                 when jsonb_typeof(coalesce(profile.permissions, '[]'::jsonb)) = 'array'
                   then coalesce(profile.permissions, '[]'::jsonb)
                 else '[]'::jsonb
               end
             ) as permission(value)
            where permission.value like 'bar.%'
         )
       )
     );

  if ambiguous_staff_permission_count > 0 then
    raise exception 'A migração de autorização foi interrompida: % perfil(is) ativo(s) usa(m) permissões vazias ou o marcador legado do Bar.', ambiguous_staff_permission_count
      using errcode = '55000',
            hint = 'Defina explicitamente as permissões mínimas de cada conta confiável (incluindo bar.*), sincronize a allowlist e repita a migração; nenhum acesso amplo foi inferido pelo cargo.';
  end if;

  select count(*)
    into mismatched_staff_permission_count
    from public.profiles as profile
    join auth.users as auth_user
      on auth_user.id = profile.id
    join public.protected_access_accounts as protected_account
      on protected_account.email = lower(trim(auth_user.email))
     and protected_account.role = profile.role
     and protected_account.active is true
   where profile.active is true
     and profile.role <> 'admin'
     and (
       jsonb_typeof(coalesce(profile.permissions, '[]'::jsonb)) <> 'array'
       or jsonb_typeof(coalesce(protected_account.permissions, '[]'::jsonb)) <> 'array'
       or not (
         coalesce(profile.permissions, '[]'::jsonb) @> coalesce(protected_account.permissions, '[]'::jsonb)
         and coalesce(protected_account.permissions, '[]'::jsonb) @> coalesce(profile.permissions, '[]'::jsonb)
       )
     );

  if mismatched_staff_permission_count > 0 then
    raise exception 'A migração de autorização foi interrompida: % perfil(is) ativo(s) diverge(m) das permissões da allowlist.', mismatched_staff_permission_count
      using errcode = '55000',
            hint = 'Confirme o conjunto mínimo de permissões de cada conta, mantenha profiles e protected_access_accounts idênticos e repita a migração.';
  end if;

  if not exists (
    select 1
      from public.protected_access_accounts as protected_account
      join auth.users as auth_user
        on lower(trim(auth_user.email)) = protected_account.email
      join public.profiles as profile
        on profile.id = auth_user.id
       and profile.role = protected_account.role
       and profile.active is true
     where protected_account.role = 'admin'
       and protected_account.active is true
  ) then
    raise exception 'A migração de autorização foi interrompida: não há administrador confiável ativo.'
      using errcode = '55000',
            hint = 'Cadastre ao menos um admin em protected_access_accounts com Auth e perfil correspondentes usando service_role; depois repita a migração.';
  end if;

  select count(*)
    into duplicate_athlete_cpf_groups
    from (
      select regexp_replace(athlete.cpf, '[^0-9]', '', 'g') as normalized_cpf
        from public.tournament_athletes as athlete
       where nullif(regexp_replace(coalesce(athlete.cpf, ''), '[^0-9]', '', 'g'), '') is not null
       group by regexp_replace(athlete.cpf, '[^0-9]', '', 'g')
      having count(*) > 1
    ) as duplicates;

  if duplicate_athlete_cpf_groups > 0 then
    raise exception 'A migração de integridade foi interrompida: há % grupo(s) de CPF duplicado em atletas.', duplicate_athlete_cpf_groups
      using errcode = '55000',
            hint = 'Revise e una manualmente os atletas duplicados antes de repetir a migração; nenhum registro foi alterado.';
  end if;

  select count(*)
    into duplicate_client_cpf_groups
    from (
      select regexp_replace(client.cpf, '[^0-9]', '', 'g') as normalized_cpf
        from public.app_clients as client
       where nullif(regexp_replace(coalesce(client.cpf, ''), '[^0-9]', '', 'g'), '') is not null
       group by regexp_replace(client.cpf, '[^0-9]', '', 'g')
      having count(*) > 1
    ) as duplicates;

  if duplicate_client_cpf_groups > 0 then
    raise exception 'A migração de integridade foi interrompida: há % grupo(s) de CPF duplicado em clientes.', duplicate_client_cpf_groups
      using errcode = '55000',
            hint = 'Revise manualmente as contas duplicadas antes de repetir a migração; nenhum registro foi alterado.';
  end if;
end;
$$;

-- Staff authorization must come from server-managed records, never from the
-- user-editable raw_user_meta_data submitted during Auth signup.
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

create or replace function public.has_bar_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    -- Only the administrator role is an unconditional bypass. Secretaria,
    -- professor and bar-linked profiles must carry the exact bar.* grant.
    when public.current_user_role() = 'admin' then true
    else exists (
      select 1
        from public.profiles as profile
        join auth.users as auth_user
          on auth_user.id = profile.id
        join public.protected_access_accounts as protected_account
          on protected_account.email = lower(trim(auth_user.email))
         and protected_account.role = profile.role
         and protected_account.active is true
       where profile.id = (select auth.uid())
         and profile.active is true
         and public.current_user_role() = profile.role
         and coalesce(profile.permissions, '[]'::jsonb) ? p_permission
         and coalesce(protected_account.permissions, '[]'::jsonb) ? p_permission
    )
  end
$$;

create or replace function public.has_club_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.current_user_role() = 'admin' then true
    else exists (
      select 1
        from public.profiles as profile
        join auth.users as auth_user
          on auth_user.id = profile.id
        join public.protected_access_accounts as protected_account
          on protected_account.email = lower(trim(auth_user.email))
         and protected_account.role = profile.role
         and protected_account.active is true
       where profile.id = (select auth.uid())
         and profile.active is true
         and public.current_user_role() = profile.role
         and coalesce(profile.permissions, '[]'::jsonb) ? p_permission
         and coalesce(protected_account.permissions, '[]'::jsonb) ? p_permission
    )
  end
$$;

-- Legacy order RPCs all call is_bar_staff() as their only entry guard. Keep
-- that compatibility helper deliberately scoped to bar.orders so an account
-- with an unrelated Bar permission cannot use a SECURITY DEFINER order RPC or
-- its early-return path to read a command/customer capability. Generic Bar
-- membership uses has_any_bar_permission() instead.
create or replace function public.is_bar_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() = 'admin', false)
    or public.has_bar_permission('bar.orders')
$$;

create or replace function public.has_any_bar_permission()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() = 'admin', false)
    or public.has_bar_permission('bar.overview')
    or public.has_bar_permission('bar.orders')
    or public.has_bar_permission('bar.kitchen')
    or public.has_bar_permission('bar.customers')
    or public.has_bar_permission('bar.products')
    or public.has_bar_permission('bar.menu')
    or public.has_bar_permission('bar.finance')
    or public.has_bar_permission('bar.qrcodes')
    or public.has_bar_permission('bar.events')
    or public.has_bar_permission('bar.access')
$$;

create or replace function public.is_club_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() = 'admin', false)
    or public.has_club_permission('dashboard')
    or public.has_club_permission('clients.read')
    or public.has_club_permission('clients.write')
    or public.has_club_permission('plans')
    or public.has_club_permission('finance.read')
    or public.has_club_permission('finance.write')
    or public.has_club_permission('classes')
    or public.has_club_permission('store')
    or public.has_club_permission('announcements')
    or public.has_club_permission('tournaments')
    or public.has_club_permission('communication')
    or public.has_club_permission('team')
$$;

create or replace function public.is_club_office()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() = 'admin', false)
    or public.has_club_permission('clients.write')
    or public.has_club_permission('plans')
    or public.has_club_permission('finance.write')
    or public.has_club_permission('classes')
    or public.has_club_permission('store')
    or public.has_club_permission('announcements')
    or public.has_club_permission('communication')
    or public.has_club_permission('tournaments')
    or public.has_club_permission('team')
$$;

revoke all on function public.has_bar_permission(text) from public, anon;
revoke all on function public.has_club_permission(text) from public, anon;
revoke all on function public.is_bar_staff() from public, anon;
revoke all on function public.has_any_bar_permission() from public, anon;
revoke all on function public.is_club_staff() from public, anon;
revoke all on function public.is_club_office() from public, anon;
grant execute on function public.has_bar_permission(text) to authenticated;
grant execute on function public.has_club_permission(text) to authenticated;
grant execute on function public.is_bar_staff() to authenticated;
grant execute on function public.has_any_bar_permission() to authenticated;
grant execute on function public.is_club_staff() to authenticated;
grant execute on function public.is_club_office() to authenticated;

create or replace function public.has_tournament_permission(
  p_permission text default 'tournaments.read'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles as profile
      join auth.users as auth_user
        on auth_user.id = profile.id
      join public.protected_access_accounts as protected_account
        on protected_account.email = lower(trim(auth_user.email))
       and protected_account.role = profile.role
       and protected_account.active is true
     where profile.id = (select auth.uid())
       and profile.active is true
       and public.current_user_role() = profile.role
       and (
         profile.role = 'admin'
         or (
           (
             coalesce(profile.permissions, '[]'::jsonb) ? 'tournaments'
             or coalesce(profile.permissions, '[]'::jsonb) ? p_permission
           )
           and (
             coalesce(protected_account.permissions, '[]'::jsonb) ? 'tournaments'
             or coalesce(protected_account.permissions, '[]'::jsonb) ? p_permission
           )
         )
       )
  )
$$;

revoke all on function public.has_tournament_permission(text) from public, anon;
grant execute on function public.has_tournament_permission(text) to authenticated;

-- Only an allowlisted administrator or a service-role management flow can
-- change the allowlist through profiles. This trigger also makes legitimate
-- Club/Bar user creation atomic with the profile write.
create or replace function public.remember_protected_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  canonical_email text;
begin
  select lower(trim(auth_user.email))
    into canonical_email
    from auth.users as auth_user
   where auth_user.id = new.id;
  canonical_email := coalesce(canonical_email, lower(nullif(trim(new.email), '')));

  if canonical_email is null then
    return new;
  end if;

  if lower(nullif(trim(new.email), '')) is distinct from canonical_email then
    raise exception 'O e-mail do perfil de equipe deve ser o mesmo da conta de autenticação.'
      using errcode = '22023';
  end if;

  if jwt_role <> 'service_role'
     and coalesce(public.current_user_role(), '') <> 'admin' then
    return new;
  end if;

  insert into public.protected_access_accounts (
    email, full_name, role, permissions, active, updated_at
  ) values (
    canonical_email,
    coalesce(nullif(trim(new.full_name), ''), split_part(canonical_email, '@', 1)),
    new.role,
    coalesce(new.permissions, '[]'::jsonb),
    new.active,
    now()
  )
  on conflict (email) do update
    set full_name = excluded.full_name,
        role = excluded.role,
        permissions = excluded.permissions,
        active = excluded.active,
        updated_at = excluded.updated_at;

  return new;
end;
$$;

revoke all on function public.remember_protected_profile()
  from public, anon, authenticated;

drop trigger if exists remember_protected_profile_trigger on public.profiles;
create trigger remember_protected_profile_trigger
before insert or update of full_name, email, role, permissions, active
on public.profiles
for each row execute function public.remember_protected_profile();

-- E-mail is part of the protected-account identity. A self-service Auth email
-- change would immediately break the profile/allowlist join and can lock out
-- the staff account. Email migration must use the documented privileged
-- replacement flow instead of the public Auth update endpoint.
create or replace function public.guard_protected_auth_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(nullif(trim(new.email), '')) is distinct from lower(nullif(trim(old.email), ''))
     and exists (
       select 1
         from public.protected_access_accounts as protected_account
        where protected_account.email = lower(trim(old.email))
     ) then
    raise exception 'O e-mail de uma conta protegida não pode ser alterado pelo fluxo comum.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_protected_auth_email_change()
  from public, anon, authenticated;

drop trigger if exists guard_protected_auth_email_change on auth.users;
create trigger guard_protected_auth_email_change
before update of email on auth.users
for each row execute function public.guard_protected_auth_email_change();

-- Explicit staff/profile deletion is a revocation, not an invitation for the
-- recovery RPC to recreate the deleted privilege later.
create or replace function public.forget_protected_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_email text;
begin
  select lower(trim(auth_user.email))
    into canonical_email
    from auth.users as auth_user
   where auth_user.id = old.id;
  canonical_email := coalesce(canonical_email, lower(nullif(trim(old.email), '')));

  if canonical_email is null then
    return old;
  end if;

  -- Any profile deletion is a revocation. RLS/service ownership decides who
  -- may delete the row; the trigger must also run for Auth cascade deletes,
  -- where no end-user JWT is necessarily present.
  update public.protected_access_accounts
     set active = false,
         updated_at = now()
   where email = canonical_email;

  return old;
end;
$$;

revoke all on function public.forget_protected_profile()
  from public, anon, authenticated;

drop trigger if exists forget_protected_profile_trigger on public.profiles;
create trigger forget_protected_profile_trigger
before delete on public.profiles
for each row execute function public.forget_protected_profile();

-- Serialize administrator revocations so two concurrent requests cannot both
-- remove what each observed as a non-final administrator.
create or replace function public.guard_last_protected_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin'
     and old.active is true
     and (
       new.role <> 'admin'
       or new.active is not true
       or new.email is distinct from old.email
     ) then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('ilha:protected-admin-revocation', 0)
    );

    if not exists (
      select 1
        from public.protected_access_accounts as protected_account
        join auth.users as auth_user
          on lower(trim(auth_user.email)) = protected_account.email
        join public.profiles as profile
          on profile.id = auth_user.id
         and profile.role = protected_account.role
         and profile.active is true
       where protected_account.email <> old.email
         and protected_account.role = 'admin'
         and protected_account.active is true
    ) then
      raise exception 'O último administrador ativo não pode ser removido.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_last_protected_admin()
  from public, anon, authenticated;

drop trigger if exists guard_last_protected_admin
  on public.protected_access_accounts;
create trigger guard_last_protected_admin
before update of email, role, active on public.protected_access_accounts
for each row execute function public.guard_last_protected_admin();

create or replace function public.count_active_protected_admins()
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  admin_count bigint;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  select count(*)
    into admin_count
    from public.protected_access_accounts as protected_account
    join auth.users as auth_user
      on lower(trim(auth_user.email)) = protected_account.email
    join public.profiles as profile
      on profile.id = auth_user.id
     and profile.role = protected_account.role
     and profile.active is true
   where protected_account.role = 'admin'
     and protected_account.active is true;

  return admin_count;
end;
$$;

revoke all on function public.count_active_protected_admins()
  from public, anon, authenticated;
grant execute on function public.count_active_protected_admins() to service_role;

create or replace function public.restore_protected_profile(p_email text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  protected_account public.protected_access_accounts%rowtype;
  auth_user auth.users%rowtype;
  restored_profile public.profiles%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  select account.*
    into protected_account
    from public.protected_access_accounts as account
   where account.email = lower(trim(p_email))
     and account.active is true;

  if not found then
    raise exception 'Acesso protegido não encontrado.' using errcode = 'P0002';
  end if;

  select candidate.*
    into auth_user
    from auth.users as candidate
   where lower(trim(candidate.email)) = protected_account.email
   limit 1;

  if not found then
    raise exception 'Usuário de autenticação não encontrado.' using errcode = 'P0002';
  end if;

  insert into public.profiles (
    id, full_name, email, role, active, permissions, updated_at
  ) values (
    auth_user.id,
    protected_account.full_name,
    protected_account.email,
    protected_account.role,
    true,
    protected_account.permissions,
    now()
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        role = excluded.role,
        active = excluded.active,
        permissions = excluded.permissions,
        updated_at = excluded.updated_at
  returning * into restored_profile;

  return restored_profile;
end;
$$;

revoke all on function public.restore_protected_profile(text)
  from public, anon, authenticated;
grant execute on function public.restore_protected_profile(text) to service_role;

create or replace function public.claim_protected_access_recovery(
  p_email text,
  p_cooldown_seconds integer default 3600
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_at timestamptz;
  cooldown_seconds integer := greatest(60, least(coalesce(p_cooldown_seconds, 3600), 86400));
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  update public.protected_access_accounts as account
     set last_recovery_at = now(),
         updated_at = now()
   where account.email = lower(trim(p_email))
     and account.active is true
     and (
       account.last_recovery_at is null
       or account.last_recovery_at <= now() - (cooldown_seconds * interval '1 second')
     )
  returning account.last_recovery_at into claimed_at;

  return claimed_at;
end;
$$;

revoke all on function public.claim_protected_access_recovery(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_protected_access_recovery(text, integer)
  to service_role;

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

revoke all on function public.handle_new_user_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();

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

revoke all on function public.ensure_current_user_profile() from public, anon;
grant execute on function public.ensure_current_user_profile() to authenticated;

-- These two self-service RPCs are the only client entry points allowed to
-- change onboarding state. A transaction-local marker lets the trigger below
-- distinguish their validated writes from an arbitrary REST PATCH.
-- The legacy Auth trigger copied user-editable metadata directly into
-- app_clients before validation; remove it so signup and completion cannot
-- bypass these RPC contracts.
drop trigger if exists on_auth_user_created_app_client on auth.users;

create or replace function public.ensure_current_app_client(
  p_full_name text default null,
  p_phone text default null
)
returns public.app_clients
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_user auth.users%rowtype;
  client_row public.app_clients%rowtype;
  candidate_name text;
  candidate_phone text;
begin
  if (select auth.uid()) is null then
    raise exception 'Usuário não autenticado.' using errcode = '42501';
  end if;

  select candidate.*
    into auth_user
    from auth.users as candidate
   where candidate.id = (select auth.uid());

  if not found then
    raise exception 'Conta não encontrada. Faça um novo cadastro.' using errcode = '42501';
  end if;

  if nullif(trim(p_full_name), '') is not null
     and (
       length(trim(p_full_name)) not between 5 and 120
       or position(' ' in trim(p_full_name)) = 0
     ) then
    raise exception 'Informe seu nome completo.' using errcode = '22023';
  end if;
  candidate_phone := regexp_replace(
    coalesce(nullif(trim(p_phone), ''), auth_user.raw_user_meta_data ->> 'phone', ''),
    '[^0-9]',
    '',
    'g'
  );
  if nullif(trim(p_phone), '') is not null and length(candidate_phone) not between 10 and 13 then
    raise exception 'Informe um telefone válido com DDD.' using errcode = '22023';
  end if;
  if length(candidate_phone) not between 10 and 13 then
    candidate_phone := null;
  end if;
  candidate_name := left(
    coalesce(
      nullif(trim(p_full_name), ''),
      nullif(trim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(auth_user.email, ''), '@', 1), ''),
      'Cliente Ilha'
    ),
    120
  );

  perform pg_catalog.set_config('ilha.onboarding_client_id', auth_user.id::text, true);

  insert into public.app_clients (
    id, full_name, email, phone, status, last_login_at
  ) values (
    auth_user.id,
    candidate_name,
    coalesce(auth_user.email, ''),
    candidate_phone,
    'ATIVO',
    now()
  )
  on conflict (id) do update
    set full_name = coalesce(nullif(trim(p_full_name), ''), public.app_clients.full_name),
        phone = coalesce(nullif(trim(p_phone), ''), public.app_clients.phone),
        email = excluded.email,
        status = case
          when upper(coalesce(public.app_clients.status, '')) = 'BLOQUEADO' then 'BLOQUEADO'
          else 'ATIVO'
        end,
        last_login_at = now(),
        updated_at = now()
  returning * into client_row;

  return client_row;
end;
$$;

revoke all on function public.ensure_current_app_client(text, text) from public, anon;
grant execute on function public.ensure_current_app_client(text, text) to authenticated;

create or replace function public.complete_current_app_registration(
  p_full_name text,
  p_phone text,
  p_cpf text,
  p_declared_plan_code text,
  p_birth_date date,
  p_declared_lesson_slots jsonb default '[]'::jsonb,
  p_guardian_name text default null,
  p_guardian_phone text default null
)
returns public.app_clients
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_user auth.users%rowtype;
  declared_plan public.app_plans%rowtype;
  client_row public.app_clients%rowtype;
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  normalized_cpf text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  normalized_guardian_phone text := regexp_replace(coalesce(p_guardian_phone, ''), '[^0-9]', '', 'g');
  required_lessons integer := 0;
  today_sp date := (now() at time zone 'America/Sao_Paulo')::date;
  age_years integer;
  violated_constraint text;
begin
  if (select auth.uid()) is null then
    raise exception 'Entre novamente para concluir o cadastro.' using errcode = '42501';
  end if;

  select candidate.*
    into auth_user
    from auth.users as candidate
   where candidate.id = (select auth.uid());

  if not found then
    raise exception 'Conta não encontrada. Faça um novo cadastro.' using errcode = '42501';
  end if;
  if auth_user.email_confirmed_at is null then
    raise exception 'Confirme seu e-mail antes de continuar.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_full_name, ''))) not between 5 and 120
     or position(' ' in trim(p_full_name)) = 0 then
    raise exception 'Informe seu nome completo.' using errcode = '22023';
  end if;
  if length(normalized_phone) not between 10 and 13 then
    raise exception 'Informe um telefone válido com DDD.' using errcode = '22023';
  end if;
  if not public.is_valid_cpf(normalized_cpf) then
    raise exception 'Informe um CPF válido.' using errcode = '22023';
  end if;
  if p_birth_date is null
     or p_birth_date > today_sp
     or p_birth_date < today_sp - interval '120 years' then
    raise exception 'Informe uma data de nascimento válida.' using errcode = '22023';
  end if;

  age_years := extract(year from age(today_sp, p_birth_date));
  if age_years not between 1 and 120 then
    raise exception 'Informe uma data de nascimento válida.' using errcode = '22023';
  end if;
  if age_years < 18
     and (
       length(trim(coalesce(p_guardian_name, ''))) not between 5 and 120
       or length(normalized_guardian_phone) not between 10 and 13
     ) then
    raise exception 'Informe o responsável e o telefone para o aluno menor de idade.' using errcode = '22023';
  end if;

  if nullif(trim(p_declared_plan_code), '') is not null then
    select plan.*
      into declared_plan
      from public.app_plans as plan
     where plan.code = trim(p_declared_plan_code)
       and plan.active is true;
    if not found then
      raise exception 'Escolha um plano válido.' using errcode = '22023';
    end if;
    required_lessons := greatest(0, coalesce(declared_plan.weekly_lessons, 0));
  end if;

  if jsonb_typeof(coalesce(p_declared_lesson_slots, '[]'::jsonb)) <> 'array' then
    raise exception 'Informe os dias e horários das aulas.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_declared_lesson_slots, '[]'::jsonb)) < required_lessons then
    raise exception 'Informe todos os dias e horários das aulas.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_declared_lesson_slots, '[]'::jsonb)) > 14 then
    raise exception 'Foram informados horários demais para o cadastro.' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('ilha.onboarding_client_id', auth_user.id::text, true);

  insert into public.app_clients (
    id, full_name, email, phone, cpf, birth_date, age, guardian_name, guardian_phone,
    status, declared_plan_code, declared_plan_name, declared_lesson_slots,
    email_verified_at, registration_completed_at, last_login_at
  ) values (
    auth_user.id,
    trim(p_full_name),
    coalesce(auth_user.email, ''),
    normalized_phone,
    normalized_cpf,
    p_birth_date,
    age_years,
    nullif(trim(coalesce(p_guardian_name, '')), ''),
    nullif(normalized_guardian_phone, ''),
    'ATIVO',
    declared_plan.code,
    declared_plan.name,
    coalesce(p_declared_lesson_slots, '[]'::jsonb),
    auth_user.email_confirmed_at,
    now(),
    now()
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        phone = excluded.phone,
        cpf = excluded.cpf,
        birth_date = excluded.birth_date,
        age = excluded.age,
        guardian_name = excluded.guardian_name,
        guardian_phone = excluded.guardian_phone,
        status = case
          when upper(coalesce(public.app_clients.status, '')) = 'BLOQUEADO' then 'BLOQUEADO'
          else 'ATIVO'
        end,
        declared_plan_code = excluded.declared_plan_code,
        declared_plan_name = excluded.declared_plan_name,
        declared_lesson_slots = excluded.declared_lesson_slots,
        email_verified_at = excluded.email_verified_at,
        registration_completed_at = excluded.registration_completed_at,
        last_login_at = excluded.last_login_at,
        updated_at = now()
  returning * into client_row;

  return client_row;
exception
  when unique_violation then
    get stacked diagnostics violated_constraint = constraint_name;
    if coalesce(violated_constraint, '') like '%cpf%' then
      raise exception 'Este CPF já está vinculado a outra conta. Fale com a equipe do clube.'
        using errcode = '23505';
    elsif coalesce(violated_constraint, '') like '%email%' then
      raise exception 'Este e-mail já está vinculado a outra conta. Entre com o acesso existente.'
        using errcode = '23505';
    else
      raise exception 'Já existe uma conta com estes dados. Fale com a equipe do clube.'
        using errcode = '23505';
    end if;
end;
$$;

revoke all on function public.complete_current_app_registration(
  text, text, text, text, date, jsonb, text, text
) from public, anon;
grant execute on function public.complete_current_app_registration(
  text, text, text, text, date, jsonb, text, text
) to authenticated;

alter table public.app_clients
  add column if not exists plan_cancellation_requested_at timestamptz,
  add column if not exists plan_cancel_at date,
  add column if not exists reenrollment_fee_required boolean not null default false;

-- Administrative client fields require the exact clients.write permission.
-- Onboarding and cancellation fields only accept writes made by their
-- validated RPC for the same authenticated client.
create or replace function public.guard_app_client_entitlements()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  onboarding_write boolean :=
    coalesce(current_setting('ilha.onboarding_client_id', true), '') = new.id::text;
  cancellation_write boolean :=
    coalesce(current_setting('ilha.plan_cancellation_client_id', true), '') = new.id::text;
  client_is_minor boolean;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'authenticated'
     and not public.has_club_permission('clients.write')
     and tg_op = 'INSERT' then
    if not onboarding_write or new.id is distinct from (select auth.uid()) then
      raise exception 'Crie a conta pelo fluxo de cadastro do Ilha Play.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'authenticated'
     and not public.has_club_permission('clients.write')
     and tg_op = 'UPDATE' then
    if new.full_name is distinct from old.full_name then
      new.full_name := trim(new.full_name);
      if (
         length(new.full_name) not between 5 and 120
         or position(' ' in new.full_name) = 0
      ) then
        raise exception 'Informe seu nome completo (até 120 caracteres).' using errcode = '22023';
      end if;
    end if;

    if new.phone is distinct from old.phone then
      new.phone := nullif(regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g'), '');
      if length(coalesce(new.phone, '')) not between 10 and 13 then
        raise exception 'Informe um telefone válido com DDD.' using errcode = '22023';
      end if;
    end if;

    if new.cpf is distinct from old.cpf then
      new.cpf := nullif(regexp_replace(coalesce(new.cpf, ''), '[^0-9]', '', 'g'), '');
      if new.cpf is null and new.registration_completed_at is not null then
        raise exception 'O CPF é obrigatório para um cadastro concluído.' using errcode = '22023';
      end if;
      if new.cpf is not null and not public.is_valid_cpf(new.cpf) then
        raise exception 'Informe um CPF válido.' using errcode = '22023';
      end if;
    end if;

    if new.birth_date is distinct from old.birth_date then
      if new.birth_date is null and new.registration_completed_at is not null then
        raise exception 'A data de nascimento é obrigatória para um cadastro concluído.' using errcode = '22023';
      end if;
      if new.birth_date is not null
         and (
           new.birth_date > (now() at time zone 'America/Sao_Paulo')::date
           or new.birth_date < (now() at time zone 'America/Sao_Paulo')::date - interval '120 years'
         ) then
        raise exception 'Informe uma data de nascimento válida.' using errcode = '22023';
      end if;
      new.age := case
        when new.birth_date is null then null
        else extract(year from age((now() at time zone 'America/Sao_Paulo')::date, new.birth_date))::integer
      end;
      if new.age is not null and new.age not between 1 and 120 then
        raise exception 'Informe uma data de nascimento válida.' using errcode = '22023';
      end if;
    elsif new.age is distinct from old.age then
      if new.birth_date is not null then
        new.age := extract(year from age((now() at time zone 'America/Sao_Paulo')::date, new.birth_date))::integer;
      elsif new.age is not null and new.age not between 1 and 120 then
        raise exception 'Informe uma idade válida.' using errcode = '22023';
      end if;
    end if;

    if new.guardian_name is distinct from old.guardian_name then
      new.guardian_name := nullif(trim(coalesce(new.guardian_name, '')), '');
      if length(coalesce(new.guardian_name, '')) > 120 then
        raise exception 'O nome do responsável deve ter no máximo 120 caracteres.' using errcode = '22023';
      end if;
    end if;
    if new.guardian_phone is distinct from old.guardian_phone then
      new.guardian_phone := nullif(regexp_replace(coalesce(new.guardian_phone, ''), '[^0-9]', '', 'g'), '');
      if new.guardian_phone is not null and length(new.guardian_phone) not between 10 and 13 then
        raise exception 'Informe um telefone válido para o responsável.' using errcode = '22023';
      end if;
    end if;

    client_is_minor :=
      (new.age is not null and new.age < 18)
      or (
        new.birth_date is not null
        and extract(year from age((now() at time zone 'America/Sao_Paulo')::date, new.birth_date)) < 18
      );
    if client_is_minor
       and (
         new.age is distinct from old.age
         or new.birth_date is distinct from old.birth_date
         or new.guardian_name is distinct from old.guardian_name
         or new.guardian_phone is distinct from old.guardian_phone
       )
       and (
         length(coalesce(new.guardian_name, '')) not between 5 and 120
         or position(' ' in coalesce(new.guardian_name, '')) = 0
         or length(coalesce(new.guardian_phone, '')) not between 10 and 13
       ) then
      raise exception 'Informe o nome completo e o telefone do responsável.' using errcode = '22023';
    end if;
    if new.notes is distinct from old.notes then
      new.notes := nullif(trim(coalesce(new.notes, '')), '');
      if length(coalesce(new.notes, '')) > 4000 then
        raise exception 'As observações devem ter no máximo 4.000 caracteres.' using errcode = '22023';
      end if;
    end if;
    if new.profile_photo is distinct from old.profile_photo
       and new.profile_photo is not null
       and (
         length(new.profile_photo) > 750000
         or not (
           new.profile_photo ~ '^data:image/(jpeg|png|webp|gif);base64,'
           or (length(new.profile_photo) <= 2048 and new.profile_photo ~ '^https://')
         )
       ) then
      raise exception 'A foto de perfil deve ser uma imagem válida e menor.' using errcode = '22023';
    end if;

    if new.created_at is distinct from old.created_at then
      raise exception 'A data de criação da conta não pode ser alterada.' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;

  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'authenticated'
     and not public.has_club_permission('clients.write')
     and tg_op = 'UPDATE'
     and (
       new.client_type is distinct from old.client_type
       or new.source is distinct from old.source
       or new.official_plan_id is distinct from old.official_plan_id
       or new.official_plan_code is distinct from old.official_plan_code
       or new.official_plan_name is distinct from old.official_plan_name
       or new.plan_amount is distinct from old.plan_amount
       or new.weekly_lessons is distinct from old.weekly_lessons
       or new.preferred_days is distinct from old.preferred_days
       or new.due_day is distinct from old.due_day
       or (
         not onboarding_write
         and (
           new.email is distinct from old.email
           or new.status is distinct from old.status
           or new.declared_plan_code is distinct from old.declared_plan_code
           or new.declared_plan_name is distinct from old.declared_plan_name
           or new.declared_lesson_slots is distinct from old.declared_lesson_slots
           or new.registration_completed_at is distinct from old.registration_completed_at
           or new.email_verified_at is distinct from old.email_verified_at
           or new.last_login_at is distinct from old.last_login_at
         )
       )
       or (
         not cancellation_write
         and (
           new.plan_cancellation_requested_at is distinct from old.plan_cancellation_requested_at
           or new.plan_cancel_at is distinct from old.plan_cancel_at
           or new.reenrollment_fee_required is distinct from old.reenrollment_fee_required
         )
       )
     ) then
    raise exception 'O plano e as permissões desta conta só podem ser alterados pela equipe administrativa.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_app_client_entitlements()
  from public, anon, authenticated;

drop trigger if exists guard_app_client_entitlements on public.app_clients;
create trigger guard_app_client_entitlements
before insert or update on public.app_clients
for each row execute function public.guard_app_client_entitlements();

-- Superseded by the complete field-level guard above. Some installations
-- still carry this trigger from the manual base schema.
drop trigger if exists protect_app_client_official_fields on public.app_clients;
drop function if exists public.protect_app_client_official_fields();

-- Client rows are created only by the validated SECURITY DEFINER RPCs above.
-- Removing direct INSERT also prevents a first-write bypass of the UPDATE guard.
drop policy if exists "clients insert own" on public.app_clients;

drop policy if exists "clients read own or staff" on public.app_clients;
drop policy if exists "clients read own or permitted staff" on public.app_clients;
create policy "clients read own or permitted staff"
on public.app_clients for select to authenticated
using (
  id = (select auth.uid())
  or (select public.has_club_permission('clients.read'))
  or (select public.has_club_permission('clients.write'))
);

drop policy if exists "clients update own or staff" on public.app_clients;
drop policy if exists "clients update own or office" on public.app_clients;
drop policy if exists "clients update own or permitted office" on public.app_clients;
create policy "clients update own or permitted office"
on public.app_clients for update to authenticated
using (
  id = (select auth.uid())
  or (select public.has_club_permission('clients.write'))
)
with check (
  id = (select auth.uid())
  or (select public.has_club_permission('clients.write'))
);

drop policy if exists "clients staff manage" on public.app_clients;
drop policy if exists "clients permitted office delete" on public.app_clients;
create policy "clients permitted office delete"
on public.app_clients for delete to authenticated
using (
  (select public.has_club_permission('clients.write'))
);

-- The historical implementation compared NULL <> 'admin'. In PL/pgSQL that
-- condition is NULL (not true), so an ordinary authenticated client crossed a
-- SECURITY DEFINER gate and could delete Auth users. Match the ADM's explicit
-- clients.write permission and make every unauthorised state fail closed.
create or replace function public.delete_app_client_account(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not coalesce(public.has_club_permission('clients.write'), false) then
    raise exception 'Seu acesso não permite excluir alunos.' using errcode = '42501';
  end if;

  if p_client_id is null then
    raise exception 'Aluno inválido.' using errcode = '22023';
  end if;
  if p_client_id = (select auth.uid()) then
    raise exception 'Você não pode excluir a própria conta administrativa.' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles as profile where profile.id = p_client_id) then
    raise exception 'Contas da equipe não podem ser excluídas pela ficha de alunos.' using errcode = '42501';
  end if;

  perform 1
    from public.app_clients as client
   where client.id = p_client_id
   for update;
  if not found then
    raise exception 'Aluno não encontrado.' using errcode = 'P0002';
  end if;

  update public.app_court_bookings as booking
     set status = 'CANCELADO',
         challenge_kind = case when booking.status = 'PENDENTE' then null else booking.challenge_kind end,
         challenge_expires_at = case when booking.status = 'PENDENTE' then null else booking.challenge_expires_at end,
         updated_at = now()
   where booking.status <> 'CANCELADO'
     and (booking.client_id = p_client_id or booking.opponent_client_id = p_client_id);

  delete from auth.users as auth_user where auth_user.id = p_client_id;
  if not found then
    raise exception 'Conta de acesso do aluno não encontrada.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.delete_app_client_account(uuid) from public, anon;
grant execute on function public.delete_app_client_account(uuid) to authenticated;

-- Replace the legacy role-gated approval RPC so a linked account with the
-- explicit clients.write permission works regardless of its primary role.
create or replace function public.approve_app_client(p_client_id uuid)
returns public.app_clients
language plpgsql
security definer
set search_path = ''
as $$
declare
  approved_client public.app_clients%rowtype;
  required_lessons integer := 0;
  age_years integer;
  today_sp date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if (select auth.uid()) is null
     or not public.has_club_permission('clients.write') then
    raise exception 'Somente a equipe autorizada pode liberar clientes.'
      using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'Informe o cliente.' using errcode = '22023';
  end if;

  select client.*
    into approved_client
    from public.app_clients as client
   where client.id = p_client_id
   for update;
  if not found then
    raise exception 'Aluno não encontrado.' using errcode = 'P0002';
  end if;

  if approved_client.registration_completed_at is null
     or approved_client.birth_date is null
     or approved_client.birth_date > today_sp
     or approved_client.birth_date < today_sp - interval '120 years'
     or not public.is_valid_cpf(
       regexp_replace(coalesce(approved_client.cpf, ''), '[^0-9]', '', 'g')
     )
     or length(regexp_replace(coalesce(approved_client.phone, ''), '[^0-9]', '', 'g')) not between 10 and 13
     or length(trim(coalesce(approved_client.full_name, ''))) not between 5 and 120
     or position(' ' in trim(coalesce(approved_client.full_name, ''))) = 0 then
    raise exception 'Complete nome, telefone, CPF e nascimento antes de liberar o acesso.'
      using errcode = '22023';
  end if;

  age_years := extract(year from age(today_sp, approved_client.birth_date))::integer;
  if age_years not between 1 and 120 then
    raise exception 'A data de nascimento do aluno é inválida.' using errcode = '22023';
  end if;
  if age_years < 18
     and (
       length(trim(coalesce(approved_client.guardian_name, ''))) not between 5 and 120
       or position(' ' in trim(coalesce(approved_client.guardian_name, ''))) = 0
       or length(regexp_replace(coalesce(approved_client.guardian_phone, ''), '[^0-9]', '', 'g')) not between 10 and 13
     ) then
    raise exception 'Informe o responsável e o telefone do aluno menor de idade.'
      using errcode = '22023';
  end if;

  if nullif(trim(coalesce(approved_client.declared_plan_code, '')), '') is not null then
    select greatest(0, coalesce(plan.weekly_lessons, 0))
      into required_lessons
      from public.app_plans as plan
     where plan.code = approved_client.declared_plan_code
       and plan.active is true;
    if not found then
      raise exception 'O plano declarado não está mais disponível. Revise o cadastro antes de liberar.'
        using errcode = '22023';
    end if;
  end if;
  if jsonb_typeof(coalesce(approved_client.declared_lesson_slots, '[]'::jsonb)) <> 'array' then
    raise exception 'Complete os dias e horários das aulas antes de liberar o acesso.'
      using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(approved_client.declared_lesson_slots, '[]'::jsonb)) < required_lessons
     or jsonb_array_length(coalesce(approved_client.declared_lesson_slots, '[]'::jsonb)) > 14 then
    raise exception 'Complete os dias e horários das aulas antes de liberar o acesso.'
      using errcode = '22023';
  end if;

  update auth.users
     set email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where id = p_client_id;

  if not found then
    raise exception 'Conta de acesso não encontrada.' using errcode = 'P0002';
  end if;

  update public.app_clients as client
     set status = 'ATIVO',
         email_verified_at = coalesce(client.email_verified_at, now()),
         updated_at = now()
   where client.id = p_client_id
  returning client.* into approved_client;

  return approved_client;
end;
$$;

revoke all on function public.approve_app_client(uuid) from public, anon;
grant execute on function public.approve_app_client(uuid) to authenticated;

create or replace function public.request_my_app_plan_cancellation()
returns public.app_clients
language plpgsql
security definer
set search_path = ''
as $$
declare
  client_row public.app_clients%rowtype;
  plan_row public.app_plans%rowtype;
  due_day integer;
  today_sp date := (now() at time zone 'America/Sao_Paulo')::date;
  month_start date;
  month_last date;
  cancellation_date date;
begin
  if (select auth.uid()) is null then
    raise exception 'Entre novamente para solicitar o cancelamento.' using errcode = '42501';
  end if;

  select client.*
    into client_row
    from public.app_clients as client
   where client.id = (select auth.uid())
   for update;

  if not found
     or upper(coalesce(client_row.status, '')) <> 'ATIVO'
     or client_row.registration_completed_at is null then
    raise exception 'Somente uma conta ativa e com cadastro concluído pode cancelar um plano.'
      using errcode = '42501';
  end if;
  if client_row.plan_cancellation_requested_at is not null
     or client_row.plan_cancel_at is not null then
    return client_row;
  end if;

  select plan.*
    into plan_row
    from public.app_plans as plan
   where (
       (client_row.official_plan_id is not null and plan.id = client_row.official_plan_id)
       or (
         nullif(client_row.official_plan_code, '') is not null
         and plan.code = client_row.official_plan_code
       )
     )
   order by (plan.id = client_row.official_plan_id) desc
   limit 1;

  if not found then
    raise exception 'Nenhum plano está vinculado a esta conta.' using errcode = '23514';
  end if;

  due_day := coalesce(client_row.due_day, plan_row.default_due_day);
  if due_day is null or due_day not between 1 and 31 then
    raise exception 'O dia de renovação do plano precisa ser definido pela secretaria antes do cancelamento.'
      using errcode = '23514';
  end if;

  month_start := date_trunc('month', today_sp::timestamp)::date;
  month_last := (month_start + interval '1 month - 1 day')::date;
  cancellation_date := pg_catalog.make_date(
    extract(year from month_start)::integer,
    extract(month from month_start)::integer,
    least(due_day, extract(day from month_last)::integer)
  );
  if cancellation_date <= today_sp then
    month_start := (month_start + interval '1 month')::date;
    month_last := (month_start + interval '1 month - 1 day')::date;
    cancellation_date := pg_catalog.make_date(
      extract(year from month_start)::integer,
      extract(month from month_start)::integer,
      least(due_day, extract(day from month_last)::integer)
    );
  end if;

  perform pg_catalog.set_config('ilha.plan_cancellation_client_id', client_row.id::text, true);

  update public.app_clients as client
     set plan_cancellation_requested_at = now(),
         plan_cancel_at = cancellation_date,
         reenrollment_fee_required = true,
         updated_at = now()
   where client.id = client_row.id
  returning client.* into client_row;

  return client_row;
end;
$$;

revoke all on function public.request_my_app_plan_cancellation() from public, anon;
grant execute on function public.request_my_app_plan_cancellation() to authenticated;

-- Requests submitted through REST must be catalog-derived. Otherwise a client
-- could forge a price/plan and the ADM fallback would approve the forged data.
create or replace function public.normalize_app_plan_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan_row public.app_plans%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'authenticated'
     and not public.has_club_permission('plans') then
    if new.client_id is distinct from (select auth.uid()) then
      raise exception 'A solicitação só pode ser criada para a própria conta.' using errcode = '42501';
    end if;

    select plan.*
      into plan_row
      from public.app_plans as plan
     where plan.code = trim(new.plan_code)
       and plan.active is true;
    if not found then
      raise exception 'Escolha um plano ativo do catálogo.' using errcode = '22023';
    end if;
    if jsonb_typeof(coalesce(new.requested_days, '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(new.requested_days, '[]'::jsonb)) > 14 then
      raise exception 'Os dias solicitados são inválidos.' using errcode = '22023';
    end if;
    if length(coalesce(new.notes, '')) > 2000 then
      raise exception 'A observação deve ter no máximo 2.000 caracteres.' using errcode = '22023';
    end if;

    new.plan_code := plan_row.code;
    new.plan_name := plan_row.name;
    new.amount := plan_row.amount;
    new.membership_type := plan_row.type;
    new.weekly_lessons := plan_row.weekly_lessons;
    new.preferred_due_day := plan_row.default_due_day;
    new.requested_days := coalesce(new.requested_days, '[]'::jsonb);
    new.status := 'SOLICITADO';
    new.notes := nullif(trim(coalesce(new.notes, '')), '');
    new.created_at := now();
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_app_plan_request() from public, anon, authenticated;
drop trigger if exists normalize_app_plan_request on public.app_plan_requests;
create trigger normalize_app_plan_request
before insert on public.app_plan_requests
for each row execute function public.normalize_app_plan_request();

create or replace function public.normalize_app_store_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'authenticated'
     and not public.has_club_permission('store') then
    if new.client_id is distinct from (select auth.uid()) then
      raise exception 'A solicitação só pode ser criada para a própria conta.' using errcode = '42501';
    end if;
    if new.quantity not between 1 and 20 then
      raise exception 'A quantidade solicitada deve ficar entre 1 e 20.' using errcode = '22023';
    end if;
    if length(coalesce(new.notes, '')) > 1000 then
      raise exception 'A observação deve ter no máximo 1.000 caracteres.' using errcode = '22023';
    end if;

    new.product_code := lower(trim(new.product_code));
    new.product_name := case new.product_code
      when 'camisa_preta' then 'Camisa preta Ilha'
      when 'camisa_roxa' then 'Camisa roxa Ilha'
      when 'camisa_verde' then 'Camisa verde Ilha'
      when 'bolinhas' then 'Bolinhas de tênis'
      when 'encordoamento' then 'Encordoamento'
      else null
    end;
    if new.product_name is null then
      raise exception 'Escolha um produto disponível na Ilha Store.' using errcode = '22023';
    end if;

    new.amount := 0;
    new.status := 'SOLICITADO';
    new.notes := nullif(trim(coalesce(new.notes, '')), '');
    new.created_at := now();
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_app_store_request() from public, anon, authenticated;
drop trigger if exists normalize_app_store_request on public.app_store_requests;
create trigger normalize_app_store_request
before insert on public.app_store_requests
for each row execute function public.normalize_app_store_request();

-- Financial/service requests and user notifications contain private data.
-- Clients keep access to their own rows; staff access is limited to the office.
drop policy if exists "plan requests read own or staff" on public.app_plan_requests;
drop policy if exists "plan requests read own or office" on public.app_plan_requests;
drop policy if exists "plan requests read own or permitted staff" on public.app_plan_requests;
create policy "plan requests read own or permitted staff"
on public.app_plan_requests for select to authenticated
using (
  client_id = (select auth.uid())
  or (select public.has_club_permission('plans'))
);

drop policy if exists "plan requests staff manage" on public.app_plan_requests;
drop policy if exists "plan requests permitted office manage" on public.app_plan_requests;
create policy "plan requests permitted office manage"
on public.app_plan_requests for all to authenticated
using (
  (select public.has_club_permission('plans'))
)
with check (
  (select public.has_club_permission('plans'))
);

drop policy if exists "store requests read own or staff" on public.app_store_requests;
drop policy if exists "store requests read own or office" on public.app_store_requests;
drop policy if exists "store requests read own or permitted staff" on public.app_store_requests;
create policy "store requests read own or permitted staff"
on public.app_store_requests for select to authenticated
using (
  client_id = (select auth.uid())
  or (select public.has_club_permission('store'))
);

drop policy if exists "store requests staff manage" on public.app_store_requests;
drop policy if exists "store requests permitted office manage" on public.app_store_requests;
create policy "store requests permitted office manage"
on public.app_store_requests for all to authenticated
using (
  (select public.has_club_permission('store'))
)
with check (
  (select public.has_club_permission('store'))
);

-- Role labels alone do not authorize operational modules. Keep the public
-- client-facing reads, but require the same explicit permissions used by ADM.
drop policy if exists "plans read active or staff" on public.app_plans;
drop policy if exists "plans read active or permitted staff" on public.app_plans;
create policy "plans read active or permitted staff"
on public.app_plans for select to authenticated
using (active is true or (select public.has_club_permission('plans')));

drop policy if exists "plans staff manage" on public.app_plans;
drop policy if exists "plans permitted office manage" on public.app_plans;
create policy "plans permitted office manage"
on public.app_plans for all to authenticated
using (
  (select public.has_club_permission('plans'))
)
with check (
  (select public.has_club_permission('plans'))
);

create or replace function public.admin_save_app_plan(
  p_id uuid,
  p_code text,
  p_name text,
  p_type text,
  p_amount numeric,
  p_weekly_lessons integer,
  p_default_due_day integer,
  p_active boolean,
  p_description text
)
returns public.app_plans
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_plan public.app_plans%rowtype;
  normalized_code text := lower(trim(coalesce(p_code, '')));
  normalized_type text := lower(trim(coalesce(p_type, 'aluno')));
begin
  if (select auth.uid()) is null
     or not public.has_club_permission('plans') then
    raise exception 'Apenas a gestão autorizada pode alterar planos.'
      using errcode = '42501';
  end if;
  if normalized_code !~ '^[a-z0-9][a-z0-9_-]{0,79}$'
     or length(trim(coalesce(p_name, ''))) not between 2 and 120 then
    raise exception 'Informe nome e código válidos para o plano.'
      using errcode = '22023';
  end if;
  if normalized_type not in ('aluno', 'mensalista', 'avulso', 'outro')
     or coalesce(p_amount, 0) < 0
     or coalesce(p_weekly_lessons, 0) not between 0 and 14
     or (p_default_due_day is not null and p_default_due_day not between 1 and 31)
     or length(coalesce(p_description, '')) > 2000 then
    raise exception 'Revise tipo, valor, aulas e vencimento do plano.'
      using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.app_plans (
      code, name, type, amount, weekly_lessons, default_due_day,
      active, description, updated_at
    ) values (
      normalized_code,
      trim(p_name),
      normalized_type,
      coalesce(p_amount, 0),
      coalesce(p_weekly_lessons, 0),
      p_default_due_day,
      coalesce(p_active, true),
      nullif(trim(coalesce(p_description, '')), ''),
      now()
    ) returning * into saved_plan;
  else
    update public.app_plans as plan
       set code = normalized_code,
           name = trim(p_name),
           type = normalized_type,
           amount = coalesce(p_amount, 0),
           weekly_lessons = coalesce(p_weekly_lessons, 0),
           default_due_day = p_default_due_day,
           active = coalesce(p_active, true),
           description = nullif(trim(coalesce(p_description, '')), ''),
           updated_at = now()
     where plan.id = p_id
    returning plan.* into saved_plan;
    if not found then
      raise exception 'Plano não encontrado.' using errcode = 'P0002';
    end if;
  end if;
  return saved_plan;
end;
$$;

revoke all on function public.admin_save_app_plan(
  uuid, text, text, text, numeric, integer, integer, boolean, text
) from public, anon;
grant execute on function public.admin_save_app_plan(
  uuid, text, text, text, numeric, integer, integer, boolean, text
) to authenticated;

drop policy if exists "announcements read active or staff" on public.app_announcements;
drop policy if exists "announcements read active or permitted staff" on public.app_announcements;
create policy "announcements read active or permitted staff"
on public.app_announcements for select to authenticated
using (active is true or (select public.has_club_permission('announcements')));

drop policy if exists "announcements staff manage" on public.app_announcements;
drop policy if exists "announcements permitted staff manage" on public.app_announcements;
create policy "announcements permitted staff manage"
on public.app_announcements for all to authenticated
using ((select public.has_club_permission('announcements')))
with check ((select public.has_club_permission('announcements')));

drop policy if exists "staff read teachers" on public.teachers;
drop policy if exists "permitted staff read teachers" on public.teachers;
create policy "permitted staff read teachers"
on public.teachers for select to authenticated
using ((select public.has_club_permission('classes')));

drop policy if exists "office manage teachers" on public.teachers;
drop policy if exists "permitted office manage teachers" on public.teachers;
create policy "permitted office manage teachers"
on public.teachers for all to authenticated
using (
  (select public.has_club_permission('classes'))
)
with check (
  (select public.has_club_permission('classes'))
);

drop policy if exists "staff read students" on public.students;
drop policy if exists "permitted staff read students" on public.students;
create policy "permitted staff read students"
on public.students for select to authenticated
using ((select public.has_club_permission('classes')));

drop policy if exists "staff manage students" on public.students;
drop policy if exists "office manage students" on public.students;
drop policy if exists "permitted staff manage students" on public.students;
create policy "permitted staff manage students"
on public.students for all to authenticated
using ((select public.has_club_permission('classes')))
with check ((select public.has_club_permission('classes')));

drop policy if exists "staff read courts" on public.courts;
drop policy if exists "permitted staff read courts" on public.courts;
create policy "permitted staff read courts"
on public.courts for select to authenticated
using ((select public.has_club_permission('classes')));

drop policy if exists "office manage courts" on public.courts;
drop policy if exists "permitted office manage courts" on public.courts;
create policy "permitted office manage courts"
on public.courts for all to authenticated
using (
  (select public.has_club_permission('classes'))
)
with check (
  (select public.has_club_permission('classes'))
);

drop policy if exists "staff read lesson_slots" on public.lesson_slots;
drop policy if exists "permitted staff read lesson slots" on public.lesson_slots;
create policy "permitted staff read lesson slots"
on public.lesson_slots for select to authenticated
using ((select public.has_club_permission('classes')));

drop policy if exists "office manage lesson_slots" on public.lesson_slots;
drop policy if exists "permitted office manage lesson slots" on public.lesson_slots;
create policy "permitted office manage lesson slots"
on public.lesson_slots for all to authenticated
using (
  (select public.has_club_permission('classes'))
)
with check (
  (select public.has_club_permission('classes'))
);

drop policy if exists "staff read lesson_enrollments" on public.lesson_enrollments;
drop policy if exists "permitted staff read lesson enrollments" on public.lesson_enrollments;
create policy "permitted staff read lesson enrollments"
on public.lesson_enrollments for select to authenticated
using ((select public.has_club_permission('classes')));

drop policy if exists "staff manage lesson_enrollments" on public.lesson_enrollments;
drop policy if exists "permitted staff manage lesson enrollments" on public.lesson_enrollments;
create policy "permitted staff manage lesson enrollments"
on public.lesson_enrollments for all to authenticated
using ((select public.has_club_permission('classes')))
with check ((select public.has_club_permission('classes')));

drop policy if exists "staff read student_interactions" on public.student_interactions;
drop policy if exists "permitted staff read student interactions" on public.student_interactions;
create policy "permitted staff read student interactions"
on public.student_interactions for select to authenticated
using ((select public.has_club_permission('classes')));

drop policy if exists "staff manage student_interactions" on public.student_interactions;
drop policy if exists "permitted staff manage student interactions" on public.student_interactions;
create policy "permitted staff manage student interactions"
on public.student_interactions for all to authenticated
using ((select public.has_club_permission('classes')))
with check ((select public.has_club_permission('classes')));

drop policy if exists "staff read club_agenda_events" on public.club_agenda_events;
drop policy if exists "permitted staff read club agenda" on public.club_agenda_events;
create policy "permitted staff read club agenda"
on public.club_agenda_events for select to authenticated
using ((select public.has_club_permission('classes')));

drop policy if exists "staff manage club_agenda_events" on public.club_agenda_events;
drop policy if exists "permitted staff manage club agenda" on public.club_agenda_events;
create policy "permitted staff manage club agenda"
on public.club_agenda_events for all to authenticated
using ((select public.has_club_permission('classes')))
with check ((select public.has_club_permission('classes')));

drop policy if exists "office read financial_transactions" on public.financial_transactions;
drop policy if exists "permitted staff read financial transactions" on public.financial_transactions;
create policy "permitted staff read financial transactions"
on public.financial_transactions for select to authenticated
using (
  (select public.has_club_permission('finance.read'))
  or (select public.has_club_permission('finance.write'))
);

drop policy if exists "office manage financial_transactions" on public.financial_transactions;
drop policy if exists "permitted office manage financial transactions" on public.financial_transactions;
create policy "permitted office manage financial transactions"
on public.financial_transactions for all to authenticated
using (
  (select public.has_club_permission('finance.write'))
)
with check (
  (select public.has_club_permission('finance.write'))
);

drop policy if exists "staff read communication_audiences" on public.communication_audiences;
drop policy if exists "permitted staff read communication audiences" on public.communication_audiences;
create policy "permitted staff read communication audiences"
on public.communication_audiences for select to authenticated
using ((select public.has_club_permission('communication')));

drop policy if exists "office manage communication_audiences" on public.communication_audiences;
drop policy if exists "permitted staff manage communication audiences" on public.communication_audiences;
create policy "permitted staff manage communication audiences"
on public.communication_audiences for all to authenticated
using ((select public.has_club_permission('communication')))
with check ((select public.has_club_permission('communication')));

drop policy if exists "staff read communication_templates" on public.communication_templates;
drop policy if exists "permitted staff read communication templates" on public.communication_templates;
create policy "permitted staff read communication templates"
on public.communication_templates for select to authenticated
using ((select public.has_club_permission('communication')));

drop policy if exists "office manage communication_templates" on public.communication_templates;
drop policy if exists "permitted staff manage communication templates" on public.communication_templates;
create policy "permitted staff manage communication templates"
on public.communication_templates for all to authenticated
using ((select public.has_club_permission('communication')))
with check ((select public.has_club_permission('communication')));

drop policy if exists "staff read communication_campaigns" on public.communication_campaigns;
drop policy if exists "permitted staff read communication campaigns" on public.communication_campaigns;
create policy "permitted staff read communication campaigns"
on public.communication_campaigns for select to authenticated
using ((select public.has_club_permission('communication')));

drop policy if exists "office manage communication_campaigns" on public.communication_campaigns;
drop policy if exists "permitted staff manage communication campaigns" on public.communication_campaigns;
create policy "permitted staff manage communication campaigns"
on public.communication_campaigns for all to authenticated
using ((select public.has_club_permission('communication')))
with check ((select public.has_club_permission('communication')));

-- The availability RPC bypasses RLS by design so it can show occupied slots.
-- Restrict it to active Play clients (or schedule staff) and never disclose a
-- third party's name merely to show that a slot is occupied.
create or replace function public.get_app_court_availability(
  p_start_date date,
  p_end_date date
)
returns table (
  booking_date date,
  starts_at time without time zone,
  court_name text,
  status text,
  is_mine boolean,
  client_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_is_staff boolean := coalesce(public.has_club_permission('classes'), false);
  today_sp date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if caller_id is null then
    raise exception 'Entre no Ilha Play para consultar a agenda.' using errcode = '42501';
  end if;
  if not caller_is_staff
     and not exists (
       select 1
         from public.app_clients as client
        where client.id = caller_id
          and upper(coalesce(client.status, '')) = 'ATIVO'
          and client.registration_completed_at is not null
     ) then
    raise exception 'Seu cadastro precisa estar ativo para consultar a agenda.' using errcode = '42501';
  end if;
  if p_start_date is null
     or p_end_date is null
     or p_start_date < today_sp
     or p_end_date < p_start_date
     or p_end_date > today_sp + 45 then
    raise exception 'Período da agenda inválido.' using errcode = '22023';
  end if;

  return query
  select
    booking.booking_date,
    booking.starts_at,
    booking.court_name,
    booking.status,
    booking.client_id = caller_id or booking.opponent_client_id = caller_id,
    case
      when booking.status = 'BLOQUEADO' then null
      when caller_is_staff
        or booking.client_id = caller_id
        or booking.opponent_client_id = caller_id
        then nullif(trim(booking.client_name), '')
      else null
    end
  from public.app_court_bookings as booking
  where booking.booking_date between p_start_date and p_end_date
    and booking.status <> 'CANCELADO'
  order by booking.booking_date, booking.starts_at, booking.court_name;
end;
$$;

revoke all on function public.get_app_court_availability(date, date)
  from public, anon;
grant execute on function public.get_app_court_availability(date, date)
  to authenticated;

-- Clients use the locking/validation RPCs for create, cancel and challenge
-- responses. Direct REST writes would bypass schedule, collision and state
-- transition rules, so only the office may mutate bookings through RLS.
drop policy if exists "court bookings read authenticated" on public.app_court_bookings;
drop policy if exists "court bookings read own or staff" on public.app_court_bookings;
drop policy if exists "court bookings read own participant or staff" on public.app_court_bookings;
drop policy if exists "court bookings read own or permitted staff" on public.app_court_bookings;
create policy "court bookings read own or permitted staff"
on public.app_court_bookings for select to authenticated
using (
  client_id = (select auth.uid())
  or opponent_client_id = (select auth.uid())
  or (select public.has_club_permission('classes'))
);

drop policy if exists "court bookings insert own" on public.app_court_bookings;
drop policy if exists "court bookings update own or staff" on public.app_court_bookings;
drop policy if exists "court bookings staff insert" on public.app_court_bookings;
drop policy if exists "court bookings staff update" on public.app_court_bookings;
drop policy if exists "court bookings staff delete" on public.app_court_bookings;
drop policy if exists "court bookings staff manage" on public.app_court_bookings;

create policy "court bookings office insert"
on public.app_court_bookings for insert to authenticated
with check (
  (select public.has_club_permission('classes'))
);

create policy "court bookings office update"
on public.app_court_bookings for update to authenticated
using (
  (select public.has_club_permission('classes'))
)
with check (
  (select public.has_club_permission('classes'))
);

create policy "court bookings office delete"
on public.app_court_bookings for delete to authenticated
using (
  (select public.has_club_permission('classes'))
);

drop policy if exists "court schedule staff manage" on public.app_court_schedule_days;
drop policy if exists "court schedule staff insert" on public.app_court_schedule_days;
drop policy if exists "court schedule staff update" on public.app_court_schedule_days;
drop policy if exists "court schedule staff delete" on public.app_court_schedule_days;
drop policy if exists "court schedule permitted staff insert" on public.app_court_schedule_days;
drop policy if exists "court schedule permitted staff update" on public.app_court_schedule_days;
drop policy if exists "court schedule permitted staff delete" on public.app_court_schedule_days;

create policy "court schedule permitted staff insert"
on public.app_court_schedule_days for insert to authenticated
with check ((select public.has_club_permission('classes')));

create policy "court schedule permitted staff update"
on public.app_court_schedule_days for update to authenticated
using ((select public.has_club_permission('classes')))
with check ((select public.has_club_permission('classes')));

create policy "court schedule permitted staff delete"
on public.app_court_schedule_days for delete to authenticated
using ((select public.has_club_permission('classes')));

create or replace function public.admin_configure_app_court_day(
  p_schedule_date date,
  p_enabled boolean,
  p_notes text default null,
  p_slot_times time without time zone[] default null
)
returns table (
  user_id uuid,
  title text,
  body text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  participant record;
  notification_title text := 'Reserva de quadra cancelada';
  notification_body text;
  allowed_times time without time zone[] := coalesce(
    p_slot_times,
    array[
      time '14:00', time '15:00', time '16:00', time '17:00',
      time '18:00', time '19:00', time '20:00'
    ]
  );
begin
  if (select auth.uid()) is null
     or not public.has_club_permission('classes') then
    raise exception 'Acesso não autorizado.' using errcode = '42501';
  end if;
  if p_schedule_date is null then
    raise exception 'Informe a data.' using errcode = '22023';
  end if;
  if cardinality(allowed_times) = 0
     or cardinality(allowed_times) > 24
     or exists (
       select 1 from unnest(allowed_times) as slot_time
        where slot_time is null
     ) then
    raise exception 'Os horários informados são inválidos.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('court-schedule:' || p_schedule_date::text, 0)
  );

  insert into public.app_court_schedule_days (
    schedule_date, enabled, notes, slot_times
  ) values (
    p_schedule_date,
    coalesce(p_enabled, false),
    nullif(trim(coalesce(p_notes, '')), ''),
    allowed_times
  )
  on conflict (schedule_date) do update
    set enabled = excluded.enabled,
        notes = excluded.notes,
        slot_times = excluded.slot_times,
        updated_at = now();

  if coalesce(p_enabled, false) then
    return;
  end if;

  notification_body := 'Sua reserva de ' || to_char(p_schedule_date, 'DD/MM/YYYY') ||
    ' foi cancelada porque o clube bloqueou esse dia' ||
    case
      when nullif(trim(coalesce(p_notes, '')), '') is not null
        then ': ' || trim(p_notes) || '.'
      else '.'
    end;

  for participant in
    select distinct booking_participant.user_id
      from public.app_court_bookings as booking
      cross join lateral (
        select booking.client_id as user_id
        union
        select booking.opponent_client_id
      ) as booking_participant
     where booking.booking_date = p_schedule_date
       and booking.status <> 'CANCELADO'
       and booking_participant.user_id is not null
  loop
    insert into public.app_client_notifications (
      user_id, title, body, link_url, event_type, dedupe_key
    ) values (
      participant.user_id,
      notification_title,
      notification_body,
      '/?view=notifications',
      'QUADRA_CANCELADA',
      'court-day-cancelled:' || p_schedule_date::text || ':' || participant.user_id::text
    ) on conflict (dedupe_key) where dedupe_key is not null do nothing;

    user_id := participant.user_id;
    title := notification_title;
    body := notification_body;
    return next;
  end loop;

  perform pg_catalog.set_config('app.court_admin_configure', 'on', true);
  update public.app_court_bookings as booking
     set status = 'CANCELADO',
         challenge_kind = case when booking.status = 'PENDENTE' then null else booking.challenge_kind end,
         challenge_expires_at = case when booking.status = 'PENDENTE' then null else booking.challenge_expires_at end,
         updated_at = now()
   where booking.booking_date = p_schedule_date
     and booking.status <> 'CANCELADO';
end;
$$;

revoke all on function public.admin_configure_app_court_day(
  date, boolean, text, time without time zone[]
) from public, anon;
grant execute on function public.admin_configure_app_court_day(
  date, boolean, text, time without time zone[]
) to authenticated;

-- A generic stock adjustment is a catalog/inventory action. The legacy RPC
-- accepted any Bar role, which let bar.orders exploit the narrower stock
-- exception needed by order-processing RPCs.
create or replace function public.bar_adjust_stock(
  p_product_id uuid,
  p_type text,
  p_quantity numeric,
  p_reason text default null,
  p_unit_cost numeric default null
)
returns public.bar_products
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_row public.bar_products%rowtype;
  signed_quantity numeric;
begin
  if (select auth.uid()) is null
     or not coalesce(public.has_bar_permission('bar.products'), false) then
    raise exception 'Seu acesso do Bar não permite ajustar estoque.' using errcode = '42501';
  end if;
  if p_product_id is null
     or p_type is null
     or p_type not in ('ENTRADA', 'SAIDA', 'AJUSTE', 'PERDA')
     or coalesce(p_quantity, 0) <= 0
     or p_quantity > 1000000
     or (p_unit_cost is not null and (p_unit_cost < 0 or p_unit_cost > 1000000000))
     or length(coalesce(p_reason, '')) > 500 then
    raise exception 'Movimentação de estoque inválida.' using errcode = '22023';
  end if;

  signed_quantity := case when p_type = 'ENTRADA' then p_quantity else -p_quantity end;

  update public.bar_products as product
     set stock_quantity = product.stock_quantity + signed_quantity,
         cost_price = case when p_unit_cost is not null then p_unit_cost else product.cost_price end,
         updated_at = now()
   where product.id = p_product_id
     and product.stock_quantity + signed_quantity >= 0
  returning product.* into product_row;
  if not found then
    raise exception 'Produto não encontrado ou estoque insuficiente.' using errcode = '23514';
  end if;

  insert into public.bar_inventory_movements (
    product_id, type, quantity, unit_cost, reason, created_by
  ) values (
    product_row.id,
    p_type,
    signed_quantity,
    coalesce(p_unit_cost, product_row.cost_price),
    nullif(trim(coalesce(p_reason, '')), ''),
    (select auth.uid())
  );
  return product_row;
end;
$$;

revoke all on function public.bar_adjust_stock(uuid, text, numeric, text, numeric)
  from public, anon;
grant execute on function public.bar_adjust_stock(uuid, text, numeric, text, numeric)
  to authenticated;

-- Enforce Bar permissions in the database. The trigger also protects writes
-- made by legacy SECURITY DEFINER Bar RPCs, which otherwise bypass RLS. Calls
-- from non-staff customers remain governed by the capability checks inside the
-- public RPCs; direct REST writes still fail their RLS policies.
create or replace function public.guard_bar_staff_table_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  staff_role text;
  allowed boolean := false;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'authenticated' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  staff_role := public.current_user_role();
  if staff_role is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if staff_role = 'admin' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'bar_products' then
    allowed := public.has_bar_permission('bar.products')
      or (
        tg_op = 'UPDATE'
        and (
          public.has_bar_permission('bar.menu')
          or public.has_bar_permission('bar.orders')
        )
      );
    if allowed
       and not public.has_bar_permission('bar.products')
       then
      if public.has_bar_permission('bar.menu') and public.has_bar_permission('bar.orders') then
        allowed :=
          (to_jsonb(new) - 'menu_visible' - 'menu_tv_visible' - 'menu_featured' - 'menu_sort_order' - 'stock_quantity' - 'updated_at')
          is not distinct from
          (to_jsonb(old) - 'menu_visible' - 'menu_tv_visible' - 'menu_featured' - 'menu_sort_order' - 'stock_quantity' - 'updated_at');
      elsif public.has_bar_permission('bar.menu') then
        allowed :=
          (to_jsonb(new) - 'menu_visible' - 'menu_tv_visible' - 'menu_featured' - 'menu_sort_order' - 'updated_at')
          is not distinct from
          (to_jsonb(old) - 'menu_visible' - 'menu_tv_visible' - 'menu_featured' - 'menu_sort_order' - 'updated_at');
      else
        -- Order RPCs reserve/release stock atomically. They may not edit
        -- catalog names, pricing, minimum stock, images or visibility.
        allowed :=
          (to_jsonb(new) - 'stock_quantity' - 'updated_at')
          is not distinct from
          (to_jsonb(old) - 'stock_quantity' - 'updated_at');
      end if;
    end if;
  elsif tg_table_name in ('bar_tables', 'bar_public_cards') then
    allowed := public.has_bar_permission('bar.qrcodes');
  elsif tg_table_name = 'bar_customers' then
    allowed := public.has_bar_permission('bar.customers') or public.has_bar_permission('bar.orders');
  elsif tg_table_name = 'bar_orders' then
    allowed := public.has_bar_permission('bar.orders')
      or (tg_op = 'UPDATE' and public.has_bar_permission('bar.kitchen'));
    if allowed
       and not public.has_bar_permission('bar.orders')
       and (
         (to_jsonb(new) - 'status' - 'updated_at')
         is distinct from
         (to_jsonb(old) - 'status' - 'updated_at')
       ) then
      allowed := false;
    end if;
    if allowed
       and not public.has_bar_permission('bar.orders')
       and not (
         new.status = old.status
         or (old.status = 'ABERTA' and new.status in ('EM_PREPARO', 'PRONTA'))
         or (old.status = 'EM_PREPARO' and new.status = 'PRONTA')
       ) then
      allowed := false;
    end if;
  elsif tg_table_name = 'bar_order_items' then
    allowed := public.has_bar_permission('bar.orders')
      or (tg_op = 'UPDATE' and public.has_bar_permission('bar.kitchen'));
    if allowed
       and not public.has_bar_permission('bar.orders')
       and (
         (to_jsonb(new) - 'status' - 'updated_at')
         is distinct from
         (to_jsonb(old) - 'status' - 'updated_at')
       ) then
      allowed := false;
    end if;
    if allowed
       and not public.has_bar_permission('bar.orders')
       and not (
         new.status = old.status
         or (old.status = 'SOLICITADO' and new.status in ('EM_PREPARO', 'PRONTO'))
         or (old.status = 'EM_PREPARO' and new.status = 'PRONTO')
         or (old.status = 'PRONTO' and new.status = 'ENTREGUE')
       ) then
      allowed := false;
    end if;
  elsif tg_table_name = 'bar_service_requests' then
    allowed := public.has_bar_permission('bar.orders')
      or (tg_op = 'UPDATE' and public.has_bar_permission('bar.kitchen'));
    if allowed
       and not public.has_bar_permission('bar.orders')
       and (
         (to_jsonb(new) - 'status' - 'handled_by' - 'handled_at' - 'updated_at')
         is distinct from
         (to_jsonb(old) - 'status' - 'handled_by' - 'handled_at' - 'updated_at')
       ) then
      allowed := false;
    end if;
    if allowed
       and not public.has_bar_permission('bar.orders')
       and not (
         new.status = old.status
         or (old.status = 'PENDENTE' and new.status in ('EM_ATENDIMENTO', 'CONCLUIDO'))
         or (old.status = 'EM_ATENDIMENTO' and new.status = 'CONCLUIDO')
       ) then
      allowed := false;
    end if;
  elsif tg_table_name = 'bar_inventory_movements' then
    allowed := public.has_bar_permission('bar.products') or public.has_bar_permission('bar.orders');
  elsif tg_table_name in ('bar_financial_entries', 'bar_order_payment_parts') then
    allowed := public.has_bar_permission('bar.finance') or public.has_bar_permission('bar.orders');
    if allowed
       and tg_table_name = 'bar_financial_entries'
       and not public.has_bar_permission('bar.finance')
       and (
         (case when tg_op = 'DELETE' then old.order_id else new.order_id end) is null
         or coalesce(case when tg_op = 'DELETE' then old.type else new.type end, '') <> 'RECEITA'
       ) then
      allowed := false;
    end if;
  elsif tg_table_name = 'bar_events' then
    allowed := public.has_bar_permission('bar.events');
  elsif tg_table_name = 'bar_runtime_settings' then
    allowed := public.has_bar_permission('bar.menu') or public.has_bar_permission('bar.qrcodes');
  elsif tg_table_name = 'bar_push_subscriptions' then
    allowed := (
        public.has_bar_permission('bar.overview')
        or public.has_bar_permission('bar.orders')
        or public.has_bar_permission('bar.kitchen')
      )
      and coalesce(case when tg_op = 'DELETE' then old.user_id else new.user_id end, (select auth.uid())) = (select auth.uid());
  end if;

  if not allowed then
    raise exception 'Seu acesso do Bar não permite esta alteração.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.guard_bar_staff_table_write() from public, anon, authenticated;

drop trigger if exists guard_bar_staff_products_write on public.bar_products;
create trigger guard_bar_staff_products_write before insert or update or delete on public.bar_products
for each row execute function public.guard_bar_staff_table_write();
drop trigger if exists guard_bar_staff_tables_write on public.bar_tables;
create trigger guard_bar_staff_tables_write before insert or update or delete on public.bar_tables
for each row execute function public.guard_bar_staff_table_write();
drop trigger if exists guard_bar_staff_cards_write on public.bar_public_cards;
create trigger guard_bar_staff_cards_write before insert or update or delete on public.bar_public_cards
for each row execute function public.guard_bar_staff_table_write();
drop trigger if exists guard_bar_staff_customers_write on public.bar_customers;
create trigger guard_bar_staff_customers_write before insert or update or delete on public.bar_customers
for each row execute function public.guard_bar_staff_table_write();
drop trigger if exists guard_bar_staff_orders_write on public.bar_orders;
create trigger guard_bar_staff_orders_write before insert or update or delete on public.bar_orders
for each row execute function public.guard_bar_staff_table_write();
drop trigger if exists guard_bar_staff_items_write on public.bar_order_items;
create trigger guard_bar_staff_items_write before insert or update or delete on public.bar_order_items
for each row execute function public.guard_bar_staff_table_write();
drop trigger if exists guard_bar_staff_service_write on public.bar_service_requests;
create trigger guard_bar_staff_service_write before insert or update or delete on public.bar_service_requests
for each row execute function public.guard_bar_staff_table_write();
drop trigger if exists guard_bar_staff_inventory_write on public.bar_inventory_movements;
create trigger guard_bar_staff_inventory_write before insert or update or delete on public.bar_inventory_movements
for each row execute function public.guard_bar_staff_table_write();
drop trigger if exists guard_bar_staff_finance_write on public.bar_financial_entries;
create trigger guard_bar_staff_finance_write before insert or update or delete on public.bar_financial_entries
for each row execute function public.guard_bar_staff_table_write();
drop trigger if exists guard_bar_staff_payment_parts_write on public.bar_order_payment_parts;
create trigger guard_bar_staff_payment_parts_write before insert or update or delete on public.bar_order_payment_parts
for each row execute function public.guard_bar_staff_table_write();
drop trigger if exists guard_bar_staff_events_write on public.bar_events;
create trigger guard_bar_staff_events_write before insert or update or delete on public.bar_events
for each row execute function public.guard_bar_staff_table_write();
drop trigger if exists guard_bar_staff_runtime_write on public.bar_runtime_settings;
create trigger guard_bar_staff_runtime_write before insert or update or delete on public.bar_runtime_settings
for each row execute function public.guard_bar_staff_table_write();
drop trigger if exists guard_bar_staff_push_write on public.bar_push_subscriptions;
create trigger guard_bar_staff_push_write before insert or update or delete on public.bar_push_subscriptions
for each row execute function public.guard_bar_staff_table_write();

drop policy if exists "bar staff manage products" on public.bar_products;
drop policy if exists "bar staff read products by permission" on public.bar_products;
drop policy if exists "bar staff write products by permission" on public.bar_products;
create policy "bar staff read products by permission" on public.bar_products for select to authenticated
using ((select public.has_bar_permission('bar.overview')) or (select public.has_bar_permission('bar.orders')) or (select public.has_bar_permission('bar.kitchen')) or (select public.has_bar_permission('bar.products')) or (select public.has_bar_permission('bar.menu')) or (select public.has_bar_permission('bar.finance')));
create policy "bar staff write products by permission" on public.bar_products for all to authenticated
using ((select public.has_bar_permission('bar.products')) or (select public.has_bar_permission('bar.menu')))
with check ((select public.has_bar_permission('bar.products')) or (select public.has_bar_permission('bar.menu')));

drop policy if exists "bar staff manage tables" on public.bar_tables;
drop policy if exists "bar staff read tables by permission" on public.bar_tables;
drop policy if exists "bar staff write tables by permission" on public.bar_tables;
create policy "bar staff read tables by permission" on public.bar_tables for select to authenticated
using ((select public.has_bar_permission('bar.overview')) or (select public.has_bar_permission('bar.orders')) or (select public.has_bar_permission('bar.qrcodes')));
create policy "bar staff write tables by permission" on public.bar_tables for all to authenticated
using ((select public.has_bar_permission('bar.qrcodes')))
with check ((select public.has_bar_permission('bar.qrcodes')));

drop policy if exists "bar staff manage public cards" on public.bar_public_cards;
drop policy if exists "bar staff read cards by permission" on public.bar_public_cards;
drop policy if exists "bar staff write cards by permission" on public.bar_public_cards;
create policy "bar staff read cards by permission" on public.bar_public_cards for select to authenticated
using ((select public.has_bar_permission('bar.orders')) or (select public.has_bar_permission('bar.qrcodes')));
create policy "bar staff write cards by permission" on public.bar_public_cards for all to authenticated
using ((select public.has_bar_permission('bar.qrcodes')))
with check ((select public.has_bar_permission('bar.qrcodes')));

drop policy if exists "bar staff manage customers" on public.bar_customers;
drop policy if exists "bar staff read customers by permission" on public.bar_customers;
drop policy if exists "bar staff write customers by permission" on public.bar_customers;
create policy "bar staff read customers by permission" on public.bar_customers for select to authenticated
using ((select public.has_bar_permission('bar.customers')) or (select public.has_bar_permission('bar.orders')) or (select public.has_bar_permission('bar.finance')));
create policy "bar staff write customers by permission" on public.bar_customers for all to authenticated
using ((select public.has_bar_permission('bar.customers')) or (select public.has_bar_permission('bar.orders')))
with check ((select public.has_bar_permission('bar.customers')) or (select public.has_bar_permission('bar.orders')));

drop policy if exists "bar staff manage orders" on public.bar_orders;
drop policy if exists "bar staff read orders by permission" on public.bar_orders;
drop policy if exists "bar staff write orders by permission" on public.bar_orders;
create policy "bar staff read orders by permission" on public.bar_orders for select to authenticated
using ((select public.has_bar_permission('bar.overview')) or (select public.has_bar_permission('bar.orders')) or (select public.has_bar_permission('bar.kitchen')) or (select public.has_bar_permission('bar.customers')) or (select public.has_bar_permission('bar.finance')));
create policy "bar staff write orders by permission" on public.bar_orders for all to authenticated
using ((select public.has_bar_permission('bar.orders')) or (select public.has_bar_permission('bar.kitchen')))
with check ((select public.has_bar_permission('bar.orders')) or (select public.has_bar_permission('bar.kitchen')));

drop policy if exists "bar staff manage order items" on public.bar_order_items;
drop policy if exists "bar staff read items by permission" on public.bar_order_items;
drop policy if exists "bar staff write items by permission" on public.bar_order_items;
create policy "bar staff read items by permission" on public.bar_order_items for select to authenticated
using ((select public.has_bar_permission('bar.overview')) or (select public.has_bar_permission('bar.orders')) or (select public.has_bar_permission('bar.kitchen')) or (select public.has_bar_permission('bar.customers')) or (select public.has_bar_permission('bar.finance')));
create policy "bar staff write items by permission" on public.bar_order_items for all to authenticated
using ((select public.has_bar_permission('bar.orders')) or (select public.has_bar_permission('bar.kitchen')))
with check ((select public.has_bar_permission('bar.orders')) or (select public.has_bar_permission('bar.kitchen')));

drop policy if exists "bar staff manage service requests" on public.bar_service_requests;
drop policy if exists "bar staff read service by permission" on public.bar_service_requests;
drop policy if exists "bar staff write service by permission" on public.bar_service_requests;
create policy "bar staff read service by permission" on public.bar_service_requests for select to authenticated
using ((select public.has_bar_permission('bar.overview')) or (select public.has_bar_permission('bar.orders')) or (select public.has_bar_permission('bar.kitchen')));
create policy "bar staff write service by permission" on public.bar_service_requests for all to authenticated
using ((select public.has_bar_permission('bar.orders')) or (select public.has_bar_permission('bar.kitchen')))
with check ((select public.has_bar_permission('bar.orders')) or (select public.has_bar_permission('bar.kitchen')));

drop policy if exists "bar staff manage inventory" on public.bar_inventory_movements;
drop policy if exists "bar staff read inventory by permission" on public.bar_inventory_movements;
drop policy if exists "bar staff write inventory by permission" on public.bar_inventory_movements;
create policy "bar staff read inventory by permission" on public.bar_inventory_movements for select to authenticated
using ((select public.has_bar_permission('bar.overview')) or (select public.has_bar_permission('bar.products')) or (select public.has_bar_permission('bar.finance')));
create policy "bar staff write inventory by permission" on public.bar_inventory_movements for all to authenticated
using ((select public.has_bar_permission('bar.products')))
with check ((select public.has_bar_permission('bar.products')));

drop policy if exists "bar staff manage finance" on public.bar_financial_entries;
drop policy if exists "bar staff read finance by permission" on public.bar_financial_entries;
drop policy if exists "bar staff write finance by permission" on public.bar_financial_entries;
create policy "bar staff read finance by permission" on public.bar_financial_entries for select to authenticated
using ((select public.has_bar_permission('bar.finance')) or (select public.has_bar_permission('bar.orders')));
create policy "bar staff write finance by permission" on public.bar_financial_entries for all to authenticated
using ((select public.has_bar_permission('bar.finance')) or (select public.has_bar_permission('bar.orders')))
with check ((select public.has_bar_permission('bar.finance')) or (select public.has_bar_permission('bar.orders')));

drop policy if exists "bar staff manage order payment parts" on public.bar_order_payment_parts;
drop policy if exists "bar staff read payment parts by permission" on public.bar_order_payment_parts;
drop policy if exists "bar staff write payment parts by permission" on public.bar_order_payment_parts;
create policy "bar staff read payment parts by permission" on public.bar_order_payment_parts for select to authenticated
using ((select public.has_bar_permission('bar.finance')) or (select public.has_bar_permission('bar.orders')));
create policy "bar staff write payment parts by permission" on public.bar_order_payment_parts for all to authenticated
using ((select public.has_bar_permission('bar.finance')) or (select public.has_bar_permission('bar.orders')))
with check ((select public.has_bar_permission('bar.finance')) or (select public.has_bar_permission('bar.orders')));

drop policy if exists "bar staff manage events" on public.bar_events;
drop policy if exists "bar staff read events by permission" on public.bar_events;
drop policy if exists "bar staff write events by permission" on public.bar_events;
create policy "bar staff read events by permission" on public.bar_events for select to authenticated
using ((select public.has_bar_permission('bar.events')) or (select public.has_bar_permission('bar.overview')));
create policy "bar staff write events by permission" on public.bar_events for all to authenticated
using ((select public.has_bar_permission('bar.events')))
with check ((select public.has_bar_permission('bar.events')));

drop policy if exists "bar staff manage runtime settings" on public.bar_runtime_settings;
drop policy if exists "bar staff read runtime by permission" on public.bar_runtime_settings;
drop policy if exists "bar staff write runtime by permission" on public.bar_runtime_settings;
create policy "bar staff read runtime by permission" on public.bar_runtime_settings for select to authenticated
using ((select public.has_bar_permission('bar.menu')) or (select public.has_bar_permission('bar.qrcodes')) or (select public.has_bar_permission('bar.overview')));
create policy "bar staff write runtime by permission" on public.bar_runtime_settings for all to authenticated
using ((select public.has_bar_permission('bar.menu')) or (select public.has_bar_permission('bar.qrcodes')))
with check ((select public.has_bar_permission('bar.menu')) or (select public.has_bar_permission('bar.qrcodes')));

drop policy if exists "bar staff manage own push subscriptions" on public.bar_push_subscriptions;
create policy "bar staff manage own push subscriptions" on public.bar_push_subscriptions for all to authenticated
using (
  user_id = (select auth.uid())
  and (
    (select public.has_bar_permission('bar.overview'))
    or (select public.has_bar_permission('bar.orders'))
    or (select public.has_bar_permission('bar.kitchen'))
  )
)
with check (
  user_id = (select auth.uid())
  and (
    (select public.has_bar_permission('bar.overview'))
    or (select public.has_bar_permission('bar.orders'))
    or (select public.has_bar_permission('bar.kitchen'))
  )
);

-- The product-image bucket is public for reads by URL, but authenticated
-- object listing/writes are restricted to the product/menu modules.
drop policy if exists "bar staff view product images" on storage.objects;
drop policy if exists "bar staff upload product images" on storage.objects;
drop policy if exists "bar staff update product images" on storage.objects;
drop policy if exists "bar staff delete product images" on storage.objects;
drop policy if exists "bar permitted staff view product images" on storage.objects;
drop policy if exists "bar permitted staff upload product images" on storage.objects;
drop policy if exists "bar permitted staff update product images" on storage.objects;
drop policy if exists "bar permitted staff delete product images" on storage.objects;

create policy "bar permitted staff view product images"
on storage.objects for select to authenticated
using (
  bucket_id = 'bar-products'
  and (
    (select public.has_bar_permission('bar.products'))
    or (select public.has_bar_permission('bar.menu'))
  )
);

create policy "bar permitted staff upload product images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'bar-products'
  and (
    (select public.has_bar_permission('bar.products'))
    or (select public.has_bar_permission('bar.menu'))
  )
);

create policy "bar permitted staff update product images"
on storage.objects for update to authenticated
using (
  bucket_id = 'bar-products'
  and (
    (select public.has_bar_permission('bar.products'))
    or (select public.has_bar_permission('bar.menu'))
  )
)
with check (
  bucket_id = 'bar-products'
  and (
    (select public.has_bar_permission('bar.products'))
    or (select public.has_bar_permission('bar.menu'))
  )
);

create policy "bar permitted staff delete product images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'bar-products'
  and (
    (select public.has_bar_permission('bar.products'))
    or (select public.has_bar_permission('bar.menu'))
  )
);

-- Profile images and self-service profile editing are available to every
-- explicitly permissioned Bar account. They must not use is_bar_staff(), whose
-- compatibility contract is intentionally limited to legacy order RPCs.
drop policy if exists "bar profile photos read" on storage.objects;
drop policy if exists "bar profile photos insert" on storage.objects;
drop policy if exists "bar profile photos update" on storage.objects;
drop policy if exists "bar profile photos delete" on storage.objects;

create policy "bar profile photos read"
on storage.objects for select to authenticated
using (
  bucket_id = 'bar-profiles'
  and (select public.has_any_bar_permission())
);

create policy "bar profile photos insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'bar-profiles'
  and (select public.has_any_bar_permission())
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or coalesce((select public.current_user_role()) = 'admin', false)
  )
);

create policy "bar profile photos update"
on storage.objects for update to authenticated
using (
  bucket_id = 'bar-profiles'
  and (select public.has_any_bar_permission())
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or coalesce((select public.current_user_role()) = 'admin', false)
  )
)
with check (
  bucket_id = 'bar-profiles'
  and (select public.has_any_bar_permission())
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or coalesce((select public.current_user_role()) = 'admin', false)
  )
);

create policy "bar profile photos delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'bar-profiles'
  and (select public.has_any_bar_permission())
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or coalesce((select public.current_user_role()) = 'admin', false)
  )
);

create or replace function public.bar_update_own_profile(
  p_full_name text,
  p_phone text,
  p_job_title text,
  p_bio text,
  p_avatar_url text
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.profiles%rowtype;
begin
  if (select auth.uid()) is null
     or not coalesce(public.has_any_bar_permission(), false) then
    raise exception 'Acesso negado ao perfil do Bar.' using errcode = '42501';
  end if;

  update public.profiles as profile
     set full_name = left(nullif(trim(p_full_name), ''), 80),
         phone = left(nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), ''), 13),
         job_title = left(nullif(trim(p_job_title), ''), 80),
         bio = left(nullif(trim(p_bio), ''), 500),
         avatar_url = left(nullif(trim(p_avatar_url), ''), 1000),
         updated_at = now()
   where profile.id = (select auth.uid())
  returning profile.* into saved;

  if not found then
    raise exception 'Perfil não encontrado.' using errcode = 'P0002';
  end if;
  return saved;
end;
$$;

revoke all on function public.bar_update_own_profile(text, text, text, text, text)
  from public, anon;
grant execute on function public.bar_update_own_profile(text, text, text, text, text)
  to authenticated;

drop policy if exists "payment invoices read own or staff" on public.app_payment_invoices;
drop policy if exists "payment invoices read own or office" on public.app_payment_invoices;
drop policy if exists "payment invoices read own or permitted staff" on public.app_payment_invoices;
create policy "payment invoices read own or permitted staff"
on public.app_payment_invoices for select to authenticated
using (
  client_id = (select auth.uid())
  or (select public.has_club_permission('finance.read'))
  or (select public.has_club_permission('finance.write'))
);

drop policy if exists "payment invoices staff manage" on public.app_payment_invoices;
drop policy if exists "payment invoices permitted office manage" on public.app_payment_invoices;
create policy "payment invoices permitted office manage"
on public.app_payment_invoices for all to authenticated
using (
  (select public.has_club_permission('finance.write'))
)
with check (
  (select public.has_club_permission('finance.write'))
);

-- Notifications target Auth identities. Restricting the foreign key to
-- app_clients silently excluded administrators who do not also use Ilha Play.
alter table public.app_client_notifications
  drop constraint if exists app_client_notifications_user_id_fkey;

alter table public.app_client_notifications
  drop constraint if exists app_client_notifications_user_auth_fkey;

alter table public.app_client_notifications
  add constraint app_client_notifications_user_auth_fkey
  foreign key (user_id) references auth.users(id) on delete cascade
  not valid;

alter table public.app_client_notifications
  validate constraint app_client_notifications_user_auth_fkey;

drop policy if exists app_client_notifications_read_own_or_staff
  on public.app_client_notifications;
drop policy if exists app_client_notifications_read_own_or_office
  on public.app_client_notifications;
drop policy if exists app_client_notifications_read_own_or_permitted_office
  on public.app_client_notifications;
create policy app_client_notifications_read_own_or_permitted_office
on public.app_client_notifications for select to authenticated
using (
  user_id = (select auth.uid())
  or (select public.has_club_permission('communication'))
);

drop policy if exists app_client_notifications_update_own_or_staff
  on public.app_client_notifications;
drop policy if exists app_client_notifications_update_own_or_office
  on public.app_client_notifications;
drop policy if exists app_client_notifications_update_own_or_permitted_office
  on public.app_client_notifications;
create policy app_client_notifications_update_own_or_permitted_office
on public.app_client_notifications for update to authenticated
using (
  user_id = (select auth.uid())
  or (select public.has_club_permission('communication'))
)
with check (
  user_id = (select auth.uid())
  or (select public.has_club_permission('communication'))
);

drop policy if exists app_client_notifications_insert_staff
  on public.app_client_notifications;
drop policy if exists app_client_notifications_insert_permitted_office
  on public.app_client_notifications;
create policy app_client_notifications_insert_permitted_office
on public.app_client_notifications for insert to authenticated
with check (
  (select public.has_club_permission('communication'))
);

drop policy if exists app_client_notifications_delete_staff
  on public.app_client_notifications;
drop policy if exists app_client_notifications_delete_permitted_office
  on public.app_client_notifications;
create policy app_client_notifications_delete_permitted_office
on public.app_client_notifications for delete to authenticated
using (
  (select public.has_club_permission('communication'))
);

-- A client may mark a notification as read, but cannot rewrite its sender,
-- contents, routing, event type or deduplication identity.
create or replace function public.guard_app_client_notification_updates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'authenticated'
     and (
       new.id is distinct from old.id
       or new.user_id is distinct from old.user_id
       or new.title is distinct from old.title
       or new.body is distinct from old.body
       or new.link_url is distinct from old.link_url
       or new.event_type is distinct from old.event_type
       or new.dedupe_key is distinct from old.dedupe_key
       or new.created_at is distinct from old.created_at
     ) then
    raise exception 'Somente a leitura da notificação pode ser atualizada.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_app_client_notification_updates()
  from public, anon, authenticated;

drop trigger if exists guard_app_client_notification_updates
  on public.app_client_notifications;
create trigger guard_app_client_notification_updates
before update on public.app_client_notifications
for each row execute function public.guard_app_client_notification_updates();

create or replace function public.notify_admins_about_new_app_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.app_client_notifications (
    user_id, title, body, link_url, event_type, dedupe_key
  )
  select
    profile.id,
    'Novo aluno cadastrado',
    coalesce(nullif(new.full_name, ''), nullif(new.email, ''), 'Novo aluno') ||
      ' criou uma conta no Ilha Play.',
    '/adm',
    'NOVO_ALUNO',
    'novo-aluno:' || new.id::text || ':admin:' || profile.id::text
  from public.profiles as profile
  join auth.users as auth_user
    on auth_user.id = profile.id
  join public.protected_access_accounts as protected_account
    on protected_account.email = lower(trim(auth_user.email))
   and protected_account.role = profile.role
   and protected_account.active is true
  where profile.active is true
    and profile.role = 'admin'
    and profile.id <> new.id
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  return new;
end;
$$;

revoke all on function public.notify_admins_about_new_app_client() from public, anon, authenticated;

-- A worker can terminate after claiming rows. Reclaim stale work instead of
-- leaving notifications in PROCESSANDO forever.
create or replace function public.claim_app_client_push_dispatches(
  p_limit integer default 100
)
returns table (
  dispatch_id uuid,
  notification_id uuid,
  user_id uuid,
  title text,
  body text,
  link_url text,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  update public.app_client_notification_dispatches as dispatch
     set status = 'FALHOU',
         last_error = coalesce(
           dispatch.last_error,
           'Processamento interrompido após o limite de tentativas.'
         ),
         updated_at = now()
   where dispatch.attempts >= 5
     and (
       dispatch.status = 'PENDENTE'
       or (
         dispatch.status = 'PROCESSANDO'
         and dispatch.updated_at < now() - interval '5 minutes'
       )
     );

  return query
  with claimed as (
    select dispatch.id
      from public.app_client_notification_dispatches as dispatch
     where dispatch.attempts < 5
       and (
         dispatch.status = 'PENDENTE'
         or (
           dispatch.status = 'PROCESSANDO'
           and dispatch.updated_at < now() - interval '5 minutes'
         )
       )
     order by dispatch.created_at
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 100), 200))
  ), updated as (
    update public.app_client_notification_dispatches as dispatch
       set status = 'PROCESSANDO',
           attempts = dispatch.attempts + 1,
           updated_at = now()
      from claimed
     where dispatch.id = claimed.id
    returning dispatch.*
  )
  select
    updated.id,
    updated.notification_id,
    notification.user_id,
    notification.title,
    notification.body,
    notification.link_url,
    updated.attempts
  from updated
  join public.app_client_notifications as notification
    on notification.id = updated.notification_id;
end;
$$;

revoke all on function public.claim_app_client_push_dispatches(integer)
  from public, anon, authenticated;
grant execute on function public.claim_app_client_push_dispatches(integer)
  to service_role;

-- Foreign-key and worker lookup indexes missing from the original schema.
create index if not exists app_clients_official_plan_id_idx
  on public.app_clients(official_plan_id);
create unique index if not exists app_clients_cpf_unique_idx
  on public.app_clients ((regexp_replace(cpf, '[^0-9]', '', 'g')))
  where nullif(regexp_replace(coalesce(cpf, ''), '[^0-9]', '', 'g'), '') is not null;
create index if not exists tournament_registrations_athlete_id_idx
  on public.tournament_registrations(athlete_id);
create unique index if not exists tournament_athletes_cpf_normalized_uq
  on public.tournament_athletes ((regexp_replace(cpf, '[^0-9]', '', 'g')))
  where nullif(regexp_replace(coalesce(cpf, ''), '[^0-9]', '', 'g'), '') is not null;
create index if not exists tournament_matches_source1_match_id_idx
  on public.tournament_matches(source1_match_id)
  where source1_match_id is not null;
create index if not exists tournament_matches_source2_match_id_idx
  on public.tournament_matches(source2_match_id)
  where source2_match_id is not null;
create index if not exists app_client_dispatches_stale_processing_idx
  on public.app_client_notification_dispatches(updated_at, created_at)
  where status = 'PROCESSANDO' and attempts < 5;

-- These base tables contain private athlete data and bearer capabilities
-- (courtesy_registration_token/public_token). Read-only tournament users must
-- consume the sanitized Edge API; direct REST access is reserved for writers.
drop policy if exists "tournament staff read" on public.tournaments;
create policy "tournament staff read"
on public.tournaments for select to authenticated
using ((select public.has_tournament_permission('tournaments.write')));

drop policy if exists "tournament staff read" on public.tournament_athletes;
create policy "tournament staff read"
on public.tournament_athletes for select to authenticated
using ((select public.has_tournament_permission('tournaments.write')));

drop policy if exists "tournament staff read" on public.tournament_registrations;
create policy "tournament staff read"
on public.tournament_registrations for select to authenticated
using ((select public.has_tournament_permission('tournaments.write')));

drop policy if exists "tournament audit read" on public.tournament_audit_log;
create policy "tournament audit read"
on public.tournament_audit_log for select to authenticated
using ((select public.has_tournament_permission('tournaments.write')));

commit;
