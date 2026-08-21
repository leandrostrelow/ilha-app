begin;

create table if not exists public.app_notification_dismissals (
  user_id uuid not null references public.app_clients(id) on delete cascade,
  source_type text not null check (source_type in ('announcement', 'client')),
  source_id uuid not null,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, source_type, source_id)
);

alter table public.app_notification_dismissals enable row level security;

drop policy if exists app_notification_dismissals_select_own on public.app_notification_dismissals;
create policy app_notification_dismissals_select_own
  on public.app_notification_dismissals
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists app_notification_dismissals_insert_own on public.app_notification_dismissals;
create policy app_notification_dismissals_insert_own
  on public.app_notification_dismissals
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists app_notification_dismissals_delete_own on public.app_notification_dismissals;
create policy app_notification_dismissals_delete_own
  on public.app_notification_dismissals
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.app_notification_dismissals from public, anon, authenticated;
grant select, insert, delete on table public.app_notification_dismissals to authenticated;
grant all on table public.app_notification_dismissals to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_notification_dismissals'
  ) then
    alter publication supabase_realtime add table public.app_notification_dismissals;
  end if;
end
$$;

commit;
