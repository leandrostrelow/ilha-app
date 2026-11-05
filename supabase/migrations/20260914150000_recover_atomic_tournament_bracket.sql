-- Replaces an entire tournament draw in one database transaction.
-- Any validation or insert error rolls the delete back, preserving the prior draw and sets.
create or replace function public.tournament_replace_bracket_atomic(
  p_tournament_id uuid,
  p_category_id uuid,
  p_draw_size integer,
  p_matches jsonb,
  p_overwrite boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_category public.tournament_categories%rowtype;
  previous_matches jsonb := '[]'::jsonb;
  inserted_matches jsonb := '[]'::jsonb;
  expected_match_count integer;
  round_count integer;
  expected_round_count integer;
  current_round integer;
begin
  -- SECURITY DEFINER is required to make the multi-table replacement atomic
  -- under RLS. The Edge Function forwards the signed-in administrator JWT,
  -- and this explicit authorization keeps the RPC independent of service_role.
  if (select auth.uid()) is null
     or not public.has_tournament_permission('tournaments.write') then
    raise exception 'Você não tem permissão para gerar chaves.' using errcode = '42501';
  end if;

  if p_tournament_id is null or p_category_id is null then
    raise exception 'Torneio e classe são obrigatórios.' using errcode = '22023';
  end if;

  select category.*
    into target_category
  from public.tournament_categories as category
  where category.id = p_category_id
    and category.tournament_id = p_tournament_id
  for update;

  if not found then
    raise exception 'Classe não encontrada neste torneio.' using errcode = '22023';
  end if;

  if p_draw_size not in (2, 4, 8, 16, 32, 64, 128) then
    raise exception 'Tamanho de chave inválido.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_matches) <> 'array' then
    raise exception 'A lista de jogos da chave é inválida.' using errcode = '22023';
  end if;

  -- Serializes concurrent replacements even when this category has no matches yet.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_category_id::text, 319118792)
  );

  expected_match_count := p_draw_size - 1;
  if jsonb_array_length(p_matches) <> expected_match_count then
    raise exception 'A chave deve conter exatamente % jogos.', expected_match_count using errcode = '22023';
  end if;

  -- Parsing happens before the delete. Invalid UUIDs, dates or field types abort safely here.
  perform 1
  from jsonb_to_recordset(p_matches) as incoming(
    id uuid,
    legacy_key text,
    round_no integer,
    round_code text,
    phase text,
    match_no integer,
    side1_athlete_id uuid,
    side2_athlete_id uuid,
    winner_athlete_id uuid,
    source1_match_id uuid,
    source2_match_id uuid,
    score text,
    court_name text,
    match_date date,
    match_time time,
    scheduled_at timestamptz,
    started_at timestamptz,
    finished_at timestamptz,
    status text,
    sort_order integer,
    published boolean,
    public_notes text,
    admin_notes text,
    metadata jsonb
  );

  if exists (
    with incoming as (
      select * from jsonb_to_recordset(p_matches) as match(
        id uuid, round_no integer, match_no integer,
        side1_athlete_id uuid, side2_athlete_id uuid, winner_athlete_id uuid,
        source1_match_id uuid, source2_match_id uuid
      )
    )
    select 1
    from incoming
    where id is null
      or round_no is null or round_no < 1
      or match_no is null or match_no < 1
      or (side1_athlete_id is not null and side1_athlete_id = side2_athlete_id)
      or (winner_athlete_id is not null and winner_athlete_id is distinct from side1_athlete_id and winner_athlete_id is distinct from side2_athlete_id)
      or (round_no = 1 and (source1_match_id is not null or source2_match_id is not null))
      or (round_no > 1 and (source1_match_id is null or source2_match_id is null or source1_match_id = source2_match_id))
  ) then
    raise exception 'A chave contém jogos incompletos ou inconsistentes.' using errcode = '22023';
  end if;

  if exists (
    with incoming as (
      select * from jsonb_to_recordset(p_matches) as match(id uuid, round_no integer, match_no integer)
    )
    select 1 from incoming group by id having count(*) > 1
  ) or exists (
    with incoming as (
      select * from jsonb_to_recordset(p_matches) as match(id uuid, round_no integer, match_no integer)
    )
    select 1 from incoming group by round_no, match_no having count(*) > 1
  ) then
    raise exception 'A chave contém jogos duplicados.' using errcode = '22023';
  end if;

  current_round := 1;
  expected_round_count := p_draw_size / 2;
  while expected_round_count >= 1 loop
    select count(*)
      into round_count
    from jsonb_to_recordset(p_matches) as match(round_no integer)
    where match.round_no = current_round;

    if round_count <> expected_round_count then
      raise exception 'A rodada % deve conter % jogos.', current_round, expected_round_count using errcode = '22023';
    end if;

    current_round := current_round + 1;
    expected_round_count := expected_round_count / 2;
  end loop;

  if exists (
    with incoming as (
      select * from jsonb_to_recordset(p_matches) as match(
        id uuid, round_no integer, source1_match_id uuid, source2_match_id uuid
      )
    )
    select 1
    from incoming as target
    left join incoming as source1 on source1.id = target.source1_match_id
    left join incoming as source2 on source2.id = target.source2_match_id
    where target.round_no > 1
      and (
        source1.id is null or source2.id is null
        or source1.round_no <> target.round_no - 1
        or source2.round_no <> target.round_no - 1
      )
  ) then
    raise exception 'A progressão entre as rodadas da chave é inválida.' using errcode = '22023';
  end if;

  if exists (
    with incoming as (
      select * from jsonb_to_recordset(p_matches) as match(
        source1_match_id uuid, source2_match_id uuid
      )
    ), sources as (
      select source1_match_id as id from incoming where source1_match_id is not null
      union all
      select source2_match_id as id from incoming where source2_match_id is not null
    )
    select 1 from sources group by id having count(*) > 1
  ) then
    raise exception 'Um jogo anterior foi ligado a mais de um confronto.' using errcode = '22023';
  end if;

  if exists (
    with incoming as (
      select * from jsonb_to_recordset(p_matches) as match(
        side1_athlete_id uuid, side2_athlete_id uuid, winner_athlete_id uuid
      )
    ), athletes as (
      select distinct athlete_id
      from incoming
      cross join lateral (values (side1_athlete_id), (side2_athlete_id), (winner_athlete_id)) as value(athlete_id)
      where athlete_id is not null
    )
    select 1
    from athletes
    where not exists (
      select 1
      from public.tournament_registrations as registration
      where registration.tournament_id = p_tournament_id
        and registration.category_id = p_category_id
        and registration.athlete_id = athletes.athlete_id
        and registration.status = 'CONFIRMED'
    )
  ) then
    raise exception 'A chave contém atleta sem inscrição confirmada nesta classe.' using errcode = '22023';
  end if;

  perform 1
  from public.tournament_matches as match
  where match.category_id = p_category_id
  for update;

  select coalesce(jsonb_agg(to_jsonb(match) order by match.round_no, match.match_no), '[]'::jsonb)
    into previous_matches
  from public.tournament_matches as match
  where match.category_id = p_category_id;

  if jsonb_array_length(previous_matches) > 0 and not coalesce(p_overwrite, false) then
    raise exception 'Esta classe já possui uma chave. Confirme a substituição para continuar.' using errcode = '22023';
  end if;

  if exists (
    with incoming as (
      select nullif(trim(match.legacy_key), '') as legacy_key
      from jsonb_to_recordset(p_matches) as match(legacy_key text)
    )
    select 1
    from incoming
    join public.tournament_matches as existing
      on existing.legacy_key = incoming.legacy_key
    where incoming.legacy_key is not null
      and existing.category_id <> p_category_id
  ) then
    raise exception 'A chave contém identificador já usado em outra classe.' using errcode = '22023';
  end if;

  delete from public.tournament_matches
  where category_id = p_category_id;

  insert into public.tournament_matches (
    id, legacy_key, tournament_id, category_id, round_no, round_code, phase, match_no,
    side1_athlete_id, side2_athlete_id, winner_athlete_id, source1_match_id, source2_match_id,
    score, court_name, match_date, match_time, scheduled_at, started_at, finished_at,
    status, sort_order, published, public_notes, admin_notes, metadata
  )
  select
    incoming.id,
    nullif(trim(incoming.legacy_key), ''),
    p_tournament_id,
    p_category_id,
    incoming.round_no,
    nullif(trim(incoming.round_code), ''),
    nullif(trim(incoming.phase), ''),
    incoming.match_no,
    incoming.side1_athlete_id,
    incoming.side2_athlete_id,
    incoming.winner_athlete_id,
    incoming.source1_match_id,
    incoming.source2_match_id,
    nullif(trim(incoming.score), ''),
    nullif(trim(incoming.court_name), ''),
    incoming.match_date,
    incoming.match_time,
    incoming.scheduled_at,
    incoming.started_at,
    incoming.finished_at,
    coalesce(nullif(trim(incoming.status), ''), 'PENDING'),
    coalesce(incoming.sort_order, 0),
    coalesce(incoming.published, true),
    nullif(trim(incoming.public_notes), ''),
    nullif(trim(incoming.admin_notes), ''),
    coalesce(incoming.metadata, '{}'::jsonb)
  from jsonb_to_recordset(p_matches) as incoming(
    id uuid,
    legacy_key text,
    round_no integer,
    round_code text,
    phase text,
    match_no integer,
    side1_athlete_id uuid,
    side2_athlete_id uuid,
    winner_athlete_id uuid,
    source1_match_id uuid,
    source2_match_id uuid,
    score text,
    court_name text,
    match_date date,
    match_time time,
    scheduled_at timestamptz,
    started_at timestamptz,
    finished_at timestamptz,
    status text,
    sort_order integer,
    published boolean,
    public_notes text,
    admin_notes text,
    metadata jsonb
  );

  update public.tournament_categories
  set draw_size = p_draw_size,
      updated_at = now()
  where id = p_category_id
    and tournament_id = p_tournament_id;

  select coalesce(jsonb_agg(to_jsonb(match) order by match.round_no, match.match_no), '[]'::jsonb)
    into inserted_matches
  from public.tournament_matches as match
  where match.category_id = p_category_id;

  if jsonb_array_length(inserted_matches) <> expected_match_count then
    raise exception 'A chave não foi gravada por completo.' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'category_id', p_category_id,
    'draw_size', p_draw_size,
    'previous_matches', previous_matches,
    'matches', inserted_matches
  );
end;
$$;

revoke all on function public.tournament_replace_bracket_atomic(uuid, uuid, integer, jsonb, boolean) from public, anon, service_role;
grant execute on function public.tournament_replace_bracket_atomic(uuid, uuid, integer, jsonb, boolean) to authenticated;
