begin;

create extension if not exists pgtap with schema extensions;

select plan(98);

select has_table(
  'public',
  'protected_access_accounts',
  'a allowlist protegida existe depois da cadeia completa'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.protected_access_accounts'::regclass),
  'RLS está habilitado na allowlist'
);

select ok(
  not has_table_privilege('anon', 'public.protected_access_accounts', 'SELECT'),
  'anon não lê a allowlist'
);

select ok(
  not has_table_privilege('authenticated', 'public.protected_access_accounts', 'SELECT'),
  'authenticated não lê diretamente a allowlist'
);

select ok(
  has_table_privilege('service_role', 'public.protected_access_accounts', 'SELECT'),
  'service_role pode operar o bootstrap controlado'
);

select has_table(
  'public',
  'app_push_subscriptions',
  'o schema-base recria as assinaturas Push do Ilha Play'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.app_push_subscriptions'::regclass),
  'RLS está habilitado nas assinaturas Push'
);

select ok(
  has_table_privilege('authenticated', 'public.app_push_subscriptions', 'SELECT')
    and has_table_privilege('authenticated', 'public.app_push_subscriptions', 'INSERT')
    and has_table_privilege('authenticated', 'public.app_push_subscriptions', 'UPDATE')
    and has_table_privilege('authenticated', 'public.app_push_subscriptions', 'DELETE'),
  'o cliente autenticado alcança a tabela, ainda restrito pela policy ao próprio usuário'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.app_push_subscriptions'::regclass
      and constraint_row.confrelid = 'auth.users'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.confdeltype = 'c'
  ),
  'a exclusão de Auth remove assinaturas Push órfãs por cascade'
);

select is(
  (select count(*)::integer from public.protected_access_accounts where active),
  1,
  'somente a identidade sintética confiável foi carregada'
);

select is(
  (select email from public.protected_access_accounts where active),
  'ci-protected-admin@tests.invalid',
  'a fixture usa domínio reservado, sem dado pessoal'
);

select ok(
  exists (
    select 1
    from public.profiles profile
    join auth.users auth_user on auth_user.id = profile.id
    join public.protected_access_accounts protected
      on protected.email = lower(trim(auth_user.email))
     and protected.role = profile.role
     and protected.active
    where profile.id = '10000000-0000-4000-8000-000000000001'::uuid
      and profile.active
      and profile.role = 'admin'
  ),
  'Auth, perfil e allowlist estão alinhados antes/depois do hardening'
);

select ok(
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260821185000'
  ),
  'a migration da allowlist foi aplicada'
);

select ok(
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260821187500'
  ),
  'o bootstrap sintético ocorreu entre as migrations protegidas'
);

select ok(
  exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260821190000'
  ),
  'o hardening foi aplicado depois do bootstrap'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select is(
  public.current_user_role(),
  'admin',
  'a autorização deriva de Auth + perfil + allowlist confiável'
);

select ok(
  public.has_club_permission('clients.read'),
  'o administrador sintético passa pela função de autorização endurecida'
);

select is(
  (
    select profile.role
      from public.ensure_current_user_profile() as profile
  ),
  'admin',
  'a sincronização preserva uma conta de equipe já confirmada na allowlist'
);

select has_table(
  'private',
  'app_client_account_backups',
  'os backups recuperáveis ficam fora do schema público'
);

select ok(
  (
    select relation.relrowsecurity
      from pg_class as relation
     where relation.oid = 'private.app_client_account_backups'::regclass
  ),
  'RLS também protege a tabela privada de backups'
);

select ok(
  not has_table_privilege('anon', 'private.app_client_account_backups', 'SELECT')
    and not has_table_privilege('authenticated', 'private.app_client_account_backups', 'SELECT')
    and not has_table_privilege('service_role', 'private.app_client_account_backups', 'SELECT')
    and not has_function_privilege(
      'anon',
      'private.app_client_reset_protected_fingerprint(uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'private.app_client_reset_protected_fingerprint(uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'private.app_client_reset_protected_fingerprint(uuid)',
      'EXECUTE'
    ),
  'nenhum papel da API lê snapshots nem executa o helper privado diretamente'
);

select ok(
  not has_function_privilege('anon', 'public.reset_app_client_account_with_backup(uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.reset_app_client_account(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.delete_app_client_account(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.list_app_client_account_backups(uuid,integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.restore_app_client_account_backup(uuid)', 'EXECUTE'),
  'anon não alcança nenhuma RPC de backup, reset ou restauração'
);

select ok(
  has_function_privilege('authenticated', 'public.reset_app_client_account_with_backup(uuid,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.reset_app_client_account(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.delete_app_client_account(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.list_app_client_account_backups(uuid,integer)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.restore_app_client_account_backup(uuid)', 'EXECUTE'),
  'authenticated alcança as RPCs, que repetem clients.write no servidor'
);

-- Exercita o caso mais sensível: a mesma identidade é cliente do Ilha Play e
-- integrante da equipe do Bar. Reset e restauração nunca removem Auth, perfil,
-- allowlist, tarefas, faturas ou qualquer histórico relacionado.
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","email":"ci-protected-admin@tests.invalid"}',
  true
);

insert into auth.users (
  id,
  email,
  raw_app_meta_data,
  raw_user_meta_data
)
values (
  '10000000-0000-4000-8000-000000000004'::uuid,
  'ci-bar-client-reset@tests.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"app_context":"public","full_name":"Cliente Bar Sintético"}'::jsonb
);

insert into public.profiles (
  id,
  full_name,
  email,
  role,
  permissions,
  active
)
values (
  '10000000-0000-4000-8000-000000000004'::uuid,
  'Cliente Bar Sintético',
  'ci-bar-client-reset@tests.invalid',
  'bar',
  '["bar.orders"]'::jsonb,
  true
);

insert into public.app_clients (
  id,
  full_name,
  email,
  phone,
  status,
  client_type,
  plan_amount,
  weekly_lessons,
  preferred_days,
  due_day,
  official_plan_code,
  official_plan_name,
  declared_plan_code,
  declared_plan_name,
  registration_completed_at,
  email_verified_at,
  declared_lesson_slots,
  last_login_at,
  plan_cancellation_requested_at,
  plan_cancel_at,
  reenrollment_fee_required
)
values (
  '10000000-0000-4000-8000-000000000004'::uuid,
  'Cliente Bar Sintético',
  'ci-bar-client-reset@tests.invalid',
  '27999999999',
  'ATIVO',
  'socio',
  180,
  2,
  '["SEGUNDA","QUARTA"]'::jsonb,
  12,
  'PLANO-CI',
  'Plano sintético',
  'PLANO-CI',
  'Plano sintético',
  '2026-08-20 12:00:00+00'::timestamptz,
  '2026-08-20 12:00:00+00'::timestamptz,
  '["SEGUNDA 18:00","QUARTA 18:00"]'::jsonb,
  '2026-08-25 12:00:00+00'::timestamptz,
  '2026-08-24 12:00:00+00'::timestamptz,
  '2026-09-30'::date,
  true
);

insert into public.bar_user_tasks (user_id, title, created_by)
values (
  '10000000-0000-4000-8000-000000000004'::uuid,
  'Tarefa sintética preservada',
  '10000000-0000-4000-8000-000000000001'::uuid
);

insert into public.app_payment_invoices (
  client_id,
  invoice_month,
  description,
  amount,
  due_date,
  status
)
values (
  '10000000-0000-4000-8000-000000000004'::uuid,
  '2099-01-01'::date,
  'Fatura sintética preservada',
  180,
  '2099-01-12'::date,
  'ABERTA'
);

create temporary table ci_reset_result on commit drop as
select public.reset_app_client_account_with_backup(
  '10000000-0000-4000-8000-000000000004'::uuid,
  'Teste local do reset recuperável'
) as result;

select ok(
  (select (result ->> 'reset')::boolean from ci_reset_result)
    and not (select (result ->> 'deleted')::boolean from ci_reset_result)
    and (select (result ->> 'preserved_auth_access')::boolean from ci_reset_result)
    and (select (result ->> 'preserved_team_access')::boolean from ci_reset_result)
    and (select (result ->> 'preserved_history')::boolean from ci_reset_result),
  'o reset informa backup lógico e preservação de identidade/equipe/histórico'
);

select ok(
  exists (
    select 1
      from public.app_clients as client
     where client.id = '10000000-0000-4000-8000-000000000004'::uuid
       and client.status = 'PENDENTE'
       and client.registration_completed_at is null
       and client.email_verified_at is null
       and client.plan_amount = 0
       and client.weekly_lessons = 0
       and client.preferred_days = '[]'::jsonb
       and client.declared_lesson_slots = '[]'::jsonb
  ),
  'o reset zera somente os campos de habilitação e plano do Ilha Play'
);

select ok(
  exists (
    select 1 from auth.users as auth_user
     where auth_user.id = '10000000-0000-4000-8000-000000000004'::uuid
  )
    and exists (
      select 1 from public.profiles as profile
       where profile.id = '10000000-0000-4000-8000-000000000004'::uuid
         and profile.role = 'bar'
         and profile.active
    )
    and exists (
      select 1 from public.protected_access_accounts as protected
       where protected.email = 'ci-bar-client-reset@tests.invalid'
         and protected.active
    ),
  'Auth, perfil do Bar e allowlist permanecem intactos após o reset'
);

select ok(
  exists (
    select 1 from public.bar_user_tasks as task
     where task.user_id = '10000000-0000-4000-8000-000000000004'::uuid
  )
    and exists (
      select 1 from public.app_payment_invoices as invoice
       where invoice.client_id = '10000000-0000-4000-8000-000000000004'::uuid
         and invoice.description = 'Fatura sintética preservada'
    ),
  'tarefas do Bar e faturas do cliente não são excluídas pelo reset'
);

select ok(
  exists (
    select 1
      from private.app_client_account_backups as backup
     where backup.id = (
       select (result ->> 'backup_id')::uuid from ci_reset_result
     )
       and backup.client_id = '10000000-0000-4000-8000-000000000004'::uuid
       and backup.actor_id = '10000000-0000-4000-8000-000000000001'::uuid
       and backup.state = 'RESET_APPLIED'
       and backup.expires_at > backup.created_at
  ),
  'o backup privado identifica cliente, administrador, estado e validade'
);

select ok(
  exists (
    select 1
      from private.app_client_account_backups as backup
     where backup.id = (
       select (result ->> 'backup_id')::uuid from ci_reset_result
     )
       and char_length(backup.snapshot_sha256) = 64
       and not (backup.app_client_snapshot ?| array[
         'password', 'encrypted_password', 'access_token', 'refresh_token', 'session'
       ])
  ),
  'o snapshot possui checksum e não contém senha, token ou sessão Auth'
);

create temporary table ci_restore_result on commit drop as
select public.restore_app_client_account_backup(
  (select (result ->> 'backup_id')::uuid from ci_reset_result)
) as result;

select ok(
  (select (result ->> 'restored')::boolean from ci_restore_result)
    and not (select (result ->> 'already_restored')::boolean from ci_restore_result)
    and (select (result ->> 'preserved_auth_access')::boolean from ci_restore_result)
    and (select (result ->> 'preserved_history')::boolean from ci_restore_result),
  'a restauração confirma o retorno sem recriar Auth nem históricos'
);

select ok(
  exists (
    select 1
      from public.app_clients as client
     where client.id = '10000000-0000-4000-8000-000000000004'::uuid
       and client.status = 'ATIVO'
       and client.plan_amount = 180
       and client.weekly_lessons = 2
       and client.preferred_days = '["SEGUNDA","QUARTA"]'::jsonb
       and client.due_day = 12
       and client.registration_completed_at = '2026-08-20 12:00:00+00'::timestamptz
       and client.email_verified_at = '2026-08-20 12:00:00+00'::timestamptz
       and client.reenrollment_fee_required
  ),
  'a restauração repõe exatamente os campos zerados da ficha anterior'
);

select ok(
  exists (
    select 1
      from private.app_client_account_backups as backup
     where backup.id = (
       select (result ->> 'backup_id')::uuid from ci_reset_result
     )
       and backup.state = 'RESTORED'
       and backup.restored_by = '10000000-0000-4000-8000-000000000001'::uuid
       and backup.restored_at is not null
  ),
  'o backup registra quem restaurou e não fica novamente disponível'
);

select ok(
  exists (
    select 1 from auth.users as auth_user
     where auth_user.id = '10000000-0000-4000-8000-000000000004'::uuid
  )
    and exists (
      select 1 from public.profiles as profile
       where profile.id = '10000000-0000-4000-8000-000000000004'::uuid
         and profile.role = 'bar'
    )
    and exists (
      select 1 from public.bar_user_tasks as task
       where task.user_id = '10000000-0000-4000-8000-000000000004'::uuid
    )
    and exists (
      select 1 from public.app_payment_invoices as invoice
       where invoice.client_id = '10000000-0000-4000-8000-000000000004'::uuid
    ),
  'identidade, acesso do Bar e históricos continuam íntegros após restaurar'
);

select ok(
  (
    public.restore_app_client_account_backup(
      (select (result ->> 'backup_id')::uuid from ci_reset_result)
    ) ->> 'already_restored'
  )::boolean,
  'restaurar novamente é idempotente e não sobrescreve dados'
);

select is(
  (
    select count(*)::integer
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and pg_get_functiondef(procedure.oid) like '%lkqtgptebkgfwguykxhv%'
  ),
  0,
  'nenhuma função local conserva endpoint ou referência do projeto de produção'
);

select has_table(
  'public',
  'tournament_registration_orders',
  'as cobranças futuras das inscrições internas possuem tabela própria'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.tournament_registration_orders'::regclass),
  'RLS está habilitado nas cobranças das inscrições'
);

select ok(
  not has_table_privilege('anon', 'public.tournament_registration_orders', 'SELECT')
    and not has_table_privilege('authenticated', 'public.tournament_registration_orders', 'SELECT'),
  'dados pessoais e de cobrança não são expostos pela Data API'
);

select ok(
  has_table_privilege('service_role', 'public.tournament_registration_orders', 'SELECT')
    and has_table_privilege('service_role', 'public.tournament_registration_orders', 'INSERT')
    and has_table_privilege('service_role', 'public.tournament_registration_orders', 'UPDATE'),
  'somente o backend confiável opera as cobranças de inscrição'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_internal_tournament_registration(text, uuid[], text, text, boolean, text, text, boolean)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'authenticated',
      'public.create_internal_tournament_registration(text, uuid[], text, text, boolean, text, text, boolean)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.create_internal_tournament_registration(text, uuid[], text, text, boolean, text, text, boolean)',
      'EXECUTE'
    ),
  'a RPC atômica só pode ser executada pela Edge Function'
);

select is(
  (
    select count(*)::integer
    from public.tournaments
    where slug = 'ilha-open-interno-2026'
  ),
  0,
  'o torneio interno residual não permanece publicável'
);

select ok(
  exists (
    select 1
    from private.tournament_deletion_backups
    where tournament_slug = 'ilha-open-interno-2026'
      and snapshot -> 'tournament' ->> 'slug' = 'ilha-open-interno-2026'
  ),
  'a remoção do torneio interno conserva um backup privado verificável'
);

select has_column(
  'public',
  'tournament_registration_orders',
  'paid_at',
  'a cobrança interna registra quando o pagamento foi confirmado'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tournament_registration_orders'::regclass
      and conname = 'tournament_registration_orders_billing_status_check'
      and pg_get_constraintdef(oid) like '%PAID%'
  ),
  'o pedido de cobrança aceita o estado pago'
);

-- User-controlled signup metadata must never create a staff profile. The
-- reserved .invalid accounts exist only inside this rolled-back CI transaction.
insert into auth.users (
  id,
  email,
  raw_app_meta_data,
  raw_user_meta_data
)
values (
  '10000000-0000-4000-8000-000000000002'::uuid,
  'ci-untrusted-admin@tests.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"app_context":"admin","full_name":"Cadastro não confiável"}'::jsonb
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"ci-untrusted-admin@tests.invalid"}',
  true
);

select is(
  (
    select count(*)::integer
      from public.profiles
     where id = '10000000-0000-4000-8000-000000000002'::uuid
  ),
  0,
  'metadado app_context=admin não cria perfil de equipe fora da allowlist'
);

select is(
  public.current_user_role(),
  null::text,
  'uma identidade fora da allowlist não recebe papel administrativo'
);

select throws_ok(
  'select public.ensure_current_user_profile()',
  '42501',
  'Seu perfil ainda não está liberado no clube.',
  'a RPC legada também falha fechada para identidade fora da allowlist'
);

select ok(
  not has_function_privilege('anon', 'public.ensure_current_user_profile()', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.ensure_current_user_profile()', 'EXECUTE'),
  'somente authenticated alcança a RPC, que repete a autorização no banco'
);

insert into auth.users (
  id,
  email,
  raw_app_meta_data,
  raw_user_meta_data
)
values (
  '10000000-0000-4000-8000-000000000003'::uuid,
  'ci-pending-client@tests.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"app_context":"public","full_name":"Cliente Sintético"}'::jsonb
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","email":"ci-pending-client@tests.invalid"}',
  true
);

select is(
  (
    select client.status
      from public.ensure_current_app_client('Cliente Sintético', null) as client
  ),
  'PENDENTE',
  'o hotfix preserva o onboarding de novos clientes como PENDENTE'
);

select is(
  (
    select count(*)::integer
      from public.profiles
     where id = '10000000-0000-4000-8000-000000000003'::uuid
  ),
  0,
  'o cadastro Ilha Play permanece separado dos perfis de equipe'
);

select has_table(
  'public',
  'tournament_registration_groups',
  'a inscrição familiar possui um agrupador exclusivo do torneio'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.tournament_registration_groups'::regclass),
  'RLS está habilitado nos grupos familiares do torneio'
);

select ok(
  not has_table_privilege('anon', 'public.tournament_registration_groups', 'SELECT')
    and not has_table_privilege('authenticated', 'public.tournament_registration_groups', 'SELECT'),
  'dados do responsável não ficam expostos no Data API público'
);

select ok(
  has_table_privilege('service_role', 'public.tournament_registration_groups', 'SELECT')
    and has_table_privilege('service_role', 'public.tournament_registration_groups', 'INSERT')
    and has_table_privilege('service_role', 'public.tournament_registration_groups', 'UPDATE'),
  'somente o backend confiável opera a inscrição familiar'
);

select ok(
  (
    select count(*) = 2
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'registration_group_id'
      and table_name in ('tournament_registrations', 'tournament_payments')
  ),
  'inscrições individuais e o Pix único apontam para o mesmo grupo'
);

select ok(
  to_regclass('public.tournament_registration_groups_primary_registration_idx') is not null,
  'a referência principal do grupo possui índice para sincronização e limpeza'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.claim_public_tournament_family_bundle(uuid,uuid,text,text,text,text,jsonb)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'authenticated',
      'public.claim_public_tournament_family_bundle(uuid,uuid,text,text,text,text,jsonb)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.claim_public_tournament_family_bundle(uuid,uuid,text,text,text,text,jsonb)',
      'EXECUTE'
    ),
  'a reserva familiar atômica só pode ser chamada pela Edge Function'
);

-- Exercita o protocolo de idempotência e a reconciliação financeira com
-- fixtures sintéticas. Toda a seção roda na transação externa e é desfeita
-- pelo rollback final, sem criar atleta, cobrança ou evento persistente.
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"service_role"}',
  true
);

select is(
  public.claim_asaas_webhook_event(
    'ci-payment-event-1',
    'PAYMENT_RECEIVED',
    'pay_ci_reconciliation',
    '{"fixture":true}'::jsonb,
    '20000000-0000-4000-8000-000000000001'::uuid
  ),
  'CLAIMED',
  'o primeiro worker reivindica o evento do Asaas'
);

select is(
  public.claim_asaas_webhook_event(
    'ci-payment-event-1',
    'PAYMENT_RECEIVED',
    'pay_ci_reconciliation',
    '{"fixture":true}'::jsonb,
    '20000000-0000-4000-8000-000000000002'::uuid
  ),
  'BUSY',
  'um segundo worker não processa o evento enquanto o claim está ativo'
);

update public.asaas_webhook_events
set processing_started_at = now() - interval '2 minutes'
where event_id = 'ci-payment-event-1';

select is(
  public.claim_asaas_webhook_event(
    'ci-payment-event-1',
    'PAYMENT_RECEIVED',
    'pay_ci_reconciliation',
    '{"fixture":true,"retry":true}'::jsonb,
    '20000000-0000-4000-8000-000000000003'::uuid
  ),
  'CLAIMED',
  'um worker retoma o processamento depois que o claim fica obsoleto'
);

update public.asaas_webhook_events
set status = 'PROCESSED',
    processed_at = now()
where event_id = 'ci-payment-event-1';

select is(
  public.claim_asaas_webhook_event(
    'ci-payment-event-1',
    'PAYMENT_RECEIVED',
    'pay_ci_reconciliation',
    '{"fixture":true,"duplicate":true}'::jsonb,
    '20000000-0000-4000-8000-000000000004'::uuid
  ),
  'DONE',
  'um evento já processado é reconhecido sem executar novamente'
);

select is(
  public.claim_asaas_webhook_event(
    'ci-refund-event-1',
    'PAYMENT_REFUNDED',
    'pay_ci_reconciliation',
    '{"fixture":true,"refund":true}'::jsonb,
    '20000000-0000-4000-8000-000000000005'::uuid
  ),
  'CLAIMED',
  'o primeiro evento de estorno integral é reivindicado'
);

update public.asaas_webhook_events
set status = 'PROCESSED',
    processed_at = now(),
    processing_token = null,
    processing_started_at = null
where event_id = 'ci-refund-event-1';

select is(
  public.claim_asaas_webhook_event(
    'ci-refund-event-1',
    'PAYMENT_REFUNDED',
    'pay_ci_reconciliation',
    '{"fixture":true,"refund":true,"duplicate":true}'::jsonb,
    '20000000-0000-4000-8000-000000000006'::uuid
  ),
  'DONE',
  'o mesmo evento de estorno integral não é aplicado duas vezes'
);

insert into public.tournaments (
  id,
  name,
  slug,
  status,
  registration_open,
  is_published,
  default_fee,
  allowed_payment_methods
)
values (
  '22000000-0000-4000-8000-000000000001'::uuid,
  'Torneio Checkout Sintético',
  'ci-payment-checkout',
  'REGISTRATION_OPEN',
  true,
  true,
  50,
  '["PIX"]'::jsonb
);

insert into public.tournament_categories (
  id,
  tournament_id,
  code,
  name,
  registration_fee,
  registration_open,
  max_entries,
  sort_order
)
values
  (
    '22000000-0000-4000-8000-000000000002'::uuid,
    '22000000-0000-4000-8000-000000000001'::uuid,
    'CI-A',
    'Classe Checkout A',
    50,
    true,
    8,
    1
  ),
  (
    '22000000-0000-4000-8000-000000000003'::uuid,
    '22000000-0000-4000-8000-000000000001'::uuid,
    'CI-B',
    'Classe Checkout B',
    50,
    true,
    8,
    2
  );

insert into public.tournament_athletes (
  id,
  source_key,
  full_name,
  email
)
values
  (
    '22000000-0000-4000-8000-000000000004'::uuid,
    'ci-payment-checkout-athlete-a',
    'Atleta Checkout A',
    'ci-checkout-a@tests.invalid'
  ),
  (
    '22000000-0000-4000-8000-000000000005'::uuid,
    'ci-payment-checkout-athlete-b',
    'Atleta Checkout B',
    'ci-checkout-b@tests.invalid'
  );

create temporary table ci_checkout_created_result on commit drop as
select public.claim_public_tournament_registration_checkout(
  '22000000-0000-4000-8000-000000000001'::uuid,
  '22000000-0000-4000-8000-000000000006'::uuid,
  '22000000-0000-4000-8000-000000000002'::uuid,
  null,
  '22000000-0000-4000-8000-000000000004'::uuid,
  'Atleta Checkout A',
  'Colatina',
  'Ilha Tênis',
  null,
  null,
  50,
  'PIX',
  'SANDBOX',
  'Fixture de checkout atômico'
) as result;

select ok(
  (select (result ->> 'payment_created')::boolean from ci_checkout_created_result)
    and exists (
      select 1
      from public.tournament_registrations as registration
      join public.tournament_payments as payment
        on payment.registration_id = registration.id
       and payment.tournament_id = registration.tournament_id
      where registration.request_token = '22000000-0000-4000-8000-000000000006'::uuid
        and registration.athlete_id = '22000000-0000-4000-8000-000000000004'::uuid
        and registration.category_id = '22000000-0000-4000-8000-000000000002'::uuid
        and registration.status = 'PENDING'
        and registration.payment_status = 'PENDING'
        and registration.total_amount = 50
        and payment.status = 'CREATED'
        and payment.billing_type = 'PIX'
        and payment.provider_environment = 'SANDBOX'
        and payment.amount = 50
    ),
  'o checkout individual cria inscrição e cobrança local na mesma operação'
);

create temporary table ci_checkout_replayed_result on commit drop as
select public.claim_public_tournament_registration_checkout(
  '22000000-0000-4000-8000-000000000001'::uuid,
  '22000000-0000-4000-8000-000000000006'::uuid,
  '22000000-0000-4000-8000-000000000002'::uuid,
  null,
  '22000000-0000-4000-8000-000000000004'::uuid,
  'Atleta Checkout A',
  'Colatina',
  'Ilha Tênis',
  null,
  null,
  50,
  'PIX',
  'SANDBOX',
  'Fixture de checkout atômico'
) as result;

select ok(
  not (select (result ->> 'payment_created')::boolean from ci_checkout_replayed_result)
    and (
      select result #>> '{registration,id}'
      from ci_checkout_replayed_result
    ) = (
      select result #>> '{registration,id}'
      from ci_checkout_created_result
    )
    and (
      select result #>> '{payment,id}'
      from ci_checkout_replayed_result
    ) = (
      select result #>> '{payment,id}'
      from ci_checkout_created_result
    )
    and (
      select count(*)
      from public.tournament_registrations
      where request_token = '22000000-0000-4000-8000-000000000006'::uuid
    ) = 1
    and (
      select count(*)
      from public.tournament_payments as payment
      join public.tournament_registrations as registration
        on registration.id = payment.registration_id
      where registration.request_token = '22000000-0000-4000-8000-000000000006'::uuid
    ) = 1,
  'repetir o mesmo request_token devolve a inscrição e a cobrança existentes'
);

select throws_ok(
  $sql$
    select public.claim_public_tournament_registration_checkout(
      '22000000-0000-4000-8000-000000000001'::uuid,
      '22000000-0000-4000-8000-000000000006'::uuid,
      '22000000-0000-4000-8000-000000000002'::uuid,
      null,
      '22000000-0000-4000-8000-000000000005'::uuid,
      'Atleta Checkout B',
      'Colatina',
      'Ilha Tênis',
      null,
      null,
      50,
      'PIX',
      'SANDBOX',
      'Tentativa divergente por atleta'
    )
  $sql$,
  '42501',
  'Esta tentativa não corresponde à inscrição informada.',
  'o mesmo request_token não pode ser reutilizado para outro atleta'
);

select throws_ok(
  $sql$
    select public.claim_public_tournament_registration_checkout(
      '22000000-0000-4000-8000-000000000001'::uuid,
      '22000000-0000-4000-8000-000000000006'::uuid,
      '22000000-0000-4000-8000-000000000003'::uuid,
      null,
      '22000000-0000-4000-8000-000000000004'::uuid,
      'Atleta Checkout A',
      'Colatina',
      'Ilha Tênis',
      null,
      null,
      50,
      'PIX',
      'SANDBOX',
      'Tentativa divergente por categoria'
    )
  $sql$,
  '42501',
  'Esta tentativa não corresponde à inscrição informada.',
  'o mesmo request_token não pode ser reutilizado para outra categoria'
);

select throws_ok(
  $sql$
    select public.claim_public_tournament_registration_checkout(
      '22000000-0000-4000-8000-000000000001'::uuid,
      '22000000-0000-4000-8000-000000000006'::uuid,
      '22000000-0000-4000-8000-000000000002'::uuid,
      null,
      '22000000-0000-4000-8000-000000000004'::uuid,
      'Atleta Checkout A',
      'Colatina',
      'Ilha Tênis',
      null,
      null,
      50,
      'BOLETO',
      'SANDBOX',
      'Tentativa com forma de pagamento inválida'
    )
  $sql$,
  '22023',
  'Forma de pagamento do provedor inválida.',
  'o checkout atômico rejeita qualquer forma de pagamento diferente de Pix'
);

insert into public.tournament_athletes (
  id,
  source_key,
  full_name,
  email,
  phone
)
values (
  '21000000-0000-4000-8000-000000000001'::uuid,
  'ci-payment-reconciliation-athlete',
  'Atleta Reconciliação Sintético',
  'ci-payment-athlete@tests.invalid',
  '27999999997'
);

insert into public.tournament_registration_groups (
  id,
  tournament_id,
  request_token,
  public_token,
  payer_name,
  payer_email,
  payer_phone,
  payer_cpf,
  status,
  total_amount
)
select
  '21000000-0000-4000-8000-000000000002'::uuid,
  tournament.id,
  '21000000-0000-4000-8000-000000000003'::uuid,
  '21000000-0000-4000-8000-000000000004'::uuid,
  'Responsável Financeiro Sintético',
  'ci-payment-payer@tests.invalid',
  '27999999996',
  '12345678901',
  'PENDING',
  100
from public.tournaments as tournament
where tournament.slug = 'ilha-open-2026-teste';

insert into public.tournament_registrations (
  id,
  tournament_id,
  category_id,
  athlete_id,
  public_name,
  public_token,
  request_token,
  status,
  payment_status,
  total_amount,
  paid_amount,
  source,
  registration_group_id
)
select
  '21000000-0000-4000-8000-000000000005'::uuid,
  tournament.id,
  (
    select category.id
    from public.tournament_categories as category
    where category.tournament_id = tournament.id
    order by category.sort_order, category.id
    limit 1
  ),
  '21000000-0000-4000-8000-000000000001'::uuid,
  'Atleta Reconciliação Sintético',
  '21000000-0000-4000-8000-000000000006'::uuid,
  '21000000-0000-4000-8000-000000000007'::uuid,
  'PENDING',
  'PENDING',
  100,
  0,
  'DEMO',
  '21000000-0000-4000-8000-000000000002'::uuid
from public.tournaments as tournament
where tournament.slug = 'ilha-open-2026-teste';

update public.tournament_registration_groups
set primary_registration_id = '21000000-0000-4000-8000-000000000005'::uuid
where id = '21000000-0000-4000-8000-000000000002'::uuid;

insert into public.tournament_payments (
  id,
  tournament_id,
  registration_id,
  registration_group_id,
  provider,
  provider_environment,
  provider_payment_id,
  external_reference,
  billing_type,
  status,
  amount,
  expires_at,
  raw_response
)
select
  '21000000-0000-4000-8000-000000000008'::uuid,
  registration.tournament_id,
  registration.id,
  registration.registration_group_id,
  'ASAAS',
  'SANDBOX',
  'pay_ci_reconciliation',
  'ci:tournament-payment-reconciliation',
  'PIX',
  'PENDING',
  100,
  now() - interval '1 hour',
  '{"fixture":true}'::jsonb
from public.tournament_registrations as registration
where registration.id = '21000000-0000-4000-8000-000000000005'::uuid;

insert into public.tournament_athletes (
  id,
  source_key,
  full_name,
  email,
  phone
)
values (
  '21000000-0000-4000-8000-000000000009'::uuid,
  'ci-payment-reconciliation-production-athlete',
  'Atleta Reconciliação Produção',
  'ci-payment-production@tests.invalid',
  '27999999995'
);

insert into public.tournament_registrations (
  id,
  tournament_id,
  category_id,
  athlete_id,
  public_name,
  public_token,
  status,
  payment_status,
  total_amount,
  paid_amount,
  source
)
select
  '21000000-0000-4000-8000-000000000010'::uuid,
  tournament.id,
  (
    select category.id
    from public.tournament_categories as category
    where category.tournament_id = tournament.id
    order by category.sort_order, category.id
    limit 1
  ),
  '21000000-0000-4000-8000-000000000009'::uuid,
  'Atleta Reconciliação Produção',
  '21000000-0000-4000-8000-000000000011'::uuid,
  'PENDING',
  'PENDING',
  100,
  0,
  'DEMO'
from public.tournaments as tournament
where tournament.slug = 'ilha-open-2026-teste';

insert into public.tournament_payments (
  id,
  tournament_id,
  registration_id,
  provider,
  provider_environment,
  provider_payment_id,
  external_reference,
  billing_type,
  status,
  amount,
  expires_at,
  raw_response
)
select
  '21000000-0000-4000-8000-000000000012'::uuid,
  registration.tournament_id,
  registration.id,
  'ASAAS',
  'PRODUCTION',
  'pay_ci_reconciliation',
  'ci:tournament-payment-reconciliation-production',
  'PIX',
  'PENDING',
  100,
  now() - interval '1 hour',
  '{"fixture":true,"environment":"production"}'::jsonb
from public.tournament_registrations as registration
where registration.id = '21000000-0000-4000-8000-000000000010'::uuid;

create temporary table ci_stale_reconciliation_result on commit drop as
select public.apply_tournament_payment_reconciliation(
  '21000000-0000-4000-8000-000000000008'::uuid,
  'PENDING',
  (
    select payment.updated_at - interval '1 second'
    from public.tournament_payments as payment
    where payment.id = '21000000-0000-4000-8000-000000000008'::uuid
  ),
  'RECEIVED',
  'SANDBOX',
  'pay_ci_reconciliation',
  'cus_ci_reconciliation',
  'PIX',
  'https://tests.invalid/invoice',
  'ci-pix-payload',
  'ci-pix-image',
  '2099-01-01 12:00:00+00'::timestamptz,
  '{"fixture":true,"phase":"stale"}'::jsonb,
  '2026-09-01 12:00:00+00'::timestamptz,
  '2026-09-01 11:59:00+00'::timestamptz,
  1,
  null,
  'CONFIRMED',
  'PAID',
  100,
  '2026-09-01 12:00:00+00'::timestamptz,
  null
) as result;

select ok(
  not (select (result ->> 'applied')::boolean from ci_stale_reconciliation_result),
  'o CAS recusa uma reconciliação baseada em updated_at obsoleto'
);

select ok(
  exists (
    select 1
    from public.tournament_payments as payment
    where payment.id = '21000000-0000-4000-8000-000000000008'::uuid
      and payment.status = 'PENDING'
      and payment.provider_customer_id is null
      and payment.paid_at is null
  )
    and exists (
      select 1
      from public.tournament_registrations as registration
      where registration.id = '21000000-0000-4000-8000-000000000005'::uuid
        and registration.status = 'PENDING'
        and registration.payment_status = 'PENDING'
        and registration.paid_amount = 0
    )
    and exists (
      select 1
      from public.tournament_registration_groups as registration_group
      where registration_group.id = '21000000-0000-4000-8000-000000000002'::uuid
        and registration_group.status = 'PENDING'
    ),
  'o CAS obsoleto não altera cobrança, inscrição nem grupo'
);

create temporary table ci_applied_reconciliation_result on commit drop as
select public.apply_tournament_payment_reconciliation(
  '21000000-0000-4000-8000-000000000008'::uuid,
  'PENDING',
  (
    select payment.updated_at
    from public.tournament_payments as payment
    where payment.id = '21000000-0000-4000-8000-000000000008'::uuid
  ),
  'RECEIVED',
  'SANDBOX',
  'pay_ci_reconciliation',
  'cus_ci_reconciliation',
  'PIX',
  'https://tests.invalid/invoice',
  'ci-pix-payload',
  'ci-pix-image',
  '2099-01-01 12:00:00+00'::timestamptz,
  '{"fixture":true,"phase":"applied"}'::jsonb,
  '2026-09-01 12:00:00+00'::timestamptz,
  '2026-09-01 11:59:00+00'::timestamptz,
  2,
  null,
  'CONFIRMED',
  'PAID',
  100,
  '2026-09-01 12:00:00+00'::timestamptz,
  null
) as result;

select ok(
  (select (result ->> 'applied')::boolean from ci_applied_reconciliation_result),
  'a reconciliação com a versão atual aplica a transição'
);

select ok(
  exists (
    select 1
    from public.tournament_payments as payment
    where payment.id = '21000000-0000-4000-8000-000000000008'::uuid
      and payment.status = 'RECEIVED'
      and payment.provider_payment_id = 'pay_ci_reconciliation'
      and payment.provider_customer_id = 'cus_ci_reconciliation'
      and payment.paid_at = '2026-09-01 12:00:00+00'::timestamptz
      and payment.reconciliation_attempts = 2
  ),
  'a aplicação persiste o estado e os identificadores da cobrança'
);

select ok(
  exists (
    select 1
    from public.tournament_payments
    where id = '21000000-0000-4000-8000-000000000008'::uuid
      and provider_environment = 'SANDBOX'
      and provider_payment_id = 'pay_ci_reconciliation'
      and status = 'RECEIVED'
  )
    and exists (
      select 1
      from public.tournament_payments
      where id = '21000000-0000-4000-8000-000000000012'::uuid
        and provider_environment = 'PRODUCTION'
        and provider_payment_id = 'pay_ci_reconciliation'
        and status = 'PENDING'
        and provider_customer_id is null
        and paid_at is null
        and reconciliation_attempts = 0
    ),
  'a reconciliação isola cobranças com o mesmo ID por ambiente do Asaas'
);

select ok(
  exists (
    select 1
    from public.tournament_registrations as registration
    where registration.id = '21000000-0000-4000-8000-000000000005'::uuid
      and registration.status = 'CONFIRMED'
      and registration.payment_status = 'PAID'
      and registration.paid_amount = 100
      and registration.confirmed_at = '2026-09-01 12:00:00+00'::timestamptz
  ),
  'a mesma aplicação confirma e quita a inscrição'
);

select ok(
  exists (
    select 1
    from public.tournament_registration_groups as registration_group
    where registration_group.id = '21000000-0000-4000-8000-000000000002'::uuid
      and registration_group.status = 'CONFIRMED'
  ),
  'a mesma aplicação confirma o grupo familiar'
);

select throws_ok(
  $sql$
    select public.apply_tournament_payment_reconciliation(
      '21000000-0000-4000-8000-000000000008'::uuid,
      'RECEIVED',
      (
        select payment.updated_at
        from public.tournament_payments as payment
        where payment.id = '21000000-0000-4000-8000-000000000008'::uuid
      ),
      'CONFIRMED',
      'SANDBOX',
      'pay_ci_divergent',
      'cus_ci_reconciliation',
      'PIX',
      null,
      null,
      null,
      null,
      '{"fixture":true,"phase":"provider-divergence"}'::jsonb,
      '2026-09-01 12:00:00+00'::timestamptz,
      null,
      3,
      null,
      'CONFIRMED',
      'PAID',
      100,
      '2026-09-01 12:00:00+00'::timestamptz,
      null
    )
  $sql$,
  '22023',
  'Identificador da cobrança divergente.',
  'a reconciliação rejeita um identificador de cobrança divergente'
);

select ok(
  exists (
    select 1
    from public.tournament_payments as payment
    where payment.id = '21000000-0000-4000-8000-000000000008'::uuid
      and payment.status = 'RECEIVED'
      and payment.provider_payment_id = 'pay_ci_reconciliation'
      and payment.reconciliation_attempts = 2
  )
    and exists (
      select 1
      from public.tournament_registrations as registration
      where registration.id = '21000000-0000-4000-8000-000000000005'::uuid
        and registration.status = 'CONFIRMED'
        and registration.payment_status = 'PAID'
    ),
  'a divergência do provedor preserva cobrança e inscrição anteriores'
);

select throws_ok(
  $sql$
    select public.apply_tournament_payment_reconciliation(
      '21000000-0000-4000-8000-000000000008'::uuid,
      'RECEIVED',
      (
        select payment.updated_at
        from public.tournament_payments as payment
        where payment.id = '21000000-0000-4000-8000-000000000008'::uuid
      ),
      'CONFIRMED',
      'SANDBOX',
      'pay_ci_reconciliation',
      'cus_ci_reconciliation',
      'PIX',
      null,
      null,
      null,
      null,
      '{"fixture":true,"phase":"atomic-rollback"}'::jsonb,
      '2026-09-01 12:00:00+00'::timestamptz,
      null,
      3,
      null,
      'INVALID',
      'PAID',
      100,
      '2026-09-01 12:00:00+00'::timestamptz,
      null
    )
  $sql$,
  '22023',
  'Status de inscrição inválido.',
  'uma falha na sincronização interrompe a aplicação inteira'
);

select ok(
  exists (
    select 1
    from public.tournament_payments as payment
    where payment.id = '21000000-0000-4000-8000-000000000008'::uuid
      and payment.status = 'RECEIVED'
      and payment.reconciliation_attempts = 2
  )
    and exists (
      select 1
      from public.tournament_registration_groups as registration_group
      where registration_group.id = '21000000-0000-4000-8000-000000000002'::uuid
        and registration_group.status = 'CONFIRMED'
    ),
  'o rollback atômico desfaz a atualização e conserva cobrança, inscrição e grupo'
);

select ok(
  not public.archive_expired_tournament_payment(
    '21000000-0000-4000-8000-000000000008'::uuid
  )
    and exists (
      select 1
      from public.tournament_payments
      where id = '21000000-0000-4000-8000-000000000008'::uuid
        and status = 'RECEIVED'
    )
    and exists (
      select 1
      from public.tournament_registrations
      where id = '21000000-0000-4000-8000-000000000005'::uuid
    ),
  'o arquivamento preserva uma cobrança recebida mesmo após a expiração'
);

update public.tournament_payments
set status = 'CONFIRMED'
where id = '21000000-0000-4000-8000-000000000008'::uuid;

select ok(
  not public.archive_expired_tournament_payment(
    '21000000-0000-4000-8000-000000000008'::uuid
  )
    and exists (
      select 1
      from public.tournament_payments
      where id = '21000000-0000-4000-8000-000000000008'::uuid
        and status = 'CONFIRMED'
    )
    and exists (
      select 1
      from public.tournament_registration_groups
      where id = '21000000-0000-4000-8000-000000000002'::uuid
    ),
  'o arquivamento preserva uma cobrança confirmada e o grupo relacionado'
);

update public.tournament_payments
set status = 'REVIEW_REQUIRED'
where id = '21000000-0000-4000-8000-000000000008'::uuid;

select ok(
  not public.archive_expired_tournament_payment(
    '21000000-0000-4000-8000-000000000008'::uuid
  )
    and exists (
      select 1
      from public.tournament_payments
      where id = '21000000-0000-4000-8000-000000000008'::uuid
        and status = 'REVIEW_REQUIRED'
    )
    and exists (
      select 1
      from public.tournament_registrations
      where id = '21000000-0000-4000-8000-000000000005'::uuid
    ),
  'o arquivamento preserva cobrança em revisão e sua inscrição'
);

update public.tournament_payments
set status = 'PARTIALLY_REFUNDED'
where id = '21000000-0000-4000-8000-000000000008'::uuid;

select ok(
  not public.archive_expired_tournament_payment(
    '21000000-0000-4000-8000-000000000008'::uuid
  )
    and exists (
      select 1
      from public.tournament_payments
      where id = '21000000-0000-4000-8000-000000000008'::uuid
        and status = 'PARTIALLY_REFUNDED'
    )
    and exists (
      select 1
      from public.tournament_registrations
      where id = '21000000-0000-4000-8000-000000000005'::uuid
    ),
  'o arquivamento preserva cobrança com estorno parcial e sua inscrição'
);

create temporary table ci_environment_quarantine_result on commit drop as
select public.quarantine_tournament_payment_environment(
  '21000000-0000-4000-8000-000000000008'::uuid,
  'PARTIALLY_REFUNDED',
  (
    select payment.updated_at
    from public.tournament_payments as payment
    where payment.id = '21000000-0000-4000-8000-000000000008'::uuid
  ),
  'ci_environment_mismatch'
) as result;

select ok(
  (select (result ->> 'applied')::boolean from ci_environment_quarantine_result)
    and exists (
      select 1
      from public.tournament_payments
      where id = '21000000-0000-4000-8000-000000000008'::uuid
        and status = 'REVIEW_REQUIRED'
        and invoice_url is null
        and pix_payload is null
        and pix_encoded_image is null
        and next_reconciliation_at is null
    )
    and exists (
      select 1
      from public.tournament_registrations
      where id = '21000000-0000-4000-8000-000000000005'::uuid
        and status = 'PENDING'
        and payment_status = 'PENDING'
        and paid_amount = 0
    ),
  'a quarentena de ambiente remove meios de pagamento e suspende a vaga atomicamente'
);

create temporary table ci_partial_refund_reconciliation_result on commit drop as
select public.apply_tournament_payment_reconciliation(
  '21000000-0000-4000-8000-000000000008'::uuid,
  'REVIEW_REQUIRED',
  (
    select payment.updated_at
    from public.tournament_payments as payment
    where payment.id = '21000000-0000-4000-8000-000000000008'::uuid
  ),
  'PARTIALLY_REFUNDED',
  'SANDBOX',
  'pay_ci_reconciliation',
  'cus_ci_reconciliation',
  'PIX',
  null,
  null,
  null,
  null,
  '{"fixture":true,"phase":"partial-refund"}'::jsonb,
  '2026-09-01 12:00:00+00'::timestamptz,
  null,
  0,
  now() + interval '24 hours',
  'CONFIRMED',
  'PARTIALLY_REFUNDED',
  70,
  '2026-09-01 12:00:00+00'::timestamptz,
  null
) as result;

select ok(
  (select (result ->> 'applied')::boolean from ci_partial_refund_reconciliation_result),
  'a reconciliação aplica o estorno parcial atomicamente'
);

select ok(
  exists (
    select 1
    from public.tournament_payments
    where id = '21000000-0000-4000-8000-000000000008'::uuid
      and status = 'PARTIALLY_REFUNDED'
      and paid_at = '2026-09-01 12:00:00+00'::timestamptz
      and next_reconciliation_at is not null
  )
    and exists (
      select 1
      from public.tournament_registrations
      where id = '21000000-0000-4000-8000-000000000005'::uuid
        and status = 'CONFIRMED'
        and payment_status = 'PARTIALLY_REFUNDED'
        and paid_amount = 70
        and confirmed_at = '2026-09-01 12:00:00+00'::timestamptz
        and cancelled_at is null
    )
    and exists (
      select 1
      from public.tournament_registration_groups
      where id = '21000000-0000-4000-8000-000000000002'::uuid
        and status = 'CONFIRMED'
    ),
  'o estorno parcial mantém a vaga confirmada e reduz o valor líquido pago'
);

create temporary table ci_full_refund_reconciliation_result on commit drop as
select public.apply_tournament_payment_reconciliation(
  '21000000-0000-4000-8000-000000000008'::uuid,
  'PARTIALLY_REFUNDED',
  (
    select payment.updated_at
    from public.tournament_payments as payment
    where payment.id = '21000000-0000-4000-8000-000000000008'::uuid
  ),
  'REFUNDED',
  'SANDBOX',
  'pay_ci_reconciliation',
  'cus_ci_reconciliation',
  'PIX',
  null,
  null,
  null,
  null,
  '{"fixture":true,"phase":"full-refund"}'::jsonb,
  null,
  null,
  0,
  null,
  'REFUNDED',
  'REFUNDED',
  0,
  null,
  null
) as result;

select ok(
  (select (result ->> 'applied')::boolean from ci_full_refund_reconciliation_result),
  'a reconciliação aplica o estorno integral após o parcial'
);

select ok(
  exists (
    select 1
    from public.tournament_payments
    where id = '21000000-0000-4000-8000-000000000008'::uuid
      and status = 'REFUNDED'
      and paid_at is null
      and next_reconciliation_at is null
  )
    and exists (
      select 1
      from public.tournament_registrations
      where id = '21000000-0000-4000-8000-000000000005'::uuid
        and status = 'REFUNDED'
        and payment_status = 'REFUNDED'
        and paid_amount = 0
        and confirmed_at is null
    )
    and exists (
      select 1
      from public.tournament_registration_groups
      where id = '21000000-0000-4000-8000-000000000002'::uuid
        and status = 'REFUNDED'
    ),
  'o estorno integral zera a cobrança e encerra inscrição e grupo como reembolsados'
);

select ok(
  not exists (
    select 1
    from public.tournaments
    where coalesce(settings, '{}'::jsonb) ? 'courtesy_registration_token'
       or (to_jsonb(tournaments) ->> 'courtesy_registration_token') is not null
  )
    and exists (
      select 1
      from pg_constraint
      where conrelid = 'public.tournaments'::regclass
        and conname = 'tournaments_settings_without_legacy_courtesy_check'
        and convalidated
    )
    and (
      not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'tournaments'
          and column_name = 'courtesy_registration_token'
      )
      or exists (
        select 1
        from pg_constraint
        where conrelid = 'public.tournaments'::regclass
          and conname = 'tournaments_without_legacy_courtesy_token_check'
          and convalidated
      )
    ),
  'o token legado foi removido e não pode voltar aos settings persistidos'
);

update public.tournaments
set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
  'api_key', 'ci-secret-must-not-leak',
  'registration_function', 'tournament-internal-register',
  'public_tabs', jsonb_build_object('categories', false)
)
where id = (
  select id
  from public.tournaments
  where slug = 'ilha-open-2026-teste'
);

create temporary table ci_anon_tournament_snapshot (payload jsonb not null);
grant insert on table ci_anon_tournament_snapshot to anon;
set local role anon;
insert into ci_anon_tournament_snapshot (payload)
select public.tournament_public_snapshot('ilha-open-2026-teste');
reset role;

select ok(
  (
    select
      coalesce((payload #> '{tournament,settings}') ? 'public_tabs', false)
      and not coalesce((payload -> 'tournament') ? 'courtesy_registration_token', true)
      and not coalesce((payload #> '{tournament,settings}') ?| array[
        'courtesy_registration_token',
        'api_key',
        'registration_function'
      ], true)
    from ci_anon_tournament_snapshot
  ),
  'o snapshot anônimo preserva apresentação permitida sem expor capacidades'
);

select ok(
  not has_function_privilege('anon', 'private.tournament_public_snapshot_legacy_unsafe(text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'private.tournament_public_snapshot_legacy_unsafe(text)', 'EXECUTE')
    and not has_function_privilege('service_role', 'private.tournament_public_snapshot_legacy_unsafe(text)', 'EXECUTE')
    and has_function_privilege('anon', 'public.tournament_public_snapshot(text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.tournament_public_snapshot(text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.tournament_public_snapshot(text)', 'EXECUTE'),
  'somente o wrapper seguro do snapshot é executável pelos papéis da API'
);

select ok(
  not exists (
    select 1
    from unnest(array[
      'tournaments', 'tournament_categories', 'tournament_athletes',
      'tournament_registrations', 'tournament_payments', 'asaas_webhook_events',
      'tournament_courts', 'tournament_matches', 'tournament_match_sets',
      'tournament_schedule_events', 'tournament_sponsors', 'tournament_live_state',
      'tournament_audit_log', 'tournament_registration_orders',
      'tournament_registration_groups', 'tournament_registration_invites',
      'public_registration_rate_limits'
    ]) as protected(table_name)
    where has_table_privilege('anon', format('public.%I', protected.table_name), 'SELECT')
       or has_table_privilege('anon', format('public.%I', protected.table_name), 'INSERT')
       or has_table_privilege('anon', format('public.%I', protected.table_name), 'UPDATE')
       or has_table_privilege('anon', format('public.%I', protected.table_name), 'DELETE')
       or has_table_privilege('anon', format('public.%I', protected.table_name), 'TRUNCATE')
       or has_table_privilege('anon', format('public.%I', protected.table_name), 'REFERENCES')
       or has_table_privilege('anon', format('public.%I', protected.table_name), 'TRIGGER')
  ),
  'anon não possui privilégios diretos nas relações de torneio'
);

select ok(
  not exists (
    select 1
    from unnest(array[
      'tournaments', 'tournament_categories', 'tournament_athletes',
      'tournament_registrations', 'tournament_payments', 'asaas_webhook_events',
      'tournament_courts', 'tournament_matches', 'tournament_match_sets',
      'tournament_schedule_events', 'tournament_sponsors', 'tournament_live_state',
      'tournament_audit_log', 'tournament_registration_orders',
      'tournament_registration_groups', 'tournament_registration_invites',
      'public_registration_rate_limits'
    ]) as protected(table_name)
    where has_table_privilege('authenticated', format('public.%I', protected.table_name), 'TRUNCATE')
       or has_table_privilege('authenticated', format('public.%I', protected.table_name), 'REFERENCES')
       or has_table_privilege('authenticated', format('public.%I', protected.table_name), 'TRIGGER')
  ),
  'authenticated não recebe privilégios estruturais ou destrutivos'
);

select ok(
  not exists (
    select 1
    from unnest(array[
      'tournaments', 'tournament_categories', 'tournament_athletes',
      'tournament_registrations', 'tournament_payments', 'asaas_webhook_events',
      'tournament_courts', 'tournament_matches', 'tournament_match_sets',
      'tournament_schedule_events', 'tournament_sponsors', 'tournament_live_state',
      'tournament_audit_log', 'tournament_registration_orders',
      'tournament_registration_groups', 'tournament_registration_invites',
      'public_registration_rate_limits'
    ]) as protected(table_name)
    where has_table_privilege('service_role', format('public.%I', protected.table_name), 'TRUNCATE')
       or has_table_privilege('service_role', format('public.%I', protected.table_name), 'REFERENCES')
       or has_table_privilege('service_role', format('public.%I', protected.table_name), 'TRIGGER')
  ),
  'service_role recebe somente DML e não conserva privilégios estruturais legados'
);

select ok(
  has_table_privilege('service_role', 'public.tournament_audit_log', 'SELECT')
    and has_table_privilege('service_role', 'public.tournament_audit_log', 'INSERT')
    and not has_table_privilege('service_role', 'public.tournament_audit_log', 'UPDATE')
    and not has_table_privilege('service_role', 'public.tournament_audit_log', 'DELETE'),
  'o log de auditoria permanece append-only até para service_role'
);

select ok(
  has_sequence_privilege('service_role', 'public.tournament_audit_log_id_seq', 'USAGE')
    and has_sequence_privilege('service_role', 'public.tournament_audit_log_id_seq', 'SELECT')
    and not has_sequence_privilege('service_role', 'public.tournament_audit_log_id_seq', 'UPDATE'),
  'a sequência do log concede somente os privilégios necessários'
);

select ok(
  not exists (
    select 1
    from unnest(array[
      'asaas_webhook_events', 'tournament_registration_orders',
      'tournament_registration_groups', 'tournament_registration_invites',
      'public_registration_rate_limits'
    ]) as protected(table_name)
    where has_table_privilege('authenticated', format('public.%I', protected.table_name), 'SELECT')
       or has_table_privilege('authenticated', format('public.%I', protected.table_name), 'INSERT')
       or has_table_privilege('authenticated', format('public.%I', protected.table_name), 'UPDATE')
       or has_table_privilege('authenticated', format('public.%I', protected.table_name), 'DELETE')
  ),
  'eventos de webhook, convites, grupos, pedidos e limites permanecem service-only'
);

select ok(
  not exists (
    select 1
    from unnest(array[
      'tournament_athletes_auth_user_id_idx',
      'tournament_athletes_app_client_id_idx',
      'tournament_registrations_category_tournament_idx',
      'tournament_payments_tournament_status_idx',
      'tournament_audit_log_tournament_created_idx',
      'tournament_registration_orders_athlete_id_idx',
      'tournament_registration_invites_created_by_idx'
    ]) as expected(index_name)
    where to_regclass(format('public.%I', expected.index_name)) is null
  ),
  'as chaves estrangeiras operacionais possuem índices de apoio'
);

select * from finish();

rollback;
