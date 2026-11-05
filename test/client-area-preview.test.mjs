import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const preview = read('client-area-preview.js');
const app = read('index.html');
const adm = read('adm/index.html');
const sql = read('supabase/migrations/20261005143730_admin_client_readonly_context.sql');

test('customer preview shares the app renderers and original registration gate', () => {
  assert.match(app, /client-area-preview\.js/);
  assert.match(preview, /if \(needsRegistration\(client\)\) openRegistrationCompletion\(\)/);
  assert.match(preview, /mapPaymentInvoiceRow/);
  assert.match(preview, /renderAll\(\)/);
  assert.match(adm, /location\.replace\('\/\?clientPreview=1'\)/);
  assert.match(adm, /data\.family = context\.family/);
});

test('preview transfers no authentication and blocks writes and stale or foreign refresh replies', () => {
  assert.doesNotMatch(preview, /access_token|refresh_token|password/);
  assert.match(preview, /window\.name = ''/);
  assert.match(preview, /event\.source !== window\.opener/);
  assert.match(preview, /event\.origin !== location\.origin/);
  assert.match(preview, /next\.data\.client\.id !== snapshot\.data\.client\.id/);
  assert.match(preview, /\['GET', 'HEAD'\]\.includes\(method\)/);
  assert.match(preview, /document\.addEventListener\('submit'/);
  assert.match(app, /if \(clientPreviewMode\) return false/);
});

test('shared family projection remains private and administrative reads require both permissions', () => {
  assert.match(sql, /revoke all on function private\.client_family_summary_data\(uuid\) from public, anon, authenticated, service_role/);
  assert.match(sql, /p_user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /not public\.has_club_permission\('clients\.read'\) or not public\.has_club_permission\('finance\.read'\)/);
  assert.match(sql, /grant execute on function public\.admin_get_client_area_context\(uuid\) to authenticated/);
  assert.doesNotMatch(sql, /\b(?:insert into|update public\.|delete from|set_config)\b/i);
});

test('enabling enrollment and generating an invoice are separate explicit actions', () => {
  assert.match(adm, /id="clientMonthlyBillingGenerateBtn"/);
  assert.match(adm, /Gerar mensalidade/);
  assert.match(adm, /Pix Asaas — baixa automática/);
});
