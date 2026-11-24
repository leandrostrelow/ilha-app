import { adjustInvoiceAmount as run } from '../supabase/functions/_shared/audited-invoice-amount.ts';
const body={action:'adjust_amount',invoiceId:'79000000-0000-4000-8000-000000000021',expectedAmount:700,newAmount:350,invoiceMonth:'2026-11-01',oldDueDate:'2026-11-10',reason:'Authorized correction matching current family composition.'};
const binding={provider_payment_id:'pay_test',provider_customer_id:'cus_test',external_reference:'invoice_test',provider_environment:'SANDBOX'};
const remote={id:'pay_test',customer:'cus_test',externalReference:'invoice_test',billingType:'PIX',value:700,dueDate:'2026-11-10',status:'OVERDUE',deleted:false};
function assert(v:unknown){if(!v)throw new Error('Assertion failed');}
function fixture(changes:Record<string,unknown>={}) {
 let p={...remote,...changes},calls=0;const writes:RequestInit[]=[];
 const rpc=()=>Promise.resolve({error:null,data:++calls===1?{state:'READY_REMOTE',version:'v',payment:binding}:{state:'COMPLETED'}});
 const request=(_path:string,init?:RequestInit)=>{if(init){writes.push(init);p={...p,...JSON.parse(String(init.body))};}return Promise.resolve(p);};
 return {rpc,request,writes,count:()=>calls};
}
const pix=()=>Promise.resolve({payload:'synthetic-updated-pix',expiresAt:null});
Deno.test('amount correction preserves overdue date, charge identity and does not create receipt',async()=>{
 const f=fixture();await run(body,'actor','SANDBOX',f.rpc,f.request,p=>({payment:p}),pix);
 assert(f.count()===2&&f.writes.length===1&&f.writes[0].method==='PUT');assert(JSON.parse(String(f.writes[0].body)).value===350&&JSON.parse(String(f.writes[0].body)).dueDate===remote.dueDate);
});
Deno.test('retry after remote success skips PUT',async()=>{const f=fixture({value:350});await run(body,'actor','SANDBOX',f.rpc,f.request,p=>({payment:p}),pix);assert(f.writes.length===0&&f.count()===2);});
for(const changes of [{status:'RECEIVED'},{status:'CONFIRMED'},{paymentDate:'2026-11-06'},{clientPaymentDate:'2026-11-06'},{value:351},{customer:'other'},{id:'other'},{externalReference:'other'},{deleted:true},{dueDate:'2026-10-05'},{billingType:'BOLETO'}]){
 Deno.test('amount correction blocks divergent remote '+JSON.stringify(changes),async()=>{
 const f=fixture(changes);let blocked=false;try{await run(body,'actor','SANDBOX',f.rpc,f.request,p=>({payment:p}),pix);}catch{blocked=true;}assert(blocked&&f.writes.length===0&&f.count()===1);
 });
}
Deno.test('provider refusal cannot update local records',async()=>{const f=fixture();let blocked=false;try{await run(body,'actor','SANDBOX',f.rpc,(_p,init)=>init?Promise.reject(Error('refused')):Promise.resolve(remote),p=>({payment:p}),pix);}catch{blocked=true;}assert(blocked&&f.count()===1);});
Deno.test('payment during correction blocks final commit',async()=>{const f=fixture();let reads=0,blocked=false;try{await run(body,'actor','SANDBOX',f.rpc,(_p,init)=>Promise.resolve(init?{}:++reads===1?remote:{...remote,value:350,status:'RECEIVED'}),p=>({payment:p}),pix);}catch{blocked=true;}assert(blocked&&f.count()===1);});
Deno.test('pending future invoice amount increase preserves charge, due date and Pix method',async()=>{
 const f=fixture({value:351,dueDate:'2026-12-05',status:'PENDING'});
 const result=await run({...body,expectedAmount:351,newAmount:520,invoiceMonth:'2026-12-01',oldDueDate:'2026-12-05'},'actor','SANDBOX',f.rpc,f.request,p=>({payment:p}),pix);
 assert(result.state==='COMPLETED'&&f.count()===2&&f.writes.length===1&&f.writes[0].method==='PUT');
 assert(JSON.stringify(JSON.parse(String(f.writes[0].body)))===JSON.stringify({value:520,dueDate:'2026-12-05',billingType:'PIX'}));
});
