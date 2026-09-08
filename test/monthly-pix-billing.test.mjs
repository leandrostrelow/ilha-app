import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { projectRoot } from '../scripts/project-files.mjs';

const migrationPath = path.join(
  projectRoot,
  'supabase',
  'migrations',
  '20260908174357_activate_monthly_pix_billing.sql'
);
const functionPath = path.join(projectRoot, 'supabase', 'functions', 'app-monthly-billing', 'index.ts');
const scheduleMigrationPath = path.join(
  projectRoot,
  'supabase',
  'migrations',
  '20260908174852_schedule_app_monthly_billing.sql'
);
const dispatcherPath = path.join(
  projectRoot,
  'supabase',
  'functions',
  'client-notification-dispatch',
  'index.ts'
);
const [migration, scheduleMigration, edgeFunction, dispatcher] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(scheduleMigrationPath, 'utf8'),
  readFile(functionPath, 'utf8'),
  readFile(dispatcherPath, 'utf8')
]);

test('financeiro mensal mantém provider, customer, runs e settings fora do acesso do app', () => {
  for (const table of [
    'app_invoice_provider_payments',
    'app_payment_customers',
    'app_monthly_billing_runs',
    'app_monthly_billing_settings',
    'app_monthly_billing_settings_audit'
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, 'i'));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table}[\\s\\S]*?from public, anon, authenticated, service_role`, 'i'));
  }
  assert.match(migration, /enabled boolean not null default false/i);
  assert.match(migration, /values \(true, false\)/i);
  assert.doesNotMatch(migration, /create policy[\s\S]{0,120}app_invoice_provider_payments/i);
});

test('uma fatura possui uma cobrança PIX avulsa e referência externa estável', () => {
  assert.match(migration, /invoice_id uuid not null unique[\s\S]*references public\.app_payment_invoices\(id\) on delete restrict/i);
  assert.match(migration, /billing_type text not null default 'PIX'/i);
  assert.match(migration, /external_reference = 'ilha-monthly-invoice:' \|\| invoice_id::text/i);
  assert.match(migration, /unique index app_invoice_provider_payments_provider_id_uidx/i);
  assert.doesNotMatch(edgeFunction, /\/subscriptions/i);
  assert.match(edgeFunction, /billingType: "PIX"/);
});

test('geração é mensal, idempotente e nunca fatura o dependente', () => {
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*ilha-monthly-billing:/i);
  assert.match(migration, /app_payment_invoices_client_competence_uidx/i);
  assert.match(migration, /on conflict \(invoice_id\) do nothing/i);
  assert.match(migration, /dependent\.status in \('PENDENTE', 'ATIVO'\)/i);
  assert.match(migration, /when resolved\.is_family_dependent then 'FAMILY_DEPENDENT'/i);
  assert.match(migration, /sum\(coalesce\(member\.monthly_amount, 0\)\)/i);
  assert.match(migration, /coalesce\(member\.monthly_amount, 0\)[\s\S]*from public\.app_family_members as member/i);
  assert.match(migration, /unconfirmed_family_count > 0 then 'FAMILY_MEMBER_CONFIRMATION_PENDING'/i);
  assert.doesNotMatch(migration, /FAMILY_MEMBER_AMOUNT_MISSING/i);
  assert.match(migration, /not coalesce\(public\.is_valid_cpf\(resolved\.cpf\), false\)[\s\S]*MISSING_VALID_CPF/i);
  assert.match(migration, /existing_invoice_id is not null[\s\S]*provider_row_id is not null[\s\S]*then null[\s\S]*when resolved\.is_family_dependent/i);
});

test('snapshot de valor, vencimento e família congela quando provider row existe', () => {
  assert.match(migration, /guard_app_payment_invoice_billing_snapshot/i);
  assert.match(migration, /new\.amount is distinct from old\.amount/i);
  assert.match(migration, /new\.due_date is distinct from old\.due_date/i);
  assert.match(migration, /guard_app_family_invoice_item_snapshot/i);
  assert.match(migration, /A composição familiar fica congelada após a emissão\./i);
  assert.match(migration, /has_provider_snapshot[\s\S]*new\.status is distinct from old\.status/i);
  assert.match(migration, /new\.payment_method is distinct from old\.payment_method/i);
  assert.match(migration, /new\.paid_at is distinct from old\.paid_at/i);
  assert.match(migration, /has_authoritative_status[\s\S]*owns financial transitions/i);
  assert.match(migration, /issued_at = case[\s\S]*p_pix_payload[\s\S]*coalesce\(issued_at, now\(\)\)[\s\S]*else issued_at/i);
});

test('falha operacional alerta equipe autorizada sem PII e com dedupe', () => {
  assert.match(migration, /monthly-billing-alert:[\s\S]*on conflict \(dedupe_key\)[\s\S]*do nothing/i);
  assert.match(migration, /protected_access_accounts[\s\S]*finance\.write[\s\S]*communication/i);
  assert.match(migration, /\/adm\?module=finance/);
  const alertBlock = migration.match(/insert into public\.app_client_notifications \([\s\S]*?monthly-billing-alert:[\s\S]*?do nothing;/i)?.[0] || '';
  assert.doesNotMatch(alertBlock, /client\.(?:cpf|email|phone)/i);
  assert.match(dispatcher, /adminOnlyEvents[\s\S]*FATURA_MENSAL_FALHA[\s\S]*\?\s*"ADM"\s*:\s*"ILHA_PLAY"/i);
});

test('retry consulta externalReference antes de qualquer POST de pagamento', () => {
  const functionBody = edgeFunction.match(
    /async function createOrRecoverPayment\([\s\S]*?\n}\n\nasync function fetchPix/
  )?.[0] || '';
  assert.ok(functionBody, 'função createOrRecoverPayment precisa existir');
  const lookup = functionBody.indexOf('findAsaasPayment(externalReference)');
  const post = functionBody.indexOf('asaasRequest("/payments",');
  assert.ok(lookup >= 0 && post > lookup, 'lookup exato precisa ocorrer antes do POST');
  assert.match(functionBody, /storedProviderPaymentId[\s\S]*\/payments\/\$\{encodeURIComponent\(storedProviderPaymentId\)\}/);
  assert.match(functionBody, /catch \(error\)[\s\S]*findAsaasPayment\(externalReference\)/);
  assert.match(functionBody, /claim\.allow_provider_create !== true[\s\S]*revisão manual[\s\S]*asaasRequest\("\/payments",/i);
  assert.match(migration, /payment\.status as claimed_status[\s\S]*claimed\.claimed_status in \('READY', 'FAILED'\)/i);
  assert.match(edgeFunction, /DuplicateProviderRecordsError\("payment"\)/);
  assert.match(edgeFunction, /if \(providerCustomerId !== customerId\)/);
});

test('customer mensal reutiliza CPF/CNPJ exato sem criar duplicata', () => {
  const functionBody = edgeFunction.match(
    /async function ensureAsaasCustomer\([\s\S]*?\n}\n\nasync function createOrRecoverPayment/
  )?.[0] || '';
  assert.ok(functionBody, 'função ensureAsaasCustomer precisa existir');
  const claim = functionBody.indexOf('claim_app_payment_customer_resolution');
  const externalReferenceLookup = functionBody.indexOf('findAsaasCustomer(externalReference)');
  const documentLookup = functionBody.indexOf('findAsaasCustomerByDocument(cpf)');
  const post = functionBody.indexOf('asaasRequest("/customers",');
  assert.ok(claim >= 0 && externalReferenceLookup > claim && documentLookup > externalReferenceLookup && post > documentLookup);
  assert.match(edgeFunction, /cpfCnpj=\$\{encodeURIComponent\(cpfCnpj\)\}&limit=2/);
  assert.match(edgeFunction, /matches\.length > 1[\s\S]*DuplicateProviderRecordsError\("customer"\)/);
  assert.doesNotMatch(edgeFunction, /console\.(?:log|warn|error)\([^\n]*cpf/i);
  assert.equal((functionBody.match(/cpfCnpj: cpf/g) || []).length, 1);
  assert.match(functionBody, /p_resolution_token: resolutionToken/);
  assert.match(functionBody, /allowProviderCreate[\s\S]*mark_app_payment_customer_create_attempt[\s\S]*asaasRequest\("\/customers",/i);
  assert.match(migration, /status in \('ACTIVE', 'RESOLVING', 'REVIEW_REQUIRED'\)/i);
  assert.match(migration, /resolution_started_at[\s\S]*interval '3 minutes'/i);
  assert.match(migration, /resolution_token = p_resolution_token/i);
  assert.match(migration, /provider_create_attempted_at[\s\S]*resultado ambíguo e exige revisão/i);
  assert.match(edgeFunction, /async function syncAsaasCustomerContact[\s\S]*method: "PUT"[\s\S]*notificationDisabled: environment !== "PRODUCTION"/i);
  assert.match(edgeFunction, /status === "ACTIVE" && mappedId[\s\S]*syncAsaasCustomerContact/i);
  assert.match(functionBody, /let reusedCustomer = Boolean\(customer\)[\s\S]*if \(reusedCustomer\)[\s\S]*syncAsaasCustomerContact/i);
  const customerSync = edgeFunction.match(
    /async function syncAsaasCustomerContact\([\s\S]*?\n}\n\nasync function ensureAsaasCustomer/
  )?.[0] || '';
  assert.doesNotMatch(customerSync, /externalReference,/);
  assert.match(customerSync, /try \{[\s\S]*asaasRequest[\s\S]*updatedCpf[\s\S]*catch \(error\)[\s\S]*return false/);
  assert.match(customerSync, /catch \(error\)[\s\S]*error instanceof ProviderInvariantError\) throw error[\s\S]*return false/);
  assert.doesNotMatch(customerSync, /throw new AmbiguousProviderResultError/);
  const recoveredCustomerTail = functionBody.slice(functionBody.indexOf('const customerId = text(customer.id, 120)'));
  assert.ok(
    recoveredCustomerTail.indexOf('save_app_payment_customer') <
      recoveredCustomerTail.indexOf('if (reusedCustomer)'),
    'o ID remoto recuperado precisa ser salvo antes do PUT best-effort'
  );
});

test('retry e reconciliação periódica consultam a cobrança existente sem abrir outra', () => {
  assert.match(migration, /payment\.status in \('PENDING', 'CONFIRMED', 'OVERDUE'\)[\s\S]*p_invoice_id is not null[\s\S]*payment\.next_reconciliation_at/i);
  assert.match(migration, /where status in \('READY', 'FAILED', 'RECONCILING', 'PENDING', 'CONFIRMED', 'OVERDUE'\)/i);
  assert.match(edgeFunction, /\/payments\/\$\{encodeURIComponent\(paymentId\)\}\/pixQrCode/);
  assert.match(edgeFunction, /createOrRecoverPayment\(claim, invoice, customerId\)[\s\S]*fetchPix\(paymentId\)/);
  assert.match(edgeFunction, /reusableStoredPix\(claim\) \|\| await fetchPix\(paymentId\)/);
  assert.match(migration, /stored_pix_payload text[\s\S]*stored_pix_expires_at timestamptz/i);
});

test('geração drena lotes somente dentro do orçamento global e informa trabalho remanescente', () => {
  assert.match(edgeFunction, /MAX_MANUAL_CLAIMS = 50/);
  assert.match(edgeFunction, /action === "generate"[\s\S]*MAX_MANUAL_CLAIMS/);
  assert.match(edgeFunction, /while \(results\.length < maxClaims\)/);
  assert.doesNotMatch(edgeFunction, /action !== "scheduled" \|\| claims\.length < claimLimit/);
  assert.match(edgeFunction, /partial: isPartial[\s\S]*remainingReady/);
  assert.match(edgeFunction, /EXECUTION_BUDGET_MS = 105_000/);
  assert.match(edgeFunction, /MIN_SAFE_BATCH_BUDGET_MS = 72_000/);
  assert.match(edgeFunction, /Date\.now\(\) \+ MIN_SAFE_BATCH_BUDGET_MS > executionDeadline/);
  assert.match(edgeFunction, /const reconciliationMayRemain = isInternalAction[\s\S]*reconciliationMayRemain,/);
});

test('retry reconcilia estados terminais sem exigir QR Code', () => {
  const processBody = edgeFunction.match(
    /async function processClaim\([\s\S]*?\n}\n\nasync function processInBatches/
  )?.[0] || '';
  assert.ok(processBody, 'função processClaim precisa existir');
  assert.match(processBody, /PIX_REQUIRED_STATUSES\.has\(status\)[\s\S]*fetchPix\(paymentId\)/);
  assert.match(processBody, /apply_app_invoice_payment_reconciliation/);
  assert.doesNotMatch(edgeFunction.match(/const PIX_REQUIRED_STATUSES[^;]+;/)?.[0] || '', /RECEIVED|REFUNDED|CANCELLED|CHARGEBACK/);
  for (const status of ['REFUNDED', 'PARTIALLY_REFUNDED', 'CHARGEBACK', 'DISPUTED']) {
    assert.match(edgeFunction, new RegExp(`"${status}"`));
  }
  assert.match(edgeFunction, /function providerStatus[\s\S]*return status;\n}/);
  assert.doesNotMatch(edgeFunction, /return error\.message\.slice/);
});

test('autorização separa preview, escrita e execução interna agendada', () => {
  assert.match(edgeFunction, /p_permission: "finance\.read"/);
  assert.match(edgeFunction, /p_permission: "finance\.write"/);
  assert.match(edgeFunction, /action !== "preview" && !auth\.canWrite/);
  assert.match(edgeFunction, /new Set\(\["preview", "generate", "retry", "scheduled", "reconcile"\]\)/);
  assert.match(edgeFunction, /const isInternalAction = \["scheduled", "reconcile"\]\.includes\(action\)/);
  assert.match(edgeFunction, /verify_app_monthly_billing_internal_token/);
  assert.doesNotMatch(edgeFunction, /MONTHLY_BILLING_INTERNAL_TOKEN/);
  assert.match(edgeFunction, /x-monthly-billing-token/);
  assert.match(edgeFunction, /timeZone: "America\/Sao_Paulo"/);
  assert.match(edgeFunction, /MAX_SCHEDULED_CLAIMS = 50/);
  assert.match(migration, /action in \('GENERATE', 'RETRY', 'SCHEDULED', 'RECONCILE'\)/);
  assert.match(migration, /grant execute on function public\.generate_app_monthly_pix_billing\(date, uuid, text\)\s+to service_role/i);
  assert.doesNotMatch(migration, /grant execute on function public\.generate_app_monthly_pix_billing\(date, uuid, text\)\s+to authenticated/i);
  assert.match(edgeFunction, /p_include_ready: action === "retry" \|\| shouldGenerate/);
  assert.match(edgeFunction, /request\.text\(\)[\s\S]*TextEncoder\(\)\.encode\(rawBody\)\.byteLength[\s\S]*JSON\.parse\(rawBody\)/);
});

test('cron provisiona credenciais dentro do Vault, fixa o host e separa geração de reconciliação', () => {
  assert.match(scheduleMigration, /app_monthly_billing_url/);
  assert.match(scheduleMigration, /app_monthly_billing_publishable_key/);
  assert.match(scheduleMigration, /app_monthly_billing_internal_token/);
  assert.match(scheduleMigration, /raise exception 'O agendamento mensal não possui configuração segura no Vault\.'/);
  assert.doesNotMatch(scheduleMigration, /then\s+return null;/i);
  assert.match(scheduleMigration, /timeout_milliseconds := 120000/);
  assert.match(scheduleMigration, /vault\.create_secret\([\s\S]*gen_random_bytes\(32\)/i);
  assert.match(scheduleMigration, /tournament_payment_expiry_publishable_key/);
  assert.match(scheduleMigration, /verify_app_monthly_billing_internal_token/);
  assert.match(scheduleMigration, /tournament_payment_expiry_url[\s\S]*\/app-monthly-billing/i);
  assert.match(scheduleMigration, /app_monthly_billing_url_sha256/);
  assert.match(scheduleMigration, /extensions\.digest[\s\S]*aae011373696cd3246639fdd0b5c1dbe7dc9c3a5473fdc7920875100c08f547b/i);
  assert.match(scheduleMigration, /'ilha-play-generate-monthly-pix'[\s\S]*'5 12 \* \* \*'/i);
  assert.match(scheduleMigration, /'ilha-play-reconcile-monthly-pix'[\s\S]*'\*\/15 \* \* \* \*'/i);
  assert.match(scheduleMigration, /jsonb_build_object\('action', p_action\)/i);
  assert.doesNotMatch(scheduleMigration, /https:\/\/[a-z0-9-]+\.supabase\.co/i);
});

test('reconciliação do webhook falha fechado por ambiente, referência, id, centavos e PIX', () => {
  const reconciliation = migration.match(
    /create or replace function public\.apply_app_invoice_payment_reconciliation\([\s\S]*?grant execute on function public\.apply_app_invoice_payment_reconciliation\([\s\S]*?to service_role;/i
  )?.[0] || '';
  assert.ok(reconciliation, 'RPC de reconciliação precisa existir');
  assert.match(reconciliation, /auth\.jwt\(\) ->> 'role'[\s\S]*service_role/i);
  assert.match(reconciliation, /p_snapshot #>> '\{payment,billing_type\}'[\s\S]*<> 'PIX'/i);
  assert.match(reconciliation, /round\(payment_row\.expected_amount \* 100\)[\s\S]*round\(coalesce\(p_expected_amount, -1\) \* 100\)/i);
  assert.match(reconciliation, /AMBIGUOUS_LOCAL_MATCH/);
  assert.match(reconciliation, /DUPLICATE_EVENT/);
  assert.ok(
    reconciliation.indexOf("'PAYMENT_MISMATCH'") < reconciliation.indexOf("'DUPLICATE_EVENT'"),
    'idempotência só pode ser reconhecida depois de validar o snapshot recebido'
  );
  assert.match(reconciliation, /STATUS_REGRESSION/);
  assert.match(reconciliation, /monthly-invoice-paid:/);
  assert.match(edgeFunction, /isCoherentDuplicate[\s\S]*DUPLICATE_EVENT/);
  assert.match(edgeFunction, /financialStatePreserved[\s\S]*preservedNeedsReview[\s\S]*"FAILED"[\s\S]*"DISPATCHED"/);
  assert.match(edgeFunction, /financialStatePreserved && !preservedNeedsReview \? null : message/);
  assert.doesNotMatch(migration, /when invoice_row\.provider_status in \([\s\S]{0,260}then invoice_row\.provider_status/i);
});

test('baixa mensal alimenta o razão do ADM de forma vinculada e idempotente', () => {
  assert.match(migration, /add column if not exists app_payment_invoice_id uuid/i);
  assert.match(migration, /financial_transactions_app_payment_invoice_uidx/i);
  assert.match(migration, /ensure_app_invoice_financial_transaction\(invoice_row\.id\)/i);
  assert.match(migration, /sync_app_invoice_financial_transaction[\s\S]*when normalized_status = 'RECEIVED' then 'RECEBIDO'/i);
  assert.match(migration, /when normalized_status = 'RECEIVED' then 'PIX'/i);
  assert.match(migration, /guard_monthly_financial_transaction_snapshot/i);
  assert.match(migration, /Lançamento mensal vinculado só pode ser conciliado pelo fluxo financeiro\./i);
});

test('configuração operacional começa pausada, exige permissão e deixa auditoria', () => {
  assert.match(migration, /admin_get_app_monthly_billing_settings/);
  assert.match(migration, /finance\.read[\s\S]*finance\.write/i);
  assert.match(migration, /admin_set_app_monthly_billing_settings/);
  assert.match(migration, /app_monthly_billing_settings_audit/);
  assert.match(migration, /authorization_kind[\s\S]*case when is_service then 'INTERNAL' else 'USER' end/i);
  assert.match(edgeFunction, /action === "generate" && !billingEnabled/);
  assert.match(edgeFunction, /action === "scheduled" && billingEnabled && generationDayReached/);
  assert.match(migration, /'reconciliationIntervalMinutes', 15[\s\S]*'paymentPollingIntervalMinutes', 60/);
});

test('vencimento efetivo e conflito no razão falham antes de chamar o Asaas', () => {
  assert.match(migration, /then greatest\([\s\S]*monthly_billing_due_date[\s\S]*America\/Sao_Paulo'\)::date \+ 1/i);
  assert.match(migration, /then 'DUE_DATE_IN_PAST'/i);
  assert.match(migration, /exception[\s\S]*when check_violation or unique_violation[\s\S]*REVIEW_REQUIRED[\s\S]*LEDGER_CONFLICT_REQUIRES_REVIEW[\s\S]*continue;/i);
});

test('estados de revisão e reversão alertam somente a equipe financeira autorizada', () => {
  const notifier = migration.match(
    /create or replace function private\.notify_monthly_billing_finance_review\([\s\S]*?revoke all on function private\.notify_monthly_billing_finance_review/i
  )?.[0] || '';
  assert.ok(notifier, 'helper privado de alerta precisa existir');
  for (const state of ['REVIEW_REQUIRED', 'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CHARGEBACK', 'DISPUTED']) {
    assert.match(migration, new RegExp(`'${state}'`));
  }
  assert.match(notifier, /protected_access_accounts[\s\S]*finance\.write[\s\S]*communication/i);
  assert.doesNotMatch(notifier, /client\.(?:cpf|email|phone)/i);
  assert.match(migration, /perform private\.notify_monthly_billing_finance_review/i);
});

test('nenhum teste ou módulo executa chamada real durante import ou CI', () => {
  assert.match(edgeFunction, /Deno\.serve\(/);
  assert.doesNotMatch(edgeFunction, /Deno\.env\.set\(/);
  assert.doesNotMatch(edgeFunction, /api\.asaas\.com\/v3\/payments/);
  assert.doesNotMatch(edgeFunction, /api-sandbox\.asaas\.com\/v3\/payments/);
});
