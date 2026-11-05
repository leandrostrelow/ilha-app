import {registerMonthlyReceiptBatch} from '../supabase/functions/_shared/monthly-receipt-batch.ts';
import {assertEquals,assertRejects} from 'jsr:@std/assert@1.0.14';
const id='11111111-1111-4111-8111-111111111111';
const second='22222222-2222-4222-8222-222222222222';
const body={action:'record_months',clientId:id,requestId:second,months:[{month:'2026-10-01',expectedAmount:100},{month:'2026-11-01',expectedAmount:100}],method:'CASH',receivedOn:'2026-10-09',notes:'2 meses'};
Deno.test('batch validation rejects injected provider IDs before any work',async()=>{
  let calls=0;
  await assertRejects(()=>registerMonthlyReceiptBatch({...body,providerId:'pay_wrong'},id,'PRODUCTION',()=>{calls++;return Promise.resolve({data:null,error:null});},async()=>({}),x=>x));
  assertEquals(calls,0);
});
Deno.test('receipts report partial results and retry completed invoice without repeating payment',async()=>{
  const done=new Set<string>();let fail=true;const completed:string[]=[];
  const rpc=async(name:string,args:Record<string,unknown>)=>{
    if(name==='prepare_monthly_receipt_batch')return{data:{invoices:[{invoiceId:id,month:'2026-10-01',amount:100},{invoiceId:second,month:'2026-11-01',amount:100}]},error:null};
    const invoice=String(args.p_invoice_id);
    if(name==='prepare_monthly_invoice_receipt'){
      if(done.has(invoice))return{data:{state:'COMPLETED'},error:null};
      if(invoice===second&&fail)return{data:null,error:{message:'Falha temporária'}};
      return{data:{state:'READY',claimToken:invoice,payment:null,amount:100},error:null};
    }
    completed.push(invoice);done.add(invoice);return{data:{state:'COMPLETED'},error:null};
  };
  const provider=async()=>{throw Error('Local manual invoice must never call Asaas');};
  let result=await registerMonthlyReceiptBatch(body,id,'PRODUCTION',rpc,provider,x=>x);
  assertEquals(result.state,'PARTIAL');assertEquals(result.results.map(r=>r.state),['COMPLETED','PENDING']);
  fail=false;result=await registerMonthlyReceiptBatch(body,id,'PRODUCTION',rpc,provider,x=>x);
  assertEquals(result.state,'COMPLETED');assertEquals(completed,[id,second]);
});
Deno.test('failed batch preflight never starts provider receipts',async()=>{
  let providerCalls=0;
  await assertRejects(()=>registerMonthlyReceiptBatch(body,id,'PRODUCTION',async()=>({data:null,error:{message:'Valor mudou'}}),async()=>{providerCalls++;return{};},x=>x));
  assertEquals(providerCalls,0);
});
