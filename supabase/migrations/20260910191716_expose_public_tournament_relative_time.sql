begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- The public agenda needs to distinguish a relative "Após" slot from a match
-- whose time was never scheduled. Expose only that derived label; the complete
-- match metadata remains private.
do $$
declare
  function_oid regprocedure := to_regprocedure(
    'private.tournament_public_snapshot_legacy_unsafe(text)'
  );
  function_security_definer boolean;
  function_config text[];
  current_definition text;
  updated_definition text;
  expected_fragment text := E'        \'match_time\', tournament_match.match_time,\n        \'scheduled_at\', tournament_match.scheduled_at,';
  replacement_fragment text := E'        \'match_time\', tournament_match.match_time,\n        \'time_label\', case\n          when lower(trim(coalesce(tournament_match.metadata ->> \'legacy_time\', \'\'))) in (\'após\', \'apos\') then \'Após\'\n          else null\n        end,\n        \'scheduled_at\', tournament_match.scheduled_at,';
begin
  if function_oid is null then
    raise exception 'A implementação privada da projeção pública não foi encontrada.'
      using errcode = '55000';
  end if;

  select
    procedure.prosecdef,
    procedure.proconfig,
    pg_catalog.pg_get_functiondef(procedure.oid)
    into function_security_definer, function_config, current_definition
  from pg_catalog.pg_proc as procedure
  where procedure.oid = function_oid;

  if function_security_definer is distinct from true
     or not coalesce('search_path=""' = any(function_config), false)
     or current_definition not like '%jsonb_build_object(%'
     or current_definition not like '%''matches'', coalesce(%'
     or current_definition like '%''metadata'', tournament_match.metadata%'
  then
    raise exception 'A projeção pública não corresponde à versão segura esperada.'
      using errcode = '55000';
  end if;

  if current_definition like '%''time_label'', case%tournament_match.metadata ->> ''legacy_time''%' then
    return;
  end if;

  if pg_catalog.strpos(current_definition, expected_fragment) = 0 then
    raise exception 'O trecho de horário da projeção pública não foi encontrado.'
      using errcode = '55000';
  end if;

  updated_definition := replace(
    current_definition,
    expected_fragment,
    replacement_fragment
  );

  if updated_definition = current_definition
     or updated_definition not like '%''time_label'', case%'
     or updated_definition like '%''metadata'', tournament_match.metadata%'
  then
    raise exception 'Não foi possível expor o horário relativo com segurança.'
      using errcode = '55000';
  end if;

  execute updated_definition;
end;
$$;

alter function private.tournament_public_snapshot_legacy_unsafe(text)
  owner to postgres;
revoke all on function private.tournament_public_snapshot_legacy_unsafe(text)
  from public, anon, authenticated, service_role;

do $$
declare
  private_oid regprocedure := to_regprocedure(
    'private.tournament_public_snapshot_legacy_unsafe(text)'
  );
  wrapper_oid regprocedure := to_regprocedure('public.tournament_public_snapshot(text)');
  private_definition text;
  wrapper_definition text;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid)
    into private_definition
  from pg_catalog.pg_proc as procedure
  where procedure.oid = private_oid;

  select pg_catalog.pg_get_functiondef(procedure.oid)
    into wrapper_definition
  from pg_catalog.pg_proc as procedure
  where procedure.oid = wrapper_oid;

  if private_definition not like '%''time_label'', case%'
     or private_definition like '%''metadata'', tournament_match.metadata%'
     or wrapper_definition not like '%private.tournament_public_snapshot_legacy_unsafe(p_slug)%'
  then
    raise exception 'A projeção pública segura de horário não foi instalada.'
      using errcode = '55000';
  end if;
end;
$$;

commit;
