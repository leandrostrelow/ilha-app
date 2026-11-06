type Data = Record<string, unknown>;
type Rpc = (name:string,args:Data)=>PromiseLike<{data:unknown;error:{message?:string}|null}>;
const obj=(v:unknown):Data=>v && typeof v==='object'?v as Data:{};
export async function prepareAuditedMonthlyReissue(body:Data,actorId:string,environment:string,rpc:Rpc,
  providerRequest:(path:string,init?:RequestInit)=>Promise<Data>,snapshot:(payment:Data)=>Data) {
  if(Object.keys(body).some(k=>!['action','invoiceId','expectedAmount','invoiceMonth','oldDueDate','newDueDate','reason'].includes(k)) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body.invoiceId||'')) ||
    !Number.isFinite(body.expectedAmount) || Number(body.expectedAmount)<=0 ||
    !/^\d{4}-\d{2}-01$/.test(String(body.invoiceMonth||'')) ||
    !['oldDueDate','newDueDate'].every(k=>/^\d{4}-\d{2}-\d{2}$/.test(String(body[k]||''))) ||
    String(body.reason||'').trim().length<10 || String(body.reason).length>400) throw new Error('Confira fatura, valor, competência, vencimentos e motivo.');
  const args={p_invoice_id:body.invoiceId,p_actor_id:actorId,p_expected_amount:body.expectedAmount,p_invoice_month:body.invoiceMonth,
    p_old_due_date:body.oldDueDate,p_new_due_date:body.newDueDate,p_reason:String(body.reason).trim()};
  const prepared=await rpc('prepare_audited_monthly_reissue',args);
  if(prepared.error)throw new Error(prepared.error.message);
  const context=obj(prepared.data);
  if(context.state==='READY_DISPATCH')return context;
  const binding=obj(context.payment);
  if(context.state!=='READY_REMOTE' || !context.version || binding.provider_environment!==environment ||
    !binding.provider_payment_id || !binding.provider_customer_id)throw new Error('Vínculo financeiro exige revisão.');
  const path='/payments/'+encodeURIComponent(String(binding.provider_payment_id));
  function validate(p:Data) {
    if(p.id!==binding.provider_payment_id || p.customer!==binding.provider_customer_id || p.externalReference!==binding.external_reference ||
      p.billingType!=='PIX' || Number(p.value)!==Number(body.expectedAmount) || p.dueDate!==body.oldDueDate ||
      !['PENDING','OVERDUE','DELETED','CANCELLED'].includes(String(p.status)) || p.paymentDate || p.clientPaymentDate || typeof p.deleted!=='boolean')
      throw new Error('Cobrança remota divergente ou com recebimento. Reemissão bloqueada.');
  }
  let payment=await providerRequest(path);validate(payment);
  if(!payment.deleted) {
    if(context.allowCancellation!==true || !['PENDING','OVERDUE'].includes(String(payment.status)))throw new Error('Cancelamento remoto não autorizado para este estado.');
    await providerRequest(path,{method:'DELETE'});
    payment=await providerRequest(path);validate(payment);
  }
  if(payment.deleted!==true)throw new Error('Asaas não confirmou o cancelamento. Nenhuma substituta foi criada.');
  const result=await rpc('prepare_audited_monthly_reissue',{...args,p_version:context.version,p_checked_at:new Date().toISOString(),
    p_snapshot:{...snapshot(payment),payment:{...obj(snapshot(payment).payment),deleted:true}}});
  if(result.error)throw new Error(result.error.message);
  if(obj(result.data).state!=='READY_DISPATCH')throw new Error('Reemissão não confirmada.');
  return obj(result.data);
}
