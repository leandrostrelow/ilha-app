-- Run inside a transaction and always roll back; no persistent test accounts/bookings.
do $$
declare
  account_id uuid := '55c0b564-2310-4a89-bd5f-f6d107cf5949';
  student_id uuid;
  child_id uuid;
  other_child uuid;
  test_day date;
  booking public.app_court_bookings%rowtype;
  family_before jsonb;
  candidate record;
  slot_id uuid;
begin
  select jsonb_agg(to_jsonb(m) order by id) into family_before from public.app_family_members m where billing_responsible_id=account_id;
  select id into student_id from public.students where app_client_id=account_id;
  select id into child_id from public.app_family_members where billing_responsible_id=account_id and status='ATIVO' limit 1;
  select id into other_child from public.app_family_members where billing_responsible_id<>account_id and status='ATIVO' limit 1;
  if student_id is null or child_id is null or other_child is null then raise exception 'Missing integration fixture'; end if;
  update public.app_clients set client_type='responsavel',plan_amount=500,weekly_lessons=2 where id=account_id;
  if not exists(select 1 from public.app_clients where id=account_id and plan_amount=0 and weekly_lessons=0 and client_type='responsavel') then
    raise exception 'Guardian still charged individually';
  end if;
  if not exists(select 1 from public.students where id=student_id and status='INATIVO' and relationship_status='INATIVO' and weekly_lessons=0) then
    raise exception 'Guardian still an active student';
  end if;
  if family_before is distinct from (select jsonb_agg(to_jsonb(m) order by id) from public.app_family_members m where billing_responsible_id=account_id) then
    raise exception 'Child records changed';
  end if;
  select * into candidate from private.monthly_billing_candidates((date_trunc('month',now())+interval '2 months')::date,account_id);
  if candidate.amount is distinct from (select coalesce(sum(monthly_amount),0) from public.app_family_members where billing_responsible_id=account_id and status='ATIVO'
    and (not coalesce(responsible_confirmation_required,false) or responsible_confirmed_at is not null or billing_authorized_at is not null)) then
    raise exception 'Family preview added guardian amount';
  end if;
  select id into slot_id from public.lesson_slots where active limit 1;
  begin
    insert into public.lesson_enrollments(student_id,slot_id,type,active) values(student_id,slot_id,'REGULAR',true);
    raise exception 'Guardian allowed into class';
  exception when check_violation then
    if sqlerrm not like 'Responsável não participa%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub',account_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',account_id,'role','authenticated')::text,true);
  begin
    update public.app_clients set client_type='aluno' where id=account_id;
    raise exception 'Self service role escalation accepted';
  exception when insufficient_privilege then null; end;
  select day::date into test_day from generate_series(current_date+28,current_date+40,interval '1 day') day
    where extract(isodow from day)=6 and not exists(select 1 from public.app_court_bookings b where b.booking_date=day::date and b.status<>'CANCELADO') limit 1;
  if test_day is null then raise exception 'No test date'; end if;
  begin
    perform public.book_my_app_court(test_day,'14:00','Quadra 1','Teste convidado');
    raise exception 'Guardian booking without child accepted';
  exception when invalid_parameter_value then
    if sqlerrm not like 'Selecione o filho%' then raise; end if;
  end;
  begin
    perform public.book_my_family_court(other_child,test_day,'14:00','Quadra 1','Teste convidado');
    raise exception 'Foreign child booking accepted';
  exception when insufficient_privilege then null; end;
  booking := public.book_my_family_court(child_id,test_day,'14:00','Quadra 1','Teste convidado');
  if booking.client_id<>account_id or booking.family_member_id<>child_id or booking.client_name<>(select full_name from public.app_family_members where id=child_id) then
    raise exception 'Booking lost child or account ownership';
  end if;
  perform public.cancel_my_app_court_booking(booking.id);
  if not exists(select 1 from public.app_court_bookings where id=booking.id and status='CANCELADO') then raise exception 'Guardian cannot cancel booking'; end if;
end;
$$;
