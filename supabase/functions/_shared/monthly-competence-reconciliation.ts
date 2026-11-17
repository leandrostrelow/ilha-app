type Data=Record<string,unknown>;
const obj=(v:unknown):Data=>v&&typeof v==='object'?v as Data:{};
export async function reconcileMonthlyCompetence(body:Data,actor:string,environment:string,
 rpc:(name:string,args:Data)=>PromiseLike<{data:unknown;error:{message?:string}|null}>,
 request:(path:string,init?:RequestInit)=>Promise<Data>,snapshot:(p:Data)=>Data){
 const keys=['action','sourceId','targetId','amount','sourceMonth','targetMonth','sourcePaidOn','clubPaidOn','clubDueDate','reason'];
 if(Object.keys(body).some(k=>!keys.includes(k))||!['sourceId','targetId'].every(k=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body[k]||'')))||
 !['sourceMonth','targetMonth','sourcePaidOn','clubPaidOn','clubDueDate'].every(k=>/^\d{4}-\d{2}-\d{2}$/.test(String(body[k]||'')))||
 !Number.isFinite(body.amount)||Number(body.amount)<=0||String(body.reason||'').trim().length<10||String(body.reason).length>400)throw new Error('Confira os dois recebimentos e as competências.');
 const args={p_source_id:body.sourceId,p_target_id:body.targetId,p_actor_id:actor,p_amount:body.amount,p_source_month:body.sourceMonth,
 p_target_month:body.targetMonth,p_source_paid_on:body.sourcePaidOn,p_club_paid_on:body.clubPaidOn,p_club_due_date:body.clubDueDate,p_reason:String(body.reason).trim()};
 const prepared=await rpc('reconcile_monthly_competence',args);if(prepared.error)throw new Error(prepared.error.message);
 const c=obj(prepared.data);if(c.state==='COMPLETED')return c;
 const source=obj(c.source),target=obj(c.target);
 if(c.state!=='READY'||!c.version||[source,target].some(b=>b.environment!==environment||!b.id||!b.customer||!b.reference))throw new Error('Vínculo financeiro divergente.');
 const path=(b:Data)=>'/payments/'+encodeURIComponent(String(b.id));
 function validate(p:Data,b:Data,paid:boolean,finished=false){
 if(p.id!==b.id||p.customer!==b.customer||p.externalReference!==b.reference||Number(p.value)!==body.amount||p.dueDate!==b.dueDate||p.billingType!=='PIX'||typeof p.deleted!=='boolean')throw new Error('Identidade da cobrança divergente.');
 if(paid?(p.deleted||p.status!=='RECEIVED'||String(p.clientPaymentDate||p.paymentDate||'').slice(0,10)!==body.sourcePaidOn):
 (p.paymentDate||p.clientPaymentDate||!['PENDING','OVERDUE','DELETED','CANCELLED'].includes(String(p.status))||(finished&&!p.deleted)))throw new Error('Recebimento ou cancelamento divergente no Asaas.');
 }
 let paid=await request(path(source));validate(paid,source,true);
 let unpaid=await request(path(target));validate(unpaid,target,false);
 if(!unpaid.deleted)await request(path(target),{method:'DELETE'});
 unpaid=await request(path(target));validate(unpaid,target,false,true);
 paid=await request(path(source));validate(paid,source,true);
 const proof=(p:Data)=>({...snapshot(p),payment:{...obj(snapshot(p).payment),deleted:p.deleted}});
 const result=await rpc('reconcile_monthly_competence',{...args,p_version:c.version,p_proof:{source:proof(paid),target:proof(unpaid)},p_checked_at:new Date().toISOString()});
 if(result.error)throw new Error(result.error.message);
 if(obj(result.data).state!=='COMPLETED')throw new Error('Conciliação pendente. Confira antes de repetir.');return obj(result.data);
}
