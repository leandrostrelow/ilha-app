begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'private')
      and procedure.prorettype = 'pg_catalog.trigger'::regtype
      and (
        has_function_privilege('anon', procedure.oid, 'EXECUTE')
        or has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      )
  ),
  0,
  'funções de trigger não são executáveis pelos papéis de cliente'
);

select ok(
  case
    when to_regprocedure('public.bar_add_order_item(uuid,uuid,numeric,text)') is null then true
    else
      not has_function_privilege(
        'anon',
        to_regprocedure('public.bar_add_order_item(uuid,uuid,numeric,text)')::oid,
        'EXECUTE'
      )
      and has_function_privilege(
        'authenticated',
        to_regprocedure('public.bar_add_order_item(uuid,uuid,numeric,text)')::oid,
        'EXECUTE'
      )
  end,
  'o overload legado do Bar, quando presente, continua staff-only'
);

select ok(
  not exists (
    select 1
    from (values
      ('public.bar_public_menu(text)'),
      ('public.bar_public_submit_order(text,text,uuid,jsonb,text,text)'),
      ('public.bar_public_claim_access(text,text,text)'),
      ('public.bar_public_submit_card_order(text,jsonb,text)'),
      ('public.bar_public_card_order_status(text)'),
      ('public.bar_public_card_request_service(text,text,text)'),
      ('public.bar_public_order_status(text,text)'),
      ('public.bar_public_request_service(text,text,text,text,text)'),
      ('public.tournament_public_snapshot(text)')
    ) as public_rpc(function_signature)
    where not has_function_privilege('anon', public_rpc.function_signature, 'EXECUTE')
       or not has_function_privilege('authenticated', public_rpc.function_signature, 'EXECUTE')
  ),
  'as RPCs públicas por capacidade permanecem disponíveis sem login'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.tournament_public_registration_status(uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.tournament_public_registration_status(uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.tournament_public_registration_status(uuid)',
    'EXECUTE'
  ),
  'o acompanhamento legado do torneio não contorna a Edge Function protegida'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.bar_add_order_item(uuid,uuid,numeric,text,text)',
    'EXECUTE'
  )
    and has_function_privilege(
      'authenticated',
      'public.bar_add_order_item(uuid,uuid,numeric,text,text)',
      'EXECUTE'
    ),
  'a RPC atual de inclusão no Bar permanece restrita à equipe autenticada'
);

select ok(
  not has_function_privilege(
    'anon',
    'private.get_my_family_summary_impl(uuid)',
    'EXECUTE'
  )
    and has_function_privilege(
      'authenticated',
      'private.get_my_family_summary_impl(uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'private.confirm_family_member_details_impl(uuid,date,text,text,boolean)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'private.confirm_family_member_details_impl(uuid,date,text,text,boolean)',
      'EXECUTE'
    ),
  'helpers privados preservam os grants exigidos pelos wrappers SECURITY INVOKER'
);

select * from finish();

rollback;
