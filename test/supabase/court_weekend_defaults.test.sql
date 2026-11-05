-- Always run with BEGIN/ROLLBACK: exercises real RPCs without saving fixtures.
do $$
declare
  admin_id uuid;
  player_id uuid;
  test_day date;
  result public.app_court_schedule_days;
  booking public.app_court_bookings;
  original public.app_court_bookings;
  hour_value time;
  court text;
begin
  select p.id into admin_id from public.profiles p join auth.users u on u.id=p.id
    where p.role='admin' and p.active limit 1;
  select c.id into player_id from public.app_clients c join auth.users u on u.id=c.id
    where c.status='ATIVO' and c.registration_completed_at is not null and c.client_type<>'responsavel' limit 1;
  select day::date into test_day from generate_series(current_date+28,current_date+40,interval '1 day') day
    where extract(dow from day)=0
      and not exists(select 1 from public.app_court_schedule_days d where d.schedule_date in (day::date,day::date-1))
      and not exists(select 1 from public.app_court_bookings b where b.booking_date in (day::date,day::date-1) and b.status<>'CANCELADO') limit 1;
  if admin_id is null or player_id is null or test_day is null then raise exception 'Missing safe fixture'; end if;
  if private.court_default_slot_times(test_day) <> array(select make_time(h,0,0) from generate_series(7,20) h)
    or cardinality(private.court_default_slot_times(test_day-1))<>7 then raise exception 'Default hours mismatch'; end if;
  select * into original from public.app_court_bookings where status in ('CONFIRMADO','PENDENTE')
    and extract(dow from booking_date) in (0,6) and starts_at in ('16:00','17:00') limit 1;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  set local role authenticated;
  if original.id is not null then
    update public.app_court_bookings set status=status where id=original.id;
    if not found then raise exception 'Existing booking cannot be edited'; end if;
  end if;
  perform set_config('request.jwt.claim.sub',player_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',player_id,'role','authenticated')::text,true);
  begin
    perform public.admin_set_app_court_default_slot(test_day,'Quadra 1','16:00',false);
    raise exception 'Player could release slot';
  exception when insufficient_privilege then null; end;
  foreach court in array array['Quadra 1','Quadra 2'] loop
    foreach hour_value in array array[time '16:00',time '17:00'] loop
      begin
        perform public.book_my_app_court(test_day,hour_value,court,'Convidado teste rollback');
        raise exception 'Blocked booking accepted';
      exception when check_violation then
        if sqlerrm not like 'Horário bloqueado por padrão%' then raise; end if;
      end;
      begin
        perform public.create_my_court_challenge(test_day-1,hour_value,court,null,null);
        raise exception 'Blocked challenge accepted';
      exception when check_violation then
        if sqlerrm not like 'Horário bloqueado por padrão%' then raise; end if;
      end;
    end loop;
  end loop;
  foreach hour_value in array array[time '07:00',time '20:00'] loop
    booking:=public.book_my_app_court(test_day,hour_value,'Quadra 1','Convidado teste rollback');
    if booking.status<>'CONFIRMADO' then raise exception 'Sunday booking failed'; end if;
    perform public.cancel_my_app_court_booking(booking.id);
  end loop;
  begin
    perform public.book_my_app_court(test_day,'06:00','Quadra 1','Convidado teste rollback');
    raise exception 'Out-of-hours booking accepted';
  exception when invalid_parameter_value then null; end;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  result:=public.admin_set_app_court_default_slot(test_day,'Quadra 1','16:00',false);
  if result.released_default_slots<>array['Quadra 1|16:00'] or cardinality(result.slot_times)<>14 then raise exception 'Release not scoped correctly'; end if;
  perform public.admin_configure_app_court_day(test_day,true,'Teste rollback',array[time '08:00',time '16:00']);
  result:=public.admin_set_app_court_default_slot(test_day,'Quadra 2','17:00',false);
  if result.slot_times<>array[time '08:00',time '16:00'] or result.notes<>'Teste rollback' then raise exception 'Custom day overwritten'; end if;
  result:=public.admin_set_app_court_default_slot(test_day,'Quadra 2','17:00',true);
  perform set_config('request.jwt.claim.sub',player_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',player_id,'role','authenticated')::text,true);
  booking:=public.book_my_app_court(test_day,'16:00','Quadra 1','Convidado teste rollback');
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  begin
    perform public.admin_set_app_court_default_slot(test_day,'Quadra 1','16:00',true);
    raise exception 'Occupied slot reblocked';
  exception when check_violation then
    if sqlerrm not like 'Este horário já possui uma reserva%' then raise; end if;
  end;
  update public.app_court_bookings set status='CANCELADO' where id=booking.id;
  result:=public.admin_set_app_court_default_slot(test_day,'Quadra 1','16:00',true);
  if cardinality(result.released_default_slots)<>0 then raise exception 'Default not restored'; end if;
  begin
    update public.app_court_bookings set status='CONFIRMADO' where id=booking.id;
    raise exception 'Cancelled booking bypassed restored block';
  exception when check_violation then
    if sqlerrm not like 'Horário bloqueado por padrão%' then raise; end if;
  end;
  reset role;
end;
$$;
