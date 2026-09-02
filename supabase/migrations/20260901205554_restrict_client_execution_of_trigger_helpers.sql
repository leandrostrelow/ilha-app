begin;

-- Trigger functions are implementation details. PostgreSQL invokes an
-- installed trigger without requiring the statement role to hold EXECUTE on
-- its function, so browser-facing roles never need this capability.
do $block$
declare
  function_signature text;
begin
  for function_signature in
    select format(
      '%I.%I(%s)',
      namespace.nspname,
      procedure.proname,
      pg_get_function_identity_arguments(procedure.oid)
    )
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'private')
      and procedure.prorettype = 'pg_catalog.trigger'::regtype
      and (
        has_function_privilege('anon', procedure.oid, 'EXECUTE')
        or has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      )
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      function_signature
    );
  end loop;
end
$block$;

-- Staging retained the pre-delivery-location overload from before the current
-- five-argument Bar RPC. Keep authenticated compatibility, but remove the
-- accidental anonymous grant when that drifted overload still exists.
do $block$
declare
  legacy_bar_add_order_item regprocedure :=
    to_regprocedure('public.bar_add_order_item(uuid,uuid,numeric,text)');
begin
  if legacy_bar_add_order_item is not null then
    execute format(
      'revoke execute on function %s from public, anon',
      legacy_bar_add_order_item
    );
  end if;
end
$block$;

commit;
