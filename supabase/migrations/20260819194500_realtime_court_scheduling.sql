begin;

alter table public.app_court_schedule_days
  add column if not exists slot_times time without time zone[] not null
  default array[
    time '14:00', time '15:00', time '16:00', time '17:00',
    time '18:00', time '19:00', time '20:00'
  ];

alter table public.app_court_bookings
  add column if not exists opponent_client_id uuid
  references public.app_clients(id) on delete set null;

create index if not exists app_court_bookings_opponent_client_idx
  on public.app_court_bookings(opponent_client_id);

create table if not exists public.app_court_slot_events (
  id bigint generated always as identity primary key,
  booking_date date not null,
  starts_at time without time zone not null,
  court_name text not null,
  changed_at timestamptz not null default now()
);

alter table public.app_court_slot_events enable row level security;

drop policy if exists app_court_slot_events_read_authenticated on public.app_court_slot_events;
create policy app_court_slot_events_read_authenticated
  on public.app_court_slot_events
  for select
  to authenticated
  using (auth.uid() is not null);

revoke all on public.app_court_slot_events from public, anon;
grant select on public.app_court_slot_events to authenticated;

create or replace function public.notify_app_court_slot_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.app_court_slot_events (booking_date, starts_at, court_name)
    values (old.booking_date, old.starts_at, old.court_name);
    return old;
  end if;
  insert into public.app_court_slot_events (booking_date, starts_at, court_name)
  values (new.booking_date, new.starts_at, new.court_name);
  return new;
end;
$$;

revoke all on function public.notify_app_court_slot_change() from public;

drop trigger if exists notify_app_court_slot_change on public.app_court_bookings;
create trigger notify_app_court_slot_change
  after insert or update or delete on public.app_court_bookings
  for each row execute function public.notify_app_court_slot_change();

create or replace function public.get_active_court_opponents()
returns table (
  id uuid,
  full_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
      from public.app_clients client
     where client.id = auth.uid()
       and upper(coalesce(client.status, 'ATIVO')) = 'ATIVO'
       and client.registration_completed_at is not null
  ) then
    raise exception 'Complete seu cadastro para consultar os alunos.' using errcode = '42501';
  end if;

  return query
  select client.id, trim(client.full_name)
    from public.app_clients client
   where upper(coalesce(client.status, 'ATIVO')) = 'ATIVO'
     and client.registration_completed_at is not null
     and client.id <> auth.uid()
     and length(trim(coalesce(client.full_name, ''))) >= 2
   order by lower(trim(client.full_name));
end;
$$;

revoke all on function public.get_active_court_opponents() from public, anon;
grant execute on function public.get_active_court_opponents() to authenticated;

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
  v_opponent public.app_clients%rowtype;
  v_booking public.app_court_bookings%rowtype;
  v_schedule public.app_court_schedule_days%rowtype;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_is_weekend boolean;
  v_day_enabled boolean;
  v_allowed_times time without time zone[] := array[
    time '14:00', time '15:00', time '16:00', time '17:00',
    time '18:00', time '19:00', time '20:00'
  ];
  v_opponent_name text := trim(coalesce(p_opponent_name, ''));
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
    raise exception 'Seu cadastro precisa estar ativo para reservar.' using errcode = '42501';
  end if;

  if p_booking_date < v_today or p_booking_date > v_today + 45 then
    raise exception 'Escolha uma data disponível na agenda.' using errcode = '22023';
  end if;

  v_is_weekend := extract(isodow from p_booking_date) in (6, 7);
  select * into v_schedule
    from public.app_court_schedule_days
   where schedule_date = p_booking_date;

  v_day_enabled := case
    when v_schedule.schedule_date is not null then coalesce(v_schedule.enabled, false)
    else v_is_weekend
  end;

  if not v_day_enabled then
    raise exception 'Este dia não está aberto para reservas.' using errcode = '22023';
  end if;

  if v_schedule.schedule_date is not null then
    v_allowed_times := coalesce(v_schedule.slot_times, v_allowed_times);
  end if;

  if p_court_name not in ('Quadra 1', 'Quadra 2')
     or not (p_starts_at = any(v_allowed_times)) then
    raise exception 'Quadra ou horário inválido.' using errcode = '22023';
  end if;

  if length(v_opponent_name) < 2 then
    raise exception 'Selecione um aluno ativo ou informe o nome do convidado.' using errcode = '22023';
  end if;

  select * into v_opponent
    from public.app_clients opponent
   where opponent.id <> v_client.id
     and upper(coalesce(opponent.status, 'ATIVO')) = 'ATIVO'
     and opponent.registration_completed_at is not null
     and lower(trim(opponent.full_name)) = lower(v_opponent_name)
   order by opponent.created_at
   limit 1;

  insert into public.app_court_bookings (
    client_id, client_name, opponent_client_id, opponent_name,
    booking_date, starts_at, court_name, status, notes
  ) values (
    v_client.id, v_client.full_name, v_opponent.id, v_opponent_name,
    p_booking_date, p_starts_at, p_court_name, 'CONFIRMADO',
    nullif(trim(coalesce(p_notes, '')), '')
  ) returning * into v_booking;

  return v_booking;
exception
  when unique_violation then
    if exists (
      select 1
        from public.app_court_bookings booking
       where booking.client_id = auth.uid()
         and booking.booking_date = p_booking_date
         and booking.status <> 'CANCELADO'
    ) then
      raise exception 'Você já possui uma reserva neste dia.' using errcode = '23505';
    end if;
    raise exception 'Outra pessoa confirmou esse horário primeiro. A agenda já foi atualizada; escolha outro horário.' using errcode = '23505';
end;
$$;

revoke all on function public.book_my_app_court(date, time without time zone, text, text, text) from public, anon;
grant execute on function public.book_my_app_court(date, time without time zone, text, text, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'app_court_bookings'
  ) then
    alter publication supabase_realtime add table public.app_court_bookings;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'app_court_schedule_days'
  ) then
    alter publication supabase_realtime add table public.app_court_schedule_days;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'app_court_slot_events'
  ) then
    alter publication supabase_realtime add table public.app_court_slot_events;
  end if;
end;
$$;

commit;
