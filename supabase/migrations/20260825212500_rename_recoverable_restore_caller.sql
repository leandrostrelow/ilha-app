begin;

-- A prior hotfix attempted to qualify a PL/pgSQL local variable as if it were
-- a table alias. Rename that variable instead. The migration is idempotent so
-- it is safe both after the staging hotfix and on a fresh database.
do $migration$
declare
  function_definition text;
  corrected_definition text;
begin
  if pg_catalog.to_regprocedure(
    'public.restore_app_client_account_backup(uuid)'
  ) is null then
    raise exception 'A função de restauração recuperável não existe.'
      using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(procedure.oid)
    into function_definition
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname = 'restore_app_client_account_backup'
     and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = 'p_backup_id uuid';

  if function_definition like '%caller_id uuid :=%'
     and function_definition like '%restored_by = caller_id,%' then
    null;
  else
    corrected_definition := pg_catalog.replace(function_definition,
      'actor_id uuid :=', 'caller_id uuid :=');
    corrected_definition := pg_catalog.replace(corrected_definition,
      'if actor_id is null', 'if caller_id is null');
    corrected_definition := pg_catalog.replace(corrected_definition,
      'restored_by = restore_app_client_account_backup.actor_id,',
      'restored_by = caller_id,');
    corrected_definition := pg_catalog.replace(corrected_definition,
      'restored_by = actor_id,', 'restored_by = caller_id,');

    if corrected_definition = function_definition
       or corrected_definition not like '%caller_id uuid :=%'
       or corrected_definition not like '%restored_by = caller_id,%' then
      raise exception 'A definição da restauração divergiu do formato auditado.'
        using errcode = '55000';
    end if;
    execute corrected_definition;
  end if;
end;
$migration$;

-- Keep the private workflow callable only by authenticated administrators.
revoke all on function public.reset_app_client_account_with_backup(uuid, text)
  from service_role;
revoke all on function public.reset_app_client_account(uuid)
  from service_role;
revoke all on function public.delete_app_client_account(uuid)
  from service_role;
revoke all on function public.list_app_client_account_backups(uuid, integer)
  from service_role;
revoke all on function public.restore_app_client_account_backup(uuid)
  from service_role;

commit;
