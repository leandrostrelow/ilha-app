import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const sql = await readFile(new URL('../supabase/migrations/20261006183710_client_monthly_pix_and_daily_reminders.sql', import.meta.url), 'utf8');
const edge = await readFile(new URL('../supabase/functions/app-monthly-billing/index.ts', import.meta.url), 'utf8');
const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const push = await readFile(new URL('../supabase/functions/client-notification-dispatch/index.ts', import.meta.url), 'utf8');
const receipts = await readFile(new URL('../supabase/migrations/20261007183150_monthly_self_service_and_invoice_receipts.sql', import.meta.url), 'utf8');
test('manual settlement requires a verified finance writer, never the internal scheduler or a client', () => {
  const branch = edge.slice(edge.indexOf('if (action === "record_receipt" ||'), edge.indexOf('if (action === "client_generate" ||'));
  assert.match(branch, /auth.kind !== "USER" \|\| !auth.canWrite \|\| !auth.userId/);
  assert.match(branch, /registerMonthlyInvoiceReceipt\)\(body, auth.userId/);
  assert.match(branch, /registerMonthlyReceiptBatch/);
  assert.match(receipts, /revoke all on private.monthly_invoice_receipts from public,anon,authenticated,service_role/);
  assert.doesNotMatch(receipts, /update public.app_monthly_billing_enrollments/i);
});
test('new current-month self service keeps future window and proven-cancellation checks', () => {
  assert.match(receipts, /cycle.month>date_trunc\('month',today\)::date and due>today\+15/);
  assert.match(receipts, /fresh.state in \('ELIGIBLE','ELIGIBLE_WITH_WARNING'\)/);
  assert.match(receipts, /payment.safe_snapshot#>>'\{payment,deleted\}'/);
  assert.match(receipts, /Nova via solicitada pelo titular autenticado/);
});
test('self service derives payer from verified identity and has no batch fallback', () => {
  const branch = edge.slice(edge.indexOf('if (action === "client_generate" ||'), edge.indexOf('if (auth.kind === "CLIENT")'));
  assert.match(branch, /let clientId = auth.userId/);
  assert.match(branch, /p_client_id: clientId/);
  assert.match(branch, /auth.kind !== "INTERNAL"/);
  assert.match(branch, /Object.keys\(body\).*invoiceMonth/);
  assert.match(branch, /p_invoice_id: invoiceId/);
  assert.match(branch, /p_batch_limit: 1/);
  assert.match(branch, /claim.client_id !== clientId/);
  assert.doesNotMatch(branch, /invoiceId \|\| null/);
});
test('availability guards enabled payer, 15 days, paid and cancelled states', () => {
  assert.match(sql, /enabled and billing_method='ASAAS_PIX'/);
  assert.match(sql, /billing_responsible_id<>p_client_id/);
  assert.match(sql, /due>today\+15 then 'TOO_EARLY'/);
  assert.match(sql, /candidate.state='PAID' then 'PAID'/);
  assert.match(sql, /superseded_at is null/);
  assert.match(sql, /Cancelamento remoto não comprovado/);
});
test('daily reminders are deduped and stop on payment or leaving window', () => {
  assert.match(sql, /p_today between i.due_date-5 and i.due_date\+5/);
  assert.match(sql, /i.paid_at is null/);
  assert.match(sql, /on conflict\(dedupe_key\).*do nothing/);
  assert.match(sql, /FATURA_MENSAL_DISPONIVEL' then return null/);
  assert.match(push, /monthly_payment_notification_is_current/);
  assert.match(push, /Math.min\(60, 86400/);
});
test('client can generate and open the actual returned Pix, preview cannot write', () => {
  assert.match(page, /data-generate-monthly-pix/);
  assert.match(page, /action: 'client_generate'/);
  assert.match(page, /invoicePaymentActionAllowed\(invoice\)\) openPixModal\(invoice\)/);
  assert.match(page, /clientPreviewMode \|\| demoMode/);
  assert.match(page, /option.state === 'TOO_EARLY'/);
});
test('current cancelled cycle remains visible and future forecasts are separated', () => {
  assert.match(page, /return !option.invoice_id \|\| option.reason === 'INVOICE_CANCELLED'/);
  assert.match(page, /Esta mensalidade não foi transferida para o mês seguinte/);
  assert.match(page, /needsReview \? '<span>Valor em revisão<\/span>'/);
  assert.match(page, /invoice-future-preview/);
  assert.match(page, /option.invoice_month <= currentMonth/);
});
