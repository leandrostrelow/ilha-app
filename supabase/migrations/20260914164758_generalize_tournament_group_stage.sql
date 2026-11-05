begin;

alter table public.tournament_categories
  drop constraint if exists tournament_categories_draw_size_check;

alter table public.tournament_categories
  add constraint tournament_categories_draw_size_check
  check (
    draw_size is null
    or (
      draw_format = 'GROUPS_AND_KNOCKOUT'
      and draw_size >= 3
    )
    or (
      coalesce(draw_format, '') <> 'GROUPS_AND_KNOCKOUT'
      and draw_size in (2, 4, 8, 16, 32, 64, 128)
    )
  );

alter table public.tournament_categories
  drop constraint if exists tournament_categories_three_player_group_capacity_check;

alter table public.tournament_categories
  drop constraint if exists tournament_categories_group_capacity_check;

alter table public.tournament_categories
  add constraint tournament_categories_group_capacity_check
  check (
    coalesce(draw_format, '') <> 'GROUPS_AND_KNOCKOUT'
    or (
      draw_size >= 3
      and max_entries is not distinct from draw_size
    )
  );

create or replace function private.refresh_tournament_group_final()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  category_format text;
  final_match public.tournament_matches%rowtype;
  group_match_count integer;
  completed_match_count integer;
  player_count integer;
  expected_group_match_count integer;
  ranked_athletes uuid[];
  second_wins integer;
  third_wins integer;
  second_win_tie_count integer;
  second_set_difference integer;
  second_game_difference integer;
  third_set_difference integer;
  third_game_difference integer;
  first_finalist uuid;
  second_finalist uuid;
  manual_finalist_count integer;
  finalists_changed boolean;
begin
  if upper(coalesce(new.phase, new.round_code, '')) <> 'GROUP' then
    return new;
  end if;

  select tournament_category.draw_format
    into category_format
  from public.tournament_categories as tournament_category
  where tournament_category.id = new.category_id
    and tournament_category.tournament_id = new.tournament_id;

  if coalesce(category_format, '') <> 'GROUPS_AND_KNOCKOUT' then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.category_id::text, 928617403)
  );

  select tournament_match.*
    into final_match
  from public.tournament_matches as tournament_match
  where tournament_match.tournament_id = new.tournament_id
    and tournament_match.category_id = new.category_id
    and upper(coalesce(tournament_match.phase, tournament_match.round_code, '')) = 'FINAL'
  order by tournament_match.round_no desc, tournament_match.match_no
  limit 1
  for update;

  if final_match.id is null then
    return new;
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where tournament_match.winner_athlete_id is not null
        and upper(coalesce(tournament_match.status, '')) in ('FINISHED', 'WALKOVER')
    )::integer
    into group_match_count, completed_match_count
  from public.tournament_matches as tournament_match
  where tournament_match.tournament_id = new.tournament_id
    and tournament_match.category_id = new.category_id
    and upper(coalesce(tournament_match.phase, tournament_match.round_code, '')) = 'GROUP';

  select count(*)::integer
    into player_count
  from private.tournament_group_stage_standings(new.category_id);

  expected_group_match_count := case
    when player_count >= 3 then (player_count * (player_count - 1)) / 2
    else 0
  end;
  first_finalist := null;
  second_finalist := null;

  if player_count >= 3
     and group_match_count = expected_group_match_count
     and completed_match_count = expected_group_match_count then
    with standings as (
      select *
      from private.tournament_group_stage_standings(new.category_id)
    ), standings_with_bucket as (
      select
        standings.*,
        count(*) over (partition by standings.wins)::integer as win_tie_count
      from standings
    ), standings_with_direct as (
      select
        standing.*,
        case
          when standing.win_tie_count = 2 then exists (
            select 1
            from public.tournament_matches as tournament_match
            join standings as opponent
              on opponent.wins = standing.wins
             and opponent.athlete_id <> standing.athlete_id
            where tournament_match.tournament_id = new.tournament_id
              and tournament_match.category_id = new.category_id
              and upper(coalesce(tournament_match.phase, tournament_match.round_code, '')) = 'GROUP'
              and tournament_match.winner_athlete_id = standing.athlete_id
              and (
                (
                  tournament_match.side1_athlete_id = standing.athlete_id
                  and tournament_match.side2_athlete_id = opponent.athlete_id
                )
                or (
                  tournament_match.side2_athlete_id = standing.athlete_id
                  and tournament_match.side1_athlete_id = opponent.athlete_id
                )
              )
          )
          else false
        end as head_to_head_won
      from standings_with_bucket as standing
    ), ranked as (
      select
        standing.*,
        row_number() over (
          order by
            standing.wins desc,
            case when standing.win_tie_count = 2 then standing.head_to_head_won::integer end desc nulls last,
            case when standing.win_tie_count >= 3 then standing.set_difference end desc nulls last,
            case when standing.win_tie_count >= 3 then standing.game_difference end desc nulls last,
            standing.athlete_id
        )::integer as rank_position
      from standings_with_direct as standing
    )
    select
      array_agg(ranked.athlete_id order by ranked.rank_position),
      max(ranked.wins) filter (where ranked.rank_position = 2),
      max(ranked.wins) filter (where ranked.rank_position = 3),
      max(ranked.win_tie_count) filter (where ranked.rank_position = 2),
      max(ranked.set_difference) filter (where ranked.rank_position = 2),
      max(ranked.game_difference) filter (where ranked.rank_position = 2),
      max(ranked.set_difference) filter (where ranked.rank_position = 3),
      max(ranked.game_difference) filter (where ranked.rank_position = 3)
      into
        ranked_athletes,
        second_wins,
        third_wins,
        second_win_tie_count,
        second_set_difference,
        second_game_difference,
        third_set_difference,
        third_game_difference
    from ranked;

    -- Confronto direto resolve qualquer empate isolado entre dois. Quando três
    -- ou mais dividem o mesmo número de vitórias, os saldos ordenam o bloco.
    -- Só a igualdade exata na linha de corte (2º/3º) exige decisão manual.
    if second_wins is distinct from third_wins
       or second_win_tie_count = 2
       or second_set_difference is distinct from third_set_difference
       or second_game_difference is distinct from third_game_difference then
      first_finalist := ranked_athletes[1];
      second_finalist := ranked_athletes[2];
    end if;
  end if;

  if first_finalist is null
     and second_finalist is null
     and player_count >= 3
     and group_match_count = expected_group_match_count
     and completed_match_count = expected_group_match_count
     and lower(coalesce(final_match.metadata ->> 'group_final_manual', 'false')) = 'true'
     and final_match.side1_athlete_id is not null
     and final_match.side2_athlete_id is not null
     and final_match.side1_athlete_id <> final_match.side2_athlete_id then
    select count(*)::integer
      into manual_finalist_count
    from private.tournament_group_stage_standings(new.category_id) as standings
    where standings.athlete_id in (
      final_match.side1_athlete_id,
      final_match.side2_athlete_id
    );

    if manual_finalist_count = 2 then
      first_finalist := final_match.side1_athlete_id;
      second_finalist := final_match.side2_athlete_id;
    end if;
  end if;

  if first_finalist is not null
     and second_finalist is not null
     and final_match.side1_athlete_id is not null
     and final_match.side2_athlete_id is not null
     and (
       (
         final_match.side1_athlete_id = first_finalist
         and final_match.side2_athlete_id = second_finalist
       )
       or (
         final_match.side1_athlete_id = second_finalist
         and final_match.side2_athlete_id = first_finalist
       )
     ) then
    first_finalist := final_match.side1_athlete_id;
    second_finalist := final_match.side2_athlete_id;
  end if;

  finalists_changed := final_match.side1_athlete_id is distinct from first_finalist
    or final_match.side2_athlete_id is distinct from second_finalist;

  if finalists_changed and final_match.winner_athlete_id is not null then
    raise exception using
      errcode = 'P0001',
      message = 'A final já possui vencedor. Remova o resultado da final antes de corrigir o grupo.';
  end if;

  if finalists_changed then
    update public.tournament_matches
    set side1_athlete_id = first_finalist,
        side2_athlete_id = second_finalist,
        score = null,
        started_at = null,
        finished_at = null,
        metadata = case
          when jsonb_typeof(final_match.metadata) = 'object'
          then final_match.metadata - 'group_final_manual'
          else '{}'::jsonb
        end,
        status = case
          when final_match.match_date is not null
            or final_match.match_time is not null
            or final_match.court_name is not null
            or final_match.scheduled_at is not null
          then 'SCHEDULED'
          else 'PENDING'
        end,
        updated_at = now()
    where id = final_match.id;
  end if;

  return new;
end;
$$;

alter function private.refresh_tournament_group_final() owner to postgres;
revoke all on function private.refresh_tournament_group_final()
  from public, anon, authenticated, service_role;

create or replace function public.tournament_replace_group_stage_atomic(
  p_tournament_id uuid,
  p_category_id uuid,
  p_athlete_ids uuid[],
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
  confirmed_count integer;
  pending_count integer;
  athlete_count integer := coalesce(cardinality(p_athlete_ids), 0);
  requested_athlete_count integer;
  matched_confirmed_count integer;
  expected_group_match_count integer;
  group_match_no integer := 0;
  first_index integer;
  second_index integer;
  group_match_id uuid;
  final_match_id uuid := gen_random_uuid();
begin
  if (select auth.uid()) is null
     or not public.has_tournament_permission('tournaments.write') then
    raise exception 'Você não tem permissão para gerar grupos.' using errcode = '42501';
  end if;

  if p_tournament_id is null or p_category_id is null then
    raise exception 'Torneio e classe são obrigatórios.' using errcode = '22023';
  end if;

  select tournament_category.*
    into target_category
  from public.tournament_categories as tournament_category
  where tournament_category.id = p_category_id
    and tournament_category.tournament_id = p_tournament_id;

  if not found then
    raise exception 'Classe não encontrada neste torneio.' using errcode = '22023';
  end if;

  perform 1
  from public.tournament_registrations as registration
  where registration.tournament_id = p_tournament_id
    and registration.category_id = p_category_id
  order by registration.id
  for update;

  select tournament_category.*
    into target_category
  from public.tournament_categories as tournament_category
  where tournament_category.id = p_category_id
    and tournament_category.tournament_id = p_tournament_id
  for update;

  if not found then
    raise exception 'Classe não encontrada neste torneio.' using errcode = '22023';
  end if;

  perform 1
  from public.tournament_matches as tournament_match
  where tournament_match.tournament_id = p_tournament_id
    and tournament_match.category_id = p_category_id
  order by
    case when upper(coalesce(tournament_match.phase, tournament_match.round_code, '')) = 'FINAL' then 1 else 0 end,
    tournament_match.round_no,
    tournament_match.match_no,
    tournament_match.id
  for update;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_category_id::text, 928617403)
  );

  select count(distinct athlete_id)::integer
    into requested_athlete_count
  from unnest(p_athlete_ids) as athlete_id;

  select
    count(*) filter (where registration.status = 'CONFIRMED')::integer,
    count(*) filter (where registration.status = 'PENDING')::integer,
    count(*) filter (
      where registration.status = 'CONFIRMED'
        and registration.athlete_id = any(p_athlete_ids)
    )::integer
    into confirmed_count, pending_count, matched_confirmed_count
  from public.tournament_registrations as registration
  where registration.tournament_id = p_tournament_id
    and registration.category_id = p_category_id;

  if athlete_count < 3
     or requested_athlete_count <> athlete_count
     or confirmed_count <> athlete_count
     or pending_count <> 0
     or matched_confirmed_count <> athlete_count then
    raise exception 'O grupo exige pelo menos três inscrições confirmadas, atletas distintos e nenhuma inscrição pendente.' using errcode = '22023';
  end if;

  if target_category.min_entries > athlete_count then
    raise exception 'A configuração mínima da classe é incompatível com a quantidade atual de atletas.' using errcode = '22023';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(tournament_match) order by tournament_match.round_no, tournament_match.match_no),
    '[]'::jsonb
  )
    into previous_matches
  from public.tournament_matches as tournament_match
  where tournament_match.category_id = p_category_id;

  if jsonb_array_length(previous_matches) > 0 and not coalesce(p_overwrite, false) then
    raise exception 'Esta classe já possui jogos. Confirme a substituição para continuar.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.tournament_matches as tournament_match
    where tournament_match.category_id = p_category_id
      and upper(coalesce(tournament_match.phase, tournament_match.round_code, '')) = 'FINAL'
      and tournament_match.winner_athlete_id is not null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'A final desta classe já possui vencedor e o grupo não pode ser gerado novamente.';
  end if;

  delete from public.tournament_matches
  where category_id = p_category_id;

  expected_group_match_count := (athlete_count * (athlete_count - 1)) / 2;

  for first_index in 1..(athlete_count - 1) loop
    for second_index in (first_index + 1)..athlete_count loop
      group_match_no := group_match_no + 1;
      group_match_id := gen_random_uuid();

      insert into public.tournament_matches (
        id, legacy_key, tournament_id, category_id, round_no, round_code, phase, match_no,
        side1_athlete_id, side2_athlete_id, winner_athlete_id,
        source1_match_id, source2_match_id, status, sort_order, published, metadata
      ) values (
        group_match_id,
        'group:' || p_category_id::text || ':' || group_match_id::text,
        p_tournament_id,
        p_category_id,
        group_match_no,
        'GROUP',
        'GROUP',
        group_match_no,
        p_athlete_ids[first_index],
        p_athlete_ids[second_index],
        null,
        null,
        null,
        'PENDING',
        group_match_no * 1000 + 10,
        false,
        jsonb_build_object(
          'generated', true,
          'format', 'GROUPS_AND_KNOCKOUT',
          'group', 'A',
          'group_size', athlete_count
        )
      );
    end loop;
  end loop;

  insert into public.tournament_matches (
    id, legacy_key, tournament_id, category_id, round_no, round_code, phase, match_no,
    side1_athlete_id, side2_athlete_id, winner_athlete_id,
    source1_match_id, source2_match_id, status, sort_order, published, metadata
  ) values (
    final_match_id,
    'group-final:' || p_category_id::text || ':' || final_match_id::text,
    p_tournament_id,
    p_category_id,
    expected_group_match_count + 1,
    'FINAL',
    'FINAL',
    expected_group_match_count + 1,
    null,
    null,
    null,
    null,
    null,
    'PENDING',
    (expected_group_match_count + 1) * 1000 + 10,
    false,
    jsonb_build_object(
      'generated', true,
      'format', 'GROUPS_AND_KNOCKOUT',
      'group_size', athlete_count,
      'qualifiers', jsonb_build_array(1, 2)
    )
  );

  update public.tournament_categories
  set draw_format = 'GROUPS_AND_KNOCKOUT',
      draw_size = athlete_count,
      max_entries = athlete_count,
      settings = (
        case
          when jsonb_typeof(settings) = 'object' then settings
          else '{}'::jsonb
        end
      ) || jsonb_build_object(
        'group_stage_previous_max_entries',
        case
          when jsonb_typeof(settings) = 'object'
            and settings ? 'group_stage_previous_max_entries'
          then settings -> 'group_stage_previous_max_entries'
          else to_jsonb(target_category.max_entries)
        end
      ),
      updated_at = now()
  where id = p_category_id
    and tournament_id = p_tournament_id;

  select coalesce(
    jsonb_agg(to_jsonb(tournament_match) order by tournament_match.round_no, tournament_match.match_no),
    '[]'::jsonb
  )
    into inserted_matches
  from public.tournament_matches as tournament_match
  where tournament_match.category_id = p_category_id;

  if jsonb_array_length(inserted_matches) <> expected_group_match_count + 1 then
    raise exception 'O grupo não foi gravado por completo.' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'category_id', p_category_id,
    'draw_format', 'GROUPS_AND_KNOCKOUT',
    'draw_size', athlete_count,
    'group_match_count', expected_group_match_count,
    'previous_matches', previous_matches,
    'matches', inserted_matches
  );
end;
$$;

alter function public.tournament_replace_group_stage_atomic(uuid, uuid, uuid[], boolean)
  owner to postgres;
comment on function public.tournament_replace_group_stage_atomic(uuid, uuid, uuid[], boolean) is
  'Atomically creates a private round robin for three or more athletes followed by a final for the top two.';
revoke all on function public.tournament_replace_group_stage_atomic(uuid, uuid, uuid[], boolean)
  from public, anon, service_role;
grant execute on function public.tournament_replace_group_stage_atomic(uuid, uuid, uuid[], boolean)
  to authenticated;

commit;
