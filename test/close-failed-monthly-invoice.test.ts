import { closeFailedMonthlyInvoice as run } from '../supabase/functions/_shared/close-failed-monthly-invoice.ts';
type Data = Record<string, unknown>;
const body = {action:'close_failed_invoice',invoiceId:'92000000-0000-4000-8000-000000000021',expectedAmount:350,invoiceMonth:'2030-01-01',oldDueDate:'2030-01-10',reason:'Synthetic authorized failed invoice closure.'};
const externalReference = `ilha-monthly-invoice:${body.invoiceId}`;
const context = {state:'CHECK_ABSENCE',version:'local-revision',environment:'SANDBOX',externalReference};
function assert(value: unknown, message = 'Assertion failed'): asserts value { if(!value) throw new Error(message); }
function fixture(remote: Data = {totalCount:0,hasMore:false,data:[]}, prepared: Data = context) {
 const calls: {name:string;args:Data}[] = [], paths: string[] = [];
 const rpc = (name:string,args:Data) => {calls.push({name,args});return Promise.resolve({error:null,data:calls.length===1?prepared:{state:'COMPLETED',invoiceId:body.invoiceId}});};
 const request = (path:string) => {paths.push(path);return Promise.resolve(remote);};
 return {calls,paths,rpc,request};
}
async function rejects(fn:()=>Promise<unknown>) {let blocked=false;try{await fn();}catch{blocked=true;}assert(blocked,'Expected protected operation to reject');}
Deno.test('failed invoice closes only after exact-reference lookup proves remote absence',async()=>{
 const f=fixture();const result=await run(body,'admin','SANDBOX',f.rpc,f.request);
 assert(result.state==='COMPLETED'&&f.calls.length===2&&f.paths.length===1);
 assert(f.paths[0]===`/payments?externalReference=${encodeURIComponent(externalReference)}&limit=100`);
 assert(f.calls[1].args.p_version==='local-revision'&&Number.isFinite(Date.parse(String(f.calls[1].args.p_checked_at))));
 const proof=f.calls[1].args.p_snapshot as Data;
 assert(proof.externalReference===externalReference&&proof.environment==='SANDBOX'&&proof.totalCount===0&&proof.hasMore===false&&JSON.stringify(proof.data)==='[]');
});
for(const remote of [{totalCount:1,hasMore:false,data:[{id:'pay_exists'}]}, {totalCount:0,hasMore:true,data:[]}, {totalCount:'0',hasMore:false,data:[]}, {totalCount:0,data:[]}, {totalCount:0,hasMore:false,data:null}, {totalCount:0,hasMore:false,data:[{deleted:true}]}]) {
 Deno.test('inconclusive or present remote payment blocks closure '+JSON.stringify(remote),async()=>{
  const f=fixture(remote);await rejects(()=>run(body,'admin','SANDBOX',f.rpc,f.request));assert(f.calls.length===1);
 });
}
Deno.test('network failure does not commit closure',async()=>{const f=fixture();await rejects(()=>run(body,'admin','SANDBOX',f.rpc,()=>Promise.reject(new Error('timeout'))));assert(f.calls.length===1);});
for(const change of [{environment:'PRODUCTION'},{externalReference:'another-invoice'},{version:''},{state:'REVIEW_REQUIRED'}]) {
 Deno.test('divergent preflight blocks provider access '+JSON.stringify(change),async()=>{const f=fixture(undefined,{...context,...change});await rejects(()=>run(body,'admin','SANDBOX',f.rpc,f.request));assert(f.calls.length===1&&f.paths.length===0);});
}
Deno.test('completed closure retry skips the provider and second commit',async()=>{const f=fixture(undefined,{state:'COMPLETED',invoiceId:body.invoiceId});await run(body,'admin','SANDBOX',f.rpc,f.request);assert(f.calls.length===1&&f.paths.length===0);});
Deno.test('CAS rejection is propagated without a third attempt',async()=>{const f=fixture();let calls=0;await rejects(()=>run(body,'admin','SANDBOX',(name,args)=>++calls===1?f.rpc(name,args):Promise.resolve({data:null,error:{message:'Dados alterados durante a conferência.'}}),f.request));assert(calls===2&&f.paths.length===1);});
Deno.test('unsafe body is rejected before preflight',async()=>{const f=fixture();await rejects(()=>run({...body,status:'PAGA'},'admin','SANDBOX',f.rpc,f.request));assert(f.calls.length===0&&f.paths.length===0);});
