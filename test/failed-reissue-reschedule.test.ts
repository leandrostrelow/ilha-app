import { prepareFailedReissueReschedule as run } from '../supabase/functions/_shared/failed-reissue-reschedule.ts';
const body={action:'reschedule_failed',invoiceId:'79000000-0000-4000-8000-000000000021',expectedAmount:250,invoiceMonth:'2026-11-01',oldDueDate:'2026-11-05',newDueDate:'2026-11-06',reason:'Authorized extension after refusal.'};
const context={state:'CHECK_ABSENCE',version:'v1',environment:'SANDBOX',externalReference:`ilha-monthly-invoice:${body.invoiceId}`};
function assert(v:unknown){if(!v)throw new Error('Assertion failed');}
Deno.test('reschedule checks remote absence before completing and never writes provider directly',async()=>{
 const calls:unknown[]=[];
 const result=await run(body,'actor','SANDBOX',async(_name,args)=>{calls.push(args);return {error:null,data:calls.length===1?context:{state:'READY_DISPATCH',invoiceId:'new'}};},async path=>{assert(path.includes(encodeURIComponent(context.externalReference)));return {totalCount:0,hasMore:false,data:[]};});
 assert(result.invoiceId==='new' && calls.length===2);
});
for(const remote of [{totalCount:1,hasMore:false,data:[{id:'existing'}]},{totalCount:0,hasMore:true,data:[]},{data:[]},{totalCount:0,hasMore:false,data:[{id:'unexpected'}]}]) {
 Deno.test('blocks nonempty or incomplete remote absence '+JSON.stringify(remote),async()=>{
 let calls=0,blocked=false;try{await run(body,'actor','SANDBOX',async()=>{calls++;return {error:null,data:context};},async()=>remote);}catch{blocked=true;}assert(blocked && calls===1);
 });
}
Deno.test('retry returns prior target without creating another invoice',async()=>{
 const result=await run(body,'actor','SANDBOX',async()=>({error:null,data:{state:'READY_DISPATCH',invoiceId:'same'}}),()=>{throw new Error('unexpected remote call');});assert(result.invoiceId==='same');
});
Deno.test('wrong environment blocked',async()=>{let blocked=false;try{await run(body,'actor','PRODUCTION',async()=>({error:null,data:context}),()=>{throw new Error('unexpected remote call');});}catch{blocked=true;}assert(blocked);});
