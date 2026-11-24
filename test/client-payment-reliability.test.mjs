import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function source(name) {
  const start = html.search(new RegExp('    (?:async )?function ' + name + '\\('));
  assert.ok(start >= 0, name);
  return html.slice(start, html.indexOf('\n    }', start) + 6);
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture(names = []) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: true, innerHTML: '', textContent: '', querySelector: () => ({ scrollTop: 0, focus() {} }) });
    return nodes.get(id);
  };
  const c = vm.createContext({ console, Date, Set, Promise, URL, AbortController, JSON,
    officialPlanSeed: [], storeProductSeed: [], window: { IlhaClientPreview: { mode: false } },
    storageGet: () => null, storageSet() {}, storageRemove() {}, clearTimeout() {}, setTimeout: () => 1,
    stopClientRealtime() {}, closeAnyModal() {}, scheduleSessionRefresh() {},
    $: node, document: { body: { style: { overflow: '' } }, activeElement: null }, requestAnimationFrame: f => f(),
    renderPayments() {}, renderAnnouncements() {}, renderHome() {}, toast() {}, renderAll() {},
    money: n => String(n), escapeHtml: x => String(x), invoiceMonthLabel: x => x, formatShortDate: x => x, pill: x => x,
    localDateString: () => '2026-11-24', SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_ANON_KEY: 'fake',
    SESSION_KEY: 'fake-session', DEMO_SESSION_KEY: 'fake-demo', navigator: { onLine: true }
  });
  vm.runInContext(html.slice(html.indexOf('    let session = null;'), html.indexOf('    const pullRefreshState =')), c);
  vm.runInContext('let clientCommerce;', c);
  for (const name of new Set(['clientSessionScope', 'clientScopeIsCurrent', 'assertClientScope', 'closePixModal', 'resetClientUserState', 'clearSession', 'storeSession', 'parseJsonResponse', ...names])) vm.runInContext(source(name), c);
  const run = code => vm.runInContext(code, c);
  run("session = { user: { id: 'A' }, access_token: 'token-A', refresh_token: 'refresh-A' };");
  return { c, run, nodes, node };
}
const response = (status, body) => ({ status, ok: status < 400, text: async () => JSON.stringify(body) });

test('logout removes financial/family state and closes the old Pix before another user enters', () => {
  const { c, run, node } = fixture();
  run("paymentInvoices = [{ id: 'invoice-A', pix_payload: 'PIX-A' }]; familyInvoiceItems = [{ invoice_id: 'invoice-A' }]; familySummary = { name: 'A' }; announcements = [{ body: 'A' }]; myLessons = [{ name: 'A' }]; activePixPayload = 'PIX-A'; activePixInvoiceId = 'invoice-A';");
  node('pixModal').hidden = false;
  node('pixModalBody').innerHTML = 'PIX-A';
  c.clearSession();
  assert.equal(run('session'), null);
  for (const field of ['paymentInvoices', 'familyInvoiceItems', 'announcements', 'myLessons']) assert.equal(run(field + '.length'), 0, field);
  assert.equal(run('familySummary'), null);
  assert.equal(run('activePixPayload'), '');
  assert.equal(node('pixModalBody').innerHTML, '');
  assert.equal(node('pixModal').hidden, true);
});

test('same-user token rotation preserves invoices; changing identity clears them', () => {
  const { c, run } = fixture();
  run("paymentInvoices = [{ id: 'invoice-A' }];");
  c.storeSession({ user: { id: 'A' }, access_token: 'new-token' });
  assert.equal(run('paymentInvoices.length'), 1);
  c.storeSession({ user: { id: 'B' }, access_token: 'token-B' });
  assert.equal(run('paymentInvoices.length'), 0);
});

test('an old refresh response cannot resurrect a signed-out session', async () => {
  const { c, run } = fixture(['refreshSession']);
  const pending = deferred(); c.authRequest = () => pending.promise;
  const task = c.refreshSession(run('session'));
  c.clearSession(); c.storeSession({ user: { id: 'B' }, access_token: 'token-B' });
  pending.resolve({ user: { id: 'A' }, access_token: 'new-A' });
  await assert.rejects(task, { code: 'CLIENT_SESSION_CHANGED' });
  assert.equal(run('session.user.id'), 'B');
});

test('late invoice refresh is discarded after a logout and a second login, even with the same account', async () => {
  const { c, run } = fixture(['refreshClientPayments', 'mapPaymentInvoiceRow']);
  const pending = deferred(); c.loadClientPaymentInvoices = () => pending.promise; c.rest = async () => [];
  const task = c.refreshClientPayments(true);
  c.clearSession(); c.storeSession({ user: { id: 'A' }, access_token: 'new-session-A' });
  pending.resolve([{ id: 'stale-invoice' }]);
  await assert.rejects(task, { code: 'CLIENT_SESSION_CHANGED' });
  assert.equal(run('paymentInvoices.length'), 0);
});

test('edge payment uses a fresh token and retries once only for a definitive 401', async () => {
  const { c, run } = fixture(['clientEdgeRequest']);
  c.ensureFreshSession = async () => run("session.access_token = 'fresh-token'");
  let refreshes = 0; c.forceRefreshSession = async () => { refreshes++; run("session.access_token = 'retry-token'"); };
  const sent = []; c.fetchWithTimeout = async (url, opts) => { sent.push(opts); return sent.length === 1 ? response(401, { error: 'Expired' }) : response(200, { invoiceId: 'invoice-A' }); };
  const result = await c.clientEdgeRequest('app-monthly-billing', { action: 'client_generate', invoiceMonth: '2026-11-01' });
  assert.equal(result.invoiceId, 'invoice-A'); assert.equal(refreshes, 1);
  assert.equal(sent[0].headers.Authorization, 'Bearer fresh-token'); assert.equal(sent[1].headers.Authorization, 'Bearer retry-token');
  assert.equal(sent[0].body, sent[1].body);
});

test('uncertain provider/network responses never repeat a payment creation request', async () => {
  for (const variant of ['network', '500', 'invalid-json', '401-twice']) {
    const { c } = fixture(['clientEdgeRequest']); let calls = 0;
    c.ensureFreshSession = async () => {}; c.forceRefreshSession = async () => {};
    c.fetchWithTimeout = async () => { calls++; if (variant === 'network') throw new Error('timeout'); if (variant === 'invalid-json') return { ok: true, status: 200, text: async () => '<html>' }; return response(variant === '500' ? 500 : 401, { error: 'Failure', order_id: 'existing-order' }); };
    await assert.rejects(c.clientEdgeRequest('store-checkout', { action: 'create', request_id: 'stable-id' }));
    assert.equal(calls, variant === '401-twice' ? 2 : 1, variant);
  }
});

test('edge ignores successful responses belonging to a prior login', async () => {
  const { c } = fixture(['clientEdgeRequest']); const pending = deferred();
  c.ensureFreshSession = async () => {}; c.fetchWithTimeout = () => pending.promise;
  const task = c.clientEdgeRequest('app-monthly-billing', { action: 'client_generate' });
  await Promise.resolve(); c.clearSession(); c.storeSession({ user: { id: 'B' }, access_token: 'token-B' });
  pending.resolve(response(200, { invoiceId: 'invoice-A' }));
  await assert.rejects(task, { code: 'CLIENT_SESSION_CHANGED' });
});

test('Pix modal removes the payable code on paid, confirmed, cancelled, review and expiry', () => {
  const { c, run, node } = fixture(['invoicePixText', 'invoicePixExpired', 'invoiceEffectiveStatus', 'invoiceProviderNeedsReview', 'invoicePaymentActionAllowed', 'renderPixModalInvoice']);
  const invoice = { id: 'invoice-A', amount: 100, invoice_month: '2026-11-01', due_date: '2026-11-30', provider_status: 'PENDING', pix_payload: 'SYNTHETIC-PIX' };
  c.renderPixModalInvoice(invoice); assert.match(node('pixModalBody').innerHTML, /data-copy-modal-pix/);
  for (const patch of [{ provider_status: 'RECEIVED' }, { provider_status: 'CONFIRMED' }, { provider_status: 'DELETED' }, { provider_status: 'REVIEW_REQUIRED' }, { pix_expires_at: '2020-01-01T00:00:00Z' }]) {
    c.renderPixModalInvoice({ ...invoice, ...patch });
    assert.equal(run('activePixPayload'), ''); assert.doesNotMatch(node('pixModalBody').innerHTML, /SYNTHETIC-PIX|data-copy-modal-pix/);
  }
});

test('manual receipt fields survive invoice mapping for customer display', () => {
  const { c } = fixture(['mapPaymentInvoiceRow']);
  const invoice = c.mapPaymentInvoiceRow({ received_method: 'CASH', received_on: '2026-11-24' });
  assert.equal(invoice.received_method, 'CASH'); assert.equal(invoice.received_on, '2026-11-24');
});

test('a delayed full dashboard load cannot inject old account data into a new session', async () => {
  const { c, run } = fixture(['loadClientData']);
  const pending = deferred();
  c.loadClientPaymentInvoices = () => pending.promise;
  c.rest = async () => [];
  const task = c.loadClientData();
  c.clearSession(); c.storeSession({ user: { id: 'B' }, access_token: 'token-B' });
  pending.resolve([{ id: 'invoice-A', client_id: 'A', pix_payload: 'PIX-A' }]);
  await assert.rejects(task, { code: 'CLIENT_SESSION_CHANGED' });
  assert.equal(run('paymentInvoices.length'), 0);
  assert.equal(run('familySummary'), null);
});

test('failed payment reads after switching user keep the new session empty, never restore previous invoices', async () => {
  const { c, run } = fixture(['refreshClientPayments', 'mapPaymentInvoiceRow']);
  run("paymentInvoices = [{ id: 'invoice-A', pix_payload: 'PIX-A' }];");
  c.clearSession(); c.storeSession({ user: { id: 'B' }, access_token: 'token-B' });
  c.loadClientPaymentInvoices = async () => { throw new Error('synthetic timeout'); };
  c.rest = async () => [];
  c.syncActivePixModal = () => {};
  await c.refreshClientPayments(true);
  assert.equal(run('paymentInvoices.length'), 0);
  assert.equal(run('paymentInvoicesLoadError.message'), 'synthetic timeout');
});

test('refresh replaces an open Pix with payment confirmation from the database', async () => {
  const { c, run, node } = fixture(['refreshClientPayments', 'mapPaymentInvoiceRow', 'syncActivePixModal', 'renderPixModalInvoice', 'invoiceEffectiveStatus', 'invoicePaymentActionAllowed', 'invoicePixExpired', 'invoicePixText', 'invoiceProviderNeedsReview']);
  run("activePixInvoiceId = 'invoice-A'; activePixPayload = 'PIX-A';"); node('pixModal').hidden = false;
  c.loadClientPaymentInvoices = async () => [{ id: 'invoice-A', provider_status: 'RECEIVED', amount: 100, status: 'PAGA', pix_payload: 'PIX-A' }];
  c.rest = async () => [];
  await c.refreshClientPayments(true);
  assert.equal(run('activePixPayload'), '');
  assert.match(node('pixModalBody').innerHTML, /Pagamento recebido/);
  assert.doesNotMatch(node('pixModalBody').innerHTML, /PIX-A|data-copy-modal-pix/);
});
