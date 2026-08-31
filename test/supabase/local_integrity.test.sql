begin;

create extension if not exists pgtap with schema extensions;

select plan(50);

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
    select settings ->> 'registration_mode'
    from public.tournaments
    where slug = 'ilha-open-interno-2026'
  ),
  'MONTHLY_BILLING_SIMPLE',
  'o novo torneio usa o modo separado de cobrança na mensalidade'
);

select is(
  (
    select count(*)::integer
    from public.tournament_categories as category
    join public.tournaments as tournament on tournament.id = category.tournament_id
    where tournament.slug = 'ilha-open-interno-2026'
      and category.active
  ),
  10,
  'as dez classes separadas por sexo são cadastradas e editáveis no ADM'
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

select * from finish();

rollback;
