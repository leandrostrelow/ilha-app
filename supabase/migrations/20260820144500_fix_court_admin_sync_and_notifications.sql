begin;

revoke all on table public.app_court_schedule_days from authenticated;
grant select, insert, update, delete on table public.app_court_schedule_days to authenticated;

create table if not exists public.app_client_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_clients(id) on delete cascade,
  title text not null,
  body text not null default '',
  link_url text not null default '/?view=notifications',
  event_type text not null default 'GERAL',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists app_client_notifications_user_created_idx
  on public.app_client_notifications(user_id, created_at desc);

alter table public.app_client_notifications enable row level security;

drop policy if exists app_client_notifications_read_own_or_staff on public.app_client_notifications;
create policy app_client_notifications_read_own_or_staff
  on public.app_client_notifications
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_club_staff());

drop policy if exists app_client_notifications_update_own_or_staff on public.app_client_notifications;
create policy app_client_notifications_update_own_or_staff
  on public.app_client_notifications
  for update
  to authenticated
  using (user_id = auth.uid() or public.is_club_staff())
  with check (user_id = auth.uid() or public.is_club_staff());

drop policy if exists app_client_notifications_insert_staff on public.app_client_notifications;
create policy app_client_notifications_insert_staff
  on public.app_client_notifications
  for insert
  to authenticated
  with check (public.is_club_office());

drop policy if exists app_client_notifications_delete_staff on public.app_client_notifications;
create policy app_client_notifications_delete_staff
  on public.app_client_notifications
  for delete
  to authenticated
  using (public.is_club_office());

revoke all on table public.app_client_notifications from public, anon, authenticated;
grant select, insert, update, delete on table public.app_client_notifications to authenticated;
grant all on table public.app_client_notifications to service_role;

create or replace function public.admin_configure_app_court_day(
  p_schedule_date date,
  p_enabled boolean,
  p_notes text default null,
  p_slot_times time without time zone[] default null
)
returns table (
  user_id uuid,
  title text,
  body text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking record;
  v_title text := 'Reserva de quadra cancelada';
  v_body text;
  v_times time without time zone[] := coalesce(
    p_slot_times,
    array[
      time '14:00', time '15:00', time '16:00', time '17:00',
      time '18:00', time '19:00', time '20:00'
    ]
  );
begin
  if auth.uid() is null or not public.is_club_office() then
    raise exception 'Acesso não autorizado.' using errcode = '42501';
  end if;

  if p_schedule_date is null then
    raise exception 'Informe a data.' using errcode = '22023';
  end if;

  insert into public.app_court_schedule_days (schedule_date, enabled, notes, slot_times)
  values (
    p_schedule_date,
    coalesce(p_enabled, false),
    nullif(trim(coalesce(p_notes, '')), ''),
    v_times
  )
  on conflict (schedule_date) do update
    set enabled = excluded.enabled,
        notes = excluded.notes,
        slot_times = excluded.slot_times;

  if coalesce(p_enabled, false) then
    return;
  end if;

  for v_booking in
    select distinct booking.client_id, booking.starts_at, booking.court_name
      from public.app_court_bookings booking
     where booking.booking_date = p_schedule_date
       and booking.status <> 'CANCELADO'
       and booking.client_id is not null
  loop
    v_body := 'Sua reserva de ' || to_char(p_schedule_date, 'DD/MM/YYYY') ||
      ' às ' || to_char(v_booking.starts_at, 'HH24:MI') || ' na ' || v_booking.court_name ||
      ' foi cancelada porque o clube bloqueou esse dia' ||
      case
        when nullif(trim(coalesce(p_notes, '')), '') is not null
          then ': ' || trim(p_notes) || '.'
        else '.'
      end;

    insert into public.app_client_notifications (
      user_id, title, body, link_url, event_type
    ) values (
      v_booking.client_id, v_title, v_body, '/?view=notifications', 'QUADRA_CANCELADA'
    );

    user_id := v_booking.client_id;
    title := v_title;
    body := v_body;
    return next;
  end loop;

  update public.app_court_bookings
     set status = 'CANCELADO'
   where booking_date = p_schedule_date
     and status <> 'CANCELADO';
end;
$$;

revoke all on function public.admin_configure_app_court_day(date, boolean, text, time without time zone[]) from public, anon;
grant execute on function public.admin_configure_app_court_day(date, boolean, text, time without time zone[]) to authenticated;

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'app_client_notifications'
  ) then
    alter publication supabase_realtime add table public.app_client_notifications;
  end if;
end;
$$;

commit;
