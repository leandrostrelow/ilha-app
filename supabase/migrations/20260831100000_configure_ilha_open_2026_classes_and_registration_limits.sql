begin;

-- Keep the current records for audit/history and only deactivate categories
-- that are no longer part of the published Ilha Open format.
with target_tournament as (
  select id
  from public.tournaments
  where lower(slug) = 'ilha-open-2026'
  limit 1
), desired_codes(code) as (
  values
    ('M2'), ('M4'), ('M5'), ('M6'), ('M7'),
    ('M1'), ('M3'), ('F2'), ('F3'), ('F4'),
    ('ESP-A-M'), ('ESP-B-M')
)
update public.tournament_categories as category
set active = false,
    is_published = false,
    registration_open = false,
    updated_at = now()
from target_tournament as tournament
where category.tournament_id = tournament.id
  and not exists (
    select 1 from desired_codes where desired_codes.code = category.code
  );

with target_tournament as (
  select id
  from public.tournaments
  where lower(slug) = 'ilha-open-2026'
  limit 1
), desired_categories(
  code, name, description, gender, class_level, sort_order, fallback_fee, source_fee_code, settings
) as (
  values
    ('M2', '2ª Classe Masculina', 'Jogos de 11 a 20 de setembro.', 'MALE', '2', 10, 89.90::numeric, 'M2', '{}'::jsonb),
    ('M4', '4ª Classe Masculina', 'Jogos de 11 a 20 de setembro.', 'MALE', '4', 20, 89.90::numeric, 'M4', '{}'::jsonb),
    ('M5', '5ª Classe Masculina', 'Jogos de 11 a 20 de setembro.', 'MALE', '5', 30, 89.90::numeric, 'M5', '{}'::jsonb),
    ('M6', '6ª Classe Masculina', 'Jogos de 11 a 20 de setembro.', 'MALE', '6', 40, 89.90::numeric, 'M6', '{}'::jsonb),
    ('M7', '7ª Classe Masculina (Iniciante)', 'Jogos de 11 a 20 de setembro.', 'MALE', '7', 50, 89.90::numeric, 'M7', '{}'::jsonb),
    ('M1', '1ª Classe Masculina', 'Jogos de 21 a 27 de setembro.', 'MALE', '1', 60, 99.90::numeric, 'M1', '{}'::jsonb),
    ('M3', '3ª Classe Masculina', 'Jogos de 21 a 27 de setembro.', 'MALE', '3', 70, 89.90::numeric, 'M3', '{}'::jsonb),
    ('F2', '2ª Classe Feminina', 'Jogos de 21 a 27 de setembro.', 'FEMALE', '2', 80, 89.90::numeric, 'F2', '{}'::jsonb),
    ('F3', '3ª Classe Feminina', 'Jogos de 21 a 27 de setembro.', 'FEMALE', '3', 90, 89.90::numeric, 'F3', '{}'::jsonb),
    ('F4', '4ª Classe Feminina (Iniciante)', 'Jogos de 21 a 27 de setembro.', 'FEMALE', '4', 100, 89.90::numeric, 'INIC-F', '{}'::jsonb),
    (
      'ESP-A-M', 'Espacial A Masculino 🚀',
      'Jogos de 21 a 27 de setembro. Exclusiva para inscritos da 2ª à 6ª Classe Masculina.',
      'MALE', 'ESPACIAL_A', 110, 89.90::numeric, 'ESP',
      jsonb_build_object(
        'registration_rule', jsonb_build_object(
          'requires_existing_codes', jsonb_build_array('M2', 'M3', 'M4', 'M5', 'M6'),
          'max_total_registrations', 2
        )
      )
    ),
    (
      'ESP-B-M', 'Espacial B Masculino 🚀',
      'Jogos de 21 a 27 de setembro. Exclusiva para inscritos da 2ª à 6ª Classe Masculina.',
      'MALE', 'ESPACIAL_B', 120, 89.90::numeric, 'ESP',
      jsonb_build_object(
        'registration_rule', jsonb_build_object(
          'requires_existing_codes', jsonb_build_array('M2', 'M3', 'M4', 'M5', 'M6'),
          'max_total_registrations', 2
        )
      )
    )
)
insert into public.tournament_categories (
  tournament_id, code, name, description, event_type, gender, class_level,
  draw_format, draw_size, registration_fee, registration_open, min_entries,
  max_entries, active, is_published, sort_order, settings
)
select
  tournament.id,
  desired.code,
  desired.name,
  desired.description,
  'SINGLES',
  desired.gender,
  desired.class_level,
  'SINGLE_ELIMINATION',
  8,
  coalesce(source_category.registration_fee, desired.fallback_fee),
  true,
  2,
  8,
  true,
  true,
  desired.sort_order,
  desired.settings
from target_tournament as tournament
cross join desired_categories as desired
left join public.tournament_categories as source_category
  on source_category.tournament_id = tournament.id
 and source_category.code = desired.source_fee_code
on conflict (tournament_id, code) do update set
  name = excluded.name,
  description = excluded.description,
  event_type = excluded.event_type,
  gender = excluded.gender,
  class_level = excluded.class_level,
  draw_format = excluded.draw_format,
  draw_size = excluded.draw_size,
  registration_fee = excluded.registration_fee,
  registration_open = excluded.registration_open,
  min_entries = excluded.min_entries,
  max_entries = excluded.max_entries,
  active = excluded.active,
  is_published = excluded.is_published,
  sort_order = excluded.sort_order,
  settings = excluded.settings,
  updated_at = now();

update public.tournaments
set starts_on = date '2026-09-11',
    ends_on = date '2026-09-27',
    settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
      'registration_limits', jsonb_build_object(
        'default_max_categories_per_athlete', 1,
        'special_rule', 'Atletas da 2ª à 6ª Classe Masculina podem fazer uma segunda inscrição na Espacial A ou B.'
      ),
      'competition_phases', jsonb_build_array(
        jsonb_build_object('starts_on', '2026-09-11', 'ends_on', '2026-09-20', 'entries', 40),
        jsonb_build_object('starts_on', '2026-09-21', 'ends_on', '2026-09-27', 'entries', 56)
      ),
      'expected_total_entries', 96,
      'expected_total_matches', 84
    ),
    updated_at = now()
where lower(slug) = 'ilha-open-2026';

-- Enforce the rule in the database. The advisory lock serializes attempts for
-- the same athlete even when two different categories are submitted together.
create or replace function public.enforce_public_tournament_registration_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tournament_settings jsonb;
  category_settings jsonb;
  required_codes jsonb;
  default_max integer;
  special_max integer;
  existing_count integer;
begin
  if new.source <> 'PUBLIC' then
    return new;
  end if;

  select tournament.settings, category.settings
    into tournament_settings, category_settings
  from public.tournaments as tournament
  join public.tournament_categories as category
    on category.tournament_id = tournament.id
   and category.id = new.category_id
  where tournament.id = new.tournament_id;

  if not found then
    return new;
  end if;

  if coalesce(tournament_settings #>> '{registration_limits,default_max_categories_per_athlete}', '') !~ '^[0-9]+$' then
    return new;
  end if;

  default_max := greatest(
    1,
    (tournament_settings #>> '{registration_limits,default_max_categories_per_athlete}')::integer
  );
  required_codes := category_settings #> '{registration_rule,requires_existing_codes}';
  special_max := case
    when coalesce(category_settings #>> '{registration_rule,max_total_registrations}', '') ~ '^[0-9]+$'
      then greatest(1, (category_settings #>> '{registration_rule,max_total_registrations}')::integer)
    else default_max
  end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.tournament_id::text || ':' || new.athlete_id::text, 20260831100000)
  );

  select count(*)::integer
    into existing_count
  from public.tournament_registrations as registration
  where registration.tournament_id = new.tournament_id
    and registration.athlete_id = new.athlete_id
    and registration.status in ('PENDING', 'CONFIRMED', 'WAITLIST');

  if jsonb_typeof(required_codes) = 'array' and jsonb_array_length(required_codes) > 0 then
    if not exists (
      select 1
      from public.tournament_registrations as registration
      join public.tournament_categories as existing_category
        on existing_category.id = registration.category_id
       and existing_category.tournament_id = registration.tournament_id
      where registration.tournament_id = new.tournament_id
        and registration.athlete_id = new.athlete_id
        and registration.status in ('PENDING', 'CONFIRMED', 'WAITLIST')
        and existing_category.code in (
          select jsonb_array_elements_text(required_codes)
        )
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'A Espacial A e a Espacial B são exclusivas para quem já está inscrito da 2ª à 6ª Classe Masculina.';
    end if;

    if existing_count >= special_max then
      raise exception using
        errcode = 'P0001',
        message = 'Este atleta já atingiu o limite de duas inscrições neste torneio.';
    end if;
  elsif existing_count >= default_max then
    raise exception using
      errcode = 'P0001',
      message = 'Somente atletas da 2ª à 6ª Classe Masculina podem fazer uma segunda inscrição, exclusivamente na Espacial A ou B.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_public_tournament_registration_limits() from public, anon, authenticated;

drop trigger if exists enforce_public_tournament_registration_limits
  on public.tournament_registrations;
create trigger enforce_public_tournament_registration_limits
before insert on public.tournament_registrations
for each row execute function public.enforce_public_tournament_registration_limits();

commit;
