import { reviewReversedMonthlyReceipt } from '../supabase/functions/_shared/monthly-receipt-reversal.ts';
const id = '77000000-0000-4000-8000-000000000001';
const body = {action:'review_reversal',invoiceId:id,expectedAmount:250,invoiceMonth:'2026-11-01',dueDate:'2026-11-03',reason:'Confirmação equivocada desfeita no provedor.'};
const binding = {provider_payment_id:'pay_test',provider_customer_id:'cus_test',provider_environment:'SANDBOX',external_reference:'ilha-monthly-invoice:'+id};
const remote = {id:'pay_test',customer:'cus_test',externalReference:binding.external_reference,value:250,billingType:'PIX',status:'OVERDUE',deleted:false,dueDate:body.dueDate,paymentDate:null,clientPaymentDate:null};
function assert(v: unknown) { if (!v) throw new Error('Assertion failed'); }
async function scenario(change: Record<string,unknown> = {}, data = body, env = 'SANDBOX', done = false) {
  let reads = 0, writes = 0, rejected = false;
  try {
    await reviewReversedMonthlyReceipt(data,id,env,(name,args)=> {
      assert(name==='review_reversed_monthly_receipt');
      if(args.p_expected_version) { writes++; assert(args.p_expected_version==='version' && args.p_actor_id===id); }
      return Promise.resolve({error:null,data:args.p_expected_version || done ? {state:'REVIEW_REQUIRED'} : {state:'READY',payment:binding,version:'version'}});
    },(path)=> { reads++; assert(path==='/payments/pay_test'); return Promise.resolve({...remote,...change}); },p=>({payment:p}));
  } catch { rejected=true; }
  return {reads,writes,rejected};
}
Deno.test('Reversal reads Asaas once and quarantines only the verified invoice',async()=>{
  const r=await scenario(); assert(!r.rejected && r.reads===1 && r.writes===1);
});
Deno.test('Reversal rejects received, deleted, wrong identity, amount, date and environment',async()=>{
  for(const change of [{status:'RECEIVED'},{status:'CONFIRMED'},{deleted:true},{deleted:undefined},{id:'other'},
    {customer:'other'},{externalReference:'other'},{value:251},{dueDate:'2026-11-05'},
    {billingType:'RECEIVED_IN_CASH'},{paymentDate:'2026-11-06'},{clientPaymentDate:'2026-11-06'}]) {
    const r=await scenario(change); assert(r.rejected && r.writes===0);
  }
  const r=await scenario({},body,'PRODUCTION'); assert(r.rejected && r.reads===0 && r.writes===0);
});
Deno.test('Reversal rejects caller provider IDs and missing accounting data before RPC',async()=>{
  for(const data of [{...body,provider_payment_id:'pay_other'},{...body,reason:''},{...body,invoiceMonth:''},
    {...body,expectedAmount:0},{...body,dueDate:''}]) {
    const r=await scenario({},data); assert(r.rejected && r.reads===0 && r.writes===0);
  }
});
Deno.test('Already reviewed reversal is idempotent without a provider call',async()=>{
  const r=await scenario({},body,'SANDBOX',true); assert(!r.rejected && r.reads===0 && r.writes===0);
});
Deno.test('Concurrent local change rejects final reconciliation',async()=>{
  let called=0,rejected=false;
  try {
    await reviewReversedMonthlyReceipt(body,id,'SANDBOX',()=> Promise.resolve(++called===1 ?
      {error:null,data:{state:'READY',payment:binding,version:'old'}} : {error:{message:'Dados alterados'},data:null}),
      ()=>Promise.resolve(remote),p=>({payment:p}));
  } catch {rejected=true;}
  assert(rejected && called===2);
});
