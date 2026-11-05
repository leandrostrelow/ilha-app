begin;

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
           count(prediction.id) filter (where match.id is not null) asc,
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

-- Owner-authorized one-time rule change. An exclusive lock prevents concurrent
-- edits while the guard is suspended; transaction failure restores it as well.
lock table public.tournament_prediction_campaigns in access exclusive mode;
alter table public.tournament_prediction_campaigns disable trigger guard_tournament_prediction_campaign_update;
with previous as (
  select c.id,c.rules_text,c.rules_version from public.tournament_prediction_campaigns c
  join public.tournaments t on t.id=c.tournament_id
  where t.slug='ilha-open-2026' and c.status in ('OPEN','LOCKED')
), changed as (
  update public.tournament_prediction_campaigns c
  set rules_text=replace(c.rules_text,'mais partidas apuradas','menos palpites já apurados')
      || ' Palpites de jogos pendentes não entram no desempate. Critério atualizado pela organização em 15/09/2026.',
      rules_version=c.rules_version+1
  from previous p where c.id=p.id and c.rules_text like '%mais partidas apuradas%'
  returning c.id,c.rules_version,p.rules_text as previous_rules,p.rules_version as previous_version
)
insert into public.tournament_prediction_audit_log(campaign_id,actor_kind,action,entity_type,entity_id,metadata)
select id,'SYSTEM','OWNER_AUTHORIZED_TIEBREAK_CHANGE','campaign',id,
 jsonb_build_object('previous_rules',previous_rules,'previous_version',previous_version,
 'new_version',rules_version,'tiebreak','score_desc_settled_asc_joined_asc')
from changed;
alter table public.tournament_prediction_campaigns enable trigger guard_tournament_prediction_campaign_update;
commit;
