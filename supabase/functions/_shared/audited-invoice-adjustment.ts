type Data = Record<string, unknown>;
type Rpc = (name:string,args:Data)=>PromiseLike<{data:unknown;error:{message?:string}|null}>;
const obj=(v:unknown):Data=>v && typeof v==='object'?v as Data:{};
export async function adjustMonthlyInvoice(body:Data,actorId:string,environment:string,rpc:Rpc,
 providerRequest:(path:string,init?:RequestInit)=>Promise<Data>,snapshot:(payment:Data)=>Data) {
 if(Object.keys(body).some(k=>!['action','operation','invoiceId','expectedAmount','invoiceMonth','oldDueDate','newDueDate','reason'].includes(k)) ||
 !['due_date','cancel'].includes(String(body.operation)) ||
 !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body.invoiceId||'')) ||
 !Number.isFinite(body.expectedAmount) || Number(body.expectedAmount)<=0 ||
 !/^\d{4}-\d{2}-01$/.test(String(body.invoiceMonth||'')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.oldDueDate||'')) ||
 (body.operation==='due_date'?!/^\d{4}-\d{2}-\d{2}$/.test(String(body.newDueDate||'')):body.newDueDate!=null) ||
 String(body.reason||'').trim().length<10 || String(body.reason).length>400) throw new Error('Confira operação, fatura, valor, competência, vencimentos e motivo.');
 const args={p_invoice_id:body.invoiceId,p_actor_id:actorId,p_operation:body.operation,p_expected_amount:body.expectedAmount,
 p_invoice_month:body.invoiceMonth,p_old_due_date:body.oldDueDate,p_new_due_date:body.newDueDate??null,p_reason:String(body.reason).trim()};
 const prepared=await rpc('adjust_unpaid_monthly_invoice',args);
 if(prepared.error)throw new Error(prepared.error.message);
 const context=obj(prepared.data);
 if(context.state==='COMPLETED')return context;
 const binding=obj(context.payment);
 if(context.state!=='READY_REMOTE' || !context.version || binding.provider_environment!==environment || !binding.provider_payment_id || !binding.provider_customer_id)throw new Error('Vínculo financeiro exige revisão.');
 const path='/payments/'+encodeURIComponent(String(binding.provider_payment_id));
 function validate(p:Data,finished=false) {
  if(p.id!==binding.provider_payment_id || p.customer!==binding.provider_customer_id || p.externalReference!==binding.external_reference ||
   p.billingType!=='PIX' || Number(p.value)!==Number(body.expectedAmount) || p.paymentDate || p.clientPaymentDate || typeof p.deleted!=='boolean' ||
   !(body.operation==='cancel'?['PENDING','OVERDUE','DELETED','CANCELLED']:['PENDING','OVERDUE']).includes(String(p.status)) ||
   (body.operation==='due_date'?(p.deleted || ![body.newDueDate,...(finished?[]:[body.oldDueDate])].includes(p.dueDate)):(p.dueDate!==body.oldDueDate || (finished&&!p.deleted))))
    throw new Error('Cobrança remota divergente ou com recebimento. Ajuste bloqueado.');
 }
 let payment=await providerRequest(path);validate(payment);
 if(body.operation==='cancel'&&!payment.deleted)await providerRequest(path,{method:'DELETE'});
 if(body.operation==='due_date'&&payment.dueDate!==body.newDueDate)await providerRequest(path,{method:'PUT',body:JSON.stringify({dueDate:body.newDueDate,billingType:payment.billingType,value:payment.value})});
 payment=await providerRequest(path);validate(payment,true);
 const completed=await rpc('adjust_unpaid_monthly_invoice',{...args,p_version:context.version,p_checked_at:new Date().toISOString(),
  p_snapshot:{...snapshot(payment),payment:{...obj(snapshot(payment).payment),deleted:payment.deleted}}});
 if(completed.error)throw new Error(completed.error.message);
 if(obj(completed.data).state!=='COMPLETED')throw new Error('Conciliação não concluída; confira antes de repetir.');
 return obj(completed.data);
}
