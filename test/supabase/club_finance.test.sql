begin;

create extension if not exists pgtap with schema extensions;

select plan(81);

-- Contrato estrutural e superfície exposta à API.
select has_table(
  'public',
  'financial_recurring_rules',
  'regras recorrentes do financeiro existem'
);

select has_table(
  'private',
  'financial_activity_audit',
  'auditoria financeira fica no schema privado'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'financial_recurring_rules'
      and relation.relrowsecurity
  ),
  'RLS está habilitado nas regras recorrentes'
);

select ok(
  not has_table_privilege('anon', 'public.financial_recurring_rules', 'SELECT')
    and has_table_privilege('authenticated', 'public.financial_recurring_rules', 'SELECT')
    and not has_table_privilege('authenticated', 'public.financial_recurring_rules', 'INSERT')
    and not has_table_privilege('authenticated', 'public.financial_recurring_rules', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.financial_recurring_rules', 'DELETE')
    and has_table_privilege('service_role', 'public.financial_recurring_rules', 'SELECT')
    and not has_table_privilege('service_role', 'public.financial_recurring_rules', 'INSERT')
    and not has_table_privilege('service_role', 'public.financial_recurring_rules', 'UPDATE')
    and not has_table_privilege('service_role', 'public.financial_recurring_rules', 'DELETE'),
  'regras são somente leitura direta para authenticated e invisíveis para anon'
);

select ok(
  not has_table_privilege('authenticated', 'public.financial_transactions', 'INSERT')
    and not has_table_privilege('authenticated', 'public.financial_transactions', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.financial_transactions', 'DELETE'),
  'lançamentos só podem ser alterados pelas RPCs auditadas'
);

select ok(
  not has_table_privilege('anon', 'private.financial_activity_audit', 'SELECT')
    and not has_table_privilege('authenticated', 'private.financial_activity_audit', 'SELECT')
    and has_table_privilege('service_role', 'private.financial_activity_audit', 'SELECT')
    and has_table_privilege('service_role', 'private.financial_activity_audit', 'INSERT')
    and not has_table_privilege('service_role', 'private.financial_activity_audit', 'UPDATE')
    and not has_table_privilege('service_role', 'private.financial_activity_audit', 'DELETE'),
  'auditoria é append-only e reservada ao serviço'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.admin_save_financial_transaction(uuid,text,text,text,text,text,numeric,date,text,text,text)',
    'EXECUTE'
  )
    and has_function_privilege(
      'authenticated',
      'public.admin_save_financial_transaction(uuid,text,text,text,text,text,numeric,date,text,text,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'public.admin_save_financial_transaction(uuid,text,text,text,text,text,numeric,date,text,text,text)',
      'EXECUTE'
    ),
  'RPC de lançamento só é alcançável por authenticated e revalida finance.write'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.admin_save_financial_recurring_rule(uuid,text,text,text,text,text,numeric,integer,text,text,date,date,text,integer,boolean)',
    'EXECUTE'
  )
    and has_function_privilege(
      'authenticated',
      'public.admin_save_financial_recurring_rule(uuid,text,text,text,text,text,numeric,integer,text,text,date,date,text,integer,boolean)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.admin_set_financial_recurring_rule_active(uuid,boolean,integer)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.admin_archive_financial_recurring_rule(uuid,integer)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.admin_generate_financial_recurring_transactions(date,uuid)',
      'EXECUTE'
    ),
  'RPCs de recorrência são expostas somente ao papel autenticado'
);

select ok(
  not has_function_privilege(
    'anon',
    'private.generate_financial_recurring_transactions_internal(date,uuid,uuid,text)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'authenticated',
      'private.generate_financial_recurring_transactions_internal(date,uuid,uuid,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'private.generate_financial_recurring_transactions_internal(date,uuid,uuid,text)',
      'EXECUTE'
    ),
  'gerador interno não é chamável pelos papéis da API'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'financial_transactions'
      and indexname = 'financial_transactions_recurring_competence_uidx'
      and indexdef ilike '%unique%'
      and indexdef ilike '%recurring_rule_id%'
      and indexdef ilike '%competence_month%'
  ),
  'índice único protege regra e competência contra duplicação'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.financial_transactions'::regclass
      and constraint_row.conname = 'financial_transactions_provider_shape_check'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) ilike '%ledger_origin%RECURRENCE%app_payment_invoice_id IS NULL%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) ilike '%ledger_origin%APP_MONTHLY_INVOICE%recurring_rule_id IS NULL%'
  ),
  'constraint impede uma ocorrência de pertencer ao mesmo tempo à recorrência e à fatura mensal'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'private.ensure_app_invoice_financial_transaction(uuid)'::regprocedure
  ) like '%ledger.ledger_origin = ''LEGACY''%',
  'matcher mensal só pode adotar lançamento explicitamente marcado como legado'
);

-- O teste não depende do seed especial da CI: a identidade administrativa é
-- sintética, criada dentro desta transação e descartada pelo rollback final.
insert into auth.users (
  id,
  email,
  raw_app_meta_data,
  raw_user_meta_data
) values (
  '10000000-0000-4000-8000-000000000001'::uuid,
  'ci-protected-admin@tests.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"app_context":"admin","full_name":"Administrador sintético da CI"}'::jsonb
)
on conflict (id) do update
set email = excluded.email,
    raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data;

insert into public.profiles (
  id,
  full_name,
  email,
  role,
  permissions,
  active
) values (
  '10000000-0000-4000-8000-000000000001'::uuid,
  'Administrador sintético da CI',
  'ci-protected-admin@tests.invalid',
  'admin',
  '[]'::jsonb,
  true
)
on conflict (id) do update
set full_name = excluded.full_name,
    email = excluded.email,
    role = excluded.role,
    permissions = excluded.permissions,
    active = true,
    updated_at = now();

insert into public.protected_access_accounts (
  email,
  full_name,
  role,
  permissions,
  active
) values (
  'ci-protected-admin@tests.invalid',
  'Administrador sintético da CI',
  'admin',
  '[]'::jsonb,
  true
)
on conflict (email) do update
set full_name = excluded.full_name,
    role = excluded.role,
    permissions = excluded.permissions,
    active = true,
    updated_at = now();

-- Usuário sintético com leitura financeira, mas sem escrita.
insert into auth.users (
  id,
  email,
  raw_app_meta_data,
  raw_user_meta_data
)
values (
  '73000000-0000-4000-8000-000000000001'::uuid,
  'ci-club-finance-reader@tests.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"app_context":"admin","full_name":"Leitor financeiro sintético"}'::jsonb
)
on conflict (id) do update
set email = excluded.email,
    raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data;

insert into public.profiles (
  id,
  full_name,
  email,
  role,
  permissions,
  active
)
values (
  '73000000-0000-4000-8000-000000000001'::uuid,
  'Leitor financeiro sintético',
  'ci-club-finance-reader@tests.invalid',
  'secretaria',
  '["finance.read"]'::jsonb,
  true
)
on conflict (id) do update
set full_name = excluded.full_name,
    email = excluded.email,
    role = excluded.role,
    permissions = excluded.permissions,
    active = true,
    updated_at = now();

insert into public.protected_access_accounts (
  email,
  full_name,
  role,
  permissions,
  active
)
values (
  'ci-club-finance-reader@tests.invalid',
  'Leitor financeiro sintético',
  'secretaria',
  '["finance.read"]'::jsonb,
  true
)
on conflict (email) do update
set full_name = excluded.full_name,
    role = excluded.role,
    permissions = excluded.permissions,
    active = true,
    updated_at = now();

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"73000000-0000-4000-8000-000000000001","role":"authenticated","email":"ci-club-finance-reader@tests.invalid"}',
  true
);

select ok(
  public.has_club_permission('finance.read')
    and not public.has_club_permission('finance.write'),
  'fixture representa finance.read sem finance.write'
);

select throws_ok(
  $sql$
    select public.admin_save_financial_transaction(
      null, 'RECEITA', 'FIXO', 'Cliente sem escrita', 'Mensalidade manual',
      'Mensalidade', 100, date '2031-01-10', 'ABERTO', 'PIX_CLUBE', null
    )
  $sql$,
  '42501',
  'Sem permissão para alterar o financeiro.',
  'finance.read não cria lançamento'
);

select throws_ok(
  $$select public.admin_set_financial_transaction_status(
      '73000000-0000-4000-8000-000000000099'::uuid, 'RECEBIDO', 'PIX_CLUBE'
    )$$,
  '42501',
  'Sem permissão para alterar o financeiro.',
  'finance.read não baixa lançamento'
);

select throws_ok(
  $sql$
    select public.admin_save_financial_recurring_rule(
      null, 'DESPESA', 'FIXO', 'Fornecedor sem escrita', 'Contrato mensal',
      'Operação', 100, 10, 'TRANSFERENCIA', 'MANUAL',
      date '2031-01-01', null, null, null, false
    )
  $sql$,
  '42501',
  'Sem permissão para alterar o financeiro.',
  'finance.read não cria regra recorrente'
);

select throws_ok(
  $$select public.admin_set_financial_recurring_rule_active(
      '73000000-0000-4000-8000-000000000099'::uuid, false, null
    )$$,
  '42501',
  'Sem permissão para alterar o financeiro.',
  'finance.read não pausa regra'
);

select throws_ok(
  $$select public.admin_archive_financial_recurring_rule(
      '73000000-0000-4000-8000-000000000099'::uuid, null
    )$$,
  '42501',
  'Sem permissão para alterar o financeiro.',
  'finance.read não arquiva regra'
);

select throws_ok(
  $$select public.admin_generate_financial_recurring_transactions(date '2031-01-01', null)$$,
  '42501',
  'Sem permissão para alterar o financeiro.',
  'finance.read não materializa recorrências'
);

-- Administrador sintético protegido da fixture de CI.
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","email":"ci-protected-admin@tests.invalid"}',
  true
);

select throws_ok(
  $sql$
    select public.admin_save_financial_transaction(
      null, 'OUTRO', 'FIXO', 'Cliente inválido', 'Lançamento inválido',
      'Operação', 100, date '2031-01-10', 'ABERTO', null, null
    )
  $sql$,
  '22023',
  'Tipo financeiro inválido.',
  'RPC rejeita tipo de lançamento inválido'
);

select throws_ok(
  $sql$
    select public.admin_save_financial_transaction(
      null, 'RECEITA', 'FIXO', 'Cliente inválido', 'Lançamento inválido',
      'Operação', 100, date '2031-01-10', 'PAGO', null, null
    )
  $sql$,
  '22023',
  'Status incompatível com o tipo financeiro.',
  'RPC rejeita status incompatível com receita'
);

select throws_ok(
  $sql$
    select public.admin_save_financial_transaction(
      null, 'RECEITA', 'FIXO', 'Cliente inválido', 'Lançamento inválido',
      'Operação', 0, date '2031-01-10', 'ABERTO', null, null
    )
  $sql$,
  '22023',
  'O valor precisa ser maior que zero.',
  'RPC rejeita valor não positivo'
);

select throws_ok(
  $sql$
    select public.admin_save_financial_recurring_rule(
      null, 'DESPESA', 'FIXO', 'Fornecedor inválido', 'Contrato inválido',
      'Operação', 100, 29, 'TRANSFERENCIA', 'MANUAL',
      date '2031-01-01', null, null, null, false
    )
  $sql$,
  '22023',
  'Revise o valor e o dia de vencimento.',
  'regra rejeita dia de vencimento fora do intervalo seguro'
);

select throws_ok(
  $sql$
    select public.admin_save_financial_recurring_rule(
      null, 'DESPESA', 'VARIAVEL', 'Fornecedor variável', 'Custo variável',
      'Operação', 100, 10, 'TRANSFERENCIA', 'MANUAL',
      date '2031-01-01', null, null, null, false
    )
  $sql$,
  '22023',
  'Custos e receitas variáveis devem ser lançados individualmente para preservar o valor real de cada mês.',
  'valor variável permanece avulso e não vira recorrência silenciosa'
);

select throws_ok(
  $sql$
    select public.admin_save_financial_recurring_rule(
      null, 'DESPESA', 'FIXO', 'Fornecedor inválido', 'Contrato inválido',
      'Operação', 100, 10, 'TRANSFERENCIA', 'MANUAL',
      date '2031-03-01', date '2031-02-01', null, null, false
    )
  $sql$,
  '22023',
  'O mês final não pode ser anterior ao início.',
  'regra rejeita período invertido'
);

select throws_ok(
  $sql$
    select public.admin_save_financial_recurring_rule(
      null, 'RECEITA', 'FIXO', 'Pagador futuro', 'Receita Asaas futura',
      'Mensalidade', 100, 10, 'PIX', 'ASAAS_PREPARED',
      date '2031-01-01', null, null, null, false
    )
  $sql$,
  '55000',
  'O Asaas automático de terceiros está preparado, mas permanece bloqueado até existir um pagador validado.',
  'contrato Asaas futuro falha fechado sem fazer chamada externa'
);

-- CRUD auditado de lançamento manual.
select set_config(
  'test.club_manual_transaction_id',
  (
    public.admin_save_financial_transaction(
      null,
      ' receita ',
      ' variavel ',
      '  Cliente Manual CI  ',
      '  Receita avulsa CI  ',
      '  Eventos  ',
      275.50,
      date '2031-01-15',
      ' aberto ',
      ' pix_clube ',
      '  criada no pgTAP  '
    )
  ).id::text,
  true
);

select ok(
  exists (
    select 1
    from public.financial_transactions as ledger
    where ledger.id = current_setting('test.club_manual_transaction_id')::uuid
      and ledger.counterparty = 'Cliente Manual CI'
      and ledger.description = 'Receita avulsa CI'
      and ledger.category = 'Eventos'
      and ledger.type = 'RECEITA'
      and ledger.classification = 'VARIAVEL'
      and ledger.amount = 275.50
      and ledger.status = 'ABERTO'
      and ledger.payment_method = 'CLUB_PIX'
      and ledger.processing_method = 'MANUAL'
      and ledger.ledger_origin = 'MANUAL'
      and ledger.created_by = '10000000-0000-4000-8000-000000000001'::uuid
  ),
  'create normaliza e persiste lançamento manual com ator'
);

select is(
  (
    select count(*)::integer
    from private.financial_activity_audit as audit
    where audit.entity_id = current_setting('test.club_manual_transaction_id')::uuid
      and audit.action = 'CREATED'
      and audit.actor_user_id = '10000000-0000-4000-8000-000000000001'::uuid
  ),
  1,
  'create de lançamento gera auditoria com ator'
);

select lives_ok(
  format(
    $sql$
      select public.admin_save_financial_transaction(
        %L::uuid, 'RECEITA', 'FIXO', 'Cliente Manual CI', 'Receita editada CI',
        'Patrocínio', 300, date '2031-01-20', 'ABERTO', 'TRANSFERENCIA',
        'editada no pgTAP'
      )
    $sql$,
    current_setting('test.club_manual_transaction_id')
  ),
  'update de lançamento manual ocorre pela RPC'
);

select ok(
  exists (
    select 1
    from public.financial_transactions as ledger
    where ledger.id = current_setting('test.club_manual_transaction_id')::uuid
      and ledger.description = 'Receita editada CI'
      and ledger.category = 'Patrocínio'
      and ledger.classification = 'FIXO'
      and ledger.amount = 300
      and ledger.due_date = date '2031-01-20'
      and ledger.payment_method = 'TRANSFERENCIA'
  ),
  'update altera os campos editáveis do lançamento manual'
);

select is(
  (
    select count(*)::integer
    from private.financial_activity_audit as audit
    where audit.entity_id = current_setting('test.club_manual_transaction_id')::uuid
      and audit.action = 'UPDATED'
  ),
  1,
  'update de lançamento fica auditado'
);

select lives_ok(
  format(
    $$select public.admin_set_financial_transaction_status(%L::uuid, 'RECEBIDO', 'PIX_CLUBE')$$,
    current_setting('test.club_manual_transaction_id')
  ),
  'baixa manual de receita ocorre pela RPC'
);

select ok(
  exists (
    select 1
    from public.financial_transactions as ledger
    where ledger.id = current_setting('test.club_manual_transaction_id')::uuid
      and ledger.status = 'RECEBIDO'
      and ledger.paid_at is not null
      and ledger.payment_method = 'CLUB_PIX'
  ),
  'baixa manual preenche status, data e forma de pagamento'
);

select is(
  (
    select count(*)::integer
    from private.financial_activity_audit as audit
    where audit.entity_id = current_setting('test.club_manual_transaction_id')::uuid
      and audit.action = 'STATUS_CHANGED'
  ),
  1,
  'baixa manual gera auditoria de status'
);

select lives_ok(
  format(
    $$select public.admin_set_financial_transaction_status(%L::uuid, 'ABERTO', null)$$,
    current_setting('test.club_manual_transaction_id')
  ),
  'reabertura manual ocorre pela RPC'
);

select ok(
  exists (
    select 1
    from public.financial_transactions as ledger
    where ledger.id = current_setting('test.club_manual_transaction_id')::uuid
      and ledger.status = 'ABERTO'
      and ledger.paid_at is null
  ),
  'reabrir lançamento limpa paid_at'
);

select throws_ok(
  format(
    $$select public.admin_set_financial_transaction_status(%L::uuid, 'PAGO', null)$$,
    current_setting('test.club_manual_transaction_id')
  ),
  '22023',
  'Status incompatível com o tipo financeiro.',
  'baixa incompatível com o tipo continua bloqueada'
);

-- Criação, leitura RLS, edição versionada e materialização idempotente.
select set_config(
  'test.club_recurring_rule_id',
  public.admin_save_financial_recurring_rule(
    null,
    ' despesa ',
    ' fixo ',
    '  Fornecedor Recorrente CI  ',
    '  Locação mensal CI  ',
    '  Estrutura  ',
    1000,
    12,
    ' transferencia ',
    ' manual ',
    date '2031-01-01',
    null,
    '  contrato sintético  ',
    null,
    false
  ) #>> '{rule,id}',
  true
);

select ok(
  exists (
    select 1
    from public.financial_recurring_rules as rule
    where rule.id = current_setting('test.club_recurring_rule_id')::uuid
      and rule.counterparty = 'Fornecedor Recorrente CI'
      and rule.description = 'Locação mensal CI'
      and rule.category = 'Estrutura'
      and rule.type = 'DESPESA'
      and rule.classification = 'FIXO'
      and rule.amount = 1000
      and rule.due_day = 12
      and rule.processing_method = 'MANUAL'
      and rule.version = 1
      and rule.active
  ),
  'create da regra normaliza e persiste a versão inicial'
);

select is(
  (
    select count(*)::integer
    from private.financial_activity_audit as audit
    where audit.entity_id = current_setting('test.club_recurring_rule_id')::uuid
      and audit.action = 'CREATED'
      and audit.actor_user_id = '10000000-0000-4000-8000-000000000001'::uuid
  ),
  1,
  'create da regra gera auditoria com ator'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"73000000-0000-4000-8000-000000000001","role":"authenticated","email":"ci-club-finance-reader@tests.invalid"}',
  true
);
set local role authenticated;
select is(
  (
    select count(*)::integer
    from public.financial_recurring_rules as rule
    where rule.id = current_setting('test.club_recurring_rule_id')::uuid
  ),
  1,
  'finance.read enxerga a regra pela policy RLS'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"73000000-0000-4000-8000-000000000099","role":"authenticated","email":"ci-club-finance-untrusted@tests.invalid"}',
  true
);
set local role authenticated;
select is(
  (
    select count(*)::integer
    from public.financial_recurring_rules as rule
    where rule.id = current_setting('test.club_recurring_rule_id')::uuid
  ),
  0,
  'identidade sem allowlist não atravessa a policy RLS'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","email":"ci-protected-admin@tests.invalid"}',
  true
);

select is(
  (
    public.admin_generate_financial_recurring_transactions(
      date '2031-02-17',
      current_setting('test.club_recurring_rule_id')::uuid
    ) ->> 'generated'
  )::integer,
  1,
  'primeira geração da competência materializa uma ocorrência'
);

select is(
  (
    public.admin_generate_financial_recurring_transactions(
      date '2031-02-01',
      current_setting('test.club_recurring_rule_id')::uuid
    ) ->> 'generated'
  )::integer,
  0,
  'segunda geração da mesma competência é idempotente'
);

select is(
  (
    select count(*)::integer
    from public.financial_transactions as ledger
    where ledger.recurring_rule_id = current_setting('test.club_recurring_rule_id')::uuid
      and ledger.competence_month = date '2031-02-01'
  ),
  1,
  'existe somente uma ocorrência por regra e competência'
);

select ok(
  exists (
    select 1
    from public.financial_transactions as ledger
    where ledger.recurring_rule_id = current_setting('test.club_recurring_rule_id')::uuid
      and ledger.competence_month = date '2031-02-01'
      and ledger.recurring_rule_version = 1
      and ledger.counterparty = 'Fornecedor Recorrente CI'
      and ledger.description = 'Locação mensal CI'
      and ledger.classification = 'FIXO'
      and ledger.amount = 1000
      and ledger.due_date = date '2031-02-12'
      and ledger.status = 'ABERTO'
      and ledger.processing_method = 'MANUAL'
      and ledger.ledger_origin = 'RECURRENCE'
  ),
  'ocorrência congela o snapshot v1 e calcula due_day corretamente'
);

select is(
  (
    select count(*)::integer
    from private.financial_activity_audit as audit
    where audit.entity_type = 'TRANSACTION'
      and audit.action = 'GENERATED'
      and (audit.after_data ->> 'recurring_rule_id')::uuid = current_setting('test.club_recurring_rule_id')::uuid
      and (audit.after_data ->> 'competence_month')::date = date '2031-02-01'
  ),
  1,
  'idempotência também evita auditoria GENERATED duplicada'
);

select lives_ok(
  format(
    $sql$
      select public.admin_save_financial_recurring_rule(
        %L::uuid, 'DESPESA', 'FIXO', 'Fornecedor Recorrente CI',
        'Locação reajustada CI', 'Estrutura', 1250, 20, 'TRANSFERENCIA',
        'MANUAL', date '2031-01-01', null, 'reajuste sintético', 1, false
      )
    $sql$,
    current_setting('test.club_recurring_rule_id')
  ),
  'regra existente pode ser editada pela RPC'
);

select ok(
  exists (
    select 1
    from public.financial_recurring_rules as rule
    where rule.id = current_setting('test.club_recurring_rule_id')::uuid
      and rule.version = 2
      and rule.description = 'Locação reajustada CI'
      and rule.classification = 'FIXO'
      and rule.amount = 1250
      and rule.due_day = 20
  ),
  'edição incrementa versão e altera somente a regra'
);

select throws_ok(
  format(
    $sql$
      select public.admin_save_financial_recurring_rule(
        %L::uuid, 'DESPESA', 'FIXO', 'Fornecedor Recorrente CI',
        'Edição concorrente obsoleta', 'Estrutura', 1300, 21, 'TRANSFERENCIA',
        'MANUAL', date '2031-01-01', null, 'versão obsoleta', 1, false
      )
    $sql$,
    current_setting('test.club_recurring_rule_id')
  ),
  '40001',
  'Esta recorrência foi atualizada em outra tela. Recarregue antes de salvar novamente.',
  'versão esperada impede sobrescrever edição concorrente'
);

select ok(
  exists (
    select 1
    from public.financial_transactions as ledger
    where ledger.recurring_rule_id = current_setting('test.club_recurring_rule_id')::uuid
      and ledger.competence_month = date '2031-02-01'
      and ledger.recurring_rule_version = 1
      and ledger.description = 'Locação mensal CI'
      and ledger.classification = 'FIXO'
      and ledger.amount = 1000
      and ledger.due_date = date '2031-02-12'
  ),
  'edição da regra não reescreve a competência já gerada'
);

select is(
  (
    select count(*)::integer
    from private.financial_activity_audit as audit
    where audit.entity_id = current_setting('test.club_recurring_rule_id')::uuid
      and audit.action = 'UPDATED'
  ),
  1,
  'edição da regra fica auditada'
);

select is(
  (
    public.admin_generate_financial_recurring_transactions(
      date '2031-03-01',
      current_setting('test.club_recurring_rule_id')::uuid
    ) ->> 'generated'
  )::integer,
  1,
  'competência seguinte é gerada após a edição'
);

select ok(
  exists (
    select 1
    from public.financial_transactions as ledger
    where ledger.recurring_rule_id = current_setting('test.club_recurring_rule_id')::uuid
      and ledger.competence_month = date '2031-03-01'
      and ledger.recurring_rule_version = 2
      and ledger.description = 'Locação reajustada CI'
      and ledger.classification = 'FIXO'
      and ledger.amount = 1250
      and ledger.due_date = date '2031-03-20'
  ),
  'nova competência usa o snapshot da versão editada'
);

select throws_ok(
  format(
    $$select public.admin_set_financial_recurring_rule_active(%L::uuid, false, 1)$$,
    current_setting('test.club_recurring_rule_id')
  ),
  '40001',
  'Esta recorrência foi atualizada em outra tela. Recarregue antes de continuar.',
  'pausa exige a versão vigente e rejeita tela obsoleta'
);

select lives_ok(
  format(
    $$select public.admin_set_financial_recurring_rule_active(%L::uuid, false, 2)$$,
    current_setting('test.club_recurring_rule_id')
  ),
  'regra pode ser pausada pela RPC'
);

select ok(
  exists (
    select 1
    from public.financial_recurring_rules as rule
    where rule.id = current_setting('test.club_recurring_rule_id')::uuid
      and not rule.active
      and rule.paused_at is not null
      and rule.version = 3
  ),
  'pausa desativa, registra instante e incrementa versão'
);

select is(
  (
    select count(*)::integer
    from private.financial_activity_audit as audit
    where audit.entity_id = current_setting('test.club_recurring_rule_id')::uuid
      and audit.action = 'PAUSED'
  ),
  1,
  'pausa fica auditada'
);

select is(
  (
    public.admin_generate_financial_recurring_transactions(
      date '2031-04-01',
      current_setting('test.club_recurring_rule_id')::uuid
    ) ->> 'generated'
  )::integer,
  0,
  'regra pausada não gera a competência seguinte'
);

select is(
  (
    select count(*)::integer
    from public.financial_transactions as ledger
    where ledger.recurring_rule_id = current_setting('test.club_recurring_rule_id')::uuid
  ),
  2,
  'pausa preserva todas as ocorrências históricas'
);

select lives_ok(
  format(
    $$select public.admin_set_financial_recurring_rule_active(%L::uuid, true, 3)$$,
    current_setting('test.club_recurring_rule_id')
  ),
  'regra pode ser retomada pela RPC'
);

select ok(
  exists (
    select 1
    from public.financial_recurring_rules as rule
    where rule.id = current_setting('test.club_recurring_rule_id')::uuid
      and rule.active
      and rule.paused_at is null
      and rule.version = 4
  ),
  'retomada reativa, limpa pausa e incrementa versão'
);

select is(
  (
    select count(*)::integer
    from private.financial_activity_audit as audit
    where audit.entity_id = current_setting('test.club_recurring_rule_id')::uuid
      and audit.action = 'RESUMED'
  ),
  1,
  'retomada fica auditada'
);

select is(
  (
    public.admin_generate_financial_recurring_transactions(
      date '2031-04-01',
      current_setting('test.club_recurring_rule_id')::uuid
    ) ->> 'generated'
  )::integer,
  1,
  'regra retomada volta a gerar a competência pendente'
);

select ok(
  exists (
    select 1
    from public.financial_transactions as ledger
    where ledger.recurring_rule_id = current_setting('test.club_recurring_rule_id')::uuid
      and ledger.competence_month = date '2031-04-01'
      and ledger.recurring_rule_version = 4
      and ledger.amount = 1250
      and ledger.due_date = date '2031-04-20'
  ),
  'competência após retomada usa a versão vigente'
);

select set_config(
  'test.club_recurring_transaction_id',
  (
    select ledger.id::text
    from public.financial_transactions as ledger
    where ledger.recurring_rule_id = current_setting('test.club_recurring_rule_id')::uuid
      and ledger.competence_month = date '2031-03-01'
  ),
  true
);

select lives_ok(
  format(
    $$select public.admin_set_financial_transaction_status(%L::uuid, 'PAGO', 'TRANSFERENCIA')$$,
    current_setting('test.club_recurring_transaction_id')
  ),
  'ocorrência recorrente aceita baixa auditada de status'
);

select ok(
  exists (
    select 1
    from public.financial_transactions as ledger
    where ledger.id = current_setting('test.club_recurring_transaction_id')::uuid
      and ledger.status = 'PAGO'
      and ledger.paid_at is not null
      and ledger.amount = 1250
      and ledger.recurring_rule_version = 2
  ),
  'baixa preserva o snapshot financeiro da ocorrência'
);

select ok(
  exists (
    select 1
    from private.financial_activity_audit as audit
    where audit.entity_id = current_setting('test.club_recurring_transaction_id')::uuid
      and audit.action = 'STATUS_CHANGED'
      and audit.actor_user_id = '10000000-0000-4000-8000-000000000001'::uuid
  ),
  'baixa da ocorrência fica auditada com o ator'
);

select throws_ok(
  format(
    $sql$
      select public.admin_save_financial_transaction(
        %L::uuid, 'DESPESA', 'VARIAVEL', 'Fornecedor Recorrente CI',
        'Tentativa de reescrever snapshot', 'Estrutura', 1,
        date '2031-03-01', 'ABERTO', null, null
      )
    $sql$,
    current_setting('test.club_recurring_transaction_id')
  ),
  '42501',
  'Este lançamento é controlado por outro fluxo e não pode ser editado diretamente.',
  'RPC de CRUD avulso não reescreve ocorrência recorrente'
);

select set_config('ilha.club_finance_write', '', true);

select throws_ok(
  format(
    $$update public.financial_transactions set amount = amount + 1 where id = %L::uuid$$,
    current_setting('test.club_recurring_transaction_id')
  ),
  '42501',
  'Lançamento recorrente só pode ser alterado pelo fluxo financeiro auditado.',
  'trigger bloqueia mutação direta do histórico recorrente fora da capability'
);

select throws_ok(
  format(
    $$delete from public.financial_transactions where id = %L::uuid$$,
    current_setting('test.club_recurring_transaction_id')
  ),
  '23514',
  'Lançamento recorrente não pode ser excluído; cancele-o para preservar o histórico.',
  'trigger bloqueia exclusão física de ocorrência recorrente'
);

select ok(
  exists (
    select 1
    from public.financial_transactions as ledger
    where ledger.id = current_setting('test.club_recurring_transaction_id')::uuid
      and ledger.amount = 1250
      and ledger.status = 'PAGO'
      and ledger.recurring_rule_version = 2
  ),
  'tentativas rejeitadas deixam o histórico intacto'
);

select throws_ok(
  format(
    $$select public.admin_archive_financial_recurring_rule(%L::uuid, 3)$$,
    current_setting('test.club_recurring_rule_id')
  ),
  '40001',
  'Esta recorrência foi atualizada em outra tela. Recarregue antes de arquivar.',
  'arquivamento exige a versão vigente e rejeita tela obsoleta'
);

select lives_ok(
  format(
    $$select public.admin_archive_financial_recurring_rule(%L::uuid, 4)$$,
    current_setting('test.club_recurring_rule_id')
  ),
  'regra pode ser arquivada pela RPC'
);

select ok(
  exists (
    select 1
    from public.financial_recurring_rules as rule
    where rule.id = current_setting('test.club_recurring_rule_id')::uuid
      and not rule.active
      and rule.paused_at is not null
      and rule.archived_at is not null
      and rule.version = 5
  ),
  'arquivamento desativa e preserva a regra como histórico'
);

select is(
  (
    select count(*)::integer
    from private.financial_activity_audit as audit
    where audit.entity_id = current_setting('test.club_recurring_rule_id')::uuid
      and audit.action = 'ARCHIVED'
      and audit.actor_user_id = '10000000-0000-4000-8000-000000000001'::uuid
  ),
  1,
  'arquivamento fica auditado com o ator'
);

select is(
  (
    public.admin_generate_financial_recurring_transactions(
      date '2031-05-01',
      current_setting('test.club_recurring_rule_id')::uuid
    ) ->> 'generated'
  )::integer,
  0,
  'regra arquivada não gera novas competências'
);

select is(
  (
    select count(*)::integer
    from public.financial_transactions as ledger
    where ledger.recurring_rule_id = current_setting('test.club_recurring_rule_id')::uuid
  ),
  3,
  'arquivamento preserva todas as ocorrências existentes'
);

-- Um lançamento realmente legado, mas já encerrado, exige revisão humana.
-- Ele nunca pode ser adotado nem provocar a criação silenciosa de uma segunda linha.
insert into auth.users (
  id,
  email,
  raw_app_meta_data,
  raw_user_meta_data
) values (
  '73000000-0000-4000-8000-000000000010'::uuid,
  'ci-club-finance-closed-ledger@tests.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"app_context":"public","full_name":"Cliente Ledger Fechado CI"}'::jsonb
);

insert into public.app_clients (
  id,
  full_name,
  email,
  status,
  client_type
) values (
  '73000000-0000-4000-8000-000000000010'::uuid,
  'Cliente Ledger Fechado CI',
  'ci-club-finance-closed-ledger@tests.invalid',
  'ATIVO',
  'aluno'
);

insert into public.app_payment_invoices (
  id,
  client_id,
  invoice_month,
  description,
  amount,
  due_date,
  status,
  payment_method
) values
  (
    '73000000-0000-4000-8000-000000000011'::uuid,
    '73000000-0000-4000-8000-000000000010'::uuid,
    date '2032-01-01',
    'Mensalidade legado recebido CI',
    88,
    date '2032-01-10',
    'ABERTA',
    'CLUB_PIX'
  ),
  (
    '73000000-0000-4000-8000-000000000012'::uuid,
    '73000000-0000-4000-8000-000000000010'::uuid,
    date '2032-02-01',
    'Mensalidade legado cancelado CI',
    99,
    date '2032-02-10',
    'ABERTA',
    'CASH'
  );

insert into public.financial_transactions (
  id,
  counterparty,
  description,
  category,
  type,
  classification,
  amount,
  due_date,
  paid_at,
  status,
  payment_method,
  processing_method,
  ledger_origin
) values
  (
    '73000000-0000-4000-8000-000000000021'::uuid,
    'Cliente Ledger Fechado CI',
    'Mensalidade legado recebido CI',
    'Mensalidade',
    'RECEITA',
    'FIXO',
    88,
    date '2032-01-10',
    now(),
    'RECEBIDO',
    'CLUB_PIX',
    'MANUAL',
    'LEGACY'
  ),
  (
    '73000000-0000-4000-8000-000000000022'::uuid,
    'Cliente Ledger Fechado CI',
    'Mensalidade legado cancelado CI',
    'Mensalidade',
    'RECEITA',
    'FIXO',
    99,
    date '2032-02-10',
    null,
    'CANCELADO',
    'CASH',
    'MANUAL',
    'LEGACY'
  );

select set_config('ilha.monthly_billing_write', '', true);

select throws_ok(
  $$select private.ensure_app_invoice_financial_transaction(
      '73000000-0000-4000-8000-000000000011'::uuid
    )$$,
  '23514',
  null,
  'legado RECEBIDO correspondente bloqueia a criação de outro lançamento'
);

select ok(
  not exists (
    select 1
    from public.financial_transactions as ledger
    where ledger.app_payment_invoice_id = '73000000-0000-4000-8000-000000000011'::uuid
  )
    and exists (
      select 1
      from public.financial_transactions as ledger
      where ledger.id = '73000000-0000-4000-8000-000000000021'::uuid
        and ledger.app_payment_invoice_id is null
        and ledger.status = 'RECEBIDO'
        and ledger.ledger_origin = 'LEGACY'
    ),
  'falha preserva o legado RECEBIDO e não duplica o razão'
);

select throws_ok(
  $$select private.ensure_app_invoice_financial_transaction(
      '73000000-0000-4000-8000-000000000012'::uuid
    )$$,
  '23514',
  null,
  'legado CANCELADO correspondente bloqueia a criação de outro lançamento'
);

select ok(
  not exists (
    select 1
    from public.financial_transactions as ledger
    where ledger.app_payment_invoice_id = '73000000-0000-4000-8000-000000000012'::uuid
  )
    and exists (
      select 1
      from public.financial_transactions as ledger
      where ledger.id = '73000000-0000-4000-8000-000000000022'::uuid
        and ledger.app_payment_invoice_id is null
        and ledger.status = 'CANCELADO'
        and ledger.ledger_origin = 'LEGACY'
    ),
  'falha preserva o legado CANCELADO e não duplica o razão'
);

select * from finish();
rollback;
