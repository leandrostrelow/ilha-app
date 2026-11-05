begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Every match on the same agenda day shares one prediction window. The first
-- exact time anchors both opening (24 hours earlier) and closing. Matches whose
-- time is "Após" therefore close safely with the first match of that day.
create or replace function private.tournament_prediction_day_cutoff(
  p_match_id uuid
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  with selected_match as (
    select
      selected.tournament_id,
      coalesce(nullif(tournament.timezone, ''), 'America/Sao_Paulo') as timezone,
      coalesce(
        selected.match_date,
        (selected.scheduled_at at time zone coalesce(nullif(tournament.timezone, ''), 'America/Sao_Paulo'))::date
      ) as match_day
    from public.tournament_matches as selected
    join public.tournaments as tournament
      on tournament.id = selected.tournament_id
    where selected.id = p_match_id
  )
  select min(
    coalesce(
      candidate.scheduled_at,
      case
        when candidate.match_date is not null and candidate.match_time is not null
        then (candidate.match_date + candidate.match_time) at time zone selected_match.timezone
        else null
      end
    )
  )
  from selected_match
  join public.tournament_matches as candidate
    on candidate.tournament_id = selected_match.tournament_id
  where selected_match.match_day is not null
    and candidate.published
    and candidate.side1_athlete_id is not null
    and candidate.side2_athlete_id is not null
    and upper(coalesce(candidate.status, '')) <> 'CANCELLED'
    and coalesce(
      candidate.match_date,
      (candidate.scheduled_at at time zone selected_match.timezone)::date
    ) = selected_match.match_day;
$$;

alter function private.tournament_prediction_day_cutoff(uuid)
  owner to postgres;
revoke all on function private.tournament_prediction_day_cutoff(uuid)
  from public, anon, authenticated, service_role;
comment on function private.tournament_prediction_day_cutoff(uuid) is
  'Returns the first exact start time among published matches on the selected match agenda day.';

create or replace function private.enforce_tournament_prediction_open_window()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day_cutoff timestamptz;
begin
  v_day_cutoff := private.tournament_prediction_day_cutoff(new.match_id);

  if v_day_cutoff is null then
    raise exception using errcode = 'P0001', message = 'match_unavailable';
  end if;

  if clock_timestamp() < v_day_cutoff - interval '24 hours' then
    raise exception using errcode = 'P0001', message = 'prediction_not_open';
  end if;

  if clock_timestamp() >= v_day_cutoff then
    raise exception using errcode = 'P0001', message = 'prediction_locked';
  end if;

  return new;
end;
$$;

alter function private.enforce_tournament_prediction_open_window()
  owner to postgres;
revoke all on function private.enforce_tournament_prediction_open_window()
  from public, anon, authenticated, service_role;
comment on function private.enforce_tournament_prediction_open_window() is
  'Allows predictions from 24 hours before until the first exact match time of the agenda day.';

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
  v_day_cutoff timestamptz;
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

  v_day_cutoff := private.tournament_prediction_day_cutoff(v_match.id);

  if v_day_cutoff is null then
    raise exception using errcode = 'P0001', message = 'match_unavailable';
  end if;

  if v_now < v_day_cutoff - interval '24 hours' then
    raise exception using errcode = 'P0001', message = 'prediction_not_open';
  end if;

  if upper(coalesce(v_match.status, '')) not in ('PENDING', 'SCHEDULED')
     or v_match.started_at is not null
     or v_match.finished_at is not null
     or v_match.winner_athlete_id is not null
     or v_now >= v_day_cutoff then
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
  'Saves an idempotent prediction only for a scheduled match inside the shared agenda-day window.';

commit;
