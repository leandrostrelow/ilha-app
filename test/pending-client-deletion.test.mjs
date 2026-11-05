import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../adm/index.html', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../supabase/migrations/20260914213726_pending_client_registration_deletion.sql', import.meta.url), 'utf8');
function extract(name, next) {
  return html.slice(html.indexOf('    ' + name), html.indexOf('    ' + next, html.indexOf('    ' + name)));
}
const eligibility = extract('function canDeletePendingClient(', 'function renderClientCard(');
const action = extract('async function deletePendingClientRegistration(', 'async function deleteClientFromAdmin(');
function fixture({ confirm = true, result = { removed: true }, fail = false } = {}) {
  const calls = [];
  const client = { id: 'client-id', name: 'Teste', status: 'PENDENTE' };
  const context = vm.createContext({
    adminProfile: { id: 'admin-id' }, isUuid: Boolean,
    canManageClientResets: () => true, canUseClubPermission: () => true,
    clientOperationalState: (row) => ({ key: row.status === 'PENDENTE' ? 'pendente' : 'ativo' }),
    requireClubPermission: () => {}, findClientByKey: () => client,
    window: { confirm: () => confirm },
    supabaseRest: async (path, options) => { calls.push({ path, options }); if (fail) throw new Error('offline'); return result; },
    opsData: { clients: [client] }, opsState: {}, closeClientModal: () => {},
    renderClientsModule: () => {}, loadOpsData: async () => {}, renderHomeDashboard: () => {}, toast: () => {},
  });
  vm.runInContext(eligibility + action, context);
  return { context, calls, client, button: { disabled: false, textContent: 'Excluir cadastro' } };
}
test('delete eligibility excludes active clients, family entries, self and non-admins', () => {
  const { context, client } = fixture();
  assert.equal(context.canDeletePendingClient(client), true);
  for (const row of [{ ...client, status: 'ATIVO' }, { ...client, familyMemberId: 'family' }, { ...client, id: 'admin-id' }]) {
    assert.equal(context.canDeletePendingClient(row), false);
  }
  context.canManageClientResets = () => false;
  assert.equal(context.canDeletePendingClient(client), false);
});
test('cancel sends no request and preserves registration', async () => {
  const f = fixture({ confirm: false });
  await f.context.deletePendingClientRegistration(f.client.id, f.button);
  assert.equal(f.calls.length, 0);
  assert.equal(f.context.opsData.clients.length, 1);
});
test('confirmed deletion targets just one client and removes it after server confirmation', async () => {
  const f = fixture();
  await f.context.deletePendingClientRegistration(f.client.id, f.button);
  assert.equal(f.calls[0].path, 'rpc/delete_pending_client_registration');
  assert.equal(f.calls[0].options.body.p_client_id, f.client.id);
  assert.equal(f.context.opsData.clients.length, 0);
  assert.equal(f.button.disabled, false);
});
test('failure or missing confirmation preserves registration and releases button', async () => {
  for (const options of [{ fail: true }, { result: {} }]) {
    const f = fixture(options);
    await assert.rejects(f.context.deletePendingClientRegistration(f.client.id, f.button));
    assert.equal(f.context.opsData.clients.length, 1);
    assert.equal(f.button.disabled, false);
    assert.equal(f.button.textContent, 'Excluir cadastro');
  }
});
test('database deletion uses authorization, row locking, backup and reversible marker, never physical deletion', () => {
  assert.match(sql, /security invoker/);
  assert.match(sql, /current_user_role\(\) is distinct from 'admin'/);
  assert.match(sql, /has_club_permission\('clients.write'\)/);
  assert.match(sql, /for update/);
  assert.match(sql, /reset_app_client_account_with_backup/);
  assert.match(sql, /registration_deleted_at = now\(\)/);
  assert.match(sql, /new.registration_deleted_at := null/);
  assert.doesNotMatch(sql, /delete from/i);
  assert.match(html, /return !row.registration_deleted_at/);
});
