import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const edge = await readFile(new URL('../supabase/functions/app-monthly-billing/index.ts', import.meta.url), 'utf8');
const branch = edge.slice(edge.indexOf('    if (action === "client_generate" ||'), edge.indexOf('    if (auth.kind === "CLIENT")'));
assert.ok(branch.length > 1000);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
// Execute the actual production branch; all data/provider dependencies are fake.
const run = new AsyncFunction('auth', 'body', 'adminClient', 'helpers', `
  const {text,isUuid,invoiceMonth,saoPauloCycle,json,asaasConfig,record,processInBatches,ProviderInvariantError}=helpers;
  const action=body.action, request={}; let executionStage='',runId='';
  ${branch}
`);
const clientId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const invoiceId = '33333333-3333-4333-8333-333333333333';
function fixture({ enabled = true, method = 'ASAAS_PIX', firstDue = '2026-10-07', payable = true, claims = [] } = {}) {
  const calls = [], processed = [];
  const db = {
    from(table) {
      const builder = {
        select() { return builder; },
        eq(_key, id) { calls.push(['eq', table, id]); return builder; },
        insert(data) { calls.push(['insert', table, data]); return builder; },
        update(data) { calls.push(['update', table, data]); return builder; },
        async maybeSingle() { return { data: { enabled, billing_method: method, first_due_date: firstDue } }; },
        async single() { return { data: { id: 'run-fixture' } }; }
      }; return builder;
    },
    async rpc(name, args) {
      calls.push([name, args]);
      if (name === 'prepare_client_monthly_pix') return { data: { state: payable ? 'PAYABLE' : 'AVAILABLE', invoiceId } };
      if (name === 'claim_app_invoice_provider_dispatch') return { data: claims };
      throw Error('Unexpected RPC: ' + name);
    }
  };
  const helpers = {
    text: (v, n) => String(v || '').trim().slice(0, n),
    isUuid: v => /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/.test(v),
    invoiceMonth: v => /^\d{4}-\d{2}-01$/.test(v || '') ? v : '',
    saoPauloCycle: () => ({ month: '2026-10-01' }),
    json: (_request, body, status = 200) => ({ body, status }),
    asaasConfig: () => ({ environment: 'PRODUCTION' }), record: v => v || {},
    processInBatches: async (_db, items) => { processed.push(...items); return []; },
    ProviderInvariantError: Error
  };
  return { calls, processed, run: (auth, body) => run(auth, body, db, helpers) };
}
const internal = { kind: 'INTERNAL', userId: null, canWrite: true };
const client = { kind: 'CLIENT', userId: clientId, canWrite: false };
test('first activation is internal-only and never accepts a caller-supplied amount/month', async () => {
  for (const kind of ['CLIENT', 'USER']) {
    const f = fixture();
    assert.equal((await f.run({ ...client, kind }, { action: 'activation_generate', clientId })).status, 403);
    assert.equal(f.calls.length, 0);
  }
  for (const extra of [{ invoiceMonth: '2026-11-01' }, { amount: 1 }, { invoiceId }]) {
    const f = fixture();
    assert.equal((await f.run(internal, { action: 'activation_generate', clientId, ...extra })).status, 400);
    assert.equal(f.calls.length, 0);
  }
});
test('first activation uses the persisted current cycle and exact payer', async () => {
  const f = fixture();
  assert.equal((await f.run(internal, { action: 'activation_generate', clientId })).status, 200);
  assert.deepEqual(f.calls.find(c => c[0] === 'prepare_client_monthly_pix')[1], {
    p_client_id: clientId, p_invoice_month: '2026-10-01', p_provider_environment: 'PRODUCTION'
  });
  for (const overrides of [{ enabled: false }, { method: 'CASH' }, { firstDue: null }, { firstDue: '2026-11-07' }, { firstDue: '2026-09-07' }]) {
    const blocked = fixture(overrides);
    assert.equal((await blocked.run(internal, { action: 'activation_generate', clientId })).status, 409);
    assert.equal(blocked.calls.filter(c => c[0] === 'prepare_client_monthly_pix').length, 0);
  }
});
test('self-service still derives identity from login and rejects foreign payer', async () => {
  const f = fixture();
  assert.equal((await f.run(client, { action: 'client_generate', invoiceMonth: '2026-10-01', clientId: otherId })).status, 400);
  assert.equal((await f.run(internal, { action: 'client_generate', invoiceMonth: '2026-10-01' })).status, 403);
  assert.equal((await f.run(client, { action: 'client_generate', invoiceMonth: '2026-10-01' })).status, 200);
  assert.equal(f.calls.find(c => c[0] === 'prepare_client_monthly_pix')[1].p_client_id, clientId);
});
test('busy activation never falls back to other invoices; foreign claims fail closed', async () => {
  const f = fixture({ payable: false });
  assert.equal((await f.run(internal, { action: 'activation_generate', clientId })).status, 200);
  assert.deepEqual(f.calls.find(c => c[0] === 'claim_app_invoice_provider_dispatch')[1], {
    p_invoice_id: invoiceId, p_invoice_month: '2026-10-01', p_batch_limit: 1, p_include_ready: true
  });
  assert.equal(f.processed.length, 0);
  const foreign = fixture({ payable: false, claims: [{ client_id: otherId, invoice_id: invoiceId }] });
  await assert.rejects(foreign.run(internal, { action: 'activation_generate', clientId }), /não pertence/);
  assert.equal(foreign.processed.length, 0);
});
