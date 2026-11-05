import { registerMonthlyInvoiceReceipt } from './monthly-invoice-receipt.ts';
type Data = Record<string, unknown>;
type Rpc = (name: string, args: Data) => PromiseLike<{data: unknown; error: {message?: string} | null}>;
type Provider = (path: string, init?: RequestInit) => Promise<Data>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): Data => value && typeof value === 'object' ? value as Data : {};

export async function registerMonthlyReceiptBatch(body: Data, actorId: string, environment: string,
  rpc: Rpc, provider: Provider, snapshot: (payment: Data) => Data) {
  const allowed = ['action','clientId','requestId','months','method','receivedOn','notes'];
  const date = String(body.receivedOn || '');
  if (Object.keys(body).some(key => !allowed.includes(key)) || !uuid.test(String(body.clientId)) ||
    !uuid.test(String(body.requestId)) || !['CASH','CLUB_PIX'].includes(String(body.method)) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0,10) !== date || !Array.isArray(body.months) ||
    !body.months.length || body.months.length > 12) throw Error('Confira o aluno, os meses e o recebimento.');
  const prepared = await rpc('prepare_monthly_receipt_batch', {
    p_client_id: body.clientId, p_actor_id: actorId, p_request_id: body.requestId, p_months: body.months,
    p_method: body.method, p_received_on: date, p_notes: String(body.notes || '').trim().slice(0,500) || null,
  });
  if (prepared.error) throw Error(prepared.error.message || 'Não foi possível conferir os meses.');
  const invoices = record(prepared.data).invoices;
  if (!Array.isArray(invoices) || invoices.length !== body.months.length) throw Error('Recebimento incompleto. Atualize e confira.');
  const results: Data[] = [];
  for (const value of invoices) {
    const invoice = record(value);
    try {
      await registerMonthlyInvoiceReceipt({action:'record_receipt', invoiceId:invoice.invoiceId,
        expectedAmount:invoice.amount, method:body.method, receivedOn:date, notes:body.notes},
        actorId,environment,rpc,provider,snapshot);
      results.push({...invoice,state:'COMPLETED'});
    } catch (error) {
      results.push({...invoice,state:'PENDING',error:error instanceof Error ? error.message : 'Atualize e confira este mês.'});
    }
  }
  // A remote receipt cannot be rolled back. Report per-month completion and
  // retain the same batch identity so a timeout/partial response is safely resumable.
  return {requestId:body.requestId,state:results.every(row=>row.state==='COMPLETED')?'COMPLETED':'PARTIAL',results};
}
