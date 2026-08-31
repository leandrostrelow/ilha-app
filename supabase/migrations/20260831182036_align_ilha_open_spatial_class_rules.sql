begin;

with target_tournament as (
  select id
  from public.tournaments
  where lower(slug) = 'ilha-open-2026'
  limit 1
), spatial_rules(code, description, required_codes) as (
  values
    (
      'ESP-A-M',
      'Jogos de 21 a 27 de setembro. Exclusiva para inscritos da 2ª, 3ª ou 4ª Classe Masculina.',
      jsonb_build_array('M2', 'M3', 'M4')
    ),
    (
      'ESP-B-M',
      'Jogos de 21 a 27 de setembro. Exclusiva para inscritos da 5ª, 6ª ou 7ª Classe Masculina.',
      jsonb_build_array('M5', 'M6', 'M7')
    )
)
update public.tournament_categories as category
set description = spatial.description,
    settings = coalesce(category.settings, '{}'::jsonb) || jsonb_build_object(
      'registration_rule', jsonb_build_object(
        'requires_existing_codes', spatial.required_codes,
        'max_total_registrations', 2
      )
    ),
    updated_at = now()
from target_tournament as tournament,
     spatial_rules as spatial
where category.tournament_id = tournament.id
  and category.code = spatial.code;

update public.tournaments
set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
      'registration_limits', jsonb_build_object(
        'default_max_categories_per_athlete', 1,
        'special_rule', '2ª, 3ª e 4ª Masculina podem adicionar somente a Espacial A; 5ª, 6ª e 7ª Masculina podem adicionar somente a Espacial B.'
      ),
      'spatial_addons', jsonb_build_object(
        'M2', jsonb_build_object('category_code', 'ESP-A-M', 'label', 'Espacial A', 'fee', 80),
        'M3', jsonb_build_object('category_code', 'ESP-A-M', 'label', 'Espacial A', 'fee', 80),
        'M4', jsonb_build_object('category_code', 'ESP-A-M', 'label', 'Espacial A', 'fee', 80),
        'M5', jsonb_build_object('category_code', 'ESP-B-M', 'label', 'Espacial B', 'fee', 80),
        'M6', jsonb_build_object('category_code', 'ESP-B-M', 'label', 'Espacial B', 'fee', 80),
        'M7', jsonb_build_object('category_code', 'ESP-B-M', 'label', 'Espacial B', 'fee', 80)
      )
    ),
    updated_at = now()
where lower(slug) = 'ilha-open-2026';

create or replace function public.enforce_public_tournament_registration_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tournament_settings jsonb;
  category_settings jsonb;
  category_code text;
  required_codes jsonb;
  default_max integer;
  special_max integer;
  existing_count integer;
begin
  if new.source <> 'PUBLIC' then
    return new;
  end if;

  select tournament.settings, category.settings, category.code
    into tournament_settings, category_settings, category_code
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
        message = case category_code
          when 'ESP-A-M' then 'A Espacial A é exclusiva para atletas inscritos na 2ª, 3ª ou 4ª Classe Masculina.'
          when 'ESP-B-M' then 'A Espacial B é exclusiva para atletas inscritos na 5ª, 6ª ou 7ª Classe Masculina.'
          else 'Esta Classe Espacial exige uma inscrição principal compatível.'
        end;
    end if;

    if existing_count >= special_max then
      raise exception using
        errcode = 'P0001',
        message = 'Este atleta já atingiu o limite de duas inscrições neste torneio.';
    end if;
  elsif existing_count >= default_max then
    raise exception using
      errcode = 'P0001',
      message = 'A segunda inscrição só é permitida na Espacial A para atletas da 2ª, 3ª e 4ª Classe Masculina ou na Espacial B para atletas da 5ª, 6ª e 7ª Classe Masculina.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_public_tournament_registration_limits() from public, anon, authenticated;

commit;
