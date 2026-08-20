do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_announcements'
  ) then
    alter publication supabase_realtime add table public.app_announcements;
  end if;
end
$$;
