set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.tournament_matches
  add column prediction_opened_at timestamptz,
  add column prediction_opened_on date;

-- Regular games retain the common daily window. A newly completed/published
-- confrontation after that cutoff gets its own window, bounded by its start
-- (or local midnight for "Após"). started_at remains an irreversible lock.
create or replace function private.tournament_prediction_window(p_match_id uuid)
returns table(opens_at timestamptz, closes_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select
    case when m.prediction_opened_at is not null and m.prediction_opened_on = d.day
      then m.prediction_opened_at else cutoff.value - interval '24 hours' end,
    case when m.prediction_opened_at is not null and m.prediction_opened_on = d.day
      then least(coalesce(m.scheduled_at, (m.match_date + m.match_time) at time zone d.tz),
        (d.day + 1)::timestamp at time zone d.tz)
      else cutoff.value end
  from public.tournament_matches m
  join public.tournaments t on t.id = m.tournament_id
  cross join lateral (select coalesce(nullif(t.timezone,''),'America/Sao_Paulo') as tz,
    coalesce(m.match_date,(m.scheduled_at at time zone coalesce(nullif(t.timezone,''),'America/Sao_Paulo'))::date) as day) d
  cross join lateral (select private.tournament_prediction_day_cutoff(m.id) as value) cutoff
  where m.id = p_match_id;
$$;
revoke all on function private.tournament_prediction_window(uuid) from public, anon, authenticated, service_role;

create or replace function private.prepare_same_day_prediction_release()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_tz text; v_day date; v_old_day date; v_exact timestamptz; v_cutoff timestamptz;
  v_new_confrontation boolean := tg_op = 'INSERT';
begin
  select coalesce(nullif(timezone,''),'America/Sao_Paulo') into v_tz
    from public.tournaments where id = new.tournament_id;
  v_day := coalesce(new.match_date,(new.scheduled_at at time zone v_tz)::date);
  if upper(coalesce(new.status,'')) = 'IN_PROGRESS' then
    new.started_at := coalesce(new.started_at, clock_timestamp());
  end if;
  if tg_op = 'UPDATE' then
    v_old_day := coalesce(old.match_date,(old.scheduled_at at time zone v_tz)::date);
    v_new_confrontation := not old.published or old.side1_athlete_id is null
      or old.side2_athlete_id is null or v_old_day is distinct from v_day;
    if v_old_day is distinct from v_day then
      new.prediction_opened_at := null;
      new.prediction_opened_on := null;
    end if;
  end if;
  if not v_new_confrontation or new.prediction_opened_at is not null
    or v_day is distinct from (clock_timestamp() at time zone v_tz)::date
    or not new.published or new.side1_athlete_id is null or new.side2_athlete_id is null
    or upper(coalesce(new.status,'')) not in ('PENDING','SCHEDULED')
    or new.started_at is not null or new.finished_at is not null or new.winner_athlete_id is not null then
    return new;
  end if;
  v_exact := coalesce(new.scheduled_at,(new.match_date + new.match_time) at time zone v_tz);
  if v_exact <= clock_timestamp() then return new; end if;
  select min(coalesce(m.scheduled_at,(m.match_date + m.match_time) at time zone v_tz))
    into v_cutoff from public.tournament_matches m
    where m.tournament_id = new.tournament_id and m.id <> new.id and m.published
      and m.side1_athlete_id is not null and m.side2_athlete_id is not null and m.status <> 'CANCELLED'
      and coalesce(m.match_date,(m.scheduled_at at time zone v_tz)::date) = v_day;
  if v_cutoff is null or v_cutoff <= clock_timestamp() then
    new.prediction_opened_at := clock_timestamp();
    new.prediction_opened_on := v_day;
  end if;
  return new;
end;
$$;
revoke all on function private.prepare_same_day_prediction_release() from public, anon, authenticated, service_role;
create trigger prepare_same_day_prediction_release
before insert or update on public.tournament_matches
for each row execute function private.prepare_same_day_prediction_release();

create or replace function private.enforce_tournament_prediction_open_window()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_window record; v_match public.tournament_matches%rowtype;
begin
  select * into v_match from public.tournament_matches where id = new.match_id for share;
  select * into v_window from private.tournament_prediction_window(new.match_id);
  if not v_match.published or v_match.side1_athlete_id is null or v_match.side2_athlete_id is null
    or v_window.opens_at is null or v_window.closes_at is null then
    raise exception using errcode = 'P0001', message = 'match_unavailable';
  end if;
  if clock_timestamp() < v_window.opens_at then
    raise exception using errcode = 'P0001', message = 'prediction_not_open';
  end if;
  if clock_timestamp() >= v_window.closes_at
    or v_match.status not in ('PENDING','SCHEDULED') or v_match.started_at is not null
    or v_match.finished_at is not null or v_match.winner_athlete_id is not null then
    raise exception using errcode = 'P0001', message = 'prediction_locked';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_tournament_prediction_open_window() from public, anon, authenticated, service_role;

-- Extra delivery queue for public-tournament subscribers who do not already
-- receive this same announcement through their Ilha Play subscription.
create table public.tournament_prediction_push_dispatches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  notification_key text not null,
  match_ids uuid[] not null,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  title text not null,
  body text not null,
  link_url text not null,
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','SENT','FAILED','EXPIRED')),
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(notification_key,endpoint)
);
create index tournament_prediction_push_tournament_idx on public.tournament_prediction_push_dispatches(tournament_id);
create index tournament_prediction_push_pending_idx on public.tournament_prediction_push_dispatches(created_at)
  where status in ('PENDING','PROCESSING');
alter table public.tournament_prediction_push_dispatches enable row level security;
alter table public.tournament_prediction_push_dispatches force row level security;
revoke all on public.tournament_prediction_push_dispatches from public, anon, authenticated;
grant all on public.tournament_prediction_push_dispatches to service_role;

create or replace function private.enqueue_prediction_release_notifications(p_match_ids uuid[], p_key text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_ids uuid[]; v_tournament uuid; v_slug text; v_title text; v_body text; v_total integer; v_queued integer;
begin
  select array_agg(m.id), (array_agg(t.id))[1], (array_agg(t.slug))[1]
    into v_ids,v_tournament,v_slug
  from public.tournament_matches m join public.tournaments t on t.id=m.tournament_id
  join public.tournament_prediction_campaigns c on c.tournament_id=t.id
  join public.tournament_categories category on category.id=m.category_id
  cross join lateral private.tournament_prediction_window(m.id) w
  where m.id=any(p_match_ids) and m.published and t.is_published and category.active and category.is_published
    and m.status in ('PENDING','SCHEDULED') and m.started_at is null and m.finished_at is null
    and m.winner_athlete_id is null and m.side1_athlete_id is not null and m.side2_athlete_id is not null
    and c.published and c.status='OPEN'
    and (c.opens_at is null or c.opens_at<=now()) and (c.closes_at is null or c.closes_at>now())
    and clock_timestamp()>=w.opens_at and clock_timestamp()<w.closes_at;
  if coalesce(cardinality(v_ids),0)=0 then return 0; end if;
  if (select count(distinct tournament_id) from public.tournament_matches where id=any(v_ids))<>1 then
    raise exception 'Os jogos devem ser do mesmo torneio.';
  end if;
  v_title := 'Novos palpites liberados';
  if cardinality(v_ids)=1 then
    select left(c.name || ': ' || coalesce(a.nickname,a.full_name) || ' x ' || coalesce(b.nickname,b.full_name)
      || '. Entre na Ilha Bet e faça seu palpite antes do início do jogo.',280)
      into v_body
    from public.tournament_matches m join public.tournament_categories c on c.id=m.category_id
      join public.tournament_athletes a on a.id=m.side1_athlete_id
      join public.tournament_athletes b on b.id=m.side2_athlete_id where m.id=v_ids[1];
  else
    v_body := cardinality(v_ids)::text || ' novos jogos de hoje estão liberados na Ilha Bet. Entre e faça seus palpites antes de cada partida começar!';
  end if;
  insert into public.app_client_notifications(user_id,title,body,link_url,event_type,dedupe_key)
    select c.id,v_title,v_body,'/bet?torneio='||v_slug,'BET_JOGO_LIBERADO',p_key||':'||c.id::text
    from public.app_clients c join auth.users u on u.id=c.id
    where upper(coalesce(c.status,''))='ATIVO' and c.registration_completed_at is not null
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_total = row_count;
  insert into public.tournament_prediction_push_dispatches(tournament_id,notification_key,match_ids,endpoint,p256dh,auth_key,title,body,link_url)
    select v_tournament,p_key,v_ids,s.endpoint,s.p256dh,s.auth_key,v_title,v_body,'/bet?torneio='||v_slug
    from public.tournament_push_subscriptions s
    where s.tournament_id=v_tournament and s.enabled
      and not exists (
        select 1 from public.app_push_subscriptions a join public.app_clients c on c.id=a.user_id
        where a.endpoint=s.endpoint and a.enabled and a.app_surface='ILHA_PLAY'
          and upper(coalesce(c.status,''))='ATIVO' and c.registration_completed_at is not null)
    on conflict (notification_key,endpoint) do nothing;
  get diagnostics v_queued = row_count;
  return v_total + v_queued;
end;
$$;
revoke all on function private.enqueue_prediction_release_notifications(uuid[],text) from public, anon, authenticated, service_role;

create or replace function private.notify_same_day_prediction_release()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.prediction_opened_at is null
    or current_setting('app.skip_bet_release_notifications',true)='on' then return new; end if;
  if tg_op='UPDATE' then
    if new.prediction_opened_at is not distinct from old.prediction_opened_at then return new; end if;
  end if;
  perform private.enqueue_prediction_release_notifications(array[new.id],
    'bet-release:'||new.id::text||':'||new.prediction_opened_on::text);
  return new;
end;
$$;
revoke all on function private.notify_same_day_prediction_release() from public, anon, authenticated, service_role;
create trigger notify_same_day_prediction_release
after insert or update on public.tournament_matches
for each row execute function private.notify_same_day_prediction_release();

create or replace function public.claim_tournament_prediction_push_dispatches(p_limit integer default 100)
returns setof public.tournament_prediction_push_dispatches
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'Acesso negado.' using errcode='42501'; end if;
  update public.tournament_prediction_push_dispatches q
    set status='EXPIRED',updated_at=now()
    where q.status in ('PENDING','PROCESSING') and not exists (
      select 1 from public.tournament_matches m
      join public.tournament_prediction_campaigns c on c.tournament_id=m.tournament_id
      cross join lateral private.tournament_prediction_window(m.id) w
      where m.id=any(q.match_ids) and m.published and m.status in ('PENDING','SCHEDULED')
        and m.started_at is null and m.finished_at is null and m.winner_athlete_id is null
        and c.published and c.status='OPEN' and (c.closes_at is null or c.closes_at>now())
        and clock_timestamp()>=w.opens_at and clock_timestamp()<w.closes_at);
  return query
  with candidates as (
    select q.id from public.tournament_prediction_push_dispatches q
    where q.attempts<5 and (q.status='PENDING' or (q.status='PROCESSING' and q.updated_at<now()-interval '5 minutes'))
    order by q.created_at for update skip locked limit greatest(1,least(coalesce(p_limit,100),200))
  )
  update public.tournament_prediction_push_dispatches q
    set status='PROCESSING',attempts=q.attempts+1,updated_at=now()
    from candidates where q.id=candidates.id returning q.*;
end;
$$;
revoke all on function public.claim_tournament_prediction_push_dispatches(integer) from public, anon, authenticated;
grant execute on function public.claim_tournament_prediction_push_dispatches(integer) to service_role;

create or replace function public.save_tournament_prediction(
  p_campaign_id uuid,
  p_entry_id uuid,
  p_access_code_hash text,
  p_match_id uuid,
  p_predicted_winner_athlete_id uuid,
  p_request_id uuid
)
returns public.tournament_predictions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.tournament_prediction_campaigns%rowtype;
  v_entry public.tournament_prediction_entries%rowtype;
  v_match public.tournament_matches%rowtype;
  v_tournament public.tournaments%rowtype;
  v_prediction public.tournament_predictions%rowtype;
  v_request public.tournament_prediction_requests%rowtype;
  v_now timestamptz := clock_timestamp();
  v_window record;
begin
  select * into v_campaign
  from public.tournament_prediction_campaigns as campaign
  where campaign.id = p_campaign_id
  for share;

  if not found then
    raise exception using errcode = 'P0001', message = 'campaign_not_found';
  end if;

  select * into v_entry
  from public.tournament_prediction_entries as entry
  where entry.id = p_entry_id
    and entry.campaign_id = v_campaign.id
    and entry.access_code_hash = p_access_code_hash
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'invalid_access';
  end if;
  if v_entry.status <> 'ACTIVE' then
    raise exception using errcode = 'P0001', message = 'entry_blocked';
  end if;

  if p_request_id is null then
    raise exception using errcode = '22023', message = 'invalid_prediction';
  end if;

  select * into v_request
  from public.tournament_prediction_requests as request
  where request.request_id = p_request_id;

  if found then
    if v_request.campaign_id is distinct from v_campaign.id
       or v_request.entry_id is distinct from v_entry.id
       or v_request.match_id is distinct from p_match_id
       or v_request.predicted_winner_athlete_id is distinct from p_predicted_winner_athlete_id then
      raise exception using errcode = 'P0001', message = 'request_conflict';
    end if;
    select * into v_prediction
    from public.tournament_predictions as prediction
    where prediction.entry_id = v_entry.id
      and prediction.match_id = p_match_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'request_conflict';
    end if;
    return v_prediction;
  end if;

  if v_campaign.status <> 'OPEN'
     or not v_campaign.published
     or (v_campaign.opens_at is not null and v_now < v_campaign.opens_at)
     or (v_campaign.closes_at is not null and v_now >= v_campaign.closes_at) then
    raise exception using errcode = 'P0001', message = 'campaign_closed';
  end if;

  select * into v_match
  from public.tournament_matches as match
  where match.id = p_match_id
    and match.tournament_id = v_campaign.tournament_id
  for share;

  if not found or not v_match.published
     or v_match.side1_athlete_id is null
     or v_match.side2_athlete_id is null
     or p_predicted_winner_athlete_id not in (v_match.side1_athlete_id, v_match.side2_athlete_id)
     or (v_match.match_date is null and v_match.scheduled_at is null) then
    raise exception using errcode = 'P0001', message = 'match_unavailable';
  end if;

  select * into v_tournament
  from public.tournaments as tournament
  where tournament.id = v_campaign.tournament_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'match_unavailable';
  end if;

  select * into v_window from private.tournament_prediction_window(v_match.id);

  if v_window.opens_at is null or v_window.closes_at is null then
    raise exception using errcode = 'P0001', message = 'match_unavailable';
  end if;

  if v_now < v_window.opens_at then
    raise exception using errcode = 'P0001', message = 'prediction_not_open';
  end if;

  if upper(coalesce(v_match.status, '')) not in ('PENDING', 'SCHEDULED')
     or v_match.started_at is not null
     or v_match.finished_at is not null
     or v_match.winner_athlete_id is not null
     or v_now >= v_window.closes_at then
    raise exception using errcode = 'P0001', message = 'prediction_locked';
  end if;

  insert into public.tournament_prediction_requests (
    request_id,
    campaign_id,
    entry_id,
    match_id,
    predicted_winner_athlete_id
  ) values (
    p_request_id,
    v_campaign.id,
    v_entry.id,
    v_match.id,
    p_predicted_winner_athlete_id
  )
  on conflict (request_id) do nothing
  returning * into v_request;

  if not found then
    select * into v_request
    from public.tournament_prediction_requests as request
    where request.request_id = p_request_id;

    if v_request.campaign_id is distinct from v_campaign.id
       or v_request.entry_id is distinct from v_entry.id
       or v_request.match_id is distinct from v_match.id
       or v_request.predicted_winner_athlete_id is distinct from p_predicted_winner_athlete_id then
      raise exception using errcode = 'P0001', message = 'request_conflict';
    end if;

    select * into v_prediction
    from public.tournament_predictions as prediction
    where prediction.entry_id = v_entry.id
      and prediction.match_id = v_match.id;
    if not found then
      raise exception using errcode = 'P0001', message = 'request_conflict';
    end if;
    return v_prediction;
  end if;

  insert into public.tournament_predictions (
    campaign_id,
    entry_id,
    match_id,
    predicted_winner_athlete_id
  ) values (
    v_campaign.id,
    v_entry.id,
    v_match.id,
    p_predicted_winner_athlete_id
  )
  on conflict (entry_id, match_id) do update
    set predicted_winner_athlete_id = excluded.predicted_winner_athlete_id,
        updated_at = now()
  returning * into v_prediction;

  update public.tournament_prediction_entries
  set last_seen_at = v_now
  where id = v_entry.id;

  insert into public.tournament_prediction_audit_log (
    campaign_id, actor_kind, action, entity_type, entity_id, metadata
  ) values (
    v_campaign.id,
    'PARTICIPANT',
    'SAVE_PREDICTION',
    'prediction',
    v_prediction.id,
    jsonb_build_object('match_id', v_match.id)
  );

  return v_prediction;
end;
$$;

alter function public.save_tournament_prediction(uuid, uuid, text, uuid, uuid, uuid)
  owner to postgres;
revoke all on function public.save_tournament_prediction(uuid, uuid, text, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.save_tournament_prediction(uuid, uuid, text, uuid, uuid, uuid)
  to service_role;
comment on function public.save_tournament_prediction(uuid, uuid, text, uuid, uuid, uuid) is
  'Saves an idempotent prediction only for a scheduled match inside its daily or explicitly released same-day window.';
