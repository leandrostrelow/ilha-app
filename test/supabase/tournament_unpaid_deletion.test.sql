begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

select ok(
  not has_function_privilege('anon', 'public.delete_unpaid_tournament_registration(uuid,uuid,text,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.delete_unpaid_tournament_registration(uuid,uuid,text,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.delete_unpaid_tournament_registration(uuid,uuid,text,uuid)', 'EXECUTE'),
  'a finalização da exclusão é exclusiva do backend service_role'
);

insert into public.tournament_athletes (id, source_key, full_name)
values
  ('73000000-0000-4000-8000-000000000001'::uuid, 'public:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Pendente removível sintético'),
  ('73000000-0000-4000-8000-000000000002'::uuid, 'public:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'Pendente divergente sintético'),
  ('73000000-0000-4000-8000-000000000003'::uuid, 'public:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'Pago protegido sintético');

insert into public.tournament_registrations (
  id, tournament_id, category_id, athlete_id, public_name,
  status, payment_status, total_amount, paid_amount, source, confirmed_at
)
select
  fixture.registration_id,
  tournament.id,
  category.id,
  fixture.athlete_id,
  fixture.public_name,
  fixture.registration_status,
  fixture.payment_status,
  100,
  fixture.paid_amount,
  'PUBLIC',
  fixture.confirmed_at
from public.tournaments as tournament
join lateral (
  select id from public.tournament_categories
  where tournament_id = tournament.id
  order by sort_order, id
  limit 1
) as category on true
cross join (values
  ('73000000-0000-4000-8000-000000000011'::uuid, '73000000-0000-4000-8000-000000000001'::uuid, 'Pendente removível sintético', 'PENDING', 'PENDING', 0::numeric, null::timestamptz),
  ('73000000-0000-4000-8000-000000000012'::uuid, '73000000-0000-4000-8000-000000000002'::uuid, 'Pendente divergente sintético', 'PENDING', 'PENDING', 0::numeric, null::timestamptz),
  ('73000000-0000-4000-8000-000000000013'::uuid, '73000000-0000-4000-8000-000000000003'::uuid, 'Pago protegido sintético', 'CONFIRMED', 'PAID', 100::numeric, now())
) as fixture(registration_id, athlete_id, public_name, registration_status, payment_status, paid_amount, confirmed_at)
where tournament.slug = 'ilha-open-2026-teste';

insert into public.tournament_payments (
  id, tournament_id, registration_id, provider, provider_environment,
  provider_payment_id, external_reference, billing_type, status, amount, paid_at
)
select
  fixture.payment_id,
  registration.tournament_id,
  registration.id,
  'ASAAS',
  'SANDBOX',
  fixture.provider_payment_id,
  fixture.external_reference,
  'PIX',
  fixture.payment_status,
  100,
  fixture.paid_at
from (values
  ('73000000-0000-4000-8000-000000000021'::uuid, '73000000-0000-4000-8000-000000000011'::uuid, 'pay_ci_unpaid_delete', 'ci:unpaid-delete', 'PENDING', null::timestamptz),
  ('73000000-0000-4000-8000-000000000022'::uuid, '73000000-0000-4000-8000-000000000012'::uuid, 'pay_ci_unpaid_mismatch', 'ci:unpaid-mismatch', 'PENDING', null::timestamptz),
  ('73000000-0000-4000-8000-000000000023'::uuid, '73000000-0000-4000-8000-000000000013'::uuid, 'pay_ci_paid_protected', 'ci:paid-protected', 'RECEIVED', now())
) as fixture(payment_id, registration_id, provider_payment_id, external_reference, payment_status, paid_at)
join public.tournament_registrations as registration on registration.id = fixture.registration_id;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);

select throws_ok(
  $$select public.delete_unpaid_tournament_registration(
    (select id from public.tournaments where slug = 'ilha-open-2026-teste'),
    '73000000-0000-4000-8000-000000000021'::uuid,
    'pay_ci_unpaid_delete',
    '10000000-0000-4000-8000-000000000001'::uuid
  )$$,
  '42501',
  'Acesso negado.',
  'cliente autenticado não executa a exclusão diretamente'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select throws_ok(
  $$select public.delete_unpaid_tournament_registration(
    (select id from public.tournaments where slug = 'ilha-open-2026-teste'),
    '73000000-0000-4000-8000-000000000022'::uuid,
    'pay_outro',
    '10000000-0000-4000-8000-000000000001'::uuid
  )$$,
  'P0001',
  'A cobrança mudou durante a exclusão. Atualize a página e confira novamente.',
  'divergência do identificador do provedor bloqueia a exclusão'
);

select ok(
  exists(select 1 from public.tournament_payments where id = '73000000-0000-4000-8000-000000000022'::uuid),
  'divergência preserva a cobrança local'
);

select ok(
  (public.delete_unpaid_tournament_registration(
    (select id from public.tournaments where slug = 'ilha-open-2026-teste'),
    '73000000-0000-4000-8000-000000000021'::uuid,
    'pay_ci_unpaid_delete',
    '10000000-0000-4000-8000-000000000001'::uuid
  ) ->> 'deleted')::boolean,
  'uma tentativa pendente validada é removida'
);

select ok(
  not exists(select 1 from public.tournament_payments where id = '73000000-0000-4000-8000-000000000021'::uuid),
  'a cobrança pendente removida não permanece ativa'
);

select ok(
  not exists(select 1 from public.tournament_registrations where id = '73000000-0000-4000-8000-000000000011'::uuid),
  'a inscrição pendente removida não ocupa vaga'
);

select ok(
  exists(
    select 1 from private.tournament_expired_registration_attempts
    where payment_id = '73000000-0000-4000-8000-000000000021'::uuid
      and cleanup_reason = 'ADMIN_UNPAID_DELETE'
      and cleaned_by = '10000000-0000-4000-8000-000000000001'::uuid
  ),
  'a exclusão conserva snapshot e autor para auditoria'
);

select ok(
  not exists(select 1 from public.tournament_athletes where id = '73000000-0000-4000-8000-000000000001'::uuid),
  'o atleta público órfão é removido e o CPF pode ser reutilizado'
);

select throws_ok(
  $$select public.delete_unpaid_tournament_registration(
    (select id from public.tournaments where slug = 'ilha-open-2026-teste'),
    '73000000-0000-4000-8000-000000000023'::uuid,
    'pay_ci_paid_protected',
    '10000000-0000-4000-8000-000000000001'::uuid
  )$$,
  'P0001',
  'Esta inscrição possui pagamento confirmado ou protegido e não pode ser excluída.',
  'pagamento recebido nunca pode ser excluído'
);

select ok(
  exists(select 1 from public.tournament_payments where id = '73000000-0000-4000-8000-000000000023'::uuid),
  'a cobrança paga continua registrada'
);

select ok(
  exists(
    select 1 from public.tournament_registrations
    where id = '73000000-0000-4000-8000-000000000013'::uuid
      and status = 'CONFIRMED'
      and payment_status = 'PAID'
      and paid_amount = 100
  ),
  'a inscrição paga continua confirmada'
);

select ok(
  exists(select 1 from public.tournament_athletes where id = '73000000-0000-4000-8000-000000000003'::uuid),
  'o atleta pago permanece intacto'
);

select * from finish();

rollback;
