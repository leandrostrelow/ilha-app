begin;

do $$
declare
  v_table_name text;
begin
  if not exists (
    select 1
      from pg_publication
     where pubname = 'supabase_realtime'
  ) then
    raise exception 'Publication supabase_realtime does not exist.';
  end if;

  foreach v_table_name in array array[
    'lesson_slots',
    'lesson_enrollments',
    'students',
    'teachers',
    'courts'
  ]
  loop
    if to_regclass(format('public.%I', v_table_name)) is null then
      raise exception 'Required table public.% does not exist.', v_table_name;
    end if;

    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = v_table_name
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        v_table_name
      );
    end if;
  end loop;
end;
$$;

commit;
