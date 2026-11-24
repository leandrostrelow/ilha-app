import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../adm/monthly-notifications.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../adm/index.html', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const entry = (id, state = 'READY', extra = {}) => ({ clientId: id, name: 'Pessoa sintética ' + id, state, configured: false, ...extra });
const page = (items, nextCursor = null, enabled = false) => ({ policy: { enabled }, items, nextCursor, hasMore: Boolean(nextCursor) });
function api() {
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.IlhaMonthlyNotifications;
}
function controller(send, extra = {}) {
  return api().createController({ isCurrent: () => true, canWrite: () => true, changed: () => {}, send, ...extra });
}
const reason = 'Configuração dos lembretes autorizada pelo clube.';

test('consulta todas as páginas sem aplicar política ou reenviar mensagens', async () => {
  const calls = [];
  const c = controller(async body => { calls.push(plain(body)); return body.cursor ? page([entry('2', 'BLOCKED')]) : page([entry('1')], 'cursor-1'); });
  await c.preview();
  assert.equal(c.state.previewComplete, true);
  assert.equal(c.state.items.length, 2);
  assert.deepEqual(calls, [{ action: 'notify_preview', limit: 5 }, { action: 'notify_preview', limit: 5, cursor: 'cursor-1' }]);
});

test('aplicação exige consulta concluída, permissão e motivo auditável', async () => {
  const calls = [];
  let canWrite = true;
  const c = controller(async body => { calls.push(body); return page([]); }, { canWrite: () => canWrite });
  await assert.rejects(c.apply(reason), /Consulte/);
  await c.preview();
  await assert.rejects(c.apply(''), /motivo/);
  await assert.rejects(c.apply('a'.repeat(401)), /motivo/);
  canWrite = false;
  await assert.rejects(c.apply(reason), /permissão/);
  assert.equal(calls.length, 1);
});

test('aplica sequencialmente em lotes de cinco, preservando exceções e sem ação de envio', async () => {
  const calls = [];
  let active = 0;
  const c = controller(async body => {
    calls.push(plain(body)); active++; assert.equal(active, 1); await Promise.resolve(); active--;
    if (body.action === 'notify_preview') return page([entry('1'), entry('2')]);
    return body.cursor ? page([entry('2', 'BLOCKED', { reason: 'FAMILY_CONTACT_MISMATCH' })], null, true) : page([entry('1', 'APPLIED')], 'cursor-1', true);
  });
  await c.preview(); await c.apply(reason);
  assert.deepEqual(calls.slice(1), [{ action: 'notify_apply', limit: 5, enabled: true, reason }, { action: 'notify_apply', limit: 5, cursor: 'cursor-1', enabled: true, reason }]);
  assert.equal(c.state.items[1].state, 'BLOCKED');
  assert.equal(c.state.previewComplete, false);
  await assert.rejects(c.apply(reason), /Consulte/);
});

test('não repete lote incerto por falha de rede e conserva resultados anteriores', async () => {
  let mutations = 0;
  const c = controller(async body => {
    if (body.action === 'notify_preview') return page([entry('1'), entry('2')]);
    mutations++;
    if (body.cursor) throw new Error('Sem conexão');
    return page([entry('1', 'APPLIED')], 'cursor-1', true);
  });
  await c.preview(); await c.apply(reason);
  assert.equal(mutations, 2);
  assert.equal(c.state.items.length, 1);
  assert.equal(c.state.error, true);
  assert.match(c.state.message, /parcial.*Consulte/);
  await assert.rejects(c.apply(reason), /Consulte/);
});

test('parada aguarda lote atual sem enviar os próximos', async () => {
  let release, calls = 0;
  const c = controller(async () => { calls++; return new Promise(resolve => { release = resolve; }); });
  const pending = c.preview();
  c.stop(); release(page([entry('1')], 'cursor-1'));
  await pending;
  assert.equal(calls, 1); assert.equal(c.state.previewComplete, false);
  assert.match(c.state.message, /Interrompido/);
});

test('duplo clique não inicia consulta ou aplicação concorrente', async () => {
  let release, calls = 0;
  const c = controller(async () => { calls++; return new Promise(resolve => { release = resolve; }); });
  const pending = c.preview(); await c.preview(); await c.apply(reason);
  release(page([])); await pending;
  assert.equal(calls, 1);
});

test('resposta de outra sessão é ignorada; nenhuma próxima página é chamada', async () => {
  let current = true, release, calls = 0;
  const c = controller(async () => { calls++; return new Promise(resolve => { release = resolve; }); }, { isCurrent: () => current });
  const pending = c.preview(); current = false; c.reset();
  release(page([entry('old-user')], 'cursor-1')); await pending;
  assert.equal(calls, 1); assert.equal(c.state.items.length, 0); assert.equal(c.state.previewComplete, false);
});

test('resposta inválida, conta duplicada e cursor circular nunca liberam aplicação', async () => {
  for (const invalid of [{}, { ...page([]), policy: {} }, page([entry('1', 'UNEXPECTED')]), page([entry('1'), entry('1')])]) {
    const c = controller(async () => invalid); await c.preview();
    assert.equal(c.state.error, true); assert.equal(c.state.previewComplete, false);
  }
  let calls = 0;
  const c = controller(async () => page([entry(String(++calls))], 'same-cursor'));
  await c.preview(); assert.equal(calls, 2); assert.equal(c.state.previewComplete, false);
});

test('resumo distingue configuração verificada de elegibilidade e pendências', () => {
  assert.deepEqual(plain(api().summarize([entry('1'), entry('2', 'READY', { configured: true }), entry('3', 'APPLIED'), entry('4', 'BLOCKED'), entry('5', 'WAITING_CUSTOMER'), entry('6', 'FAILED')])),
    { total: 6, configured: 2, ready: 1, blocked: 1, waiting: 1, failed: 1 });
  assert.match(api().reasonLabel('FAMILY_CONTACT_MISMATCH'), /responsável/);
});

test('UI só consulta/aplica em cliques explícitos e escapa os nomes retornados', async () => {
  const fields = new Map();
  const host = { innerHTML: '', querySelector(selector) {
    if (!fields.has(selector)) fields.set(selector, { reportValidity: () => true, value: reason });
    return fields.get(selector);
  } };
  let calls = 0, confirmed = false;
  const config = { sessionKey: 'synthetic', canWrite: () => true, isCurrent: () => true, confirm: () => confirmed, send: async body => {
    calls++; return page([entry('1', body.action === 'notify_apply' ? 'APPLIED' : 'READY', { name: '<img src=x onerror=alert(1)>', recipientKind: 'GUARDIAN' })]);
  } };
  const mod = api(); mod.mount(host, config);
  assert.equal(calls, 0); assert.match(host.innerHTML, /Cobranças já emitidas podem manter/);
  const field = name => fields.get('[data-mn-' + name + ']');
  assert.equal(field('apply').disabled, true);
  await field('preview').onclick(); assert.equal(field('apply').disabled, false);
  assert.match(field('list').innerHTML, /&lt;img/); assert.match(field('list').innerHTML, /Responsável pelo menor/);
  await field('apply').onclick(); assert.equal(calls, 1);
  confirmed = true; await field('apply').onclick(); assert.equal(calls, 2);
  mod.reset(); assert.equal(host.innerHTML, '');
});

function requestContext(fetcher) {
  const context = {
    adminSessionEpoch: 1, adminSession: { user: { id: 'synthetic-admin' }, access_token: 'old-synthetic-token' },
    requireClubPermission: permission => assert.equal(permission, 'finance.write'), isAdminDemoMode: () => false,
    supabaseBaseUrl: () => 'https://synthetic.example', supabaseHeaders: () => ({ Authorization: context.adminSession.access_token }),
    fetchWithAdminTimeout: fetcher, MONTHLY_BILLING_REQUEST_TIMEOUT_MS: 120000,
    refreshAdminSession: async () => { context.adminSession.access_token = 'new-synthetic-token'; }
  };
  vm.runInNewContext(html.slice(html.indexOf('    function monthlyNotificationsSessionKey()'), html.indexOf('    async function monthlyBillingRequest(')), context);
  return context;
}
test('transporte autenticado renova apenas em 401, com mesmo lote e motivo', async () => {
  const calls = [];
  const context = requestContext(async (url, options) => {
    calls.push({ url, ...options });
    return { status: calls.length === 1 ? 401 : 200, ok: calls.length !== 1, json: async () => page([]) };
  });
  await context.monthlyNotificationsRequest({ action: 'notify_apply', enabled: true, reason, limit: 5 }, '1:synthetic-admin');
  assert.equal(calls.length, 2); assert.equal(calls[0].body, calls[1].body);
  assert.equal(calls[1].headers.Authorization, 'new-synthetic-token');
});
test('transporte não repete erro incerto nem aceita resposta após trocar sessão', async () => {
  let calls = 0;
  let context = requestContext(async () => { calls++; throw new Error('network'); });
  await assert.rejects(context.monthlyNotificationsRequest({ action: 'notify_apply' }, '1:synthetic-admin'), /network/);
  assert.equal(calls, 1);
  context = requestContext(async () => { context.adminSessionEpoch++; return { status: 200, ok: true, json: async () => page([]) }; });
  await assert.rejects(context.monthlyNotificationsRequest({ action: 'notify_preview' }, '1:synthetic-admin'), /Sessão alterada/);
});
