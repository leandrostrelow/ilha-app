import { deepStrictEqual as assertEquals, rejects as assertRejects } from "node:assert/strict";
import { receiveClosedMonthlyInvoice } from "../supabase/functions/_shared/closed-invoice-receipt.ts";
const body={action:'receive_closed',invoiceId:'93000000-0000-4000-8000-000000000021',expectedAmount:350,invoiceMonth:'2026-11-01',oldDueDate:'2026-11-05',receivedOn:'2026-11-23',reason:'Synthetic confirmed club Pix receipt.'};
const context={state:'CHECK_ABSENCE',version:'v1',externalReference:'ilha-monthly-invoice:'+body.invoiceId,environment:'SANDBOX'};
Deno.test('closed receipt checks absence and preserves the exact receipt date without provider mutation',async()=>{
 const calls:Record<string,unknown>[]=[];const paths:string[]=[];
 const result=await receiveClosedMonthlyInvoice(body,'actor','SANDBOX',(_n,args)=>{calls.push(args);return Promise.resolve({data:calls.length===1?context:{state:'COMPLETED'},error:null});},path=>{paths.push(path);return Promise.resolve({totalCount:0,hasMore:false,data:[]});});
 assertEquals(result.state,'COMPLETED');assertEquals(calls.length,2);assertEquals(calls[1].p_received_on,'2026-11-23');
 assertEquals(calls[1].p_version,'v1');assertEquals(paths,['/payments?externalReference=ilha-monthly-invoice%3A'+body.invoiceId+'&limit=100']);
});
Deno.test('remote charge, incomplete response, environment mismatch and uncertain outcome block receipt',async()=>{
 for(const remote of [{totalCount:1,hasMore:false,data:[{id:'pay_existing'}]},{totalCount:0,hasMore:true,data:[]},{totalCount:0,data:[]},{totalCount:0,hasMore:false,data:[{}]}]){
  let calls=0;await assertRejects(()=>receiveClosedMonthlyInvoice(body,'actor','SANDBOX',()=>{calls++;return Promise.resolve({data:context,error:null});},()=>Promise.resolve(remote)));assertEquals(calls,1);
 }
 await assertRejects(()=>receiveClosedMonthlyInvoice(body,'actor','PRODUCTION',()=>Promise.resolve({data:context,error:null}),()=>{throw new Error('must not call provider');}));
 let calls=0;await assertRejects(()=>receiveClosedMonthlyInvoice(body,'actor','SANDBOX',()=>Promise.resolve({data:++calls===1?context:{state:'PENDING'},error:null}),()=>Promise.resolve({totalCount:0,hasMore:false,data:[]})));
});
Deno.test('rejects payload overrides and returns only database-confirmed idempotent completion',async()=>{
 for(const change of [{receivedOn:''},{expectedAmount:0},{providerStatus:'RECEIVED'},{method:'CASH'}]) await assertRejects(()=>receiveClosedMonthlyInvoice({...body,...change},'actor','SANDBOX',()=>{throw new Error('must not call database');},()=>Promise.resolve({})));
 assertEquals(await receiveClosedMonthlyInvoice(body,'actor','SANDBOX',()=>Promise.resolve({data:{state:'COMPLETED',invoiceId:'replacement'},error:null}),()=>{throw new Error('no provider repeat');}),{state:'COMPLETED',invoiceId:'replacement'});
});
