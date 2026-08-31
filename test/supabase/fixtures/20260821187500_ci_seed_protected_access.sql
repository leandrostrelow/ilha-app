-- Fixture exclusiva da CI. O domínio .invalid é reservado e não recebe e-mail.
-- Este arquivo é copiado apenas para o projeto Supabase temporário, entre a
-- criação da allowlist e o hardening; ele nunca integra o deploy remoto.
insert into auth.users (
  id,
  email,
  raw_app_meta_data,
  raw_user_meta_data
)
values (
  '10000000-0000-4000-8000-000000000001'::uuid,
  'ci-protected-admin@tests.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"app_context":"admin","full_name":"Administrador sintético da CI"}'::jsonb
)
on conflict (id) do update
set email = excluded.email,
    raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data;

insert into public.profiles (
  id,
  full_name,
  email,
  role,
  permissions,
  active
)
values (
  '10000000-0000-4000-8000-000000000001'::uuid,
  'Administrador sintético da CI',
  'ci-protected-admin@tests.invalid',
  'admin',
  '[]'::jsonb,
  true
)
on conflict (id) do update
set full_name = excluded.full_name,
    email = excluded.email,
    role = excluded.role,
    permissions = excluded.permissions,
    active = true,
    updated_at = now();

insert into public.protected_access_accounts (
  email,
  full_name,
  role,
  permissions,
  active
)
values (
  'ci-protected-admin@tests.invalid',
  'Administrador sintético da CI',
  'admin',
  '[]'::jsonb,
  true
)
on conflict (email) do update
set full_name = excluded.full_name,
    role = excluded.role,
    permissions = excluded.permissions,
    active = true,
    updated_at = now();
