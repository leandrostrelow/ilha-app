begin;

-- Secret API keys no longer populate the legacy request.jwt.claim.role GUC.
-- Keep both tournament payment RPCs private to service_role while reading the
-- role through Supabase's supported auth.jwt() helper.
do $$
declare
  function_row record;
  original_definition text;
  corrected_definition text;
  corrected_count integer := 0;
begin
  for function_row in
    select procedure.oid
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.prokind = 'f'
       and procedure.proname in (
         'claim_public_tournament_registration_bundle',
         'sync_tournament_registration_payment_group'
       )
  loop
    original_definition := pg_catalog.pg_get_functiondef(function_row.oid);
    corrected_definition := replace(
      original_definition,
      'coalesce(current_setting(''request.jwt.claim.role'', true), '''')',
      'coalesce((select auth.jwt() ->> ''role''), '''')'
    );

    if corrected_definition = original_definition then
      if original_definition like '%auth.jwt() ->> ''role''%' then
        corrected_count := corrected_count + 1;
        continue;
      end if;
      raise exception
        'A função % não possui uma verificação de papel reconhecida.',
        function_row.oid::regprocedure
        using errcode = '55000';
    end if;

    execute corrected_definition;
    corrected_count := corrected_count + 1;
  end loop;

  if corrected_count <> 2 then
    raise exception
      'Era esperado corrigir duas funções de pagamento do torneio; foram encontradas %.',
      corrected_count
      using errcode = '55000';
  end if;
end;
$$;

commit;
