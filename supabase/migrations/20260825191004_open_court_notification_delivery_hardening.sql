begin;

-- Keep delivery state truthful. A push can be visible in-app without any browser
-- subscription, and one failing device must not erase successful delivery to
-- another device owned by the same client.
alter table public.app_client_notification_dispatches
  drop constraint if exists app_client_notification_dispatches_status_check;

alter table public.app_client_notification_dispatches
  add constraint app_client_notification_dispatches_status_check
  check (status in (
    'PENDENTE',
    'PROCESSANDO',
    'ENVIADO',
    'PARCIAL',
    'SEM_ASSINATURA',
    'FALHOU'
  )) not valid;

alter table public.app_client_notification_dispatches
  validate constraint app_client_notification_dispatches_status_check;

update public.app_client_notification_dispatches
   set status = 'SEM_ASSINATURA',
       sent_at = null,
       updated_at = now()
 where status = 'ENVIADO'
   and sent_at is not null
   and last_error = 'Nenhum aparelho com notificações ativas.';

-- The minute cron already drains the dispatch queue. Open-challenge fanout can
-- create many notifications in one statement, so invoking pg_net once per row
-- only causes duplicate worker calls. Keep the existing trigger and make its
-- function enqueue-only.
create or replace function public.queue_app_client_notification_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.app_client_notification_dispatches (notification_id)
  values (new.id)
  on conflict (notification_id) do nothing;

  return new;
end;
$$;

revoke all on function public.queue_app_client_notification_push()
  from public, anon, authenticated;

-- An endpoint is a browser/device capability. Reassign it atomically to the
-- currently authenticated, approved client when that browser changes account.
-- This avoids the RLS upsert conflict caused by endpoint's unique constraint.
create or replace function public.upsert_current_app_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth_key text,
  p_user_agent text default null
)
returns table (
  subscription_id uuid,
  owner_user_id uuid,
  enabled boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Faça login para ativar as notificações.' using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.app_clients as client
     where client.id = v_user_id
       and upper(coalesce(client.status, '')) = 'ATIVO'
       and client.registration_completed_at is not null
  ) then
    raise exception 'Seu acesso precisa estar ativo para receber notificações.' using errcode = '42501';
  end if;

  if p_endpoint is null
     or length(p_endpoint) > 4096
     or p_endpoint !~ '^https://[^[:space:]]+$' then
    raise exception 'Assinatura de notificações inválida.' using errcode = '22023';
  end if;

  if p_p256dh is null
     or length(p_p256dh) not between 32 and 512
     or p_p256dh !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Chave de notificações inválida.' using errcode = '22023';
  end if;

  if p_auth_key is null
     or length(p_auth_key) not between 8 and 256
     or p_auth_key !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Autenticação de notificações inválida.' using errcode = '22023';
  end if;

  return query
  insert into public.app_push_subscriptions as subscription (
    user_id,
    endpoint,
    p256dh,
    auth_key,
    user_agent,
    enabled,
    updated_at
  ) values (
    v_user_id,
    p_endpoint,
    p_p256dh,
    p_auth_key,
    left(nullif(trim(coalesce(p_user_agent, '')), ''), 1000),
    true,
    now()
  )
  on conflict (endpoint) do update
     set user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth_key = excluded.auth_key,
         user_agent = excluded.user_agent,
         enabled = true,
         updated_at = now()
  returning subscription.id, subscription.user_id, subscription.enabled;
end;
$$;

revoke all on function public.upsert_current_app_push_subscription(text, text, text, text)
  from public, anon;
grant execute on function public.upsert_current_app_push_subscription(text, text, text, text)
  to authenticated;

comment on function public.upsert_current_app_push_subscription(text, text, text, text) is
  'Atomically assigns the current browser push endpoint to the authenticated active Ilha Play client.';

-- Open challenges previously had no recipient at all, so neither an in-app
-- notification nor a push dispatch was created. Fan out one deduplicated event
-- to every approved client who can still accept that date.
create or replace function public.notify_clients_about_open_court_challenge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_opponent_id uuid;
begin
  if new.status <> 'PENDENTE'
     or new.challenge_kind <> 'ABERTO'
     or new.challenge_expires_at is null
     or new.challenge_expires_at <= now() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status
       and new.challenge_kind is not distinct from old.challenge_kind
       and new.challenge_invite_version is not distinct from old.challenge_invite_version then
      return new;
    end if;
    v_previous_opponent_id := old.opponent_client_id;
  end if;

  insert into public.app_client_notifications (
    user_id,
    title,
    body,
    link_url,
    event_type,
    dedupe_key
  )
  select
    candidate.id,
    'Novo convite aberto para jogar',
    trim(coalesce(new.client_name, 'Um aluno')) ||
      ' procura adversário para ' || new.court_name || ', dia ' ||
      to_char(new.booking_date, 'DD/MM/YYYY') || ' às ' ||
      to_char(new.starts_at, 'HH24:MI') || '. Toque em Jogar para aceitar.',
    '/?view=jogar',
    'CONVITE_QUADRA_ABERTO',
    'court-challenge-open:' || new.id::text || ':' ||
      new.challenge_invite_version::text || ':' || candidate.id::text
  from public.app_clients as candidate
  where upper(coalesce(candidate.status, '')) = 'ATIVO'
    and candidate.registration_completed_at is not null
    and candidate.id <> new.client_id
    and candidate.id is distinct from v_previous_opponent_id
    and not exists (
      select 1
        from public.app_court_bookings as occupied
       where occupied.id <> new.id
         and occupied.booking_date = new.booking_date
         and occupied.status <> 'CANCELADO'
         and (
           occupied.client_id = candidate.id
           or occupied.opponent_client_id = candidate.id
         )
    )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  return new;
end;
$$;

revoke all on function public.notify_clients_about_open_court_challenge()
  from public, anon, authenticated;

drop trigger if exists notify_clients_about_open_court_challenge
  on public.app_court_bookings;
create trigger notify_clients_about_open_court_challenge
after insert or update of status, challenge_kind, challenge_invite_version
on public.app_court_bookings
for each row execute function public.notify_clients_about_open_court_challenge();

-- Backfill only open challenges that are still actionable when this migration
-- is applied. The same dedupe contract used by the trigger makes this idempotent.
insert into public.app_client_notifications (
  user_id,
  title,
  body,
  link_url,
  event_type,
  dedupe_key
)
select
  candidate.id,
  'Novo convite aberto para jogar',
  trim(coalesce(booking.client_name, 'Um aluno')) ||
    ' procura adversário para ' || booking.court_name || ', dia ' ||
    to_char(booking.booking_date, 'DD/MM/YYYY') || ' às ' ||
    to_char(booking.starts_at, 'HH24:MI') || '. Toque em Jogar para aceitar.',
  '/?view=jogar',
  'CONVITE_QUADRA_ABERTO',
  'court-challenge-open:' || booking.id::text || ':' ||
    booking.challenge_invite_version::text || ':' || candidate.id::text
from public.app_court_bookings as booking
join public.app_clients as candidate
  on candidate.id <> booking.client_id
 and upper(coalesce(candidate.status, '')) = 'ATIVO'
 and candidate.registration_completed_at is not null
where booking.status = 'PENDENTE'
  and booking.challenge_kind = 'ABERTO'
  and booking.challenge_expires_at > now()
  and not exists (
    select 1
      from public.app_court_bookings as occupied
     where occupied.id <> booking.id
       and occupied.booking_date = booking.booking_date
       and occupied.status <> 'CANCELADO'
       and (
         occupied.client_id = candidate.id
         or occupied.opponent_client_id = candidate.id
       )
  )
on conflict (dedupe_key) where dedupe_key is not null do nothing;

-- Include event_type in the atomic claim so the worker can choose an expiry
-- aligned with the business event instead of using one fixed two-hour TTL.
drop function if exists public.claim_app_client_push_dispatches(integer);

create function public.claim_app_client_push_dispatches(
  p_limit integer default 100
)
returns table (
  dispatch_id uuid,
  notification_id uuid,
  user_id uuid,
  title text,
  body text,
  link_url text,
  event_type text,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  update public.app_client_notification_dispatches as dispatch
     set status = 'FALHOU',
         last_error = coalesce(
           dispatch.last_error,
           'Processamento interrompido após o limite de tentativas.'
         ),
         updated_at = now()
   where dispatch.attempts >= 5
     and (
       dispatch.status = 'PENDENTE'
       or (
         dispatch.status = 'PROCESSANDO'
         and dispatch.updated_at < now() - interval '5 minutes'
       )
     );

  return query
  with claimed as (
    select dispatch.id
      from public.app_client_notification_dispatches as dispatch
     where dispatch.attempts < 5
       and (
         dispatch.status = 'PENDENTE'
         or (
           dispatch.status = 'PROCESSANDO'
           and dispatch.updated_at < now() - interval '5 minutes'
         )
       )
     order by dispatch.created_at
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 100), 200))
  ), updated as (
    update public.app_client_notification_dispatches as dispatch
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
    notification.event_type,
    updated.attempts
  from updated
  join public.app_client_notifications as notification
    on notification.id = updated.notification_id;
end;
$$;

revoke all on function public.claim_app_client_push_dispatches(integer)
  from public, anon, authenticated;
grant execute on function public.claim_app_client_push_dispatches(integer)
  to service_role;

commit;
