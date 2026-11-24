type Data = Record<string, unknown>;
type Rpc = (name: string, args: Data) => PromiseLike<{data: unknown; error: {message?: string} | null}>;
const obj = (value: unknown): Data => value && typeof value === 'object' ? value as Data : {};

export async function closeFailedMonthlyInvoice(body: Data, actorId: string, environment: string, rpc: Rpc,
  request: (path: string) => Promise<Data>) {
  if (Object.keys(body).some(key => !['action','invoiceId','expectedAmount','invoiceMonth','oldDueDate','reason'].includes(key)) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body.invoiceId || '')) ||
    !Number.isFinite(body.expectedAmount) || Number(body.expectedAmount) <= 0 ||
    !/^\d{4}-\d{2}-01$/.test(String(body.invoiceMonth || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.oldDueDate || '')) ||
    String(body.reason || '').trim().length < 10 || String(body.reason).length > 400) throw new Error('Confira os dados do encerramento.');
  const args = {p_invoice_id:body.invoiceId, p_actor_id:actorId, p_expected_amount:body.expectedAmount,
    p_invoice_month:body.invoiceMonth, p_old_due_date:body.oldDueDate, p_reason:String(body.reason).trim()};
  const prepared = await rpc('close_failed_monthly_invoice', args);
  if (prepared.error) throw new Error(prepared.error.message);
  const context = obj(prepared.data);
  if (context.state === 'COMPLETED') return context;
  if (context.state !== 'CHECK_ABSENCE' || !context.version || context.environment !== environment ||
    context.externalReference !== `ilha-monthly-invoice:${body.invoiceId}`) throw new Error('Vínculo financeiro divergente.');
  const remote = await request('/payments?externalReference=' + encodeURIComponent(String(context.externalReference)) + '&limit=100');
  if (remote.totalCount !== 0 || remote.hasMore !== false || !Array.isArray(remote.data) || remote.data.length !== 0)
    throw new Error('Existe cobrança remota ou resposta inconclusiva. Encerramento bloqueado.');
  const completed = await rpc('close_failed_monthly_invoice', {...args, p_version:context.version, p_checked_at:new Date().toISOString(),
    p_snapshot:{externalReference:context.externalReference, environment, totalCount:0, hasMore:false, data:[]}});
  if (completed.error) throw new Error(completed.error.message);
  if (obj(completed.data).state !== 'COMPLETED') throw new Error('Encerramento não confirmado.');
  return obj(completed.data);
}
