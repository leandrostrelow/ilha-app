begin;

create index tournament_prediction_campaigns_winner_entry_idx
  on public.tournament_prediction_campaigns(winner_entry_id)
  where winner_entry_id is not null;

create index tournament_prediction_campaigns_created_by_idx
  on public.tournament_prediction_campaigns(created_by)
  where created_by is not null;

create index tournament_prediction_campaigns_updated_by_idx
  on public.tournament_prediction_campaigns(updated_by)
  where updated_by is not null;

create index tournament_predictions_match_idx
  on public.tournament_predictions(match_id);

create index tournament_prediction_requests_campaign_idx
  on public.tournament_prediction_requests(campaign_id);

create index tournament_prediction_requests_match_idx
  on public.tournament_prediction_requests(match_id);

create index tournament_prediction_requests_winner_athlete_idx
  on public.tournament_prediction_requests(predicted_winner_athlete_id);

commit;
