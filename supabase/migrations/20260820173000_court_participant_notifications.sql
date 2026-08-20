begin;

create extension if not exists pg_net;
create extension if not exists pg_cron;

select vault.create_secret(
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrcXRncHRlYmtnZndndXlreGh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzEyNjAsImV4cCI6MjA5NzcwNzI2MH0.S-dopp-fbBgq8_YclyiAheOdK-QhXt92RYLu8JKmKCg',
  'court_dispatch_anon_key'
)
where not exists (
  select 1 from vault.decrypted_secrets where name = 'court_dispatch_anon_key'
);

alter table public.app_client_notifications
  add column if not exists dedupe_key text;

create unique index if not exists app_client_notifications_dedupe_idx
  on public.app_client_notifications(dedupe_key)
  where dedupe_key is not null;

create table if not exists public.app_client_notification_dispatches (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null unique
    references public.app_client_notifications(id) on delete cascade,
  status text not null default 'PENDENTE'
    check (status in ('PENDENTE', 'PROCESSANDO', 'ENVIADO', 'FALHOU')),
  attempts integer not null default 0,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_client_notification_dispatches_pending_idx
  on public.app_client_notification_dispatches(status, created_at);

alter table public.app_client_notification_dispatches enable row level security;
revoke all on table public.app_client_notification_dispatches from public, anon, authenticated;
grant all on table public.app_client_notification_dispatches to service_role;

create table if not exists public.app_notification_dispatch_config (
  id boolean primary key default true check (id),
  dispatch_secret text not null default encode(gen_random_bytes(32), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.app_notification_dispatch_config (id)
values (true)
on conflict (id) do nothing;

alter table public.app_notification_dispatch_config enable row level security;
revoke all on table public.app_notification_dispatch_config from public, anon, authenticated;
grant all on table public.app_notification_dispatch_config to service_role;

create or replace function public.queue_app_client_notification_push()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $$
begin
  insert into public.app_client_notification_dispatches (notification_id)
  values (new.id)
  on conflict (notification_id) do nothing;

  perform net.http_post(
    url := 'https://lkqtgptebkgfwguykxhv.supabase.co/functions/v1/client-notification-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'court_dispatch_anon_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'court_dispatch_anon_key'),
      'x-dispatch-token', (
        select config.dispatch_secret
        from public.app_notification_dispatch_config config
        where config.id = true
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;

revoke all on function public.queue_app_client_notification_push() from public, anon, authenticated;

drop trigger if exists queue_app_client_notification_push on public.app_client_notifications;
create trigger queue_app_client_notification_push
  after insert on public.app_client_notifications
  for each row execute function public.queue_app_client_notification_push();

create or replace function public.notify_app_court_booking_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_body text;
begin
  if tg_op = 'INSERT'
     and new.status = 'CONFIRMADO'
     and new.opponent_client_id is not null then
    v_title := 'Nova reserva com você';
    v_body := trim(coalesce(new.client_name, 'Um aluno')) ||
      ' marcou ' || new.court_name || ' com você para ' ||
      to_char(new.booking_date, 'DD/MM/YYYY') || ' às ' ||
      to_char(new.starts_at, 'HH24:MI') || '.';

    insert into public.app_client_notifications (
      user_id, title, body, link_url, event_type, dedupe_key
    ) values (
      new.opponent_client_id, v_title, v_body, '/?view=jogar',
      'QUADRA_MARCADA', 'court-booked:' || new.id::text || ':' || new.opponent_client_id::text
    ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  elsif tg_op = 'UPDATE'
        and old.status <> 'CANCELADO'
        and new.status = 'CANCELADO'
        and new.opponent_client_id is not null then
    v_title := 'Reserva de quadra cancelada';
    v_body := 'A reserva com ' || trim(coalesce(new.client_name, 'outro aluno')) ||
      ' em ' || to_char(new.booking_date, 'DD/MM/YYYY') || ' às ' ||
      to_char(new.starts_at, 'HH24:MI') || ' foi cancelada.';

    insert into public.app_client_notifications (
      user_id, title, body, link_url, event_type, dedupe_key
    ) values (
      new.opponent_client_id, v_title, v_body, '/?view=jogar',
      'QUADRA_CANCELADA', 'court-cancelled:' || new.id::text || ':' || new.opponent_client_id::text
    ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.notify_app_court_booking_participants() from public, anon, authenticated;

drop trigger if exists notify_app_court_booking_participants on public.app_court_bookings;
create trigger notify_app_court_booking_participants
  after insert or update of status on public.app_court_bookings
  for each row execute function public.notify_app_court_booking_participants();

drop policy if exists "court bookings read own or staff" on public.app_court_bookings;
create policy "court bookings read own participant or staff"
  on public.app_court_bookings
  for select
  to authenticated
  using (
    client_id = (select auth.uid())
    or opponent_client_id = (select auth.uid())
    or (select public.is_club_staff())
  );

drop function if exists public.get_app_court_availability(date, date);
create function public.get_app_court_availability(
  p_start_date date,
  p_end_date date
)
returns table (
  booking_date date,
  starts_at time without time zone,
  court_name text,
  status text,
  is_mine boolean,
  client_name text
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
    booking.booking_date,
    booking.starts_at,
    booking.court_name,
    booking.status,
    booking.client_id = auth.uid() or booking.opponent_client_id = auth.uid(),
    case
      when booking.status = 'BLOQUEADO' then null
      else nullif(trim(booking.client_name), '')
    end
  from public.app_court_bookings booking
  where booking.booking_date between p_start_date and p_end_date
    and booking.status <> 'CANCELADO'
  order by booking.booking_date, booking.starts_at, booking.court_name;
end;
$$;

revoke all on function public.get_app_court_availability(date, date) from public, anon;
grant execute on function public.get_app_court_availability(date, date) to authenticated;

create or replace function public.enqueue_due_court_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  with participants as (
    select
      booking.id as booking_id,
      participant.user_id,
      booking.booking_date,
      booking.starts_at,
      booking.court_name,
      (booking.booking_date + booking.starts_at) at time zone 'America/Sao_Paulo' as starts_at_tz
    from public.app_court_bookings booking
    cross join lateral (
      values (booking.client_id), (booking.opponent_client_id)
    ) as participant(user_id)
    where booking.status = 'CONFIRMADO'
      and participant.user_id is not null
  ), inserted as (
    insert into public.app_client_notifications (
      user_id, title, body, link_url, event_type, dedupe_key
    )
    select
      participant.user_id,
      'Sua quadra começa em 2 horas',
      participant.court_name || ' às ' || to_char(participant.starts_at, 'HH24:MI') ||
        '. Se não puder ir, cancele no Ilha Play para liberar o horário.',
      '/?view=jogar',
      'LEMBRETE_QUADRA',
      'court-reminder-2h:' || participant.booking_id::text || ':' || participant.user_id::text
    from participants participant
    where participant.starts_at_tz > now()
      and participant.starts_at_tz <= now() + interval '2 hours'
    on conflict (dedupe_key) where dedupe_key is not null do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

revoke all on function public.enqueue_due_court_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_due_court_reminders() to service_role;

create or replace function public.claim_app_client_push_dispatches(p_limit integer default 100)
returns table (
  dispatch_id uuid,
  notification_id uuid,
  user_id uuid,
  title text,
  body text,
  link_url text,
  attempts integer
)
language sql
security definer
set search_path = public
as $$
  with claimed as (
    select dispatch.id
    from public.app_client_notification_dispatches dispatch
    where dispatch.status = 'PENDENTE'
      and dispatch.attempts < 5
    order by dispatch.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 200))
  ), updated as (
    update public.app_client_notification_dispatches dispatch
    set status = 'PROCESSANDO',
        attempts = dispatch.attempts + 1,
        updated_at = now()
    from claimed
    where dispatch.id = claimed.id
    returning dispatch.*
  )
  select
    updated.id,
    updated.notification_id,
    notification.user_id,
    notification.title,
    notification.body,
    notification.link_url,
    updated.attempts
  from updated
  join public.app_client_notifications notification on notification.id = updated.notification_id;
$$;

revoke all on function public.claim_app_client_push_dispatches(integer) from public, anon, authenticated;
grant execute on function public.claim_app_client_push_dispatches(integer) to service_role;

insert into public.app_client_notifications (
  user_id, title, body, link_url, event_type, dedupe_key
)
select
  booking.opponent_client_id,
  'Nova reserva com você',
  trim(coalesce(booking.client_name, 'Um aluno')) || ' marcou ' || booking.court_name ||
    ' com você para ' || to_char(booking.booking_date, 'DD/MM/YYYY') || ' às ' ||
    to_char(booking.starts_at, 'HH24:MI') || '.',
  '/?view=jogar',
  'QUADRA_MARCADA',
  'court-booked:' || booking.id::text || ':' || booking.opponent_client_id::text
from public.app_court_bookings booking
where booking.status = 'CONFIRMADO'
  and booking.opponent_client_id is not null
  and booking.booking_date >= (now() at time zone 'America/Sao_Paulo')::date
on conflict (dedupe_key) where dedupe_key is not null do nothing;

select cron.schedule(
  'ilha-play-court-reminders',
  '* * * * *',
  $cron$
    select public.enqueue_due_court_reminders();
    select net.http_post(
      url := 'https://lkqtgptebkgfwguykxhv.supabase.co/functions/v1/client-notification-dispatch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'court_dispatch_anon_key'),
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'court_dispatch_anon_key'),
        'x-dispatch-token', (
          select config.dispatch_secret
          from public.app_notification_dispatch_config config
          where config.id = true
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 5000
    );
  $cron$
);

commit;
