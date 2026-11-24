import { applyMonthlyWhatsappPolicy as apply, planMonthlyWhatsappRules as plan, previewMonthlyWhatsappTarget as preview, monthlyWhatsappBatch as batch, normalizeMonthlyWhatsappPhone as phone } from '../supabase/functions/_shared/monthly-whatsapp-policy.ts';
type Data = Record<string, unknown>;
const id='94000000-0000-4000-8000-000000000001', customerId='cus_synthetic';
const target={state:'READY',reason:null,clientId:id,payerClientId:id,isFamily:false,isMinor:false,recipientKind:'PAYER',name:'Synthetic recipient',cpf:'12345678909',phone:'27999999999',providerCustomerId:customerId,mappingStatus:'ACTIVE',targetVersion:'a'.repeat(32),policyEnabled:true};
const flags=['emailEnabledForProvider','smsEnabledForProvider','emailEnabledForCustomer','smsEnabledForCustomer','phoneCallEnabledForCustomer','whatsappEnabledForCustomer'];
const defaults=[['PAYMENT_DUEDATE_WARNING',0],['PAYMENT_DUEDATE_WARNING',10],['PAYMENT_CREATED',0],['PAYMENT_UPDATED',0],['PAYMENT_RECEIVED',0],['PAYMENT_OVERDUE',0],['PAYMENT_OVERDUE',7],['SEND_LINHA_DIGITAVEL',0]].map(([event,scheduleOffset],i)=>({id:`not_synthetic_${i}`,customer:customerId,event,scheduleOffset,enabled:true,deleted:false,...Object.fromEntries(flags.map(key=>[key,key.includes('email')||key.includes('sms')]))}));
function assert(value:unknown,message='Assertion failed'):asserts value {if(!value)throw new Error(message);}
function clone<T>(value:T):T{return JSON.parse(JSON.stringify(value));}
function fixture(options:Data={}) {
 let currentTarget={...target,...(options.target as Data||{})}, customer:Data={id:customerId,cpfCnpj:target.cpf,externalReference:`ilha-monthly-customer:${id}`,notificationDisabled:true,mobilePhone:target.phone,...(options.customer as Data||{})};
 let rules:Data[]=clone(defaults), targetReads=0, ruleReads=0;
 const requests:{path:string;method:string;body:Data}[]=[], audits:Data[]=[], rpcCalls:{name:string;args:Data}[]=[];
 const rpc=async(name:string,args:Data={})=>{
  rpcCalls.push({name,args});
  if(name==='get_monthly_whatsapp_target'){
   targetReads++;if(options.changeTarget && targetReads>1)currentTarget={...currentTarget,targetVersion:'b'.repeat(32)};
   return {data:clone(currentTarget),error:null};
  }
  if(name==='record_monthly_whatsapp_result'){
   audits.push(clone(args));
   if(options.failAudit && args.p_status==='APPLIED')return {data:null,error:{message:'changed financial target'}};
   return {data:{auditId:'audit_synthetic',status:args.p_status},error:null};
  }
  if(name==='get_monthly_whatsapp_policy')return {data:{enabled:currentTarget.policyEnabled,updatedAt:'2030-01-01'},error:null};
  if(name==='set_monthly_whatsapp_policy')return {data:{enabled:true},error:null};
  if(name==='list_monthly_whatsapp_targets')return {data:{targets:[clone(currentTarget)],nextCursor:options.nextCursor||null,hasMore:Boolean(options.nextCursor)},error:null};
  throw new Error('Unexpected RPC '+name);
 };
 const request=async(path:string,init?:RequestInit)=>{
  const method=init?.method||'GET',body=init?.body?JSON.parse(String(init.body)):{};
  requests.push({path,method,body});
  if(path===`/customers/${customerId}/notifications`&&method==='GET') {
   ruleReads++;
   if(options.failRulesReadback && ruleReads>1)return {data:clone(rules.slice(0,-1))};
   return {data:clone(rules)};
  }
  if(path===`/customers/${customerId}`){
   if(method==='PUT'){
    if(options.failDisable && body.notificationDisabled===true)throw new Error('disable unavailable');
    if(options.failEnable && body.notificationDisabled===false)throw new Error('enable uncertain');
    customer={...customer,...body};
   }
   if(options.badCustomerReadback && method==='GET'&&customer.notificationDisabled===false)return {...customer,mobilePhone:'27888888888'};
   return clone(customer);
  }
  if(path==='/notifications/batch'&&method==='PUT'){
   if(options.failBatch)throw new Error('batch unavailable');
   rules=rules.map(r=>({...r,...(body.notifications as Data[]).find(x=>x.id===r.id)}));
   return {data:clone(rules)};
  }
  throw new Error('Unexpected provider call '+method+' '+path);
 };
 return {rpc,request,requests,audits,rpcCalls,getCustomer:()=>customer,getRules:()=>rules,setRules:(rows:Data[])=>{rules=clone(rows);}};
}
Deno.test('planner configures only WhatsApp D-5 and D0 and disables every other channel/event',()=>{
 const result=plan({data:defaults},customerId), enabled=result.filter(r=>r.enabled);
 assert(enabled.length===2&&enabled.map(r=>r.scheduleOffset).sort().join(',')==='0,5');
 assert(result.every(r=>flags.every(key=>r[key]===(r.enabled&&key==='whatsappEnabledForCustomer'))));
 assert(defaults[1].scheduleOffset===10,'planner must not mutate provider evidence');
});
for(const [label,mutate] of [
 ['duplicate due rule',(r:Data[])=>[...r,{...r[0],id:'not_duplicate'}]],
 ['missing due rule',(r:Data[])=>r.filter(x=>x.scheduleOffset!==10)],
 ['missing extra event',(r:Data[])=>r.map((x,i)=>i===0?{...x,event:null}:x)],
 ['duplicate id',(r:Data[])=>[...r,{...r[2]}]],
 ['foreign customer',(r:Data[])=>r.map((x,i)=>i===0?{...x,customer:'cus_other'}:x)],
 ['unknown enabled channel',(r:Data[])=>r.map((x,i)=>i===0?{...x,newEnabledForCustomer:true}:x)],
 ['missing channel',(r:Data[])=>r.map((x,i)=>{if(i!==0)return x;const copy={...x};delete copy.smsEnabledForCustomer;return copy;})],
] as [string,(rows:Data[])=>Data[]][]) {
 Deno.test('planner fails closed: '+label,()=>{let blocked=false;try{plan({data:mutate(clone(defaults))},customerId);}catch{blocked=true;}assert(blocked);});
}
Deno.test('incomplete pagination cannot be configured',()=>{for(const evidence of [{data:defaults,hasMore:true},{data:defaults,totalCount:defaults.length+1}]){let blocked=false;try{plan(evidence,customerId);}catch{blocked=true;}assert(blocked);}});
Deno.test('preview reads actual provider configuration without writes or PII',async()=>{
 const f=fixture();const result=await preview(target,f.request);
 assert(result.notificationDisabled===true&&!result.configured&&f.requests.every(r=>r.method==='GET'));
 assert(!JSON.stringify(result).includes(target.cpf)&&!JSON.stringify(result).includes(target.phone));
});
Deno.test('apply disables first, checks both slots, updates recipient then audits without sends or payment changes',async()=>{
 const f=fixture({customer:{notificationDisabled:false}});const result=await apply(id,'actor','SANDBOX',f.rpc,f.request);
 assert(result.state==='APPLIED'&&result.auditId==='audit_synthetic');
 const writes=f.requests.filter(r=>r.method!=='GET');
 assert(writes[0].body.notificationDisabled===true&&writes[1].path==='/notifications/batch'&&writes[2].body.notificationDisabled===false);
 assert(writes.every(r=>r.method==='PUT'&&!r.path.includes('payments')&&!r.path.includes('send')));
 assert(f.getRules().filter(r=>r.enabled).length===2&&f.getCustomer().notificationDisabled===false);
 assert(f.audits.length===1&&f.audits[0].p_status==='APPLIED'&&!JSON.stringify(f.audits).includes(target.cpf)&&!JSON.stringify(f.audits).includes(target.phone));
});
Deno.test('already configured customer is idempotent and sends no PUT',async()=>{
 const f=fixture({customer:{notificationDisabled:false}});f.setRules(defaults.map(r=>({...r,...plan({data:defaults},customerId).find(p=>p.id===r.id)})));
 assert((await apply(id,null,'SANDBOX',f.rpc,f.request)).state==='APPLIED');assert(f.requests.every(r=>r.method==='GET'));
});
for(const [option,expected] of [['failBatch','FAILED'],['failRulesReadback','BLOCKED'],['failEnable','FAILED'],['badCustomerReadback','BLOCKED'],['changeTarget','BLOCKED'],['failAudit','BLOCKED']] as const) {
 Deno.test('failure keeps global notifications disabled: '+option,async()=>{
  const f=fixture({[option]:true,customer:{notificationDisabled:false}});const result=await apply(id,'actor','SANDBOX',f.rpc,f.request);
  assert(result.state===expected&&f.getCustomer().notificationDisabled===true);
  assert(f.audits.at(-1)?.p_status===expected);
  assert((f.audits.at(-1)?.p_after_config as Data).notificationDisabled===true);
 });
}
Deno.test('failure to disable cannot claim successful activation or continue with batch',async()=>{
 const f=fixture({failDisable:true,customer:{notificationDisabled:false}});const result=await apply(id,'actor','SANDBOX',f.rpc,f.request);
 assert(result.state==='FAILED'&&result.reason==='GLOBAL_DISABLE_UNCONFIRMED'&&result.notificationDisabled===null);
 assert(!f.requests.some(r=>r.path==='/notifications/batch'));
});
Deno.test('shared or divergent CPF customer is never modified',async()=>{
 for(const customer of [{externalReference:'store-order:synthetic'},{cpfCnpj:'98765432100'}]) {
  const f=fixture({customer});const result=await apply(id,'actor','SANDBOX',f.rpc,f.request);
  assert(result.state==='BLOCKED'&&f.requests.every(r=>r.method==='GET'));
 }
});
Deno.test('blocked dependent disables only its owned legacy customer, never redirects debt',async()=>{
 const f=fixture({target:{state:'BLOCKED',reason:'FAMILY_DEPENDENT',phone:null},customer:{notificationDisabled:false}});
 const result=await apply(id,'actor','SANDBOX',f.rpc,f.request);
 assert(result.state==='BLOCKED');const writes=f.requests.filter(r=>r.method==='PUT');
 assert(writes.length===1&&JSON.stringify(writes[0].body)==='{"notificationDisabled":true}');
});
Deno.test('isolated minor receives notification at guardian number with own billing identity preserved',async()=>{
 const guardian='27977777777';const f=fixture({target:{isMinor:true,recipientKind:'GUARDIAN',phone:guardian}});
 const result=await apply(id,'actor','SANDBOX',f.rpc,f.request);
 assert(result.state==='APPLIED'&&f.getCustomer().mobilePhone===guardian&&f.getCustomer().cpfCnpj===target.cpf);
 assert(f.requests.every(r=>!('cpfCnpj' in r.body)));
});
Deno.test('missing customer waits for natural issuance, never creates one',async()=>{
 const f=fixture({target:{providerCustomerId:null}});assert((await apply(id,'actor','SANDBOX',f.rpc,f.request)).state==='WAITING_CUSTOMER');assert(f.requests.length===0);
});
Deno.test('disabled policy never accesses provider',async()=>{
 const f=fixture({target:{policyEnabled:false}});assert((await apply(id,null,'SANDBOX',f.rpc,f.request)).state==='SKIPPED');assert(f.requests.length===0);
});
Deno.test('batch forwards cursor, caps at five, and preview does not activate policy',async()=>{
 const next='94000000-0000-4000-8000-000000000099',f=fixture({nextCursor:next});
 const result=await batch({action:'notify_preview',cursor:id,limit:5},'actor','SANDBOX',f.rpc,f.request);
 assert(result.hasMore&&result.nextCursor===next&&result.items.length===1);
 assert(f.rpcCalls.find(r=>r.name==='list_monthly_whatsapp_targets')?.args.p_after_client_id===id);
 assert(!f.rpcCalls.some(r=>r.name==='set_monthly_whatsapp_policy')&&f.requests.every(r=>r.method==='GET'));
 let blocked=false;try{await batch({action:'notify_apply',enabled:true,reason:'Authorized synthetic configuration.',limit:6},'actor','SANDBOX',f.rpc,f.request);}catch{blocked=true;}assert(blocked);
});
Deno.test('apply batch activates policy explicitly and processes all returned targets',async()=>{
 const f=fixture();const result=await batch({action:'notify_apply',enabled:true,reason:'Authorized synthetic configuration.'},'actor','SANDBOX',f.rpc,f.request);
 assert(f.rpcCalls[0].name==='set_monthly_whatsapp_policy'&&result.items.length===1&&result.counts.applied===1);
});
Deno.test('phone normalization handles country code without inventing missing numbers',()=>{assert(phone('+55 (27) 99999-9999')==='27999999999');assert(!phone('2799999999')&&!phone('')&&!phone('551234'));});
Deno.test('deadline stops configuration before enable and preserves a disabled customer',async()=>{
 const realNow=Date.now;let clock=1_000;Date.now=()=>clock;
 try {
  const f=fixture({customer:{notificationDisabled:false}});
  const result=await apply(id,'actor','SANDBOX',f.rpc,async(path,init)=>{
   const response=await f.request(path,init);if(path==='/notifications/batch')clock+=16_000;return response;
  });
  assert(result.state==='FAILED'&&result.reason==='POLICY_DEADLINE_EXCEEDED'&&f.getCustomer().notificationDisabled===true);
  assert(!f.requests.some(r=>r.body.notificationDisabled===false));
 } finally {Date.now=realNow;}
});
Deno.test('monthly handler restricts both policy actions to authenticated finance writers',()=>{
 const source=Deno.readTextFileSync(new URL('../supabase/functions/app-monthly-billing/index.ts',import.meta.url));
 const handler=source.slice(source.indexOf('if (action === "notify_preview"'),source.indexOf('if (action === "close_failed_invoice"'));
 assert(handler.includes('auth.kind !== "USER" || !auth.canWrite || !auth.userId'));
 assert(handler.indexOf('403')<handler.indexOf('await monthlyWhatsappBatch'));
});
Deno.test('repeated contact sync is read-only and changed contact is disabled before update without replacing guardian phone',async()=>{
 const {monthlyCustomerContactChanged}=await import('../supabase/functions/_shared/monthly-whatsapp-policy.ts');
 const source=Deno.readTextFileSync(new URL('../supabase/functions/app-monthly-billing/index.ts',import.meta.url));
 const original=source.slice(source.indexOf('async function syncAsaasCustomerContact('),source.indexOf('async function ensureAsaasCustomer('));
 const executable=original.replace('customerId: string','customerId').replace('client: JsonRecord','client').replace('cpf: string','cpf').replace('environment: string','environment');
 let remote:Data={id:customerId,externalReference:`ilha-monthly-customer:${id}`,cpfCnpj:target.cpf,name:target.name,email:'synthetic@tests.invalid',mobilePhone:'27977777777',notificationDisabled:false};
 const client={id,full_name:target.name,cpf:target.cpf,email:'synthetic@tests.invalid',phone:target.phone};
 const writes:Data[]=[];
 const request=async(_path:string,init?:RequestInit)=>{if(init?.body){const update=JSON.parse(String(init.body));writes.push(update);remote={...remote,...update};}return remote;};
 const sync=new Function('asaasRequest','text','monthlyCustomerContactChanged','ProviderInvariantError',`return (${executable});`)(request,(v:unknown,max:number)=>String(v||'').trim().replace(/\s+/g,' ').slice(0,max),monthlyCustomerContactChanged,Error);
 await sync(customerId,client,target.cpf,'PRODUCTION',true);await sync(customerId,client,target.cpf,'PRODUCTION',true);
 assert(writes.length===0&&remote.mobilePhone==='27977777777');
 await sync(customerId,{...client,email:'changed@tests.invalid'},target.cpf,'PRODUCTION',true);
 assert(Number(writes.length)===1&&writes[0].notificationDisabled===true&&!('mobilePhone' in writes[0]));
});

Deno.test('insufficient wall-clock budget yields partial work before leasing or failing any invoice',async()=>{
 const source=Deno.readTextFileSync(new URL('../supabase/functions/app-monthly-billing/index.ts',import.meta.url));
 const start=source.indexOf('    do {',source.indexOf('let deadlineReached = false'));
 const end=source.indexOf('while (results.length < maxClaims);',start)+'while (results.length < maxClaims);'.length;
 const loop=source.slice(start,end);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 let operations=0;
 const result=await new AsyncFunction('adminClient', 'processInBatches', `
  const results=[], maxClaims=3, MIN_SAFE_BATCH_BUDGET_MS=95000, executionDeadline=Date.now()+90000;
  let deadlineReached=false, executionStage='START';
  ${loop}
  return {results,deadlineReached,executionStage,partial:deadlineReached};
 `)({rpc:()=>{operations++;throw new Error('Must not claim an invoice');}},()=>{operations++;throw new Error('Must not process an invoice');});
 assert(result.partial&&result.deadlineReached&&result.results.length===0&&operations===0&&result.executionStage==='START');
});

Deno.test('unknown global flag is paused explicitly before reporting a disabled customer',async()=>{
 for(const failDisable of [false,true]) {
  const f=fixture({customer:{notificationDisabled:undefined},failDisable});
  const result=await apply(id,'actor','SANDBOX',f.rpc,f.request);
  assert(f.requests.some(r=>r.method==='PUT'&&r.body.notificationDisabled===true));
  assert(result.notificationDisabled===(failDisable?null:true));
  assert(result.state===(failDisable?'FAILED':'BLOCKED'));
  assert(!f.requests.some(r=>r.path==='/notifications/batch'));
 }
});
