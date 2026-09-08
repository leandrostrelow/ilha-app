import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { projectRoot } from '../scripts/project-files.mjs';

const webhookSource = await readFile(
  path.join(projectRoot, 'supabase', 'functions', 'asaas-payment-webhook', 'index.ts'),
  'utf8'
);

function functionSource(source, name) {
  const functionStart = source.indexOf(`function ${name}(`);
  assert.notEqual(functionStart, -1, `funcao ${name} nao encontrada`);
  const start = source.slice(Math.max(0, functionStart - 6), functionStart) === 'async '
    ? functionStart - 6
    : functionStart;
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`corpo incompleto para ${name}`);
}

function executableFunction(name) {
  return functionSource(webhookSource, name)
    .replace(/: DbClient/g, '')
    .replace(/: JsonRecord/g, '')
    .replace(/: Record<string, string>/g, '')
    .replace(/: string/g, '')
    .replace(/ as JsonRecord \| null/g, '');
}

test('referencia de mensalidade aceita somente o namespace e um UUID exatos', () => {
  const patternMatch = webhookSource.match(
    /const monthlyInvoiceExternalReferencePattern\s*=\s*(\/\^[^;]+\/i);/
  );
  assert.ok(patternMatch, 'regex de referencia mensal ausente');
  const monthlyInvoiceExternalReferencePattern = vm.runInNewContext(patternMatch[1]);
  const isMonthlyInvoiceExternalReference = vm.runInNewContext(
    `(${executableFunction('isMonthlyInvoiceExternalReference')})`,
    { monthlyInvoiceExternalReferencePattern }
  );

  assert.equal(
    isMonthlyInvoiceExternalReference('ilha-monthly-invoice:123e4567-e89b-12d3-a456-426614174000'),
    true
  );
  assert.equal(
    isMonthlyInvoiceExternalReference('ILHA-MONTHLY-INVOICE:123E4567-E89B-12D3-A456-426614174000'),
    true
  );
  assert.equal(
    isMonthlyInvoiceExternalReference('ilha-monthly-invoice:123e4567-e89b-12d3-a456-426614174000:extra'),
    false
  );
  assert.equal(isMonthlyInvoiceExternalReference('ilha-monthly-invoice:not-a-uuid'), false);
  assert.equal(isMonthlyInvoiceExternalReference('tournament-registration:123e4567-e89b-12d3-a456-426614174000'), false);
});

test('mensalidade preserva os estados financeiros relevantes do evento Asaas', () => {
  const text = (value, maxLength) => String(value || '').trim().slice(0, maxLength);
  const monthlyProviderStatus = vm.runInNewContext(
    `(${executableFunction('monthlyProviderStatus')})`,
    { text }
  );

  assert.equal(monthlyProviderStatus('PAYMENT_CONFIRMED', { status: 'RECEIVED' }), 'CONFIRMED');
  assert.equal(monthlyProviderStatus('PAYMENT_RECEIVED', {}), 'RECEIVED');
  assert.equal(monthlyProviderStatus('PAYMENT_RECEIVED_IN_CASH', {}), 'RECEIVED_IN_CASH');
  assert.equal(monthlyProviderStatus('PAYMENT_OVERDUE', {}), 'OVERDUE');
  assert.equal(monthlyProviderStatus('PAYMENT_DELETED', {}), 'DELETED');
  assert.equal(monthlyProviderStatus('PAYMENT_REFUNDED', {}), 'REFUNDED');
  assert.equal(monthlyProviderStatus('PAYMENT_PARTIALLY_REFUNDED', {}), 'PARTIALLY_REFUNDED');
  assert.equal(monthlyProviderStatus('PAYMENT_REFUND_IN_PROGRESS', {}), 'REFUND_PENDING');
  assert.equal(monthlyProviderStatus('PAYMENT_CHARGEBACK_REQUESTED', {}), 'CHARGEBACK');
  assert.equal(monthlyProviderStatus('PAYMENT_AWAITING_CHARGEBACK_REVERSAL', {}), 'DISPUTED');
  assert.equal(monthlyProviderStatus('PAYMENT_UPDATED', { status: 'received_in_cash' }), 'RECEIVED_IN_CASH');
  assert.equal(monthlyProviderStatus('PAYMENT_UPDATED', { status: 'refund_in_progress' }), 'REFUND_PENDING');
  assert.equal(monthlyProviderStatus('PAYMENT_CREATED', {}), 'PENDING');
  assert.equal(monthlyProviderStatus('PAYMENT_UPDATED', { status: 'future_provider_status' }), 'FUTURE_PROVIDER_STATUS');
});

test('lookup mensal separa ambientes por provider ID e entrega divergencia de referencia ao RPC', async () => {
  const patternMatch = webhookSource.match(
    /const monthlyInvoiceExternalReferencePattern\s*=\s*(\/\^[^;]+\/i);/
  );
  assert.ok(patternMatch);
  const monthlyInvoiceExternalReferencePattern = vm.runInNewContext(patternMatch[1]);
  const isMonthlyInvoiceExternalReference = vm.runInNewContext(
    `(${executableFunction('isMonthlyInvoiceExternalReference')})`,
    { monthlyInvoiceExternalReferencePattern }
  );
  const findMonthlyInvoicePayment = vm.runInNewContext(
    `(${executableFunction('findMonthlyInvoicePayment')})`,
    { isMonthlyInvoiceExternalReference }
  );
  const reference = 'ilha-monthly-invoice:123e4567-e89b-12d3-a456-426614174000';
  const rows = [
    {
      id: 'sandbox-row',
      provider: 'ASAAS',
      provider_environment: 'SANDBOX',
      provider_payment_id: 'pay_same_id',
      external_reference: reference,
      status: 'PENDING'
    },
    {
      id: 'production-row',
      provider: 'ASAAS',
      provider_environment: 'PRODUCTION',
      provider_payment_id: 'pay_same_id',
      external_reference: 'ilha-monthly-invoice:223e4567-e89b-12d3-a456-426614174000',
      status: 'PENDING'
    }
  ];
  const queries = [];
  const supabase = {
    from(tableName) {
      assert.equal(tableName, 'app_invoice_provider_payments');
      const filters = [];
      const query = {
        select(columns) {
          assert.doesNotMatch(columns, /pix_payload|safe_snapshot|provider_customer_id/);
          return query;
        },
        eq(column, value) {
          filters.push([column, value]);
          return query;
        },
        async maybeSingle() {
          queries.push(filters.slice());
          const matches = rows.filter((row) => filters.every(([column, value]) => row[column] === value));
          return { data: matches[0] || null, error: null };
        }
      };
      return query;
    }
  };

  const production = await findMonthlyInvoicePayment(
    supabase,
    'PRODUCTION',
    'pay_same_id',
    rows[1].external_reference
  );
  assert.equal(production.id, 'production-row');

  const wrongEnvironment = await findMonthlyInvoicePayment(
    supabase,
    'PRODUCTION',
    'pay_unknown',
    reference
  );
  assert.equal(wrongEnvironment.id, 'sandbox-row');
  assert.equal(
    queries.some((filters) => filters.some(([column]) => column === 'external_reference') &&
      !filters.some(([column]) => column === 'provider_environment')),
    true
  );

  const queryCount = queries.length;
  const suffixedReference = await findMonthlyInvoicePayment(
    supabase,
    'PRODUCTION',
    'pay_unknown',
    `${reference}:extra`
  );
  assert.equal(suffixedReference, null);
  assert.equal(queries.length, queryCount + 1, 'referencia invalida nao deve acionar o fallback');
});

test('ramo mensal usa apenas snapshot sanitizado e o RPC transacional service-only', () => {
  const sanitizer = functionSource(webhookSource, 'safeProviderPaymentSnapshot');
  assert.doesNotMatch(sanitizer, /customer|cpf|email|invoiceUrl|bankSlipUrl|pix_payload|pix_encoded_image/i);
  assert.match(sanitizer, /billing_type/);
  assert.match(sanitizer, /external_reference/);

  const tournamentLookupPosition = webhookSource.indexOf('const localPayment = await findTournamentPayment(');
  const monthlyLookupPosition = webhookSource.indexOf('const monthlyInvoicePayment = await findMonthlyInvoicePayment(');
  const unrelatedIgnorePosition = webhookSource.indexOf('Cobrança não pertence a uma inscrição deste sistema.');
  assert.ok(tournamentLookupPosition > -1 && monthlyLookupPosition > tournamentLookupPosition);
  assert.ok(unrelatedIgnorePosition > monthlyLookupPosition);

  const monthlyBranch = webhookSource.slice(
    monthlyLookupPosition,
    unrelatedIgnorePosition
  );
  assert.match(monthlyBranch, /rpc\("apply_app_invoice_payment_reconciliation", \{/);
  for (const argument of [
    'p_provider_payment_id',
    'p_provider_environment',
    'p_provider_status',
    'p_external_reference',
    'p_expected_amount',
    'p_paid_at',
    'p_event_id',
    'p_snapshot'
  ]) {
    assert.match(monthlyBranch, new RegExp(`${argument}:`));
  }
  assert.match(monthlyBranch, /p_expected_amount: finiteNumber\(providerPayment\.value\)/);
  assert.match(monthlyBranch, /p_snapshot: safeEventSnapshot/);
  assert.match(
    monthlyBranch,
    /\["RECEIVED", "RECEIVED_IN_CASH"\]\.includes\(providerStatus\)[\s\S]*\? paidAt\(providerPayment\)[\s\S]*: null/
  );
  assert.match(monthlyBranch, /status: applied \|\| reviewRequired \? "PROCESSED" : "IGNORED"/);
  assert.match(monthlyBranch, /resultInvoiceId !== expectedInvoiceId/);
  assert.match(monthlyBranch, /resultProviderPaymentId !== providerPaymentId/);
  assert.match(monthlyBranch, /review_required: reviewRequired/);
  assert.doesNotMatch(monthlyBranch, /from\("app_payment_invoices"\)/);
  assert.doesNotMatch(monthlyBranch, /from\("app_invoice_provider_payments"\)\.update/);
});

test('snapshot mensal descarta PII e links portadores recebidos do Asaas', () => {
  const text = (value, maxLength) => String(value || '').trim().slice(0, maxLength);
  const finiteNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const executableSanitizer = functionSource(webhookSource, 'safeProviderPaymentSnapshot')
    .replace(/: JsonRecord/g, '')
    .replace(/: refund is JsonRecord/g, '')
    .replace(/ as JsonRecord/g, '');
  const safeProviderPaymentSnapshot = vm.runInNewContext(
    `(${executableSanitizer})`,
    { finiteNumber, text }
  );
  const snapshot = safeProviderPaymentSnapshot({
    id: 'pay_123',
    status: 'RECEIVED',
    value: 220,
    billingType: 'PIX',
    externalReference: 'ilha-monthly-invoice:123e4567-e89b-12d3-a456-426614174000',
    customer: 'cus_secret',
    cpfCnpj: '11144477735',
    email: 'pessoa@example.com',
    invoiceUrl: 'https://secret.example/invoice',
    bankSlipUrl: 'https://secret.example/bank-slip',
    pixTransaction: { payload: 'bearer-pix-secret' },
    refunds: [{ status: 'DONE', value: 20, dateCreated: '2026-09-08', customer: 'refund-secret' }]
  });
  const serialized = JSON.stringify(snapshot);

  assert.equal(snapshot.id, 'pay_123');
  assert.equal(snapshot.billing_type, 'PIX');
  assert.equal(snapshot.value, 220);
  for (const secret of [
    'cus_secret',
    '11144477735',
    'pessoa@example.com',
    'secret.example',
    'bearer-pix-secret',
    'refund-secret'
  ]) {
    assert.doesNotMatch(serialized, new RegExp(secret.replace('.', '\\.')));
  }
});
