create table if not exists public.app_client_experience_settings (
  singleton boolean primary key default true check (singleton is true),
  intro_enabled boolean not null default true,
  intro_video_url text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_client_experience_intro_url_check check (
    intro_video_url is null
    or (
      char_length(intro_video_url) <= 2000
      and (intro_video_url like '/%' or intro_video_url ~ '^https?://')
    )
  )
);

comment on table public.app_client_experience_settings is
  'Single-row public presentation settings for the installed Ilha Play client app.';

insert into public.app_client_experience_settings (
  singleton,
  intro_enabled,
  intro_video_url
)
values (
  true,
  true,
  '/assets/app/ilha-play-intro.mp4'
)
on conflict (singleton) do update
set intro_enabled = excluded.intro_enabled,
    intro_video_url = excluded.intro_video_url,
    updated_at = now();

alter table public.app_client_experience_settings enable row level security;
alter table public.app_client_experience_settings force row level security;

drop policy if exists app_client_experience_public_read on public.app_client_experience_settings;
create policy app_client_experience_public_read
on public.app_client_experience_settings
for select
to anon, authenticated
using (singleton is true);

drop policy if exists app_client_experience_staff_update on public.app_client_experience_settings;
create policy app_client_experience_staff_update
on public.app_client_experience_settings
for update
to authenticated
using ((select public.has_club_permission('settings')))
with check (singleton is true and (select public.has_club_permission('settings')));

revoke all on table public.app_client_experience_settings from public, anon, authenticated;
grant select (singleton, intro_enabled, intro_video_url, updated_at)
  on public.app_client_experience_settings to anon, authenticated;
grant update (intro_enabled, intro_video_url, updated_at)
  on public.app_client_experience_settings to authenticated;
grant all on table public.app_client_experience_settings to service_role;

create or replace function private.set_app_client_experience_audit_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

revoke all on function private.set_app_client_experience_audit_fields() from public, anon, authenticated;

drop trigger if exists set_app_client_experience_audit_fields
  on public.app_client_experience_settings;
create trigger set_app_client_experience_audit_fields
before update on public.app_client_experience_settings
for each row execute function private.set_app_client_experience_audit_fields();

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'app-branding',
  'app-branding',
  true,
  15728640,
  array['video/mp4']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists app_branding_staff_select on storage.objects;
create policy app_branding_staff_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'app-branding'
  and (select public.has_club_permission('settings'))
);

drop policy if exists app_branding_staff_insert on storage.objects;
create policy app_branding_staff_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'app-branding'
  and (storage.extension(name) = 'mp4')
  and (select public.has_club_permission('settings'))
);

drop policy if exists app_branding_staff_update on storage.objects;
create policy app_branding_staff_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'app-branding'
  and (select public.has_club_permission('settings'))
)
with check (
  bucket_id = 'app-branding'
  and (storage.extension(name) = 'mp4')
  and (select public.has_club_permission('settings'))
);

drop policy if exists app_branding_staff_delete on storage.objects;
create policy app_branding_staff_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'app-branding'
  and (select public.has_club_permission('settings'))
);

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
    or public.has_club_permission('settings')
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
    or public.has_club_permission('settings')
$$;

revoke all on function public.is_club_staff() from public, anon;
revoke all on function public.is_club_office() from public, anon;
grant execute on function public.is_club_staff() to authenticated;
grant execute on function public.is_club_office() to authenticated;
