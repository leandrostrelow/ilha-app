begin;

do $$
declare
  original_definition text;
  corrected_definition text;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid)
    into original_definition
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'archive_expired_tournament_payment'
    and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = 'p_payment_id uuid';

  if original_definition is null then
    raise exception 'A função de expiração do torneio não foi encontrada.' using errcode = '55000';
  end if;

  corrected_definition := replace(
    original_definition,
    'coalesce(current_setting(''request.jwt.claim.role'', true), '''')',
    'coalesce((select auth.jwt() ->> ''role''), '''')'
  );

  if corrected_definition = original_definition then
    raise exception 'A verificação de papel da função de expiração não foi corrigida.' using errcode = '55000';
  end if;

  execute corrected_definition;
end;
$$;

commit;
