begin;

-- Canonical, seed-free definition. Privileged accounts must be provisioned by
-- a trusted service-role/bootstrap process; profiles are not a trust source.
-- Follow supabase/PROTECTED_ACCESS_BOOTSTRAP.md before applying migration 190000.
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

commit;
