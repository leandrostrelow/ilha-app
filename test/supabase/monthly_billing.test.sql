begin;

create extension if not exists pgtap with schema extensions;

select plan(79);

select has_table('public', 'app_invoice_provider_payments', 'há snapshot privado 1:1 da cobrança mensal');
select has_table('public', 'app_payment_customers', 'há mapeamento privado de customer por ambiente');
select has_table('public', 'app_monthly_billing_runs', 'há auditoria privada das execuções mensais');
select has_table('public', 'app_monthly_billing_settings', 'há feature flag privada do financeiro mensal');
select has_table('public', 'app_monthly_billing_settings_audit', 'há auditoria privada das alterações de configuração');

select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class where oid = 'public.app_invoice_provider_payments'::regclass),
  'provider payments usa RLS forçada'
);
select ok(
  not has_table_privilege('anon', 'public.app_invoice_provider_payments', 'SELECT')
    and not has_table_privilege('authenticated', 'public.app_invoice_provider_payments', 'SELECT')
    and has_table_privilege('service_role', 'public.app_invoice_provider_payments', 'SELECT'),
  'somente service_role alcança o snapshot do provedor'
);
select ok(
  not has_table_privilege('anon', 'public.app_payment_customers', 'SELECT')
    and not has_table_privilege('authenticated', 'public.app_payment_customers', 'SELECT'),
  'customer Asaas não é exposto à Data API pública'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.apply_app_invoice_payment_reconciliation(text,text,text,text,numeric,timestamptz,text,jsonb)',
    'EXECUTE'
  ) and has_function_privilege(
    'service_role',
    'public.apply_app_invoice_payment_reconciliation(text,text,text,text,numeric,timestamptz,text,jsonb)',
    'EXECUTE'
  ),
  'reconciliação mensal é exclusiva do service_role'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.generate_app_monthly_pix_billing(date,uuid,text)',
    'EXECUTE'
  ) and has_function_privilege(
    'service_role',
    'public.generate_app_monthly_pix_billing(date,uuid,text)',
    'EXECUTE'
  ),
  'geração mensal só pode ser invocada pela Edge com service_role'
);
select is(
  (select enabled from public.app_monthly_billing_settings where singleton),
  false,
  'emissão começa pausada até o preflight de produção'
);
select is(
  public.is_valid_cpf('11111111111'),
  false,
  'CPF sintético com 11 dígitos mas verificadores inválidos é rejeitado no preflight'
);
select lives_ok(
  $$insert into public.app_monthly_billing_runs (
      action, invoice_month, authorization_kind, status
    ) values (
      'SCHEDULED', date '2026-09-01', 'INTERNAL', 'STARTED'
    )$$,
  'auditoria aceita a ação SCHEDULED usada pelo cron interno'
);
select lives_ok(
  $$insert into public.app_monthly_billing_runs (
      action, invoice_month, authorization_kind, status
    ) values (
      'RECONCILE', date '2026-09-01', 'INTERNAL', 'STARTED'
    )$$,
  'auditoria aceita a ação RECONCILE usada pelo polling interno'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"71000000-0000-4000-8000-000000000001","role":"service_role"}',
  true
);

insert into public.app_plans (
  id, code, name, type, amount, weekly_lessons, default_due_day, active
) values (
  '71000000-0000-4000-8000-000000000010'::uuid,
  'ci-monthly-pix',
  'Plano mensal Pix CI',
  'aluno',
  100,
  2,
  31,
  true
);

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values
  (
    '71000000-0000-4000-8000-000000000001'::uuid,
    'monthly-one@tests.invalid',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"app_context":"public"}'::jsonb
  ),
  (
    '71000000-0000-4000-8000-000000000002'::uuid,
    'monthly-payer@tests.invalid',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"app_context":"public"}'::jsonb
  ),
  (
    '71000000-0000-4000-8000-000000000003'::uuid,
    'monthly-dependent@tests.invalid',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"app_context":"public"}'::jsonb
  );

insert into public.app_clients (
  id, full_name, email, phone, cpf, official_plan_id, official_plan_code,
  official_plan_name, plan_amount, weekly_lessons, due_day, status,
  client_type, registration_completed_at, email_verified_at
) values
  (
    '71000000-0000-4000-8000-000000000001'::uuid,
    'Cliente Mensal Sintético',
    'monthly-one@tests.invalid',
    '27999990001',
    '11144477735',
    '71000000-0000-4000-8000-000000000010'::uuid,
    'ci-monthly-pix',
    'Plano mensal Pix CI',
    100,
    2,
    31,
    'ATIVO',
    'aluno',
    now(),
    now()
  ),
  (
    '71000000-0000-4000-8000-000000000002'::uuid,
    'Responsável Familiar Sintético',
    'monthly-payer@tests.invalid',
    '27999990002',
    '52998224725',
    '71000000-0000-4000-8000-000000000010'::uuid,
    'ci-monthly-pix',
    'Plano mensal Pix CI',
    100,
    2,
    31,
    'ATIVO',
    'responsavel',
    now(),
    now()
  ),
  (
    '71000000-0000-4000-8000-000000000003'::uuid,
    'Dependente Familiar Sintético',
    'monthly-dependent@tests.invalid',
    '27999990003',
    '12345678909',
    '71000000-0000-4000-8000-000000000010'::uuid,
    'ci-monthly-pix',
    'Plano mensal Pix CI',
    100,
    2,
    31,
    'ATIVO',
    'aluno',
    now(),
    now()
  );

insert into public.app_family_members (
  id, billing_responsible_id, member_client_id, full_name, relationship,
  cpf, contact_responsible_name, monthly_amount, status, reviewed_at,
  responsible_confirmation_required, responsible_confirmed_at
) values
  (
    '71000000-0000-4000-8000-000000000020'::uuid,
    '71000000-0000-4000-8000-000000000002'::uuid,
    '71000000-0000-4000-8000-000000000003'::uuid,
    'Dependente Familiar Sintético',
    'filho',
    '12345678909',
    'Responsável Familiar Sintético',
    50,
    'ATIVO',
    now(),
    false,
    now()
  ),
  (
    '71000000-0000-4000-8000-000000000021'::uuid,
    '71000000-0000-4000-8000-000000000002'::uuid,
    null,
    'Membro Sem Valor Sintético',
    'filho',
    '39053344705',
    'Responsável Familiar Sintético',
    null,
    'ATIVO',
    now(),
    false,
    now()
  );

select lives_ok(
  $$select public.generate_app_monthly_pix_billing(date '2026-09-01', null, 'SANDBOX')$$,
  'a geração mensal sintética conclui sem chamar o provedor'
);

select is(
  (select count(*)::integer from public.app_payment_invoices
    where invoice_month = date '2026-09-01'
      and client_id in (
        '71000000-0000-4000-8000-000000000001'::uuid,
        '71000000-0000-4000-8000-000000000002'::uuid,
        '71000000-0000-4000-8000-000000000003'::uuid
      )),
  2,
  'gera individual e responsável, nunca uma fatura do dependente'
);
select is(
  (select count(*)::integer from public.app_payment_invoices
    where invoice_month = date '2026-09-01'
      and client_id = '71000000-0000-4000-8000-000000000003'::uuid),
  0,
  'dependente ativo não recebe cobrança própria'
);
select is(
  (select amount from public.app_payment_invoices
    where invoice_month = date '2026-09-01'
      and client_id = '71000000-0000-4000-8000-000000000002'::uuid),
  150.00::numeric,
  'responsável soma membro com valor e normaliza componente opcional NULL para zero'
);
select is(
  (select due_date from public.app_payment_invoices
    where invoice_month = date '2026-09-01'
      and client_id = '71000000-0000-4000-8000-000000000001'::uuid),
  date '2026-09-30',
  'vencimento 31 é limitado ao último dia da competência'
);
select is(
  (select sum(item.amount) from public.app_family_invoice_items as item
    join public.app_payment_invoices as invoice on invoice.id = item.invoice_id
    where invoice.client_id = '71000000-0000-4000-8000-000000000002'::uuid
      and invoice.invoice_month = date '2026-09-01'),
  150.00::numeric,
  'snapshot dos itens familiares fecha com o total da fatura'
);
select is(
  (select count(*)::integer from public.app_family_invoice_items as item
    join public.app_payment_invoices as invoice on invoice.id = item.invoice_id
    where invoice.client_id = '71000000-0000-4000-8000-000000000002'::uuid
      and invoice.invoice_month = date '2026-09-01'
      and item.family_member_id = '71000000-0000-4000-8000-000000000021'::uuid
      and item.amount = 0),
  1,
  'membro ativo confirmado com monthly_amount NULL entra no snapshot como zero'
);
select is(
  (select count(*)::integer from public.app_invoice_provider_payments as payment
    join public.app_payment_invoices as invoice on invoice.id = payment.invoice_id
    where invoice.invoice_month = date '2026-09-01'
      and invoice.client_id in (
        '71000000-0000-4000-8000-000000000001'::uuid,
        '71000000-0000-4000-8000-000000000002'::uuid,
        '71000000-0000-4000-8000-000000000003'::uuid
      )),
  2,
  'cada fatura tem exatamente um snapshot de provider payment'
);
select is(
  (select count(*)::integer from public.financial_transactions as ledger
    join public.app_payment_invoices as invoice
      on invoice.id = ledger.app_payment_invoice_id
    where invoice.invoice_month = date '2026-09-01'
      and invoice.client_id in (
        '71000000-0000-4000-8000-000000000001'::uuid,
        '71000000-0000-4000-8000-000000000002'::uuid
      )),
  2,
  'cada fatura gerada cria um único lançamento de receita no razão do ADM'
);

select lives_ok(
  $$select public.generate_app_monthly_pix_billing(date '2026-09-01', null, 'SANDBOX')$$,
  'repetir a geração é idempotente'
);
select is(
  (select count(*)::integer from public.app_invoice_provider_payments as payment
    join public.app_payment_invoices as invoice on invoice.id = payment.invoice_id
    where invoice.invoice_month = date '2026-09-01'
      and invoice.client_id in (
        '71000000-0000-4000-8000-000000000001'::uuid,
        '71000000-0000-4000-8000-000000000002'::uuid
      )),
  2,
  'segunda geração não duplica cobrança local'
);
select is(
  (select count(*)::integer from public.financial_transactions as ledger
    join public.app_payment_invoices as invoice
      on invoice.id = ledger.app_payment_invoice_id
    where invoice.invoice_month = date '2026-09-01'
      and invoice.client_id in (
        '71000000-0000-4000-8000-000000000001'::uuid,
        '71000000-0000-4000-8000-000000000002'::uuid
      )),
  2,
  'segunda geração também não duplica o lançamento do razão'
);

select is(
  public.claim_app_payment_customer_resolution(
    '71000000-0000-4000-8000-000000000001'::uuid,
    'SANDBOX',
    'ilha-monthly-customer:71000000-0000-4000-8000-000000000001',
    repeat('a', 64)
  ) ->> 'claimed',
  'true',
  'primeira execução adquire lease exclusivo para resolver o customer Asaas'
);
select is(
  public.claim_app_payment_customer_resolution(
    '71000000-0000-4000-8000-000000000001'::uuid,
    'SANDBOX',
    'ilha-monthly-customer:71000000-0000-4000-8000-000000000001',
    repeat('a', 64)
  ) ->> 'status',
  'RESOLVING',
  'execução concorrente não recebe lease nem cria customer duplicado'
);
select lives_ok(
  $$select public.mark_app_payment_customer_create_attempt(
      '71000000-0000-4000-8000-000000000001'::uuid,
      'SANDBOX',
      (select resolution_token from public.app_payment_customers
        where client_id = '71000000-0000-4000-8000-000000000001'::uuid
          and provider_environment = 'SANDBOX')
    )$$,
  'tentativa de POST do customer é registrada antes da chamada remota'
);
update public.app_payment_customers
   set resolution_started_at = now() - interval '4 minutes'
 where client_id = '71000000-0000-4000-8000-000000000001'::uuid
   and provider_environment = 'SANDBOX';
select is(
  public.claim_app_payment_customer_resolution(
    '71000000-0000-4000-8000-000000000001'::uuid,
    'SANDBOX',
    'ilha-monthly-customer:71000000-0000-4000-8000-000000000001',
    repeat('a', 64)
  ) ->> 'status',
  'REVIEW_REQUIRED',
  'resultado remoto ambíguo vira revisão e nunca repete POST de customer'
);

update public.app_clients
   set status = 'INATIVO'
 where id = '71000000-0000-4000-8000-000000000001'::uuid;
select is(
  (select state
     from private.monthly_billing_candidates(
       date '2026-09-01',
       '71000000-0000-4000-8000-000000000001'::uuid
     )),
  'READY',
  'fatura emitida continua visível pelo snapshot mesmo após mudança cadastral'
);
update public.app_clients
   set status = 'ATIVO'
 where id = '71000000-0000-4000-8000-000000000001'::uuid;

select public.fail_app_invoice_provider_dispatch(
  (
    select id from public.app_payment_invoices
     where client_id = '71000000-0000-4000-8000-000000000002'::uuid
       and invoice_month = date '2026-09-01'
  ),
  'Falha sintética sem dado pessoal.',
  false
);
select public.fail_app_invoice_provider_dispatch(
  (
    select id from public.app_payment_invoices
     where client_id = '71000000-0000-4000-8000-000000000002'::uuid
       and invoice_month = date '2026-09-01'
  ),
  'Falha sintética sem dado pessoal.',
  false
);
select is(
  (select count(*)::integer
     from public.app_client_notifications
    where dedupe_key = 'monthly-billing-alert:' || (
      select id::text from public.app_payment_invoices
       where client_id = '71000000-0000-4000-8000-000000000002'::uuid
         and invoice_month = date '2026-09-01'
    ) || ':failed:adm:10000000-0000-4000-8000-000000000001'),
  1,
  'falha operacional alerta o ADM uma única vez sem depender da RLS do app'
);

update public.app_invoice_provider_payments
   set status = 'RECONCILING',
       provider_customer_id = 'cus_monthly_ci_2',
       provider_payment_id = 'pay_monthly_ci_2'
 where invoice_id = (
   select id from public.app_payment_invoices
    where client_id = '71000000-0000-4000-8000-000000000002'::uuid
      and invoice_month = date '2026-09-01'
 );
update public.app_payment_invoices
   set status = 'AGUARDANDO',
       provider_status = 'CONFIRMED'
 where client_id = '71000000-0000-4000-8000-000000000002'::uuid
   and invoice_month = date '2026-09-01';

select lives_ok(
  $$select public.complete_app_invoice_provider_dispatch(
      (
        select id from public.app_payment_invoices
         where client_id = '71000000-0000-4000-8000-000000000002'::uuid
           and invoice_month = date '2026-09-01'
      ),
      'SANDBOX',
      'cus_monthly_ci_2',
      'pay_monthly_ci_2',
      'PENDING',
      'ilha-monthly-invoice:' || (
        select id::text from public.app_payment_invoices
         where client_id = '71000000-0000-4000-8000-000000000002'::uuid
           and invoice_month = date '2026-09-01'
      ),
      150,
      'PIX',
      'https://sandbox.invalid/monthly-ci-2',
      'pix-valido-sintetico',
      now() + interval '1 day',
      '{"payment":{"billing_type":"PIX"}}'::jsonb
    )$$,
  'complete de retry aceita atualizar vínculo e QR sem decidir a transição financeira'
);
select is(
  (select payment.status || ':' || invoice.provider_status
     from public.app_invoice_provider_payments as payment
     join public.app_payment_invoices as invoice on invoice.id = payment.invoice_id
    where invoice.client_id = '71000000-0000-4000-8000-000000000002'::uuid
      and invoice.invoice_month = date '2026-09-01'),
  'CONFIRMED:CONFIRMED',
  'complete não rebaixa CONFIRMED para resposta PENDING atrasada'
);
select is(
  (
    public.apply_app_invoice_payment_reconciliation(
      'pay_monthly_ci_2',
      'SANDBOX',
      'PENDING',
      'ilha-monthly-invoice:' || (
        select id::text from public.app_payment_invoices
         where client_id = '71000000-0000-4000-8000-000000000002'::uuid
           and invoice_month = date '2026-09-01'
      ),
      150,
      null,
      'evt_monthly_ci_late_pending',
      '{"payment":{"billing_type":"PIX"}}'::jsonb
    ) ->> 'reason'
  ),
  'STATUS_REGRESSION',
  'reconciliação recusa evento PENDING mais antigo que CONFIRMED'
);

select set_config('ilha.monthly_billing_write', '', true);
select throws_ok(
  $$update public.app_payment_invoices set amount = amount + 1
     where client_id = '71000000-0000-4000-8000-000000000002'::uuid
       and invoice_month = date '2026-09-01'$$,
  '23514',
  'Valor, vencimento e composição ficam congelados após a emissão.',
  'valor da fatura emitida fica congelado'
);
select throws_ok(
  $$update public.app_family_invoice_items set amount = amount + 1
     where invoice_id = (
       select id from public.app_payment_invoices
        where client_id = '71000000-0000-4000-8000-000000000002'::uuid
          and invoice_month = date '2026-09-01'
     )$$,
  '23514',
  'A composição familiar fica congelada após a emissão.',
  'itens familiares emitidos também ficam congelados'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$update public.app_payment_invoices
       set status = 'PAGA', payment_method = 'PIX', paid_at = now()
     where client_id = '71000000-0000-4000-8000-000000000002'::uuid
       and invoice_month = date '2026-09-01'$$,
  '42501',
  'Campos do provedor só podem ser alterados pelo fluxo financeiro.',
  'finance.write não pode forjar baixa manual depois da emissão'
);
select throws_ok(
  $$update public.financial_transactions
       set status = 'RECEBIDO', payment_method = 'PIX', paid_at = now()
     where app_payment_invoice_id = (
       select id from public.app_payment_invoices
        where client_id = '71000000-0000-4000-8000-000000000002'::uuid
          and invoice_month = date '2026-09-01'
     )$$,
  '42501',
  'Lançamento mensal vinculado só pode ser conciliado pelo fluxo financeiro.',
  'finance.write não pode forjar baixa no razão vinculado'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"71000000-0000-4000-8000-000000000001","role":"service_role"}',
  true
);

select is(
  (
    public.apply_app_invoice_payment_reconciliation(
      'pay_monthly_ci_1',
      'SANDBOX',
      'RECEIVED',
      'ilha-monthly-invoice:' || (
        select id::text from public.app_payment_invoices
         where client_id = '71000000-0000-4000-8000-000000000001'::uuid
           and invoice_month = date '2026-09-01'
      ),
      100,
      '2026-09-08T12:00:00-03:00'::timestamptz,
      'evt_monthly_ci_1',
      '{"payment":{"billing_type":"PIX"}}'::jsonb
    ) ->> 'reason'
  ),
  'APPLIED',
  'webhook PIX exato aplica a baixa'
);
select is(
  (select status from public.app_payment_invoices
    where client_id = '71000000-0000-4000-8000-000000000001'::uuid
      and invoice_month = date '2026-09-01'),
  'PAGA',
  'pagamento recebido baixa a fatura automaticamente'
);
select is(
  (select ledger.status || ':' || coalesce(ledger.payment_method, '')
     from public.financial_transactions as ledger
    where ledger.app_payment_invoice_id = (
      select id from public.app_payment_invoices
       where client_id = '71000000-0000-4000-8000-000000000001'::uuid
         and invoice_month = date '2026-09-01'
    )),
  'RECEBIDO:PIX',
  'baixa recebida sincroniza o lançamento de receita do ADM'
);
select is(
  (
    public.apply_app_invoice_payment_reconciliation(
      'pay_monthly_ci_1',
      'SANDBOX',
      'RECEIVED',
      'ilha-monthly-invoice:' || (
        select id::text from public.app_payment_invoices
         where client_id = '71000000-0000-4000-8000-000000000001'::uuid
           and invoice_month = date '2026-09-01'
      ),
      100,
      '2026-09-08T12:00:00-03:00'::timestamptz,
      'evt_monthly_ci_1',
      '{"payment":{"billing_type":"PIX"}}'::jsonb
    ) ->> 'reason'
  ),
  'DUPLICATE_EVENT',
  'reenvio do mesmo evento é idempotente'
);
select is(
  (select count(*)::integer from public.app_client_notifications
    where dedupe_key = 'monthly-invoice-paid:' || (
      select id::text from public.app_payment_invoices
       where client_id = '71000000-0000-4000-8000-000000000001'::uuid
         and invoice_month = date '2026-09-01'
    )),
  1,
  'baixa notifica somente uma vez o responsável da fatura'
);

select is(
  (
    public.fail_app_invoice_provider_dispatch(
      (
        select id from public.app_payment_invoices
         where client_id = '71000000-0000-4000-8000-000000000001'::uuid
           and invoice_month = date '2026-09-01'
      ),
      'Resposta perdida depois da baixa sintética.',
      false
    ) ->> 'reason'
  ),
  'FINANCIAL_STATE_PRESERVED',
  'falha tardia não regride cobrança já recebida'
);
select is(
  (select invoice.status || ':' || payment.status || ':' || ledger.status
     from public.app_payment_invoices as invoice
     join public.app_invoice_provider_payments as payment on payment.invoice_id = invoice.id
     join public.financial_transactions as ledger
       on ledger.app_payment_invoice_id = invoice.id
    where invoice.client_id = '71000000-0000-4000-8000-000000000001'::uuid
      and invoice.invoice_month = date '2026-09-01'),
  'PAGA:RECEIVED:RECEBIDO',
  'fatura, provider e razão permanecem baixados após falha tardia'
);

select is(
  (select count(*)::integer
     from public.claim_app_invoice_provider_dispatch(
       (
         select id from public.app_payment_invoices
          where client_id = '71000000-0000-4000-8000-000000000001'::uuid
            and invoice_month = date '2026-09-01'
       ),
       null,
       1
     )),
  0,
  'retry nunca reclama uma cobrança já recebida'
);

update public.app_invoice_provider_payments
   set status = 'PENDING',
       pix_payload = 'pix-valido-sintetico',
       pix_expires_at = now() + interval '1 day',
       next_reconciliation_at = now() + interval '1 day'
 where invoice_id = (
   select id from public.app_payment_invoices
    where client_id = '71000000-0000-4000-8000-000000000002'::uuid
      and invoice_month = date '2026-09-01'
 );

select is(
  (select allow_provider_create::text
     from public.claim_app_invoice_provider_dispatch(
       (
         select id from public.app_payment_invoices
          where client_id = '71000000-0000-4000-8000-000000000002'::uuid
            and invoice_month = date '2026-09-01'
       ),
       null,
       1
     )),
  'false',
  'retry de cobrança PENDING reconcilia o remoto sem autorizar outro POST'
);
select is(
  public.fail_app_invoice_provider_dispatch(
    (
      select id from public.app_payment_invoices
       where client_id = '71000000-0000-4000-8000-000000000002'::uuid
         and invoice_month = date '2026-09-01'
    ),
    'Cobrança remota não encontrada no polling sintético.',
    false
  ) ->> 'status',
  'FAILED',
  'falha determinística após claim não preserva provider_status antigo indefinidamente'
);
update public.app_invoice_provider_payments
   set status = 'PENDING',
       next_reconciliation_at = now() + interval '1 day'
 where invoice_id = (
   select id from public.app_payment_invoices
    where client_id = '71000000-0000-4000-8000-000000000002'::uuid
      and invoice_month = date '2026-09-01'
 );
select is(
  (select stored_pix_payload
     from public.claim_app_invoice_provider_dispatch(
       (
         select id from public.app_payment_invoices
          where client_id = '71000000-0000-4000-8000-000000000002'::uuid
            and invoice_month = date '2026-09-01'
       ),
       null,
       1,
       false
     )),
  'pix-valido-sintetico',
  'claim explícito devolve Pix válido armazenado para polling sem nova chamada de QR'
);

update public.app_invoice_provider_payments
   set status = 'PENDING',
       pix_payload = 'pix-valido-sintetico',
       pix_expires_at = now() + interval '1 day',
       next_reconciliation_at = now() - interval '1 minute'
 where invoice_id = (
   select id from public.app_payment_invoices
    where client_id = '71000000-0000-4000-8000-000000000002'::uuid
      and invoice_month = date '2026-09-01'
 );
select is(
  (select count(*)::integer
     from public.claim_app_invoice_provider_dispatch(
       null,
       date '2026-09-01',
       1
     )),
  1,
  'reconciliação periódica reclama PENDING vencido mesmo com QR válido'
);

update public.app_invoice_provider_payments
   set status = 'RECONCILING',
       next_reconciliation_at = now() + interval '1 minute'
 where invoice_id = (
   select id from public.app_payment_invoices
    where client_id = '71000000-0000-4000-8000-000000000002'::uuid
      and invoice_month = date '2026-09-01'
 );
select is(
  (select count(*)::integer
     from public.claim_app_invoice_provider_dispatch(null, null, 1, false)),
  0,
  'RECONCILING ainda dentro da lease de três minutos não é reclamado'
);
update public.app_invoice_provider_payments
   set next_reconciliation_at = now() - interval '1 second'
 where invoice_id = (
   select id from public.app_payment_invoices
    where client_id = '71000000-0000-4000-8000-000000000002'::uuid
      and invoice_month = date '2026-09-01'
 );
select is(
  (select allow_provider_create::text
     from public.claim_app_invoice_provider_dispatch(null, null, 1, false)),
  'false',
  'RECONCILING retomado automaticamente nunca autoriza outro POST'
);

update public.app_invoice_provider_payments
   set status = 'FAILED',
       next_reconciliation_at = now() - interval '1 hour'
 where invoice_id = (
   select id from public.app_payment_invoices
    where client_id = '71000000-0000-4000-8000-000000000002'::uuid
      and invoice_month = date '2026-09-01'
 );
select is(
  (select count(*)::integer
     from public.claim_app_invoice_provider_dispatch(null, null, 1, false)),
  0,
  'FAILED nunca é retomado automaticamente pelo cron de reconciliação'
);
select is(
  (select allow_provider_create::text
     from public.claim_app_invoice_provider_dispatch(
       (
         select id from public.app_payment_invoices
          where client_id = '71000000-0000-4000-8000-000000000002'::uuid
            and invoice_month = date '2026-09-01'
       ),
       null,
       1,
       false
     )),
  'true',
  'FAILED só autoriza novo POST no retry explícito do operador'
);

update public.app_invoice_provider_payments
   set status = 'PENDING',
       reconciliation_attempts = 1000,
       next_reconciliation_at = now() - interval '1 second'
 where invoice_id = (
   select id from public.app_payment_invoices
    where client_id = '71000000-0000-4000-8000-000000000002'::uuid
      and invoice_month = date '2026-09-01'
 );
select is(
  (select attempt_number
     from public.claim_app_invoice_provider_dispatch(null, null, 1, false)),
  1001,
  'polling de longa duração não estoura um teto artificial de tentativas'
);

select is(
  (
    public.apply_app_invoice_payment_reconciliation(
      'pay_monthly_ci_2',
      'SANDBOX',
      'RECEIVED',
      'ilha-monthly-invoice:' || (
        select id::text from public.app_payment_invoices
         where client_id = '71000000-0000-4000-8000-000000000002'::uuid
           and invoice_month = date '2026-09-01'
      ),
      150,
      now(),
      'evt_monthly_ci_wrong_type',
      '{"payment":{"billing_type":"BOLETO"}}'::jsonb
    ) ->> 'reason'
  ),
  'PAYMENT_MISMATCH',
  'boleto/cartão nunca baixa uma fatura configurada como PIX'
);
select is(
  (select provider_status from public.app_payment_invoices
    where client_id = '71000000-0000-4000-8000-000000000002'::uuid
      and invoice_month = date '2026-09-01'),
  'REVIEW_REQUIRED',
  'divergência do provider fica visível sem expor identificadores'
);
select is(
  (select state
     from private.monthly_billing_candidates(
       date '2026-09-01',
       '71000000-0000-4000-8000-000000000002'::uuid
     )),
  'FAILED',
  'review/refund/chargeback aparecem como revisão financeira, nunca como cobrança verde'
);
select is(
  (select count(*)::integer
     from public.app_client_notifications
    where dedupe_key = 'monthly-billing-alert:' || (
      select id::text from public.app_payment_invoices
       where client_id = '71000000-0000-4000-8000-000000000002'::uuid
         and invoice_month = date '2026-09-01'
    ) || ':review_required:adm:10000000-0000-4000-8000-000000000001'),
  1,
  'divergência cria alerta ADM deduplicado para revisão financeira'
);

update public.app_payment_invoices
   set status = 'PAGA'
 where client_id = '71000000-0000-4000-8000-000000000002'::uuid
   and invoice_month = date '2026-09-01';
select is(
  (select state
     from private.monthly_billing_candidates(
       date '2026-09-01',
       '71000000-0000-4000-8000-000000000002'::uuid
     )),
  'FAILED',
  'REVIEW_REQUIRED prevalece sobre PAGA para nunca mascarar uma divergência'
);
update public.app_payment_invoices
   set status = 'AGUARDANDO'
 where client_id = '71000000-0000-4000-8000-000000000002'::uuid
   and invoice_month = date '2026-09-01';

update public.app_clients
   set official_plan_code = 'isento',
       official_plan_name = 'Plano isento familiar',
       plan_amount = 0
 where id = '71000000-0000-4000-8000-000000000002'::uuid;

select lives_ok(
  $$select public.generate_app_monthly_pix_billing(
      date '2026-10-01',
      '71000000-0000-4000-8000-000000000002'::uuid,
      'SANDBOX'
    )$$,
  'responsável isento continua elegível quando há membro familiar faturável'
);
select is(
  (select amount from public.app_payment_invoices
    where client_id = '71000000-0000-4000-8000-000000000002'::uuid
      and invoice_month = date '2026-10-01'),
  50.00::numeric,
  'plano base zero não apaga o valor dos membros ativos confirmados'
);

insert into public.app_family_members (
  id, billing_responsible_id, member_client_id, full_name, relationship,
  contact_responsible_name, monthly_amount, status, reviewed_at,
  responsible_confirmation_required, responsible_confirmed_at
) values (
  '71000000-0000-4000-8000-000000000022'::uuid,
  '71000000-0000-4000-8000-000000000002'::uuid,
  null,
  'Membro Aguardando Confirmação Sintético',
  'filho',
  'Responsável Familiar Sintético',
  25,
  'ATIVO',
  now(),
  true,
  null
);
select is(
  (select reason
     from private.monthly_billing_candidates(
       date '2026-11-01',
       '71000000-0000-4000-8000-000000000002'::uuid
     )),
  'FAMILY_MEMBER_CONFIRMATION_PENDING',
  'um membro ativo sem confirmação bloqueia toda a composição familiar'
);
select lives_ok(
  $$select public.generate_app_monthly_pix_billing(
      date '2026-11-01',
      '71000000-0000-4000-8000-000000000002'::uuid,
      'SANDBOX'
    )$$,
  'geração fail-closed apenas ignora a família ainda não confirmada'
);
select is(
  (select count(*)::integer from public.app_payment_invoices
    where client_id = '71000000-0000-4000-8000-000000000002'::uuid
      and invoice_month = date '2026-11-01'),
  0,
  'nenhuma fatura parcial é emitida enquanto há confirmação familiar pendente'
);

insert into public.app_payment_invoices (
  client_id, invoice_month, amount, due_date
) values (
  '71000000-0000-4000-8000-000000000001'::uuid,
  date '2026-12-01',
  100,
  date '2026-12-31'
);
update public.app_clients
   set status = 'INATIVO'
 where id = '71000000-0000-4000-8000-000000000001'::uuid;
select is(
  (select state
     from private.monthly_billing_candidates(
       date '2026-12-01',
       '71000000-0000-4000-8000-000000000001'::uuid
     )),
  'SKIPPED',
  'rascunho local sem provider revalida elegibilidade antes de emitir no Asaas'
);
update public.app_clients
   set status = 'ATIVO'
 where id = '71000000-0000-4000-8000-000000000001'::uuid;

update public.app_payment_invoices
   set amount = 90
 where client_id = '71000000-0000-4000-8000-000000000001'::uuid
   and invoice_month = date '2026-12-01';
select is(
  (select reason
     from private.monthly_billing_candidates(
       date '2026-12-01',
       '71000000-0000-4000-8000-000000000001'::uuid
     )),
  'DRAFT_SNAPSHOT_MISMATCH',
  'rascunho local divergente não pode ganhar cobrança Asaas obsoleta'
);
select lives_ok(
  $$select public.generate_app_monthly_pix_billing(
      date '2026-12-01',
      '71000000-0000-4000-8000-000000000001'::uuid,
      'SANDBOX'
    )$$,
  'rascunho divergente é ignorado sem erro global'
);
select is(
  (select count(*)::integer from public.app_invoice_provider_payments
    where invoice_id = (
      select id from public.app_payment_invoices
       where client_id = '71000000-0000-4000-8000-000000000001'::uuid
         and invoice_month = date '2026-12-01'
    )),
  0,
  'rascunho divergente permanece sem provider payment'
);

insert into public.app_payment_invoices (
  client_id, invoice_month, description, amount, due_date
) values (
  '71000000-0000-4000-8000-000000000001'::uuid,
  date '2027-01-01',
  'Mensalidade Ilha Tênis',
  100,
  date '2027-01-31'
);
insert into public.financial_transactions (
  counterparty, description, category, type, amount, due_date, status, paid_at
) values (
  'Cliente Mensal Sintético',
  'Mensalidade Ilha Tênis',
  'Mensalidade',
  'RECEITA',
  100,
  date '2027-01-31',
  'RECEBIDO',
  now()
);
update public.app_family_members
   set responsible_confirmed_at = coalesce(responsible_confirmed_at, now())
 where billing_responsible_id = '71000000-0000-4000-8000-000000000002'::uuid
   and status = 'ATIVO';
select lives_ok(
  $$select public.generate_app_monthly_pix_billing(
      date '2027-01-01',
      null,
      'SANDBOX'
    )$$,
  'conflito legado de um cliente não interrompe o restante do lote'
);
select is(
  (select provider_status from public.app_payment_invoices
    where client_id = '71000000-0000-4000-8000-000000000001'::uuid
      and invoice_month = date '2027-01-01'),
  'REVIEW_REQUIRED',
  'lançamento legado encerrado isola somente a fatura conflitante para revisão'
);
select is(
  (select count(*)::integer from public.app_invoice_provider_payments as payment
    join public.app_payment_invoices as invoice on invoice.id = payment.invoice_id
    where invoice.client_id = '71000000-0000-4000-8000-000000000001'::uuid
      and invoice.invoice_month = date '2027-01-01'),
  0,
  'fatura com conflito no razão não chega à fila do Asaas'
);
select is(
  (select count(*)::integer from public.app_invoice_provider_payments as payment
    join public.app_payment_invoices as invoice on invoice.id = payment.invoice_id
    where invoice.client_id = '71000000-0000-4000-8000-000000000002'::uuid
      and invoice.invoice_month = date '2027-01-01'),
  1,
  'outro responsável elegível do lote continua até READY'
);

select is(
  (select reason from private.monthly_billing_candidates(
    date '2020-01-01',
    '71000000-0000-4000-8000-000000000001'::uuid
  )),
  'DUE_DATE_IN_PAST',
  'competência passada sem provider nunca é enviada retroativamente ao Asaas'
);

select lives_ok(
  $$select public.admin_set_app_monthly_billing_settings(false, 5, 12)$$,
  'service_role altera configuração mensal pelo RPC auditável'
);
select is(
  (select generation_day::text || ':' || max_batch_size::text
     from public.app_monthly_billing_settings where singleton),
  '5:12',
  'configuração operacional persiste dia e lote validados'
);
select is(
  (select count(*)::integer from public.app_monthly_billing_settings_audit),
  1,
  'alteração operacional gera uma linha de auditoria'
);

select throws_ok(
  $$insert into public.app_payment_invoices (
      client_id, invoice_month, amount, due_date
    ) values (
      '71000000-0000-4000-8000-000000000001'::uuid,
      date '2026-10-15',
      100,
      date '2026-10-31'
    )$$,
  '23514',
  null,
  'nova fatura exige competência no primeiro dia do mês'
);

select * from finish();
rollback;
