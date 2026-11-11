import { adjustMonthlyInvoice as run } from '../supabase/functions/_shared/audited-invoice-adjustment.ts';
const body={action:'adjust_invoice',operation:'due_date',invoiceId:'79000000-0000-4000-8000-000000000021',expectedAmount:350,invoiceMonth:'2026-11-01',oldDueDate:'2026-11-05',newDueDate:'2026-11-25',reason:'Authorized correction to registered due day.'};
const binding={provider_payment_id:'pay_test',provider_customer_id:'cus_test',external_reference:'invoice_test',provider_environment:'SANDBOX'};
const remote={id:'pay_test',customer:'cus_test',externalReference:'invoice_test',billingType:'PIX',value:350,dueDate:'2026-11-05',status:'OVERDUE',deleted:false};
function assert(v:unknown){if(!v)throw new Error('Assertion failed');}
function fixture(changes:Record<string,unknown>={}) {
 let p={...remote,...changes},calls=0;const writes:RequestInit[]=[];
 const rpc=()=>Promise.resolve({error:null,data:++calls===1?{state:'READY_REMOTE',version:'v',payment:binding}:{state:'COMPLETED'}});
 const request=(_path:string,init?:RequestInit)=>{if(init){writes.push(init);p={...p,...(init.method==='DELETE'?{deleted:true}:JSON.parse(String(init.body)))};}return Promise.resolve(p);};
 return {rpc,request,writes,count:()=>calls};
}
Deno.test('updates the same charge then reads confirmation before local completion',async()=>{
 const f=fixture();const r=await run(body,'actor','SANDBOX',f.rpc,f.request,p=>({payment:p}));
 assert(r.state==='COMPLETED'&&f.count()===2&&f.writes.length===1&&f.writes[0].method==='PUT');
 assert(JSON.parse(String(f.writes[0].body)).dueDate==='2026-11-25');
});
Deno.test('retry after remote success skips another PUT and completes local reconciliation',async()=>{
 const f=fixture({dueDate:body.newDueDate});await run(body,'actor','SANDBOX',f.rpc,f.request,p=>({payment:p}));assert(f.writes.length===0&&f.count()===2);
});
Deno.test('cancellation confirms remote deletion without a new charge or receipt',async()=>{
 const f=fixture();await run({...body,operation:'cancel',newDueDate:null},'actor','SANDBOX',f.rpc,f.request,p=>({payment:p}));assert(f.writes.length===1&&f.writes[0].method==='DELETE'&&f.count()===2);
});
for(const changes of [{status:'RECEIVED'},{status:'CONFIRMED'},{paymentDate:'2026-11-06'},{clientPaymentDate:'2026-11-06'},{value:351},{customer:'other'},{id:'other'},{externalReference:'other'},{deleted:true},{dueDate:'2026-10-05'},{billingType:'BOLETO'}]){
 Deno.test('reject divergent remote '+JSON.stringify(changes),async()=>{
 const f=fixture(changes);let blocked=false;try{await run(body,'actor','SANDBOX',f.rpc,f.request,p=>({payment:p}));}catch{blocked=true;}assert(blocked&&f.writes.length===0&&f.count()===1);
 });
}
Deno.test('provider refusal does not commit local changes',async()=>{
 const f=fixture();let blocked=false;try{await run(body,'actor','SANDBOX',f.rpc,(_path,init)=>init?Promise.reject(Error('refused')):Promise.resolve(remote),p=>({payment:p}));}catch{blocked=true;}assert(blocked&&f.count()===1);
});
Deno.test('paid between remote update and verification blocks completion',async()=>{
 const f=fixture();let reads=0,blocked=false;try{await run(body,'actor','SANDBOX',f.rpc,(_path,init)=>Promise.resolve(init?{}:++reads===1?remote:{...remote,dueDate:body.newDueDate,status:'RECEIVED'}),p=>({payment:p}));}catch{blocked=true;}assert(blocked&&f.count()===1);
});
