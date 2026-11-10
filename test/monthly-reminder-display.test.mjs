import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extract(start, end) { return html.slice(html.indexOf('    function ' + start), html.indexOf('    function ' + end)); }
function fixture(items, invoices = [], dismissed = []) {
  const context = vm.createContext({ URL, announcements: items, paymentInvoices: invoices,
    dismissedNotificationKeys: new Set(dismissed), announcementMatchesClient: x => x.active !== false,
    localDateString: () => '2026-11-10', invoicePixExpired: () => false });
  vm.runInContext(extract('notificationSourceKey(', 'readAnnouncementKeys(') + extract('invoiceEffectiveStatus(', 'invoiceProviderNeedsReview('), context);
  return () => Array.from(context.visibleAnnouncements(), x => x.id);
}
function reminder(id, invoice, date) {
  return { id, source_id: id, source_type: 'client', event_type: 'FATURA_MENSAL_LEMBRETE',
    link_url: '/?view=payments&invoice=' + invoice, published_at: date };
}
const older = reminder('old', 'invoice-a', '2026-11-05');
const newer = reminder('new', 'invoice-a', '2026-11-08');
test('keeps only newest reminder per invoice, without changing the stored history', () => {
  const items = [older, reminder('other', 'invoice-b', '2026-11-07'), newer];
  assert.deepEqual(fixture(items)(), ['new', 'other']);
  assert.deepEqual(items.map(x => x.id), ['old', 'other', 'new']);
});
test('paid, cancelled and confirmed invoices hide collection reminders', () => {
  for (const fields of [{ status: 'PAGA' }, { status: 'CANCELADA' }, { provider_status: 'RECEIVED' },
    { provider_status: 'CANCELLED' }, { provider_status: 'CONFIRMED' }, { paid_at: '2026-11-09' }]) {
    assert.deepEqual(fixture([older, newer], [{ id: 'invoice-a', ...fields }])(), []);
  }
});
test('open and overdue invoices retain one reminder', () => {
  for (const status of ['ABERTA', 'VENCIDA']) {
    assert.deepEqual(fixture([older, newer], [{ id: 'invoice-a', status }])(), ['new']);
  }
});
test('clearing newest reminder never uncovers older ones', () => {
  assert.deepEqual(fixture([older, newer], [], ['client:new'])(), []);
});
test('a new daily reminder can appear after an earlier one was dismissed', () => {
  assert.deepEqual(fixture([older, newer], [], ['client:old'])(), ['new']);
});
test('unavailable invoice data still deduplicates without assuming payment', () => {
  assert.deepEqual(fixture([older, newer])(), ['new']);
});
test('other notices and payment confirmations stay visible; missing links do not collapse', () => {
  const paid = { ...newer, id: 'paid', source_id: 'paid', event_type: 'FATURA_MENSAL_PAGA' };
  const generic = { ...older, id: 'generic', source_id: 'generic', event_type: 'GERAL' };
  const missing1 = { ...older, id: 'missing1', source_id: 'missing1', link_url: '' };
  const missing2 = { ...older, id: 'missing2', source_id: 'missing2', link_url: '' };
  assert.deepEqual(fixture([older, paid, generic, missing1, missing2], [{ id: 'invoice-a', status: 'PAGA' }])(), ['paid', 'generic', 'missing1', 'missing2']);
});
