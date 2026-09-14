begin;

alter table public.tournament_categories
  drop constraint if exists tournament_categories_draw_size_check;

alter table public.tournament_categories
  add constraint tournament_categories_draw_size_check
  check (
    draw_size is null
    or draw_size in (2, 4, 8, 16, 32, 64, 128)
    or (draw_format = 'GROUPS_AND_KNOCKOUT' and draw_size = 3)
  );

alter table public.tournament_categories
  drop constraint if exists tournament_categories_three_player_group_capacity_check;

alter table public.tournament_categories
  add constraint tournament_categories_three_player_group_capacity_check
  check (
    draw_format <> 'GROUPS_AND_KNOCKOUT'
    or draw_size is distinct from 3
    or max_entries = 3
  );

create or replace function private.tournament_group_score_metrics(p_score text)
returns table (
  side1_sets integer,
  side2_sets integer,
  side1_games integer,
  side2_games integer
)
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  normalized_score text;
  score_token text;
  score_parts text[];
  raw_side1 text;
  raw_side2 text;
  side1_main integer;
  side2_main integer;
  side1_extra integer;
  side2_extra integer;
  set_result integer;
  is_super_tie boolean;
begin
  side1_sets := 0;
  side2_sets := 0;
  side1_games := 0;
  side2_games := 0;

  normalized_score := pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(coalesce(p_score, ''), '(ST|TB)[[:space:]]+([0-9])', '\1\2', 'gi'),
    '[,;]+',
    ' ',
    'g'
  ));

  if normalized_score = '' then
    return next;
    return;
  end if;

  foreach score_token in array pg_catalog.regexp_split_to_array(normalized_score, '[[:space:]]+') loop
    score_parts := pg_catalog.regexp_match(
      score_token,
      '^(ST|TB)?([0-9]+)[xX/-]([0-9]+)$',
      'i'
    );
    if score_parts is null then
      continue;
    end if;

    is_super_tie := score_parts[1] is not null;
    raw_side1 := score_parts[2];
    raw_side2 := score_parts[3];
    side1_extra := null;
    side2_extra := null;

    if not is_super_tie and length(raw_side1) >= 2 and left(raw_side1, 1) in ('6', '7') then
      side1_main := left(raw_side1, 1)::integer;
      side1_extra := substring(raw_side1 from 2)::integer;
    else
      side1_main := raw_side1::integer;
    end if;

    if not is_super_tie and length(raw_side2) >= 2 and left(raw_side2, 1) in ('6', '7') then
      side2_main := left(raw_side2, 1)::integer;
      side2_extra := substring(raw_side2 from 2)::integer;
    else
      side2_main := raw_side2::integer;
    end if;

    set_result := case
      when side1_main > side2_main then 1
      when side2_main > side1_main then -1
      when side1_extra is not null and side2_extra is not null and side1_extra > side2_extra then 1
      when side1_extra is not null and side2_extra is not null and side2_extra > side1_extra then -1
      else 0
    end;

    if set_result > 0 then
      side1_sets := side1_sets + 1;
    elsif set_result < 0 then
      side2_sets := side2_sets + 1;
    end if;

    -- A super tie decide um set, mas seus pontos não entram no saldo de games.
    if not is_super_tie then
      side1_games := side1_games + side1_main;
      side2_games := side2_games + side2_main;
    end if;
  end loop;

  return next;
end;
$$;

alter function private.tournament_group_score_metrics(text) owner to postgres;
revoke all on function private.tournament_group_score_metrics(text)
  from public, anon, authenticated, service_role;

create or replace function private.tournament_group_stage_standings(p_category_id uuid)
returns table (
  athlete_id uuid,
  wins integer,
  set_difference integer,
  game_difference integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with group_matches as (
    select
      tournament_match.side1_athlete_id,
      tournament_match.side2_athlete_id,
      tournament_match.winner_athlete_id,
      score_metrics.side1_sets,
      score_metrics.side2_sets,
      score_metrics.side1_games,
      score_metrics.side2_games
    from public.tournament_matches as tournament_match
    cross join lateral private.tournament_group_score_metrics(tournament_match.score) as score_metrics
    where tournament_match.category_id = p_category_id
      and upper(coalesce(tournament_match.phase, tournament_match.round_code, '')) = 'GROUP'
  ), athlete_results as (
    select
      side1_athlete_id as athlete_id,
      case when winner_athlete_id = side1_athlete_id then 1 else 0 end as wins,
      side1_sets as sets_won,
      side2_sets as sets_lost,
      side1_games as games_won,
      side2_games as games_lost
    from group_matches
    where side1_athlete_id is not null

    union all

    select
      side2_athlete_id,
      case when winner_athlete_id = side2_athlete_id then 1 else 0 end,
      side2_sets,
      side1_sets,
      side2_games,
      side1_games
    from group_matches
    where side2_athlete_id is not null
  )
  select
    athlete_results.athlete_id,
    sum(athlete_results.wins)::integer,
    sum(athlete_results.sets_won - athlete_results.sets_lost)::integer,
    sum(athlete_results.games_won - athlete_results.games_lost)::integer
  from athlete_results
  group by athlete_results.athlete_id;
$$;

alter function private.tournament_group_stage_standings(uuid) owner to postgres;
revoke all on function private.tournament_group_stage_standings(uuid)
  from public, anon, authenticated, service_role;

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
  distinct_win_count integer;
  ranked_athletes uuid[];
  tied_athletes uuid[];
  tied_wins integer;
  unique_athlete uuid;
  unique_wins integer;
  head_to_head_winner uuid;
  tied_loser uuid;
  first_finalist uuid;
  second_finalist uuid;
  second_set_difference integer;
  second_game_difference integer;
  third_set_difference integer;
  third_game_difference integer;
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

  first_finalist := null;
  second_finalist := null;

  if group_match_count = 3 and completed_match_count = 3 then
    select count(*)::integer, count(distinct standings.wins)::integer
      into player_count, distinct_win_count
    from private.tournament_group_stage_standings(new.category_id) as standings;

    if player_count = 3 and distinct_win_count = 3 then
      select array_agg(standings.athlete_id order by standings.wins desc, standings.athlete_id)
        into ranked_athletes
      from private.tournament_group_stage_standings(new.category_id) as standings;
      first_finalist := ranked_athletes[1];
      second_finalist := ranked_athletes[2];
    elsif player_count = 3 and distinct_win_count = 2 then
      select standings.wins,
             array_agg(standings.athlete_id order by standings.athlete_id)
        into tied_wins, tied_athletes
      from private.tournament_group_stage_standings(new.category_id) as standings
      group by standings.wins
      having count(*) = 2
      limit 1;

      select standings.athlete_id, standings.wins
        into unique_athlete, unique_wins
      from private.tournament_group_stage_standings(new.category_id) as standings
      where standings.wins <> tied_wins
      limit 1;

      select tournament_match.winner_athlete_id
        into head_to_head_winner
      from public.tournament_matches as tournament_match
      where tournament_match.tournament_id = new.tournament_id
        and tournament_match.category_id = new.category_id
        and upper(coalesce(tournament_match.phase, tournament_match.round_code, '')) = 'GROUP'
        and (
          (tournament_match.side1_athlete_id = tied_athletes[1] and tournament_match.side2_athlete_id = tied_athletes[2])
          or
          (tournament_match.side1_athlete_id = tied_athletes[2] and tournament_match.side2_athlete_id = tied_athletes[1])
        )
        and tournament_match.winner_athlete_id in (tied_athletes[1], tied_athletes[2])
      limit 1;

      if head_to_head_winner is not null then
        tied_loser := case
          when head_to_head_winner = tied_athletes[1] then tied_athletes[2]
          else tied_athletes[1]
        end;
        if unique_wins > tied_wins then
          first_finalist := unique_athlete;
          second_finalist := head_to_head_winner;
        else
          first_finalist := head_to_head_winner;
          second_finalist := tied_loser;
        end if;
      end if;
    elsif player_count = 3 and distinct_win_count = 1 then
      select array_agg(
        standings.athlete_id
        order by standings.set_difference desc, standings.game_difference desc, standings.athlete_id
      )
        into ranked_athletes
      from private.tournament_group_stage_standings(new.category_id) as standings;

      select standings.set_difference, standings.game_difference
        into second_set_difference, second_game_difference
      from private.tournament_group_stage_standings(new.category_id) as standings
      where standings.athlete_id = ranked_athletes[2];

      select standings.set_difference, standings.game_difference
        into third_set_difference, third_game_difference
      from private.tournament_group_stage_standings(new.category_id) as standings
      where standings.athlete_id = ranked_athletes[3];

      -- A igualdade entre 1º e 2º não impede a final: ambos já estão
      -- classificados. Somente um empate que alcance a linha de corte (2º/3º)
      -- exige definição manual no ADM.
      if second_set_difference is distinct from third_set_difference
         or second_game_difference is distinct from third_game_difference then
        first_finalist := ranked_athletes[1];
        second_finalist := ranked_athletes[2];
      end if;
    end if;
  end if;

  -- Um desempate manual feito pelo ADM é uma decisão oficial. Preserve-o em
  -- recálculos posteriores enquanto a tabela continuar sem resolver a linha
  -- de corte e os dois nomes ainda pertencerem ao grupo.
  if first_finalist is null
     and second_finalist is null
     and group_match_count = 3
     and completed_match_count = 3
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

  -- Se a correção do grupo apenas inverte a ordem dos mesmos dois
  -- classificados, mantenha os lados já usados no card da final. Assim um
  -- resultado existente continua associado aos mesmos participantes.
  if first_finalist is not null
     and second_finalist is not null
     and final_match.side1_athlete_id is not null
     and final_match.side2_athlete_id is not null
     and (
       (
         final_match.side1_athlete_id = first_finalist
         and final_match.side2_athlete_id = second_finalist
       )
       or
       (
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

drop trigger if exists refresh_tournament_group_final
  on public.tournament_matches;

create trigger refresh_tournament_group_final
after update of side1_athlete_id, side2_athlete_id, winner_athlete_id, score, status
on public.tournament_matches
for each row
when (upper(coalesce(new.phase, new.round_code, '')) = 'GROUP')
execute function private.refresh_tournament_group_final();

create or replace function private.guard_tournament_group_final_predictions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.side1_athlete_id is not distinct from new.side1_athlete_id
     and old.side2_athlete_id is not distinct from new.side2_athlete_id then
    return new;
  end if;

  if upper(coalesce(old.phase, old.round_code, '')) <> 'FINAL'
     or not exists (
       select 1
       from public.tournament_categories as tournament_category
       where tournament_category.id = old.category_id
         and tournament_category.tournament_id = old.tournament_id
         and tournament_category.draw_format = 'GROUPS_AND_KNOCKOUT'
     ) then
    return new;
  end if;

  if exists (
    select 1
    from public.tournament_predictions as prediction
    where prediction.match_id = old.id
  ) or exists (
    select 1
    from public.tournament_prediction_requests as prediction_request
    where prediction_request.match_id = old.id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'A final já possui palpites. Os participantes não podem ser trocados sem tratar esses palpites.';
  end if;

  return new;
end;
$$;

alter function private.guard_tournament_group_final_predictions() owner to postgres;
revoke all on function private.guard_tournament_group_final_predictions()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_tournament_group_final_predictions
  on public.tournament_matches;
create trigger guard_tournament_group_final_predictions
before update of side1_athlete_id, side2_athlete_id on public.tournament_matches
for each row execute function private.guard_tournament_group_final_predictions();

create or replace function public.tournament_replace_single_elimination_atomic(
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
  replacement jsonb;
begin
  if (select auth.uid()) is null
     or not public.has_tournament_permission('tournaments.write') then
    raise exception 'Você não tem permissão para gerar chaves.' using errcode = '42501';
  end if;

  -- O RPC legado faz toda a validação e substituição da chave. A atualização
  -- do formato ocorre na mesma transação externa, evitando categoria em formato
  -- de grupo com jogos de mata-mata caso qualquer passo falhe.
  replacement := public.tournament_replace_bracket_atomic(
    p_tournament_id,
    p_category_id,
    p_draw_size,
    p_matches,
    p_overwrite
  );

  update public.tournament_categories
  set draw_format = 'SINGLE_ELIMINATION',
      max_entries = case
        when jsonb_typeof(settings -> 'group_stage_previous_max_entries') = 'number'
        then (settings ->> 'group_stage_previous_max_entries')::integer
        when settings ? 'group_stage_previous_max_entries'
          and jsonb_typeof(settings -> 'group_stage_previous_max_entries') = 'null'
        then null
        else max_entries
      end,
      settings = case
        when jsonb_typeof(settings) = 'object'
        then settings - 'group_stage_previous_max_entries'
        else '{}'::jsonb
      end,
      updated_at = now()
  where id = p_category_id
    and tournament_id = p_tournament_id;

  if not found then
    raise exception 'Classe não encontrada neste torneio.' using errcode = '22023';
  end if;

  return replacement || jsonb_build_object('draw_format', 'SINGLE_ELIMINATION');
end;
$$;

alter function public.tournament_replace_single_elimination_atomic(uuid, uuid, integer, jsonb, boolean)
  owner to postgres;
comment on function public.tournament_replace_single_elimination_atomic(uuid, uuid, integer, jsonb, boolean) is
  'Atomically replaces a single-elimination draw and resets the category format.';
revoke all on function public.tournament_replace_single_elimination_atomic(uuid, uuid, integer, jsonb, boolean)
  from public, anon, service_role;
grant execute on function public.tournament_replace_single_elimination_atomic(uuid, uuid, integer, jsonb, boolean)
  to authenticated;

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
  requested_athlete_count integer;
  group_match1_id uuid := gen_random_uuid();
  group_match2_id uuid := gen_random_uuid();
  group_match3_id uuid := gen_random_uuid();
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

  -- Edições de inscrição já possuem a linha antes do trigger de capacidade.
  -- Use a mesma ordem aqui (inscrição -> categoria) para não inverter locks.
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
    count(*) filter (where registration.status = 'PENDING')::integer
    into confirmed_count, pending_count
  from public.tournament_registrations as registration
  where registration.tournament_id = p_tournament_id
    and registration.category_id = p_category_id;

  if cardinality(p_athlete_ids) <> 3
     or requested_athlete_count <> 3
     or confirmed_count <> 3
     or pending_count <> 0
     or (
       select count(*)
       from public.tournament_registrations as registration
       where registration.tournament_id = p_tournament_id
         and registration.category_id = p_category_id
         and registration.status = 'CONFIRMED'
         and registration.athlete_id = any(p_athlete_ids)
     ) <> 3 then
    raise exception 'O grupo exige exatamente três inscrições confirmadas, distintas e nenhuma inscrição pendente.' using errcode = '22023';
  end if;

  if target_category.min_entries > 3 then
    raise exception 'A configuração mínima da classe é incompatível com um grupo de três atletas.' using errcode = '22023';
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

  insert into public.tournament_matches (
    id, legacy_key, tournament_id, category_id, round_no, round_code, phase, match_no,
    side1_athlete_id, side2_athlete_id, winner_athlete_id,
    source1_match_id, source2_match_id, status, sort_order, published, metadata
  ) values
    (
      group_match1_id, 'group:' || p_category_id::text || ':' || group_match1_id::text,
      p_tournament_id, p_category_id, 1, 'GROUP', 'GROUP', 1,
      p_athlete_ids[1], p_athlete_ids[2], null,
      null, null, 'PENDING', 1010, false,
      jsonb_build_object('generated', true, 'format', 'GROUPS_AND_KNOCKOUT', 'group', 'A')
    ),
    (
      group_match2_id, 'group:' || p_category_id::text || ':' || group_match2_id::text,
      p_tournament_id, p_category_id, 2, 'GROUP', 'GROUP', 1,
      p_athlete_ids[1], p_athlete_ids[3], null,
      null, null, 'PENDING', 2010, false,
      jsonb_build_object('generated', true, 'format', 'GROUPS_AND_KNOCKOUT', 'group', 'A')
    ),
    (
      group_match3_id, 'group:' || p_category_id::text || ':' || group_match3_id::text,
      p_tournament_id, p_category_id, 3, 'GROUP', 'GROUP', 1,
      p_athlete_ids[2], p_athlete_ids[3], null,
      null, null, 'PENDING', 3010, false,
      jsonb_build_object('generated', true, 'format', 'GROUPS_AND_KNOCKOUT', 'group', 'A')
    ),
    (
      final_match_id, 'group-final:' || p_category_id::text || ':' || final_match_id::text,
      p_tournament_id, p_category_id, 4, 'FINAL', 'FINAL', 1,
      null, null, null,
      null, null, 'PENDING', 4010, false,
      jsonb_build_object(
        'generated', true,
        'format', 'GROUPS_AND_KNOCKOUT',
        'qualifiers', jsonb_build_array(1, 2)
      )
    );

  update public.tournament_categories
  set draw_format = 'GROUPS_AND_KNOCKOUT',
      draw_size = 3,
      max_entries = 3,
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

  if jsonb_array_length(inserted_matches) <> 4 then
    raise exception 'O grupo não foi gravado por completo.' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'category_id', p_category_id,
    'draw_format', 'GROUPS_AND_KNOCKOUT',
    'draw_size', 3,
    'previous_matches', previous_matches,
    'matches', inserted_matches
  );
end;
$$;

alter function public.tournament_replace_group_stage_atomic(uuid, uuid, uuid[], boolean)
  owner to postgres;
comment on function public.tournament_replace_group_stage_atomic(uuid, uuid, uuid[], boolean) is
  'Atomically creates a private three-player round robin followed by a final for the two classified athletes.';
revoke all on function public.tournament_replace_group_stage_atomic(uuid, uuid, uuid[], boolean)
  from public, anon, service_role;
grant execute on function public.tournament_replace_group_stage_atomic(uuid, uuid, uuid[], boolean)
  to authenticated;

commit;
