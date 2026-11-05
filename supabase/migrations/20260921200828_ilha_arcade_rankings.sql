-- Original arcade scores live separately from tournaments and Ilha Bet.
create table public.arcade_runs (
  id uuid primary key default gen_random_uuid(),
  game text not null default 'tennis-8bit-v1' check (game = 'tennis-8bit-v1'),
  player_hash text not null check (player_hash ~ '^[a-f0-9]{64}$'),
  ip_hash text not null,
  nickname text not null check (char_length(nickname) between 2 and 18),
  character text not null check (character in ('leandro','romulo','evandro','alexandre')),
  seed bigint not null check (seed between 0 and 4294967295),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score integer check (score between 0 and 20000),
  points_won integer,
  points_lost integer,
  returns integer
);
create index arcade_runs_player_time_idx on public.arcade_runs (player_hash, started_at desc);
create index arcade_runs_ip_time_idx on public.arcade_runs (ip_hash, started_at desc);
create table public.arcade_scores (
  game text not null,
  player_hash text not null,
  nickname text not null check (char_length(nickname) between 2 and 18),
  character text not null,
  score integer not null check (score between 0 and 20000),
  points_won integer not null,
  returns integer not null,
  achieved_at timestamptz not null default now(),
  primary key (game, player_hash)
);
create index arcade_scores_ranking_idx on public.arcade_scores (game, score desc, points_won desc, returns desc, achieved_at asc);
alter table public.arcade_runs enable row level security;
alter table public.arcade_scores enable row level security;
revoke all on public.arcade_runs, public.arcade_scores from public, anon, authenticated;
grant select, insert, update, delete on public.arcade_runs, public.arcade_scores to service_role;

-- Only the Edge Function can call these invoker functions. No public write API.
create function public.arcade_start_run(p_player_hash text, p_ip_hash text, p_nickname text, p_character text, p_seed bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_run public.arcade_runs;
begin
  perform pg_advisory_xact_lock(hashtextextended('arcade-ip:' || p_ip_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('arcade-player:' || p_player_hash, 0));
  if (select count(*) from public.arcade_runs where player_hash=p_player_hash and started_at>now()-interval '1 hour') >= 60
     or (select count(*) from public.arcade_runs where ip_hash=p_ip_hash and started_at>now()-interval '1 hour') >= 300 then
    raise exception 'ARCADE_RATE_LIMIT';
  end if;
  insert into public.arcade_runs (player_hash,ip_hash,nickname,character,seed)
  values (p_player_hash,p_ip_hash,p_nickname,p_character,p_seed) returning * into v_run;
  return jsonb_build_object('id',v_run.id,'seed',v_run.seed,'version',v_run.game);
end;
$$;

create function public.arcade_finish_run(p_run_id uuid, p_player_hash text, p_score integer, p_points_won integer, p_points_lost integer, p_returns integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_run public.arcade_runs;
begin
  select * into v_run from public.arcade_runs where id=p_run_id and player_hash=p_player_hash for update;
  if not found then raise exception 'ARCADE_RUN_NOT_FOUND'; end if;
  if v_run.finished_at is not null then return jsonb_build_object('score',v_run.score,'saved',true); end if;
  if now()-v_run.started_at < interval '88 seconds' or now()-v_run.started_at > interval '24 hours' then
    raise exception 'ARCADE_RUN_TIME';
  end if;
  if p_score <> 10*p_returns+100*p_points_won+(case when p_points_won>p_points_lost then 300 else 0 end)
     or least(p_points_won,p_points_lost,p_returns)<0 then raise exception 'ARCADE_INVALID_SCORE'; end if;
  update public.arcade_runs set finished_at=now(),score=p_score,points_won=p_points_won,points_lost=p_points_lost,returns=p_returns where id=p_run_id;
  insert into public.arcade_scores (game,player_hash,nickname,character,score,points_won,returns)
  values (v_run.game,v_run.player_hash,v_run.nickname,v_run.character,p_score,p_points_won,p_returns)
  on conflict (game,player_hash) do update set nickname=excluded.nickname,character=excluded.character,
    score=excluded.score,points_won=excluded.points_won,returns=excluded.returns,achieved_at=now()
  where (excluded.score,excluded.points_won,excluded.returns) > (arcade_scores.score,arcade_scores.points_won,arcade_scores.returns);
  return jsonb_build_object('score',p_score,'saved',true);
end;
$$;
revoke all on function public.arcade_start_run(text,text,text,text,bigint) from public, anon, authenticated;
revoke all on function public.arcade_finish_run(uuid,text,integer,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.arcade_start_run(text,text,text,text,bigint) to service_role;
grant execute on function public.arcade_finish_run(uuid,text,integer,integer,integer,integer) to service_role;
