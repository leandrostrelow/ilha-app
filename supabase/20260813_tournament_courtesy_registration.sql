alter table public.tournaments
  add column if not exists courtesy_registration_token uuid;

update public.tournaments
set courtesy_registration_token = coalesce(
      nullif(settings->>'courtesy_registration_token', '')::uuid,
      gen_random_uuid()
    ),
    settings = coalesce(settings, '{}'::jsonb) - 'courtesy_registration_token'
where slug = 'ilha-open-2026'
  and courtesy_registration_token is null;

update public.tournaments
set settings = coalesce(settings, '{}'::jsonb) - 'courtesy_registration_token'
where settings ? 'courtesy_registration_token';
