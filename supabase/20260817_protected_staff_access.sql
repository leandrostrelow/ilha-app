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

-- Intentionally seed-free. Do not infer privileged access from profiles or
-- raw_user_meta_data: both were historically user-influenced. Bootstrap every
-- trusted admin/secretaria/professor/bar explicitly with service_role by
-- following supabase/PROTECTED_ACCESS_BOOTSTRAP.md, then apply the canonical
-- migrations 20260821185000 and 20260821190000. The canonical hardening
-- migration installs the guarded synchronization and recovery functions.
