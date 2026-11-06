type Data = Record<string, unknown>;
export async function recordHistoricalMonthlyReceipt(body: Data, actorId: string,
  rpc: (name: string,args: Data)=>PromiseLike<{data:unknown;error:{message?:string}|null}>) {
  if (Object.keys(body).some(k=>!['action','clientId','invoiceMonth','amount','dueDate','receivedOn','reason'].includes(k)) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body.clientId || '')) ||
    !Number.isFinite(body.amount) || Number(body.amount)<=0 ||
    !['invoiceMonth','dueDate','receivedOn'].every(k=>/^\d{4}-\d{2}-\d{2}$/.test(String(body[k] || '')))) {
    throw new Error('Confira aluno, competência, valor e datas do Pix histórico.');
  }
  const result = await rpc('record_historical_club_monthly_receipt',{
    p_client_id:body.clientId,p_actor_id:actorId,p_invoice_month:body.invoiceMonth,p_amount:body.amount,
    p_due_date:body.dueDate,p_received_on:body.receivedOn,p_reason:String(body.reason || '').trim(),
  });
  if(result.error) throw new Error(result.error.message);
  return result.data;
}
