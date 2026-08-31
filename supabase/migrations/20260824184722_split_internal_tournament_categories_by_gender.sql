-- Split the youth/beginner divisions requested by the club without deleting
-- existing registrations. The original rows keep their IDs as the male
-- divisions; the female divisions receive new IDs.

with target as (
  select id from public.tournaments where slug = 'ilha-open-interno-2026'
)
update public.tournament_categories as category
set code = 'INFANTIL-MASC',
    name = 'Infantil Masculino',
    description = 'Categoria infantil masculina',
    gender = 'MALE',
    sort_order = 10,
    updated_at = now()
where category.tournament_id in (select id from target)
  and category.code = 'INFANTIL';

with target as (
  select id from public.tournaments where slug = 'ilha-open-interno-2026'
)
update public.tournament_categories as category
set code = 'ADULTO-INICIANTE-MASC',
    name = 'Adulto Iniciante Masculino',
    description = 'Categoria iniciante masculina',
    gender = 'MALE',
    sort_order = 40,
    updated_at = now()
where category.tournament_id in (select id from target)
  and category.code = 'ADULTO-INICIANTE';

insert into public.tournament_categories (
  tournament_id, code, name, description, event_type, gender, class_level,
  draw_format, draw_size, registration_fee, registration_open,
  min_entries, max_entries, active, is_published, sort_order
)
select tournament.id, category.code, category.name, category.description,
  'SINGLES', 'FEMALE', category.class_level, 'SINGLE_ELIMINATION', null,
  0, true, 2, 32, true, true, category.sort_order
from public.tournaments as tournament
cross join (values
  ('INFANTIL-FEM', 'Infantil Feminino', 'Categoria infantil feminina', 'INFANTIL', 20),
  ('ADULTO-INICIANTE-FEM', 'Adulto Iniciante Feminino', 'Categoria iniciante feminina', 'INICIANTE', 50)
) as category(code, name, description, class_level, sort_order)
where tournament.slug = 'ilha-open-interno-2026'
on conflict (tournament_id, code) do update
set name = excluded.name,
    description = excluded.description,
    gender = excluded.gender,
    class_level = excluded.class_level,
    registration_open = true,
    active = true,
    is_published = true,
    sort_order = excluded.sort_order,
    updated_at = now();

update public.tournament_categories as category
set sort_order = case category.code
      when 'JUVENIL' then 30
      when 'MASC-1' then 60
      when 'MASC-2' then 70
      when 'MASC-3' then 80
      when 'FEM-1' then 90
      when 'FEM-2' then 100
      else category.sort_order
    end,
    updated_at = now()
where category.tournament_id = (
  select id from public.tournaments where slug = 'ilha-open-interno-2026' limit 1
);

update public.tournaments
set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('requires_gender', true),
    updated_at = now()
where slug = 'ilha-open-interno-2026';
