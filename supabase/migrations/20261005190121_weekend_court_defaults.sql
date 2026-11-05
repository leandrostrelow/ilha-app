-- Sunday opens hourly from 07:00 through 20:00. Weekend 16/17h blocks are
-- defaults, not bookings: existing reservations remain untouched.
create or replace function private.court_default_slot_times(p_date date)
returns time[] language sql immutable security invoker set search_path = '' as $$
  select array_agg(make_time(h, 0, 0) order by h)
  from generate_series(case when extract(dow from p_date) = 0 then 7 else 14 end, 20) h;
$$;
revoke all on function private.court_default_slot_times(date) from public, anon, authenticated;

alter table public.app_court_schedule_days
  add column released_default_slots text[] not null default '{}',
  add constraint court_released_default_slots_valid check (
    cardinality(released_default_slots) <= 4
    and array_position(released_default_slots, null) is null
    and released_default_slots <@ array['Quadra 1|16:00','Quadra 1|17:00','Quadra 2|16:00','Quadra 2|17:00']::text[]
  );

create or replace function public.admin_set_app_court_default_slot(
  p_schedule_date date, p_court_name text, p_starts_at time, p_blocked boolean
) returns public.app_court_schedule_days
language plpgsql security invoker set search_path = '' as $$
declare
  slot_key text;
  result public.app_court_schedule_days;
  default_times time[];
begin
  if auth.uid() is null or not public.has_club_permission('classes') then
    raise exception 'Sem permissão para configurar as quadras.' using errcode = '42501';
  end if;
  if p_schedule_date is null or extract(dow from p_schedule_date) not in (0,6)
    or p_court_name is null or p_court_name not in ('Quadra 1','Quadra 2')
    or p_starts_at is null or p_starts_at not in (time '16:00',time '17:00') or p_blocked is null then
    raise exception 'Escolha 16h ou 17h de sábado ou domingo.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('court-schedule:' || p_schedule_date::text, 0));
  if p_blocked and exists (
    select 1 from public.app_court_bookings b where b.booking_date = p_schedule_date
      and b.court_name = p_court_name and b.starts_at = p_starts_at
      and b.status not in ('CANCELADO','BLOQUEADO')
  ) then
    raise exception 'Este horário já possui uma reserva. Ela foi mantida.' using errcode = '23514';
  end if;
  slot_key := p_court_name || '|' || to_char(p_starts_at, 'HH24:MI');
  select array_agg(make_time(h,0,0) order by h) into default_times
    from generate_series(case when extract(dow from p_schedule_date) = 0 then 7 else 14 end,20) h;
  insert into public.app_court_schedule_days as d (schedule_date,enabled,slot_times,released_default_slots)
    values (p_schedule_date,true,default_times,case when p_blocked then '{}'::text[] else array[slot_key] end)
    on conflict (schedule_date) do update set
      released_default_slots = case when p_blocked then array_remove(d.released_default_slots,slot_key)
        when slot_key = any(d.released_default_slots) then d.released_default_slots
        else array_append(d.released_default_slots,slot_key) end,
      updated_at = now()
    returning * into result;
  return result;
end;
$$;
revoke all on function public.admin_set_app_court_default_slot(date,text,time,boolean) from public, anon;
grant execute on function public.admin_set_app_court_default_slot(date,text,time,boolean) to authenticated;

create or replace function private.guard_weekend_court_default_block()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status in ('CANCELADO','BLOQUEADO') then return new; end if;
  -- A pre-existing reservation may be confirmed, edited or cancelled normally.
  if tg_op = 'UPDATE' then
    if old.status in ('PENDENTE','CONFIRMADO') and old.booking_date = new.booking_date
      and old.court_name = new.court_name and old.starts_at = new.starts_at then return new; end if;
  end if;
  if extract(dow from new.booking_date) in (0,6) and new.starts_at in (time '16:00',time '17:00') then
    perform pg_advisory_xact_lock(hashtextextended('court-schedule:' || new.booking_date::text,0));
    if not exists (
      select 1 from public.app_court_schedule_days d where d.schedule_date = new.booking_date
        and (new.court_name || '|' || to_char(new.starts_at,'HH24:MI')) = any(d.released_default_slots)
    ) then
      raise exception 'Horário bloqueado por padrão. Peça ao clube para liberar esta quadra nesta data.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_weekend_court_default_block() from public, anon, authenticated;
create trigger guard_weekend_court_default_block
before insert or update of booking_date, starts_at, court_name, status on public.app_court_bookings
for each row execute function private.guard_weekend_court_default_block();

-- Keep all existing authorization, family, opponent and concurrency checks.
do $$
declare
  signature text;
  definition text;
  revised text;
  old_array text := E'array[\n    time ''14:00'', time ''15:00'', time ''16:00'', time ''17:00'',\n    time ''18:00'', time ''19:00'', time ''20:00''\n  ]';
begin
  foreach signature in array array[
    'private.book_my_app_court_for_member(date,time without time zone,text,text,text,uuid,uuid)',
    'public.create_my_court_challenge(date,time without time zone,text,uuid,text)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    revised := replace(definition,old_array,'private.court_default_slot_times(p_booking_date)');
    if revised = definition then raise exception 'Default times anchor missing: %', signature; end if;
    execute revised;
  end loop;
  signature := 'public.admin_configure_app_court_day(date,boolean,text,time without time zone[])';
  definition := pg_get_functiondef(signature::regprocedure);
  revised := regexp_replace(definition,
    'array\[\s*time ''14:00'',\s*time ''15:00'',\s*time ''16:00'',\s*time ''17:00'',\s*time ''18:00'',\s*time ''19:00'',\s*time ''20:00''\s*\]',
    'private.court_default_slot_times(p_schedule_date)');
  if revised = definition then raise exception 'Admin default times anchor missing'; end if;
  execute revised;
end;
$$;
