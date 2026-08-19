create or replace function public.sync_app_plan_to_linked_records()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.app_clients
     set official_plan_id = new.id,
         official_plan_code = new.code,
         official_plan_name = new.name,
         plan_amount = new.amount,
         weekly_lessons = new.weekly_lessons,
         updated_at = now()
   where official_plan_id = new.id
      or official_plan_code = old.code;

  update public.app_plan_requests
     set plan_code = new.code,
         plan_name = new.name,
         amount = new.amount,
         weekly_lessons = new.weekly_lessons,
         updated_at = now()
   where plan_code = old.code;

  return new;
end;
$$;

revoke all on function public.sync_app_plan_to_linked_records() from public;

drop trigger if exists sync_app_plan_to_linked_records on public.app_plans;
create trigger sync_app_plan_to_linked_records
  after update of code, name, amount, weekly_lessons
  on public.app_plans
  for each row
  execute function public.sync_app_plan_to_linked_records();

update public.app_clients c
   set official_plan_id = p.id,
       official_plan_code = p.code,
       official_plan_name = p.name,
       plan_amount = p.amount,
       weekly_lessons = p.weekly_lessons,
       updated_at = now()
  from public.app_plans p
 where c.official_plan_id = p.id;

update public.app_clients c
   set official_plan_id = p.id,
       official_plan_code = p.code,
       official_plan_name = p.name,
       plan_amount = p.amount,
       weekly_lessons = p.weekly_lessons,
       updated_at = now()
  from public.app_plans p
 where c.official_plan_id is null
   and c.official_plan_code = p.code;

update public.app_plan_requests r
   set plan_name = p.name,
       amount = p.amount,
       weekly_lessons = p.weekly_lessons,
       updated_at = now()
  from public.app_plans p
 where r.plan_code = p.code;

create or replace function public.book_my_app_court(
  p_booking_date date,
  p_starts_at time without time zone,
  p_court_name text,
  p_opponent_name text,
  p_notes text default null::text
)
returns public.app_court_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.app_clients%rowtype;
  v_booking public.app_court_bookings%rowtype;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_is_weekend boolean;
  v_extra_enabled boolean;
begin
  if auth.uid() is null then
    raise exception 'Entre no Ilha Play para reservar.' using errcode = '42501';
  end if;

  select * into v_client
  from public.app_clients
  where id = auth.uid()
    and upper(coalesce(status, 'ATIVO')) = 'ATIVO'
    and registration_completed_at is not null;

  if v_client.id is null then
    raise exception 'Complete seu cadastro para reservar.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.app_plans p
    where p.active = true
      and (
        (v_client.official_plan_id is not null and p.id = v_client.official_plan_id)
        or
        (nullif(v_client.official_plan_code, '') is not null and p.code = v_client.official_plan_code)
      )
  ) then
    raise exception 'Você precisa de um plano ou pacote ativo para reservar quadras.' using errcode = '42501';
  end if;

  if p_booking_date < v_today or p_booking_date > v_today + 45 then
    raise exception 'Escolha uma data disponível na agenda.' using errcode = '22023';
  end if;

  v_is_weekend := extract(isodow from p_booking_date) in (6, 7);
  select coalesce(enabled, false) into v_extra_enabled
  from public.app_court_schedule_days
  where schedule_date = p_booking_date;

  if not v_is_weekend and not coalesce(v_extra_enabled, false) then
    raise exception 'Este dia não está aberto para reservas.' using errcode = '22023';
  end if;

  if p_court_name not in ('Quadra 1', 'Quadra 2')
     or p_starts_at not in (time '14:00', time '15:00', time '16:00', time '17:00', time '18:00', time '19:00', time '20:00') then
    raise exception 'Quadra ou horário inválido.' using errcode = '22023';
  end if;

  if length(trim(coalesce(p_opponent_name, ''))) < 2 then
    raise exception 'Informe o nome do adversário.' using errcode = '22023';
  end if;

  insert into public.app_court_bookings (
    client_id, client_name, opponent_name, booking_date, starts_at, court_name, status, notes
  ) values (
    v_client.id, v_client.full_name, trim(p_opponent_name), p_booking_date, p_starts_at,
    p_court_name, 'CONFIRMADO', nullif(trim(coalesce(p_notes, '')), '')
  ) returning * into v_booking;

  return v_booking;
exception
  when unique_violation then
    if exists (
      select 1 from public.app_court_bookings
      where client_id = auth.uid()
        and booking_date = p_booking_date
        and status <> 'CANCELADO'
    ) then
      raise exception 'Você já possui uma reserva neste dia.' using errcode = '23505';
    end if;
    raise exception 'Esse horário acabou de ser reservado. Escolha outro.' using errcode = '23505';
end;
$$;

revoke all on function public.book_my_app_court(date, time without time zone, text, text, text) from public;
grant execute on function public.book_my_app_court(date, time without time zone, text, text, text) to authenticated;
