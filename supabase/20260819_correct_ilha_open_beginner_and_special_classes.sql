begin;

with target_tournament as (
  select id
  from public.tournaments
  where lower(slug) = 'ilha-open-2026'
  limit 1
)
update public.tournament_categories category
set code = 'INIC-F',
    name = 'Iniciante Feminino',
    description = 'Jogos de 11 a 13 de setembro.',
    gender = 'FEMALE',
    class_level = 'INICIANTE',
    sort_order = 40,
    updated_at = now()
from target_tournament tournament
where category.tournament_id = tournament.id
  and category.code = 'F-ESP';

with target_tournament as (
  select id
  from public.tournaments
  where lower(slug) = 'ilha-open-2026'
  limit 1
)
insert into public.tournament_categories (
  tournament_id,
  code,
  name,
  description,
  event_type,
  gender,
  class_level,
  draw_format,
  draw_size,
  registration_fee,
  registration_open,
  min_entries,
  max_entries,
  active,
  is_published,
  sort_order
)
select
  tournament.id,
  'ESP',
  'Classe Espacial',
  'Jogos de 11 a 13 de setembro.',
  'SINGLES',
  'OPEN',
  'ESPACIAL',
  'SINGLE_ELIMINATION',
  16,
  89.90,
  true,
  2,
  16,
  true,
  true,
  50
from target_tournament tournament
on conflict (tournament_id, code) do update set
  name = excluded.name,
  description = excluded.description,
  event_type = excluded.event_type,
  gender = excluded.gender,
  class_level = excluded.class_level,
  draw_format = excluded.draw_format,
  draw_size = excluded.draw_size,
  registration_open = excluded.registration_open,
  max_entries = excluded.max_entries,
  active = excluded.active,
  is_published = excluded.is_published,
  sort_order = excluded.sort_order,
  updated_at = now();

with target_tournament as (
  select id
  from public.tournaments
  where lower(slug) = 'ilha-open-2026'
  limit 1
), class_order(code, sort_order) as (
  values
    ('M2', 60),
    ('M4', 70),
    ('M6', 80),
    ('M7', 90),
    ('M1', 100),
    ('M3', 110),
    ('M5', 120),
    ('F1', 130),
    ('F2', 140),
    ('F3', 150)
)
update public.tournament_categories category
set sort_order = ordering.sort_order,
    updated_at = now()
from target_tournament tournament,
     class_order ordering
where category.tournament_id = tournament.id
  and category.code = ordering.code;

commit;
