begin;

create or replace function public.admin_set_tournament_prediction_entry_status(
  p_entry_id uuid,
  p_status text,
  p_actor_id uuid
)
returns public.tournament_prediction_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.tournament_prediction_entries%rowtype;
  v_campaign public.tournament_prediction_campaigns%rowtype;
  v_campaign_id uuid;
  v_status text := upper(trim(coalesce(p_status, '')));
  v_previous_status text;
begin
  if v_status not in ('ACTIVE', 'BLOCKED') then
    raise exception using errcode = '22023', message = 'invalid_entry_status';
  end if;

  select entry.campaign_id into v_campaign_id
  from public.tournament_prediction_entries as entry
  where entry.id = p_entry_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'entry_not_found';
  end if;

  -- All participant mutations lock campaign first, then entry.
  select * into v_campaign
  from public.tournament_prediction_campaigns as campaign
  where campaign.id = v_campaign_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'campaign_not_found';
  end if;

  select * into v_entry
  from public.tournament_prediction_entries as entry
  where entry.id = p_entry_id
    and entry.campaign_id = v_campaign.id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'entry_not_found';
  end if;
  if v_campaign.status = 'FINISHED' then
    raise exception using errcode = 'P0001', message = 'campaign_finished';
  end if;

  v_previous_status := v_entry.status;
  update public.tournament_prediction_entries
  set status = v_status
  where id = v_entry.id
  returning * into v_entry;

  insert into public.tournament_prediction_audit_log (
    campaign_id, actor_id, actor_kind, action, entity_type, entity_id, metadata
  ) values (
    v_entry.campaign_id, p_actor_id, 'ADMIN', 'SET_ENTRY_STATUS', 'entry', v_entry.id,
    jsonb_build_object('from', v_previous_status, 'to', v_status, 'public_name', v_entry.public_name)
  );
  return v_entry;
end;
$$;

revoke all on function public.admin_set_tournament_prediction_entry_status(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_set_tournament_prediction_entry_status(uuid, text, uuid)
  to service_role;

create or replace function public.admin_delete_tournament_prediction_entry(
  p_entry_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.tournament_prediction_entries%rowtype;
  v_campaign public.tournament_prediction_campaigns%rowtype;
  v_campaign_id uuid;
begin
  select entry.campaign_id into v_campaign_id
  from public.tournament_prediction_entries as entry
  where entry.id = p_entry_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'entry_not_found';
  end if;

  -- Match save_tournament_prediction's campaign -> entry lock order.
  select * into v_campaign
  from public.tournament_prediction_campaigns as campaign
  where campaign.id = v_campaign_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'campaign_not_found';
  end if;

  select * into v_entry
  from public.tournament_prediction_entries as entry
  where entry.id = p_entry_id
    and entry.campaign_id = v_campaign.id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'entry_not_found';
  end if;
  if v_campaign.status = 'FINISHED' then
    raise exception using errcode = 'P0001', message = 'campaign_finished';
  end if;

  delete from public.tournament_prediction_entries where id = v_entry.id;
  insert into public.tournament_prediction_audit_log (
    campaign_id, actor_id, actor_kind, action, entity_type, entity_id, metadata
  ) values (
    v_entry.campaign_id, p_actor_id, 'ADMIN', 'DELETE_ENTRY', 'entry', v_entry.id,
    jsonb_build_object('public_name', v_entry.public_name, 'previous_status', v_entry.status)
  );
  return v_entry.id;
end;
$$;

revoke all on function public.admin_delete_tournament_prediction_entry(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_delete_tournament_prediction_entry(uuid, uuid)
  to service_role;

create or replace function public.admin_finalize_tournament_prediction_campaign(
  p_tournament_id uuid,
  p_actor_id uuid
)
returns public.tournament_prediction_campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.tournament_prediction_campaigns%rowtype;
  v_tournament_status text;
  v_winner_id uuid;
  v_winner_score integer;
begin
  select * into v_campaign
  from public.tournament_prediction_campaigns as campaign
  where campaign.tournament_id = p_tournament_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'campaign_not_found';
  end if;
  if v_campaign.status <> 'LOCKED' then
    raise exception using errcode = 'P0001', message = 'campaign_must_be_locked';
  end if;

  select tournament.status into v_tournament_status
  from public.tournaments as tournament
  where tournament.id = p_tournament_id
  for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'tournament_not_found';
  end if;
  if v_tournament_status <> 'FINISHED' then
    raise exception using errcode = 'P0001', message = 'tournament_not_finished';
  end if;

  perform match.id
  from public.tournament_matches as match
  where match.tournament_id = p_tournament_id
    and match.published
  for share;

  if exists (
    select 1
    from public.tournament_matches as match
    where match.tournament_id = p_tournament_id
      and match.published
      and match.side1_athlete_id is not null
      and match.side2_athlete_id is not null
      and upper(coalesce(match.status, '')) <> 'CANCELLED'
      and (
        match.winner_athlete_id is null
        or upper(coalesce(match.status, '')) not in ('FINISHED', 'WALKOVER')
      )
  ) then
    raise exception using errcode = 'P0001', message = 'tournament_results_incomplete';
  end if;

  select entry.id,
         coalesce(sum(
           case when prediction.predicted_winner_athlete_id = match.winner_athlete_id then
             case
               when upper(coalesce(match.round_code, match.phase, '')) in ('FINAL', 'F') then v_campaign.final_points
               when upper(coalesce(match.round_code, match.phase, '')) in ('SF', 'SEMIFINAL', 'SEMI_FINAL') then v_campaign.semifinal_points
               else v_campaign.initial_round_points
             end
           else 0 end
         ), 0)::integer as score
  into v_winner_id, v_winner_score
  from public.tournament_prediction_entries as entry
  left join public.tournament_predictions as prediction on prediction.entry_id = entry.id
  left join public.tournament_matches as match
    on match.id = prediction.match_id
   and match.published
   and match.winner_athlete_id is not null
   and upper(coalesce(match.status, '')) in ('FINISHED', 'WALKOVER')
   and prediction.predicted_winner_athlete_id in (match.side1_athlete_id, match.side2_athlete_id)
  where entry.campaign_id = v_campaign.id
    and entry.status = 'ACTIVE'
  group by entry.id, entry.created_at
  having count(prediction.id) filter (where match.id is not null) > 0
  order by score desc,
           count(prediction.id) filter (where match.id is not null) desc,
           entry.created_at asc,
           entry.id asc
  limit 1;

  if v_winner_id is null then
    raise exception using errcode = 'P0001', message = 'no_winner';
  end if;

  update public.tournament_prediction_campaigns
  set winner_entry_id = v_winner_id,
      status = 'FINISHED',
      finalized_at = clock_timestamp(),
      updated_by = p_actor_id
  where id = v_campaign.id
  returning * into v_campaign;

  insert into public.tournament_prediction_audit_log (
    campaign_id, actor_id, actor_kind, action, entity_type, entity_id, metadata
  ) values (
    v_campaign.id, p_actor_id, 'ADMIN', 'FINALIZE_CAMPAIGN', 'campaign', v_campaign.id,
    jsonb_build_object('winner_entry_id', v_winner_id, 'score', v_winner_score)
  );
  return v_campaign;
end;
$$;

revoke all on function public.admin_finalize_tournament_prediction_campaign(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_finalize_tournament_prediction_campaign(uuid, uuid)
  to service_role;

commit;
