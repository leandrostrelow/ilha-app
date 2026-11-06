import {prepareAuditedMonthlyReissue} from '../supabase/functions/_shared/audited-monthly-reissue.ts';
const id='79000000-0000-4000-8000-000000000001';
const body={action:'audited_reissue',invoiceId:id,expectedAmount:250,invoiceMonth:'2026-11-01',oldDueDate:'2026-11-03',newDueDate:'2026-11-05',reason:'Vencimento contratual conferido pelo responsável.'};
const binding={provider_payment_id:'pay_fixture',provider_customer_id:'cus_fixture',provider_environment:'SANDBOX',external_reference:'ilha-monthly-invoice:'+id};
const remote={id:'pay_fixture',customer:'cus_fixture',externalReference:binding.external_reference,billingType:'PIX',value:250,dueDate:body.oldDueDate,status:'OVERDUE',deleted:false,paymentDate:null,clientPaymentDate:null};
function assert(v:unknown){if(!v)throw new Error('Assertion failed');}
async function scenario(options:{change?:Record<string,unknown>;after?:Record<string,unknown>;cancel?:boolean;retry?:boolean;failDelete?:boolean;stale?:boolean;env?:string;payload?:Record<string,unknown>}={}) {
 let gets=0,deletes=0,completes=0,rejected=false;
 try {await prepareAuditedMonthlyReissue(options.payload||body,id,options.env||'SANDBOX',(_name,args)=>{
   if(args.p_version){completes++;assert((args.p_snapshot as {payment:{deleted:boolean}}).payment.deleted===true);if(options.stale)return Promise.resolve({error:{message:'stale'},data:null});}
   return Promise.resolve({error:null,data:args.p_version||options.retry?{state:'READY_DISPATCH',invoiceId:id,clientId:id}:{state:'READY_REMOTE',version:'version',payment:binding,allowCancellation:options.cancel!==false}});
 },(_path,init)=>{assert(_path==='/payments/pay_fixture');if(init?.method==='DELETE'){deletes++;if(options.failDelete)throw new Error('provider failure');return Promise.resolve({deleted:true});}
   gets++;return Promise.resolve({...remote,deleted:gets>1,...options.change,...(gets>1?options.after:{})});},p=>({payment:p}));}catch{rejected=true;}
 return {gets,deletes,completes,rejected};
}
Deno.test('reviewed unpaid invoice is deleted, reread, then replaced once',async()=>{const r=await scenario();assert(!r.rejected&&r.gets===2&&r.deletes===1&&r.completes===1);});
Deno.test('already cancelled invoice never calls DELETE',async()=>{const r=await scenario({change:{deleted:true},cancel:false});assert(!r.rejected&&r.gets===1&&r.deletes===0&&r.completes===1);});
Deno.test('paid, wrong identity, amount, date and missing deletion flag block all mutation',async()=>{
 for(const change of [{status:'RECEIVED'},{paymentDate:'2026-11-06'},{clientPaymentDate:'2026-11-06'},{customer:'other'},{id:'other'},{externalReference:'other'},{value:251},{dueDate:'2026-11-05'},{billingType:'CREDIT_CARD'},{deleted:undefined}]){const r=await scenario({change});assert(r.rejected&&r.deletes===0&&r.completes===0);}
});
Deno.test('failed delete or paid race after delete cannot produce replacement',async()=>{
 for(const options of [{failDelete:true},{after:{deleted:false}},{after:{paymentDate:'2026-11-06'}},{after:{status:'RECEIVED'}}]){const r=await scenario(options);assert(r.rejected&&r.completes===0);}
});
Deno.test('cancelled local record cannot authorize deleting active remote charge',async()=>{const r=await scenario({cancel:false});assert(r.rejected&&r.deletes===0);});
Deno.test('retry uses existing replacement without touching provider; stale version aborts',async()=>{
 const retry=await scenario({retry:true});assert(!retry.rejected&&retry.gets===0&&retry.deletes===0);
 const stale=await scenario({stale:true});assert(stale.rejected&&stale.completes===1);
});
Deno.test('wrong environment and caller payment identity rejected',async()=>{
 for(const options of [{env:'PRODUCTION'},{payload:{...body,provider_payment_id:'pay_other'}}]){const r=await scenario(options);assert(r.rejected&&r.gets===0&&r.deletes===0);}
});
