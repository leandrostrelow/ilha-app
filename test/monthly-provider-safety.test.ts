import { isDefiniteCustomerRejection, monthlyProviderDiagnostic, monthlyProviderOperation, monthlyRemoteDueDateChanged, monthlyReviewEvent } from '../supabase/functions/_shared/monthly-provider-safety.ts';
function assert(value: unknown) { if (!value) throw new Error('Assertion failed'); }
const failure = (status: number, operation = 'CUSTOMER_CREATE') => ({ name: 'AsaasRequestError', status, operation, codes: ['invalid_object'] });
Deno.test('only explicit customer validation rejections release a creation lease', () => {
  for (const status of [400, 422]) assert(isDefiniteCustomerRejection(failure(status)));
  for (const status of [401, 403, 408, 409, 425, 429, 500, 502, 503]) assert(!isDefiniteCustomerRejection(failure(status)));
  assert(!isDefiniteCustomerRejection(failure(400, 'PAYMENT_CREATE')));
  assert(!isDefiniteCustomerRejection(new Error('timeout')));
});
Deno.test('provider diagnostics never expose descriptions, paths or arbitrary error values', () => {
  const value = monthlyProviderDiagnostic({ ...failure(400), codes: ['invalid_object', 'person@example.com', '52998224725', 'CUSTOMER_NAME'], message: 'person@example.com', operation: '/customers/private-customer-id' });
  assert(JSON.stringify(value) === JSON.stringify({ http_status: 400, codes: ['invalid_object'], operation: 'UNKNOWN' }));
  assert(monthlyProviderOperation('/customers?cpfCnpj=52998224725') === 'CUSTOMER_LOOKUP');
  assert(monthlyProviderOperation('/payments/private-id/pixQrCode') === 'PIX_READ');
  assert(monthlyProviderOperation('/payments', 'POST') === 'PAYMENT_CREATE');
});
Deno.test('ambiguous failure retains only allowlisted diagnostic context', () => {
  assert(monthlyProviderDiagnostic({ name: 'AmbiguousProviderResultError', cause: failure(429, 'PAYMENT_CREATE') })?.http_status === 429);
});
Deno.test('provider reversals and restoration require review, never an automatic paid transition', () => {
  for (const type of ['PAYMENT_RECEIVED_IN_CASH_UNDONE', 'PAYMENT_RESTORED', 'PAYMENT_REFUND_DENIED']) assert(monthlyReviewEvent(type));
  for (const type of ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_UPDATED']) assert(!monthlyReviewEvent(type));
});
Deno.test('remote due-date drift and missing remote date cannot silently reuse the Pix', () => {
  assert(!monthlyRemoteDueDateChanged({ dueDate: '2026-12-10' }, '2026-12-10'));
  assert(monthlyRemoteDueDateChanged({ dueDate: '2026-12-11' }, '2026-12-10'));
  assert(monthlyRemoteDueDateChanged({}, '2026-12-10'));
});
