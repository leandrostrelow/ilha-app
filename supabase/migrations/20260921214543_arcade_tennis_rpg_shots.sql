-- Keep the classic engine and its results intact while adding four-shot tennis.
alter table public.arcade_runs drop constraint arcade_runs_game_check;
alter table public.arcade_runs add constraint arcade_runs_game_check
  check (game in ('tennis-8bit-v1','tennis-rpg-v2'));

-- Explicit version overload. The old five-argument RPC remains for old clients.
create function public.arcade_start_run(p_player_hash text, p_ip_hash text, p_nickname text, p_character text, p_seed bigint, p_game text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_run public.arcade_runs;
begin
  if p_game is null or p_game not in ('tennis-8bit-v1','tennis-rpg-v2') then
    raise exception 'ARCADE_INVALID_VERSION';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('arcade-ip:' || p_ip_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('arcade-player:' || p_player_hash, 0));
  if (select count(*) from public.arcade_runs where player_hash=p_player_hash and started_at>now()-interval '1 hour') >= 60
     or (select count(*) from public.arcade_runs where ip_hash=p_ip_hash and started_at>now()-interval '1 hour') >= 300 then
    raise exception 'ARCADE_RATE_LIMIT';
  end if;
  insert into public.arcade_runs (player_hash,ip_hash,nickname,character,seed,game)
  values (p_player_hash,p_ip_hash,p_nickname,p_character,p_seed,p_game) returning * into v_run;
  return jsonb_build_object('id',v_run.id,'seed',v_run.seed,'version',v_run.game);
end;
$$;
revoke all on function public.arcade_start_run(text,text,text,text,bigint,text) from public, anon, authenticated;
grant execute on function public.arcade_start_run(text,text,text,text,bigint,text) to service_role;
