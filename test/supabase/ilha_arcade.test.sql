-- Transactional integration checks: synthetic rows are always rolled back.
begin;
do $$
declare
  h text := encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
  other_h text := encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
  r jsonb; run_id1 uuid; run_id2 uuid; n integer;
begin
  if has_table_privilege('anon','public.arcade_scores','INSERT') or
     has_table_privilege('authenticated','public.arcade_scores','UPDATE') or
     has_function_privilege('anon','public.arcade_finish_run(uuid,text,integer,integer,integer,integer)','EXECUTE') then
    raise exception 'Public score writes must be forbidden';
  end if;
  r := public.arcade_start_run(h,h,'Arcade SQL QA','leandro',42); run_id1 := (r->>'id')::uuid;
  begin
    perform public.arcade_finish_run(run_id1,h,500,1,0,10);
    raise exception 'Expected minimum duration rejection';
  exception when others then if sqlerrm <> 'ARCADE_RUN_TIME' then raise; end if; end;
  update public.arcade_runs set started_at=now()-interval '95 seconds' where arcade_runs.id=run_id1;
  begin
    perform public.arcade_finish_run(run_id1,other_h,500,1,0,10);
    raise exception 'Expected wrong-player rejection';
  exception when others then if sqlerrm <> 'ARCADE_RUN_NOT_FOUND' then raise; end if; end;
  begin
    perform public.arcade_finish_run(run_id1,h,9999,1,0,10);
    raise exception 'Expected inconsistent score rejection';
  exception when others then if sqlerrm <> 'ARCADE_INVALID_SCORE' then raise; end if; end;
  perform public.arcade_finish_run(run_id1,h,500,1,0,10);
  perform public.arcade_finish_run(run_id1,h,9999,99,0,99);
  select score into n from public.arcade_scores where player_hash=h;
  if n<>500 then raise exception 'Retry must not overwrite the verified score'; end if;
  r := public.arcade_start_run(h,h,'Arcade SQL QA','evandro',52);run_id2:=(r->>'id')::uuid;
  update public.arcade_runs set started_at=now()-interval '95 seconds' where arcade_runs.id=run_id2;
  perform public.arcade_finish_run(run_id2,h,20,0,2,2);
  select score into n from public.arcade_scores where player_hash=h;
  if n<>500 then raise exception 'Weaker runs must not replace best score'; end if;
  r := public.arcade_start_run(h,h,'Arcade SQL QA','romulo',72);run_id2:=(r->>'id')::uuid;
  update public.arcade_runs set started_at=now()-interval '95 seconds' where arcade_runs.id=run_id2;
  perform public.arcade_finish_run(run_id2,h,700,3,0,10);
  select score into n from public.arcade_scores where player_hash=h;
  if n<>700 then raise exception 'Better run must replace best score'; end if;
  insert into public.arcade_runs(player_hash,ip_hash,nickname,character,seed)
    select h,h,'Arcade SQL QA','leandro',1 from generate_series(1,57);
  begin
    perform public.arcade_start_run(h,h,'Arcade SQL QA','leandro',1);
    raise exception 'Expected rate limit rejection';
  exception when others then if sqlerrm <> 'ARCADE_RATE_LIMIT' then raise; end if; end;
end;
$$;
rollback;
