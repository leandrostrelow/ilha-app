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


test('monthly reminders display their original publication date in club time, not the current date', () => {
  const context = vm.createContext({});
  vm.runInContext(extract('monthlyReminderDateLabel(', 'visibleAnnouncements('), context);
  const label = value => context.monthlyReminderDateLabel(value);
  assert.equal(label(reminder('dated', 'invoice-a', '2026-11-25T01:30:00Z')), 'Aviso de 24/11/2026');
  assert.equal(label(reminder('dated', 'invoice-a', '2026-11-25T12:00:00Z')), 'Aviso de 25/11/2026');
  assert.equal(label(reminder('date-only', 'invoice-a', '2026-11-25')), 'Aviso de 25/11/2026');
  assert.equal(label({ ...newer, event_type: 'FATURA_MENSAL_PAGA' }), '');
  assert.equal(label({ ...newer, published_at: 'invalid' }), '');
  assert.equal(label({ ...newer, published_at: null }), '');
});

test('home and notification list show the dated reminder without relabeling its historical title', () => {
  const item = { ...reminder('dated', 'invoice-a', '2026-11-24T12:00:00Z'), title: 'Sua mensalidade vence amanhã', body: 'Vencimento em 25/11/2026.' };
  const nodes = Object.fromEntries(['notificationsList', 'notificationToolbar', 'homeAnnouncements', 'homeNotices'].map(id => [id, { innerHTML: '', hidden: false, querySelectorAll: () => [] }]));
  const context = vm.createContext({ $: id => nodes[id], visibleAnnouncements: () => [item], readAnnouncementKeys: () => [],
    announcementKey: row => row.id, notificationSourceKey: row => row.id, safeImageUrl: () => '', safeHttpUrl: () => '', escapeHtml: value => String(value), updateNotificationBadges: () => {} });
  vm.runInContext(extract('monthlyReminderDateLabel(', 'visibleAnnouncements(') + extract('renderAnnouncements(', 'renderHome('), context);
  context.renderAnnouncements();
  for (const id of ['notificationsList', 'homeAnnouncements']) {
    assert.match(nodes[id].innerHTML, /Aviso de 24\/11\/2026/);
    assert.match(nodes[id].innerHTML, /Sua mensalidade vence amanhã/);
    assert.match(nodes[id].innerHTML, /Vencimento em 25\/11\/2026/);
  }
  item.event_type = 'GERAL'; context.renderAnnouncements();
  for (const id of ['notificationsList', 'homeAnnouncements']) assert.doesNotMatch(nodes[id].innerHTML, /Aviso de/);
});
