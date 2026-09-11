create or replace function private.enforce_tournament_prediction_open_window()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reference_at timestamptz;
begin
  select coalesce(
    match.scheduled_at,
    case
      when match.match_date is not null and match.match_time is not null
        then (match.match_date + match.match_time) at time zone coalesce(tournament.timezone, 'America/Sao_Paulo')
      when match.match_date is not null
        then match.match_date::timestamp at time zone coalesce(tournament.timezone, 'America/Sao_Paulo')
      else null
    end
  )
  into v_reference_at
  from public.tournament_matches as match
  join public.tournaments as tournament on tournament.id = match.tournament_id
  where match.id = new.match_id;

  if v_reference_at is null or clock_timestamp() < v_reference_at - interval '24 hours' then
    raise exception using errcode = 'P0001', message = 'prediction_not_open';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_tournament_prediction_open_window()
  from public, anon, authenticated;

drop trigger if exists enforce_tournament_prediction_open_window
  on public.tournament_predictions;

create trigger enforce_tournament_prediction_open_window
before insert or update of predicted_winner_athlete_id
on public.tournament_predictions
for each row execute function private.enforce_tournament_prediction_open_window();

comment on function private.enforce_tournament_prediction_open_window() is
  'Impede inserir ou trocar palpites antes das 24 horas que antecedem o jogo. Jogos com horário relativo abrem à meia-noite do dia anterior.';
