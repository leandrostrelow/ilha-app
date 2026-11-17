type Data = Record<string, unknown>;
type Rpc = (name:string,args:Data)=>PromiseLike<{data:unknown;error:{message?:string}|null}>;
const obj=(v:unknown):Data=>v && typeof v==='object'?v as Data:{};
export async function adjustInvoiceAmount(body:Data,actorId:string,environment:string,rpc:Rpc,
 request:(path:string,init?:RequestInit)=>Promise<Data>,snapshot:(payment:Data)=>Data, pix:(id:string)=>Promise<{payload:string;expiresAt:string|null}>) {
 if(Object.keys(body).some(k=>!['action','invoiceId','expectedAmount','newAmount','invoiceMonth','oldDueDate','reason'].includes(k)) ||
 !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body.invoiceId||'')) ||
 ![body.expectedAmount,body.newAmount].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&Math.abs(v*100-Math.round(v*100))<0.000001) ||
 !/^\d{4}-\d{2}-01$/.test(String(body.invoiceMonth||'')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.oldDueDate||'')) ||
 String(body.reason||'').trim().length<10 || String(body.reason).length>400) throw new Error('Confira fatura, valores, competência, vencimento e motivo.');
 const args={p_invoice_id:body.invoiceId,p_actor_id:actorId,p_new_amount:body.newAmount,p_expected_amount:body.expectedAmount,
 p_invoice_month:body.invoiceMonth,p_old_due_date:body.oldDueDate,p_reason:String(body.reason).trim()};
 const prepared=await rpc('adjust_unpaid_monthly_invoice_amount',args);
 if(prepared.error)throw new Error(prepared.error.message);
 const context=obj(prepared.data),binding=obj(context.payment);
 if(context.state==='COMPLETED')return context;
 if(context.state!=='READY_REMOTE'||!context.version||binding.provider_environment!==environment||!binding.provider_payment_id||!binding.provider_customer_id)throw new Error('Vínculo financeiro exige revisão.');
 const path='/payments/'+encodeURIComponent(String(binding.provider_payment_id));
 function validate(p:Data,finished=false){
 if(p.id!==binding.provider_payment_id||p.customer!==binding.provider_customer_id||p.externalReference!==binding.external_reference||p.billingType!=='PIX'||
 p.deleted!==false||p.paymentDate||p.clientPaymentDate||!['PENDING','OVERDUE'].includes(String(p.status))||p.dueDate!==body.oldDueDate||
 !(finished?[body.newAmount]:[body.expectedAmount,body.newAmount]).includes(Number(p.value)))throw new Error('Cobrança remota divergente ou com recebimento. Ajuste bloqueado.');
 }
 let payment=await request(path);validate(payment);
 // Preserve the existing due date and payment method required by the update contract.
 if(Number(payment.value)!==body.newAmount)await request(path,{method:'PUT',body:JSON.stringify({value:body.newAmount,dueDate:payment.dueDate,billingType:payment.billingType})});
 payment=await request(path);validate(payment,true);
 const qr=await pix(String(binding.provider_payment_id));
 if(!qr.payload)throw new Error('Asaas não retornou o Pix atualizado. Confira antes de repetir.');
 payment=await request(path);validate(payment,true);
 const result=await rpc('adjust_unpaid_monthly_invoice_amount',{...args,p_version:context.version,p_checked_at:new Date().toISOString(),
 p_snapshot:{...snapshot(payment),pix_payload:qr.payload,pix_expires_at:qr.expiresAt,payment:{...obj(snapshot(payment).payment),deleted:payment.deleted}}});
 if(result.error)throw new Error(result.error.message);
 if(obj(result.data).state!=='COMPLETED')throw new Error('Conciliação não concluída; confira antes de repetir.');
 return obj(result.data);
}
