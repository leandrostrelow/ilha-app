begin;

-- Supabase exposes the request claims through auth.jwt().  The older
-- request.jwt.claim.role GUC is not guaranteed to be populated on current
-- PostgREST requests, which made trigger guards silently skip authenticated
-- writes.  Recreate every current public function that still uses the legacy
-- lookup, preserving its signature, owner, grants and business logic.
do $$
declare
  function_row record;
  original_definition text;
  hardened_definition text;
  hardened_count integer := 0;
begin
  for function_row in
    select procedure.oid
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.prokind = 'f'
       and pg_catalog.pg_get_functiondef(procedure.oid)
           like '%request.jwt.claim.role%'
  loop
    original_definition := pg_catalog.pg_get_functiondef(function_row.oid);
    hardened_definition := replace(
      original_definition,
      'coalesce(current_setting(''request.jwt.claim.role'', true), '''')',
      'coalesce((select auth.jwt() ->> ''role''), '''')'
    );

    if hardened_definition = original_definition then
      raise exception
        'A função % usa request.jwt.claim.role em um formato não reconhecido.',
        function_row.oid::regprocedure
        using errcode = '55000';
    end if;

    execute hardened_definition;
    hardened_count := hardened_count + 1;
  end loop;

  if hardened_count = 0 then
    raise exception
      'Nenhuma função com a leitura legada do papel JWT foi encontrada.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.prokind = 'f'
       and pg_catalog.pg_get_functiondef(procedure.oid)
           like '%request.jwt.claim.role%'
  ) then
    raise exception
      'Ainda existem funções públicas usando a leitura legada do papel JWT.'
      using errcode = '55000';
  end if;
end;
$$;

comment on function public.keep_self_service_client_pending() is
  'Mantém novos cadastros do Ilha Play como PENDENTE usando o papel confiável do JWT até aprovação do clube.';

commit;
