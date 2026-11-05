type RecordData = Record<string, unknown>;
type Rpc = (name: string, args: RecordData) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
type ProviderRequest = (path: string, init?: RequestInit) => Promise<RecordData>;

const cents = (value: unknown) => Math.round(Number(value) * 100);
const obj = (value: unknown): RecordData => value && typeof value === 'object' ? value as RecordData : {};

// The edge handler has already checked finance.write and verified actorId.
// Only invoice identity + expected total come from the UI, never provider IDs.
export async function registerMonthlyInvoiceReceipt(
  body: RecordData, actorId: string, environment: string, rpc: Rpc,
  providerRequest: ProviderRequest, snapshot: (payment: RecordData) => RecordData,
) {
  const allowed = ['action', 'invoiceId', 'method', 'receivedOn', 'expectedAmount', 'notes'];
  const date = String(body.receivedOn || '');
  if (Object.keys(body).some(key => !allowed.includes(key)) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body.invoiceId || '')) ||
      !['CASH', 'CLUB_PIX'].includes(String(body.method)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date ||
      !Number.isFinite(Number(body.expectedAmount)) || Number(body.expectedAmount) <= 0) {
    throw new Error('Confira a fatura, o valor, a forma e a data do recebimento.');
  }
  const prepared = await rpc('prepare_monthly_invoice_receipt', {
    p_invoice_id: body.invoiceId, p_actor_id: actorId, p_method: body.method,
    p_received_on: date, p_expected_amount: Number(body.expectedAmount),
    p_notes: String(body.notes || '').trim().slice(0, 500) || null,
  });
  if (prepared.error) throw new Error(prepared.error.message || 'Não foi possível preparar o recebimento.');
  const receipt = obj(prepared.data);
  if (receipt.state === 'COMPLETED') return receipt;
  if (receipt.state !== 'READY' || !receipt.claimToken) throw new Error('Recebimento ainda não liberado. Atualize a fatura.');
  const binding = obj(receipt.payment);
  let confirmedSnapshot: RecordData | null = null;
  if (receipt.payment) {
    if (binding.provider_environment !== environment || !binding.provider_payment_id || !binding.provider_customer_id) {
      throw new Error('O vínculo desta cobrança precisa de revisão.');
    }
    const path = `/payments/${encodeURIComponent(String(binding.provider_payment_id))}`;
    const validate = (payment: RecordData) => {
      if (payment.id !== binding.provider_payment_id || payment.externalReference !== binding.external_reference ||
          payment.customer !== binding.provider_customer_id || payment.deleted === true ||
          !Number.isFinite(Number(payment.value)) || cents(payment.value) !== cents(receipt.amount)) {
        throw new Error('A cobrança no Asaas diverge desta fatura. Nenhuma baixa foi confirmada.');
      }
    };
    const isCashReceipt = (payment: RecordData) => ['RECEIVED', 'RECEIVED_IN_CASH'].includes(String(payment.status)) &&
      (payment.status === 'RECEIVED_IN_CASH' || payment.billingType === 'RECEIVED_IN_CASH');
    let payment = await providerRequest(path);
    validate(payment);
    // Recovery after a timeout: consult first and never repeat an already
    // confirmed receipt. A normal Pix payment is not a manual cash receipt.
    if (!isCashReceipt(payment)) {
      if (!['PENDING', 'OVERDUE'].includes(String(payment.status)) || payment.billingType !== 'PIX') {
        throw new Error('O pagamento já foi identificado ou está em revisão no Asaas. Atualize a fatura antes de registrar recebimento.');
      }
      try {
        await providerRequest(`${path}/receiveInCash`, {
          method: 'POST', body: JSON.stringify({ paymentDate: receipt.receivedOn, value: receipt.amount, notifyCustomer: false }),
        });
      } catch {
        // The POST may have succeeded even if its response was lost. GET is
        // authoritative; a retry can only resume this same invoice/receipt.
      }
      payment = await providerRequest(path);
      validate(payment);
      if (!isCashReceipt(payment)) throw new Error('O Asaas ainda não confirmou a baixa. Aguarde dois minutos e tente novamente com os mesmos dados.');
    }
    const remoteDate = String(payment.clientPaymentDate || payment.paymentDate || '').slice(0, 10);
    if (remoteDate !== receipt.receivedOn) throw new Error('A data recebida do Asaas difere da confirmação pendente. Solicite revisão antes de continuar.');
    confirmedSnapshot = snapshot(payment);
  }
  const completed = await rpc('complete_monthly_invoice_receipt', {
    p_invoice_id: body.invoiceId, p_claim_token: receipt.claimToken, p_provider_snapshot: confirmedSnapshot,
  });
  if (completed.error) throw new Error(completed.error.message || 'Não foi possível sincronizar a baixa. Atualize antes de tentar novamente.');
  if (obj(completed.data).state !== 'COMPLETED') throw new Error('Recebimento não confirmado. Atualize a fatura.');
  return completed.data;
}
