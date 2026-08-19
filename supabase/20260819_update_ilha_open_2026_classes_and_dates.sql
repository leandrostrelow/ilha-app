begin;

update public.tournaments
set starts_on = date '2026-09-11',
    ends_on = date '2026-09-27',
    updated_at = now()
where lower(slug) = 'ilha-open-2026';

with target_tournament as (
  select id
  from public.tournaments
  where lower(slug) = 'ilha-open-2026'
  limit 1
), existing_schedule(code, description, sort_order) as (
  values
    ('M2', 'Jogos de 14 a 20 de setembro.', 50),
    ('M4', 'Jogos de 14 a 20 de setembro.', 60),
    ('M6', 'Jogos de 14 a 20 de setembro.', 70),
    ('M7', 'Jogos de 14 a 20 de setembro.', 80),
    ('M1', 'Jogos de 21 a 27 de setembro.', 90),
    ('M3', 'Jogos de 21 a 27 de setembro.', 100),
    ('M5', 'Jogos de 21 a 27 de setembro.', 110),
    ('F1', 'Jogos de 21 a 27 de setembro.', 120),
    ('F2', 'Jogos de 21 a 27 de setembro.', 130),
    ('F3', 'Jogos de 21 a 27 de setembro.', 140)
)
update public.tournament_categories category
set description = schedule.description,
    sort_order = schedule.sort_order,
    updated_at = now()
from target_tournament tournament,
     existing_schedule schedule
where category.tournament_id = tournament.id
  and category.code = schedule.code;

with target_tournament as (
  select id
  from public.tournaments
  where lower(slug) = 'ilha-open-2026'
  limit 1
), new_categories(code, name, gender, class_level, sort_order) as (
  values
    ('VET45', 'Veteranos 45+', 'OPEN', 'VETERANOS_45', 10),
    ('JUV', 'Juvenil', 'OPEN', 'JUVENIL', 20),
    ('INIC-M', 'Iniciante Masculino', 'MALE', 'INICIANTE', 30),
    ('F-ESP', 'FEM - Classe Espacial', 'FEMALE', 'ESPACIAL', 40)
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
  category.code,
  category.name,
  'Jogos de 11 a 13 de setembro.',
  'SINGLES',
  category.gender,
  category.class_level,
  'SINGLE_ELIMINATION',
  16,
  89.90,
  true,
  2,
  16,
  true,
  true,
  category.sort_order
from target_tournament tournament
cross join new_categories category
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

commit;
