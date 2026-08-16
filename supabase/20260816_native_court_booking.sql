-- Native Ilha Play court booking flow.

create table if not exists public.app_court_schedule_days (
  schedule_date date primary key,
  enabled boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_court_schedule_days enable row level security;

drop policy if exists "court schedule read authenticated" on public.app_court_schedule_days;
drop policy if exists "court schedule staff manage" on public.app_court_schedule_days;
drop policy if exists "court schedule staff insert" on public.app_court_schedule_days;
drop policy if exists "court schedule staff update" on public.app_court_schedule_days;
drop policy if exists "court schedule staff delete" on public.app_court_schedule_days;

create policy "court schedule read authenticated"
on public.app_court_schedule_days for select
to authenticated
using (true);

create policy "court schedule staff insert"
on public.app_court_schedule_days for insert
to authenticated
with check ((select public.is_club_office()));

create policy "court schedule staff update"
on public.app_court_schedule_days for update
to authenticated
using ((select public.is_club_office()))
with check ((select public.is_club_office()));

create policy "court schedule staff delete"
on public.app_court_schedule_days for delete
to authenticated
using ((select public.is_club_office()));

drop policy if exists "court bookings read authenticated" on public.app_court_bookings;
drop policy if exists "court bookings insert own" on public.app_court_bookings;
drop policy if exists "court bookings update own or staff" on public.app_court_bookings;
drop policy if exists "court bookings staff manage" on public.app_court_bookings;

create policy "court bookings read own or staff"
on public.app_court_bookings for select
to authenticated
using (client_id = (select auth.uid()) or (select public.is_club_staff()));

create policy "court bookings staff insert"
on public.app_court_bookings for insert
to authenticated
with check ((select public.is_club_office()));

create policy "court bookings staff update"
on public.app_court_bookings for update
to authenticated
using ((select public.is_club_staff()))
with check ((select public.is_club_staff()));

create policy "court bookings staff delete"
on public.app_court_bookings for delete
to authenticated
using ((select public.is_club_office()));

create or replace function public.get_app_court_availability(
  p_start_date date,
  p_end_date date
)
returns table (
  booking_date date,
  starts_at time,
  court_name text,
  status text,
  is_mine boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Entre no Ilha Play para consultar a agenda.' using errcode = '42501';
  end if;

  if p_start_date is null or p_end_date is null or p_end_date < p_start_date or p_end_date > p_start_date + 45 then
    raise exception 'Período da agenda inválido.' using errcode = '22023';
  end if;

  return query
  select
    b.booking_date,
    b.starts_at,
    b.court_name,
    b.status,
    b.client_id = auth.uid()
  from public.app_court_bookings b
  where b.booking_date between p_start_date and p_end_date
    and b.status <> 'CANCELADO'
  order by b.booking_date, b.starts_at, b.court_name;
end;
$$;

create or replace function public.book_my_app_court(
  p_booking_date date,
  p_starts_at time,
  p_court_name text,
  p_opponent_name text,
  p_notes text default null
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
    and upper(coalesce(status, 'ATIVO')) = 'ATIVO';

  if v_client.id is null then
    raise exception 'Seu cadastro precisa estar ativo para reservar.' using errcode = '42501';
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

  if v_is_weekend and p_court_name = 'Quadra 1' and p_starts_at = time '17:00' then
    raise exception 'Este horário possui um bloqueio fixo.' using errcode = '23514';
  end if;

  if length(trim(coalesce(p_opponent_name, ''))) < 2 then
    raise exception 'Informe o nome do adversário.' using errcode = '22023';
  end if;

  insert into public.app_court_bookings (
    client_id,
    client_name,
    opponent_name,
    booking_date,
    starts_at,
    court_name,
    status,
    notes
  ) values (
    v_client.id,
    v_client.full_name,
    trim(p_opponent_name),
    p_booking_date,
    p_starts_at,
    p_court_name,
    'CONFIRMADO',
    nullif(trim(coalesce(p_notes, '')), '')
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

create or replace function public.cancel_my_app_court_booking(p_booking_id uuid)
returns public.app_court_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.app_court_bookings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Entre no Ilha Play para cancelar.' using errcode = '42501';
  end if;

  update public.app_court_bookings
  set status = 'CANCELADO', updated_at = now()
  where id = p_booking_id
    and client_id = auth.uid()
    and status = 'CONFIRMADO'
  returning * into v_booking;

  if v_booking.id is null then
    raise exception 'Reserva não encontrada ou já cancelada.' using errcode = 'P0002';
  end if;

  return v_booking;
end;
$$;

revoke all on function public.get_app_court_availability(date, date) from public, anon;
revoke all on function public.book_my_app_court(date, time, text, text, text) from public, anon;
revoke all on function public.cancel_my_app_court_booking(uuid) from public, anon;

grant execute on function public.get_app_court_availability(date, date) to authenticated;
grant execute on function public.book_my_app_court(date, time, text, text, text) to authenticated;
grant execute on function public.cancel_my_app_court_booking(uuid) to authenticated;
