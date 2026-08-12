-- Corrige de forma idempotente a semifinal fake após os dois resultados das quartas.
-- Mantém o escopo no mesmo torneio e na mesma categoria para não cruzar chaves.
update public.tournament_matches as semifinal
set
  side1_athlete_id = quarter1.winner_athlete_id,
  side2_athlete_id = quarter2.winner_athlete_id,
  updated_at = now()
from public.tournament_matches as quarter1,
     public.tournament_matches as quarter2
where semifinal.legacy_key = 'demo:b-sf1'
  and quarter1.legacy_key = 'demo:b-qf1'
  and quarter2.legacy_key = 'demo:b-qf2'
  and quarter1.tournament_id = semifinal.tournament_id
  and quarter2.tournament_id = semifinal.tournament_id
  and quarter1.category_id = semifinal.category_id
  and quarter2.category_id = semifinal.category_id;
