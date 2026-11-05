import { registerMonthlyInvoiceReceipt } from '../supabase/functions/_shared/monthly-invoice-receipt.ts';
const id = '11111111-1111-4111-8111-111111111111';
const body = { action: 'record_receipt', invoiceId: id, expectedAmount: 350, method: 'CASH', receivedOn: '2026-10-07' };
const remote = { id: 'pay_fixture', customer: 'cus_fixture', externalReference: 'ilha-monthly-invoice:' + id, value: 350, billingType: 'PIX', status: 'PENDING' };
const binding = { provider_payment_id: remote.id, provider_customer_id: remote.customer, external_reference: remote.externalReference, provider_environment: 'PRODUCTION' };
function assert(ok: unknown, message = 'Assertion failed') { if (!ok) throw new Error(message); }
async function scenario(mode: string) {
  let posts = 0, gets = 0, completes = 0;
  const rpc = (name: string) => Promise.resolve({ error: null, data: name.startsWith('prepare') ? {
    state: mode === 'done' ? 'COMPLETED' : 'READY', invoiceId: id, claimToken: id, amount: 350, receivedOn: body.receivedOn,
    payment: mode === 'local' ? null : binding,
  } : (completes++, { state: 'COMPLETED' }) });
  const provider = (_path: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts++;
      const sent = JSON.parse(String(init.body));
      assert(sent.value === 350 && sent.paymentDate === body.receivedOn && sent.notifyCustomer === false);
      if (mode === 'timeout') throw new Error('Timeout');
      return Promise.resolve({});
    }
    gets++;
    const payment = { ...remote, ...(mode === 'mismatch' ? { value: 500 } : {}), ...(mode === 'deleted' ? { deleted: true } : {}),
      ...(mode === 'paid' ? { status: 'RECEIVED' } : {}),
      ...((posts || mode === 'recovery') && mode !== 'unconfirmed' ? { status: 'RECEIVED', billingType: 'RECEIVED_IN_CASH', paymentDate: body.receivedOn } : {}) };
    return Promise.resolve(payment);
  };
  let rejected = false;
  try { await registerMonthlyInvoiceReceipt(body, id, 'PRODUCTION', rpc, provider, p => ({ payment: p })); }
  catch { rejected = true; }
  return { posts, gets, completes, rejected };
}
Deno.test('Cash receipt checks Asaas, confirms once, then completes invoice', async () => {
  const r = await scenario('normal'); assert(!r.rejected && r.posts === 1 && r.gets === 2 && r.completes === 1);
});
Deno.test('Timeout recovered by GET, not duplicate POST', async () => {
  const r = await scenario('timeout'); assert(!r.rejected && r.posts === 1 && r.completes === 1);
  const retry = await scenario('recovery'); assert(!retry.rejected && retry.posts === 0 && retry.completes === 1);
});
Deno.test('Paid, wrong amount, deleted and unconfirmed provider cannot be settled', async () => {
  for (const mode of ['paid', 'mismatch', 'deleted', 'unconfirmed']) {
    const r = await scenario(mode); assert(r.rejected && r.completes === 0, mode);
    if (mode !== 'unconfirmed') assert(r.posts === 0, mode);
  }
});
Deno.test('Local receipt and already completed receipt never call Asaas', async () => {
  const r = await scenario('local'); assert(!r.rejected && r.gets === 0 && r.posts === 0 && r.completes === 1);
  const done = await scenario('done'); assert(!done.rejected && done.posts === 0 && done.completes === 0);
});
Deno.test('Reject extra identity/amount fields before any RPC', async () => {
  let called = false, rejected = false;
  try { await registerMonthlyInvoiceReceipt({ ...body, clientId: id }, id, 'PRODUCTION', () => { called = true; return Promise.resolve({ error: null, data: {} }); }, () => Promise.resolve({}), p => p); }
  catch { rejected = true; }
  assert(rejected && !called);
});
