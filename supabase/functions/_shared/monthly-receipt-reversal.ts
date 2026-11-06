type Data = Record<string, unknown>;
type Rpc = (name: string, args: Data) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
const obj = (v: unknown): Data => v && typeof v === 'object' ? v as Data : {};

// Administrative review only. Never POST to Asaas, reopen collection, or invent a receipt date.
export async function reviewReversedMonthlyReceipt(body: Data, actorId: string, environment: string,
  rpc: Rpc, providerRequest: (path: string) => Promise<Data>, snapshot: (p: Data) => Data) {
  const allowed = ['action', 'invoiceId', 'expectedAmount', 'invoiceMonth', 'dueDate', 'reason'];
  if (Object.keys(body).some(k => !allowed.includes(k)) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body.invoiceId || '')) ||
    !Number.isFinite(body.expectedAmount) || Number(body.expectedAmount) <= 0 ||
    !/^\d{4}-\d{2}-01$/.test(String(body.invoiceMonth || '')) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(body.dueDate || '')) ||
    String(body.reason || '').trim().length < 10 || String(body.reason).length > 500) {
    throw new Error('Confira competência, valor, vencimento e motivo da reconciliação.');
  }
  const args = { p_invoice_id: body.invoiceId, p_actor_id: actorId, p_expected_amount: body.expectedAmount,
    p_invoice_month: body.invoiceMonth, p_due_date: body.dueDate, p_reason: String(body.reason).trim() };
  const prepared = await rpc('review_reversed_monthly_receipt', args);
  if (prepared.error) throw new Error(prepared.error.message);
  const context = obj(prepared.data);
  if (context.state === 'REVIEW_REQUIRED') return context;
  const binding = obj(context.payment);
  if (context.state !== 'READY' || !context.version || binding.provider_environment !== environment ||
    !binding.provider_payment_id || !binding.provider_customer_id) throw new Error('Vínculo financeiro exige revisão.');
  const payment = await providerRequest(`/payments/${encodeURIComponent(String(binding.provider_payment_id))}`);
  if (payment.id !== binding.provider_payment_id || payment.customer !== binding.provider_customer_id ||
    payment.externalReference !== binding.external_reference || payment.deleted !== false ||
    payment.billingType !== 'PIX' || !['PENDING', 'OVERDUE'].includes(String(payment.status)) ||
    Number(payment.value) !== Number(body.expectedAmount) || payment.dueDate !== body.dueDate ||
    payment.paymentDate || payment.clientPaymentDate) {
    throw new Error('Asaas não comprova a reversão desta cobrança. Nenhum registro foi alterado.');
  }
  const result = await rpc('review_reversed_monthly_receipt', { ...args, p_expected_version: context.version,
    p_snapshot: { ...snapshot(payment), payment: { ...obj(snapshot(payment).payment), deleted: false } }, p_checked_at: new Date().toISOString(), p_remote_due_date: payment.dueDate });
  if (result.error) throw new Error(result.error.message);
  if (obj(result.data).state !== 'REVIEW_REQUIRED') throw new Error('Reconciliação não concluída.');
  return result.data;
}
