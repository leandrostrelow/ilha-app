import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../adm/index.html', import.meta.url), 'utf8');
const sql = fs.readFileSync(new URL('../supabase/migrations/20260930182204_admin_confirm_family_member.sql', import.meta.url), 'utf8');
test('erro familiar orienta confirmação sem expor código interno', () => {
  const source = html.match(/    function friendlyFamilyBillingError\(message\) \{[\s\S]*?\n    \}/)[0];
  const ctx = vm.createContext({});
  vm.runInContext(source, ctx);
  assert.match(ctx.friendlyFamilyBillingError('Este cadastro: FAMILY_MEMBER_CONFIRMATION_PENDING.'), /Revisar e confirmar/);
  assert.doesNotMatch(ctx.friendlyFamilyBillingError('FAMILY_MEMBER_CONFIRMATION_PENDING'), /FAMILY_MEMBER/);
  assert.equal(ctx.friendlyFamilyBillingError('Outro erro'), 'Outro erro');
});
test('confirmação ADM é explícita, revisada e protege contra cadastro desatualizado', () => {
  const action = html.slice(html.indexOf('    async function confirmFamilyMemberAction'), html.indexOf('    async function reviewFamilyMemberAction'));
  assert.match(action, /window.confirm\(review\)/);
  assert.match(action, /requireClubPermission\('clients.write'\)/);
  assert.match(action, /p_expected_updated_at: member.updatedAt/);
  assert.match(action, /openFamilyMemberEditor/);
  assert.match(sql, /auth.uid\(\).*is null/);
  assert.match(sql, /has_club_permission\('clients.write'\)/);
  assert.match(sql, /for update/);
  assert.match(sql, /is distinct from p_expected_updated_at/);
  assert.match(sql, /security invoker/);
  assert.doesNotMatch(sql, /insert into public.app_payment_invoices/);
});
