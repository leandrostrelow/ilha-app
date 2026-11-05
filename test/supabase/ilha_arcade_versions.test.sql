-- Version isolation, legacy compatibility and private RPC; no retained fixtures.
begin;
do $$
declare
  h text := encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
  r jsonb; v1 uuid; v2 uuid; n integer;
begin
  if has_function_privilege('anon','public.arcade_start_run(text,text,text,text,bigint,text)','EXECUTE') or
     has_function_privilege('authenticated','public.arcade_start_run(text,text,text,text,bigint,text)','EXECUTE') then
    raise exception 'Versioned RPC must be private';
  end if;
  r := public.arcade_start_run(h,h,'Version SQL QA','leandro',22);v1:=(r->>'id')::uuid;
  if r->>'version'<>'tennis-8bit-v1' then raise exception 'Legacy version changed'; end if;
  r := public.arcade_start_run(h,h,'Version SQL QA','leandro',22,'tennis-rpg-v2');v2:=(r->>'id')::uuid;
  if r->>'version'<>'tennis-rpg-v2' then raise exception 'New version not recorded'; end if;
  begin
    perform public.arcade_start_run(h,h,'Version SQL QA','leandro',22,'invalid');
    raise exception 'Expected invalid version rejection';
  exception when others then if sqlerrm<>'ARCADE_INVALID_VERSION' then raise;end if;end;
  update public.arcade_runs set started_at=now()-interval '95 seconds' where id in(v1,v2);
  perform public.arcade_finish_run(v1,h,500,1,0,10);
  perform public.arcade_finish_run(v2,h,700,3,0,10);
  select count(*) into n from public.arcade_scores where player_hash=h;
  if n<>2 then raise exception 'Versions must keep independent records';end if;
  select score into n from public.arcade_scores where player_hash=h and game='tennis-8bit-v1';
  if n<>500 then raise exception 'Classic score changed';end if;
end;
$$;
rollback;
