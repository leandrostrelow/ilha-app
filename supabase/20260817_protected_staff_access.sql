-- Preserve privileged Club and Bar access independently from client onboarding.

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

insert into public.protected_access_accounts (email, full_name, role, permissions, active)
select lower(p.email), p.full_name, p.role, coalesce(p.permissions, '[]'::jsonb), p.active
from public.profiles p
where nullif(trim(p.email), '') is not null
  and (
    p.role in ('admin', 'bar')
    or coalesce(p.permissions, '[]'::jsonb) ? 'bar'
    or exists (
      select 1
      from jsonb_array_elements_text(coalesce(p.permissions, '[]'::jsonb)) permission(value)
      where permission.value like 'bar.%'
    )
  )
on conflict (email) do update
set full_name = excluded.full_name,
    role = excluded.role,
    permissions = excluded.permissions,
    active = excluded.active,
    updated_at = now();

insert into public.protected_access_accounts (email, full_name, role, permissions, active)
values (
  'kikostrelow@gmail.com',
  'Leandro Strelow',
  'admin',
  '[]'::jsonb,
  true
)
on conflict (email) do update
set full_name = excluded.full_name,
    role = excluded.role,
    active = true,
    updated_at = now();

insert into public.protected_access_accounts (email, full_name, role, permissions, active)
select
  lower(u.email),
  coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1)),
  'bar',
  '[]'::jsonb,
  true
from auth.users u
where coalesce(u.raw_user_meta_data ->> 'app_context', '') = 'bar'
  and nullif(trim(u.email), '') is not null
on conflict (email) do nothing;

create or replace function public.remember_protected_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(new.email), '') is null then
    return new;
  end if;

  if new.role in ('admin', 'bar')
    or coalesce(new.permissions, '[]'::jsonb) ? 'bar'
    or exists (
      select 1
      from jsonb_array_elements_text(coalesce(new.permissions, '[]'::jsonb)) permission(value)
      where permission.value like 'bar.%'
    ) then
    insert into public.protected_access_accounts (email, full_name, role, permissions, active)
    values (lower(new.email), new.full_name, new.role, coalesce(new.permissions, '[]'::jsonb), new.active)
    on conflict (email) do update
    set full_name = excluded.full_name,
        role = excluded.role,
        permissions = excluded.permissions,
        active = excluded.active,
        updated_at = now();
  end if;

  return new;
end;
$$;

revoke all on function public.remember_protected_profile() from public, anon, authenticated;

drop trigger if exists remember_protected_profile_trigger on public.profiles;
create trigger remember_protected_profile_trigger
after insert or update of full_name, email, role, permissions, active on public.profiles
for each row execute function public.remember_protected_profile();

create or replace function public.restore_protected_profile(p_email text)
returns public.profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  protected_account public.protected_access_accounts%rowtype;
  auth_user auth.users%rowtype;
  restored_profile public.profiles%rowtype;
begin
  select * into protected_account
  from public.protected_access_accounts
  where email = lower(trim(p_email))
    and active = true;

  if protected_account.email is null then
    raise exception 'Acesso protegido não encontrado.' using errcode = 'P0002';
  end if;

  select * into auth_user
  from auth.users
  where lower(email) = protected_account.email;

  if auth_user.id is null then
    raise exception 'Usuário de autenticação não encontrado.' using errcode = 'P0002';
  end if;

  insert into public.profiles (id, full_name, email, role, active, permissions, updated_at)
  values (
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
      active = true,
      permissions = excluded.permissions,
      updated_at = now()
  returning * into restored_profile;

  return restored_profile;
end;
$$;

revoke all on function public.restore_protected_profile(text) from public, anon, authenticated;
grant execute on function public.restore_protected_profile(text) to service_role;
