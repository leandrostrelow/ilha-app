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
 let rules:Data[]=clone(defaults), targetReads=0, ruleReads=0,scopeReads=0;
 const requests:{path:string;method:string;body:Data}[]=[], audits:Data[]=[], rpcCalls:{name:string;args:Data}[]=[];
 const rpc=async(name:string,args:Data={})=>{
  rpcCalls.push({name,args});
  if(name==='get_monthly_whatsapp_target'){
   targetReads++;if(options.changeTarget && targetReads>1)currentTarget={...currentTarget,targetVersion:'b'.repeat(32)};
   return {data:clone(currentTarget),error:null};
  }
  if(name==='get_monthly_whatsapp_customer_scope') {
   scopeReads++;
   return {data:{state:'READY',reason:null,clientId:id,customerId,targetVersion:currentTarget.targetVersion,scopeVersion:options.changeScope&&scopeReads>1?'d'.repeat(32):'c'.repeat(32),
    allowedExternalReferences:[`tournament-athlete:${id}`],monthlyPayments:[{providerPaymentId:'pay_monthly_synthetic',externalReference:`ilha-monthly:${id}`}],hasOtherActiveProduct:false,...(options.scope as Data||{})},error:null};
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
  if(path.startsWith('/payments?')&&method==='GET') {
   const data=(options.payments as Data[]|undefined)||[{id:'pay_tournament_synthetic',customer:customerId,status:'RECEIVED',externalReference:`tournament-registration:${id}`,deleted:false},{id:'pay_monthly_synthetic',customer:customerId,status:'PENDING',externalReference:`ilha-monthly:${id}`,deleted:false}];
   const offset=Number(new URL('https://synthetic.invalid'+path).searchParams.get('offset'));
   return {data:clone(data.slice(offset,offset+100)),totalCount:data.length,hasMore:offset+100<data.length,offset};
  }
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
 ['invalid channel type',(r:Data[])=>r.map((x,i)=>i===0?{...x,smsEnabledForCustomer:'false'}:x)],
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

Deno.test('preview diagnoses known unknown fields without considering them false or changing provider data',async()=>{
 const f=fixture();const rows:Data[]=clone(defaults);
 delete rows[0].phoneCallEnabledForCustomer;
 rows[1].phoneCallEnabledForCustomer=null;
 f.setRules(rows);
 const result=await preview(target,f.request),diagnostics=result.diagnostics as Data,issues=diagnostics.notificationChannels as Data[];
 assert(result.state==='READY'&&!result.configured);
 assert(issues.some(i=>i.field==='phoneCallEnabledForCustomer'&&i.type==='MISSING'&&i.event==='PAYMENT_DUEDATE_WARNING'));
 assert(issues.some(i=>i.field==='phoneCallEnabledForCustomer'&&i.type==='NULL'));
 const serialized=JSON.stringify(diagnostics);
 assert(!serialized.includes(customerId)&&!serialized.includes(target.cpf)&&!serialized.includes(target.phone));
 assert(f.requests.every(r=>r.method==='GET'));
 assert(f.getRules()[1].phoneCallEnabledForCustomer===null&&!('phoneCallEnabledForCustomer' in f.getRules()[0]));
});

Deno.test('known unknown fields can be configured only after explicit boolean write and exact readback',async()=>{
 const f=fixture({customer:{notificationDisabled:false}}),rows:Data[]=clone(defaults);
 delete rows[0].phoneCallEnabledForCustomer;rows[1].phoneCallEnabledForCustomer=null;
 f.setRules(rows);
 const result=await apply(id,'actor','SANDBOX',f.rpc,f.request);
 assert(result.state==='APPLIED');
 const writes=f.requests.filter(r=>r.method==='PUT'),batchWrite=writes.find(r=>r.path==='/notifications/batch');
 assert(writes[0].body.notificationDisabled===true);
 assert(batchWrite&&(batchWrite.body.notifications as Data[]).every(row=>flags.every(flag=>typeof row[flag]==='boolean')));
 assert(f.getRules().every(row=>row.phoneCallEnabledForCustomer===false));
 assert(((result.diagnostics as Data).notificationChannels as Data[]).length===2);
});

Deno.test('unknown fields persisting after write never count as disabled and prevent global activation',async()=>{
 for(const value of [null,undefined]) {
  const f=fixture(),rows:Data[]=clone(defaults);rows[0].phoneCallEnabledForCustomer=value;f.setRules(rows);
  let written=false;
  const result=await apply(id,'actor','SANDBOX',f.rpc,async(path,init)=>{
   const response=await f.request(path,init);
   if(path==='/notifications/batch')written=true;
   if(written&&path.endsWith('/notifications'))(response.data as Data[])[0].phoneCallEnabledForCustomer=value;
   return response;
  });
  assert(result.state==='BLOCKED'&&result.reason==='NOTIFICATION_READBACK_MISMATCH');
  assert(result.notificationDisabled===true&&!f.requests.some(r=>r.body.notificationDisabled===false));
  assert(((result.diagnostics as Data).verificationChannels as Data[]).some(i=>i.field==='phoneCallEnabledForCustomer'&&i.type===(value===null?'NULL':'MISSING')));
 }
});

Deno.test('disabled SEND_LINHA_DIGITAVEL with unavailable WhatsApp supports planning, verified update and idempotent reuse',async()=>{
 for(const unavailable of [undefined,null]) {
  const f=fixture({customer:{notificationDisabled:false}});
  const request=async(path:string,init?:RequestInit)=>{
   const response=await f.request(path,init);
   if(path.endsWith('/notifications')) {
    const row=(response.data as Data[]).find(r=>r.event==='SEND_LINHA_DIGITAVEL')!;
    if(unavailable===undefined)delete row.whatsappEnabledForCustomer;else row.whatsappEnabledForCustomer=unavailable;
   }
   return response;
  };
  const initial=await preview(target,request);
  assert(initial.state==='READY'&&!initial.configured);
  const result=await apply(id,'actor','SANDBOX',f.rpc,request);
  assert(result.state==='APPLIED'&&result.notificationDisabled===false);
  const writes=f.requests.filter(r=>r.method==='PUT');
  assert(writes[0].body.notificationDisabled===true);
  const planned=(writes.find(r=>r.path==='/notifications/batch')!.body.notifications as Data[]).find(r=>r.id===defaults[7].id)!;
  assert(planned.enabled===false&&planned.whatsappEnabledForCustomer===false);
  const audited=((f.audits[0].p_after_config as Data).notifications as Data[]).find(r=>r.event==='SEND_LINHA_DIGITAVEL')!;
  assert(audited.enabled===false&&audited.whatsappEnabledForCustomer===unavailable,'unknown channel must not be recorded as false');
  assert((await preview(target,request)).configured===true);
  const before=f.requests.length;
  assert((await apply(id,null,'SANDBOX',f.rpc,request)).state==='APPLIED');
  assert(f.requests.slice(before).every(r=>r.method==='GET'),'verified disabled rule must not trigger another update');
 }
});

Deno.test('active due-date WhatsApp requires explicit true even when missing fields are allowed on disabled rules',async()=>{
 for(const offset of [0,5])for(const unavailable of [undefined,null]) {
  const f=fixture();let written=false;
  const result=await apply(id,'actor','SANDBOX',f.rpc,async(path,init)=>{
   const response=await f.request(path,init);if(path==='/notifications/batch')written=true;
   if(written&&path.endsWith('/notifications')) {
    const row=(response.data as Data[]).find(r=>r.event==='PAYMENT_DUEDATE_WARNING'&&r.scheduleOffset===offset)!;
    if(unavailable===undefined)delete row.whatsappEnabledForCustomer;else row.whatsappEnabledForCustomer=unavailable;
   }
   return response;
  });
  assert(result.state==='BLOCKED'&&result.reason==='NOTIFICATION_READBACK_MISMATCH'&&result.notificationDisabled===true);
  assert(!f.requests.some(r=>r.body.notificationDisabled===false));
 }
});

Deno.test('disabled rules still reject true channels, unknown channels, invalid types and rules that remain enabled',async()=>{
 for(const [change,reason] of [
  [{whatsappEnabledForCustomer:true},'NOTIFICATION_READBACK_MISMATCH'],
  [{emailEnabledForCustomer:true},'NOTIFICATION_READBACK_MISMATCH'],
  [{unknownEnabledForCustomer:true},'UNKNOWN_NOTIFICATION_CHANNEL'],
  [{unknownEnabledForCustomer:null},'UNKNOWN_NOTIFICATION_CHANNEL'],
  [{whatsappEnabledForCustomer:'false'},'INVALID_NOTIFICATION_CHANNEL'],
  [{enabled:true,whatsappEnabledForCustomer:undefined},'NOTIFICATION_READBACK_MISMATCH'],
 ] as [Data,string][]) {
  const f=fixture();let written=false;
  const result=await apply(id,'actor','SANDBOX',f.rpc,async(path,init)=>{
   const response=await f.request(path,init);if(path==='/notifications/batch')written=true;
   if(written&&path.endsWith('/notifications'))Object.assign((response.data as Data[]).find(r=>r.event==='SEND_LINHA_DIGITAVEL')!,change);
   return response;
  });
  assert(result.state==='BLOCKED'&&result.reason===reason&&result.notificationDisabled===true);
  assert(!f.requests.some(r=>r.body.notificationDisabled===false));
 }
});

Deno.test('known field with unexpected type is blocked and its value is absent from diagnostic output',async()=>{
 const f=fixture(),rows:Data[]=clone(defaults);rows[0].smsEnabledForCustomer='sensitive-provider-value';f.setRules(rows);
 const result=await preview(target,f.request);
 assert(result.state==='BLOCKED'&&result.reason==='INVALID_NOTIFICATION_CHANNEL');
 assert(!JSON.stringify(result.diagnostics).includes('sensitive-provider-value'));
 assert(f.requests.every(r=>r.method==='GET'));
});

Deno.test('readback schema errors are labeled separately from the original provider configuration',async()=>{
 const f=fixture();let written=false;
 const result=await apply(id,'actor','SANDBOX',f.rpc,async(path,init)=>{
  const response=await f.request(path,init);if(path==='/notifications/batch')written=true;
  if(written&&path.endsWith('/notifications'))(response.data as Data[])[0].smsEnabledForCustomer='unexpected';
  return response;
 });
 assert(result.state==='BLOCKED'&&result.reason==='INVALID_NOTIFICATION_CHANNEL'&&result.notificationDisabled===true);
 const diagnostics=result.diagnostics as Data;
 assert((diagnostics.notificationChannels as Data[]).length===0&&(diagnostics.verificationChannels as Data[]).some(i=>i.field==='smsEnabledForCustomer'&&i.type==='STRING'));
 assert(!JSON.stringify(diagnostics).includes('unexpected'));
});
Deno.test('unknown channels and events never leak arbitrary provider fields in diagnostics',async()=>{
 const f=fixture();const rows:Data[]=clone(defaults);
 rows[2].event='sensitive-event';rows[2]['sensitive-field-EnabledForCustomer']={secret:'sensitive-value'};
 f.setRules(rows);
 const result=await preview(target,f.request),diagnostics=result.diagnostics as Data;
 assert(result.reason==='UNKNOWN_NOTIFICATION_CHANNEL');
 assert((diagnostics.notificationChannels as Data[]).some(i=>i.field==='UNKNOWN_CHANNEL'&&i.type==='OBJECT'&&i.event==='UNKNOWN_EVENT'));
 assert(!JSON.stringify(diagnostics).includes('sensitive'));
 const applied=await apply(id,'actor','SANDBOX',f.rpc,f.request);
 assert(applied.state==='BLOCKED'&&applied.reason==='UNKNOWN_NOTIFICATION_CHANNEL');
 assert(!f.requests.some(r=>r.path==='/notifications/batch'));
});

Deno.test('diagnostic size limit never suppresses validation of a late unsupported channel',async()=>{
 const events=['PAYMENT_CREATED','PAYMENT_UPDATED','PAYMENT_RECEIVED','PAYMENT_OVERDUE','PAYMENT_DUEDATE_WARNING','SEND_LINHA_DIGITAVEL','UNRECOGNIZED'];
 const rows:Data[]=events.flatMap((event,i)=>[null,undefined].map((value,j)=>({id:`not_many_${i}_${j}`,customer:customerId,event,scheduleOffset:j===0?0:10,enabled:true,...Object.fromEntries(flags.map(flag=>[flag,value]))})));
 rows.push({...defaults[2],id:'not_late_unknown',newEnabledForCustomer:true});
 const f=fixture();f.setRules(rows);
 const result=await preview(target,f.request);
 assert(result.state==='BLOCKED'&&result.reason==='UNKNOWN_NOTIFICATION_CHANNEL');
 assert(((result.diagnostics as Data).notificationChannels as Data[]).length===64);
 assert(f.requests.every(r=>r.method==='GET'));
 rows[rows.length-1]={...defaults[2],id:'not_late_invalid',smsEnabledForCustomer:'false'};f.setRules(rows);
 const invalid=await preview(target,f.request);
 assert(invalid.state==='BLOCKED'&&invalid.reason==='INVALID_NOTIFICATION_CHANNEL');
});
Deno.test('identity diagnostics distinguish empty and foreign references without adopting or leaking them',async()=>{
 for(const [externalReference,referenceKind] of [[null,'EMPTY'],['','EMPTY'],['foreign-private-value','FOREIGN'],[`ilha-monthly-customer:${id}`,'OWNED']] as const) {
  const f=fixture({customer:{externalReference,deleted:false}}),result=await preview(target,f.request);
  const identity=(result.diagnostics as Data).identity as Data;
  assert(identity.idMatches===true&&identity.documentMatches===true&&identity.referenceKind===referenceKind&&identity.deleted===false);
  assert(referenceKind==='OWNED'||result.state==='BLOCKED');
  assert(!JSON.stringify(identity).includes('foreign-private-value')&&!JSON.stringify(identity).includes(id));
  assert(f.requests.every(r=>r.method==='GET'));
 }
 const f=fixture({customer:{id:'cus_foreign',cpfCnpj:'98765432100'}}),result=await preview(target,f.request);
 const identity=(result.diagnostics as Data).identity as Data;
 assert(identity.idMatches===false&&identity.documentMatches===false&&identity.deleted===null&&result.state==='BLOCKED');
});

Deno.test('unexpected provider errors do not expose response bodies through diagnostics',async()=>{
 const result=await preview(target,async()=>{throw new Error('CPF 12345678909 private response');});
 assert(result.reason==='PROVIDER_POLICY_FAILED'&&JSON.stringify(result.diagnostics)==='{}');
 assert(!JSON.stringify(result).includes('12345678909'));
});

Deno.test('known reused customer needs exact database scope and only monthly active remote payments',async()=>{
 const ref=`tournament-athlete:${id}`,f=fixture({customer:{externalReference:ref}});
 const check=await preview(target,f.request,f.rpc,'SANDBOX');
 assert(check.state==='READY'&&(check.diagnostics as Data).scopeVerified===true&&f.requests.every(r=>r.method==='GET'));
 const result=await apply(id,'actor','SANDBOX',f.rpc,f.request);
 assert(result.state==='APPLIED'&&f.getCustomer().externalReference===ref);
 assert(f.requests.every(r=>r.method!=='PUT'||!('externalReference' in r.body)));
 assert(!f.requests.some(r=>r.path.startsWith('/payments')&&r.method!=='GET'));
 assert(!JSON.stringify(result.diagnostics).includes(ref));
});

Deno.test('inactive reused customer with proven isolated scope is only paused and remains blocked',async()=>{
 const ref=`tournament-athlete:${id}`,inactive={...target,state:'BLOCKED',reason:'CLIENT_NOT_ACTIVE',phone:null};
 const f=fixture({customer:{externalReference:ref,notificationDisabled:false},target:inactive});
 const check=await preview(inactive,f.request,f.rpc,'SANDBOX');
 assert(check.state==='BLOCKED'&&check.reason==='CLIENT_NOT_ACTIVE'&&!check.configured);
 assert((check.diagnostics as Data).scopeVerified===true&&f.requests.every(r=>r.method==='GET'));
 const result=await apply(id,'actor','SANDBOX',f.rpc,f.request);
 assert(result.state==='BLOCKED'&&result.reason==='CLIENT_NOT_ACTIVE'&&result.notificationDisabled===true);
 const writes=f.requests.filter(r=>r.method!=='GET');
 assert(writes.length===1&&writes[0].method==='PUT'&&writes[0].path===`/customers/${customerId}`);
 assert(JSON.stringify(writes[0].body)==='{"notificationDisabled":true}');
 assert(f.getCustomer().externalReference===ref&&f.getCustomer().mobilePhone===target.phone);
 assert(f.audits.length===1&&f.audits[0].p_status==='BLOCKED'&&f.audits[0].p_error_code==='CLIENT_NOT_ACTIVE');
});

Deno.test('inactive reused customer is never touched if identity, origin or isolated scope is unproven',async()=>{
 const ref=`tournament-athlete:${id}`;
 for(const changes of [
  {customer:{cpfCnpj:'98765432100'}},
  {customer:{externalReference:''}},
  {scope:{allowedExternalReferences:['tournament-athlete:unproven']}},
  {scope:{hasOtherActiveProduct:true}},
  {scope:{state:'BLOCKED'}},
  {payments:[{id:'pay_foreign_pending',customer:customerId,status:'PENDING',externalReference:'other'}]},
 ]) {
  const f=fixture({...changes,customer:{externalReference:ref,notificationDisabled:false,...(changes.customer||{})},target:{state:'BLOCKED',reason:'CLIENT_NOT_ACTIVE',phone:null}});
  const result=await apply(id,'actor','SANDBOX',f.rpc,f.request);
  assert(result.state==='BLOCKED'&&result.notificationDisabled===null);
  assert(f.requests.every(r=>r.method==='GET'));
  assert(f.getCustomer().notificationDisabled===false);
 }
});

Deno.test('reused customer with another active product, unproven reference or divergent scope is never mutated',async()=>{
 const ref=`tournament-athlete:${id}`;
 for(const options of [
  {scope:{hasOtherActiveProduct:true}},
  {scope:{state:'BLOCKED'}},
  {scope:{allowedExternalReferences:['tournament-athlete:other']}},
  {scope:{targetVersion:'e'.repeat(32)}},
  {scope:{customerId:'cus_other'}},
  {scope:{scopeVersion:null}},
  {payments:[{id:'pay_foreign',customer:customerId,status:'PENDING',externalReference:'store:foreign'}]},
  {payments:[{id:'pay_monthly_synthetic',customer:customerId,status:'OVERDUE',externalReference:'foreign'}]},
  {payments:[{id:'pay_not_mapped',customer:customerId,status:'PENDING',externalReference:`ilha-monthly:${id}`}]},
  {payments:[{id:'pay_unrecognized',customer:customerId,status:'NEW_UNKNOWN_STATUS'}]},
  {payments:[{id:'pay_foreign_customer',customer:'cus_other',status:'RECEIVED'}]},
 ]) {
  const f=fixture({customer:{externalReference:ref},...options}),result=await apply(id,'actor','SANDBOX',f.rpc,f.request);
  assert(result.state==='BLOCKED',JSON.stringify(options));assert(f.requests.every(r=>r.method==='GET'));
 }
});

Deno.test('reused scope pagination must be complete, stable and duplicate-free',async()=>{
 const ref=`tournament-athlete:${id}`;
 for(const invalid of [
  {data:[],totalCount:1,hasMore:false},
  {data:[],totalCount:1,hasMore:true},
  {data:[],totalCount:0,hasMore:null},
  {data:[],totalCount:501,hasMore:true},
  {data:[],totalCount:0,hasMore:false,offset:1},
  {data:[{id:'pay_duplicate',customer:customerId,status:'RECEIVED'},{id:'pay_duplicate',customer:customerId,status:'RECEIVED'}],totalCount:2,hasMore:false},
 ]) {
  const f=fixture({customer:{externalReference:ref}});
  const result=await apply(id,'actor','SANDBOX',f.rpc,async(path,init)=>path.startsWith('/payments?')?invalid:f.request(path,init));
  assert(result.state==='BLOCKED'&&f.requests.every(r=>r.method==='GET'));
 }
 const payments=Array.from({length:101},(_,i)=>({id:`pay_settled_${i}`,customer:customerId,status:'RECEIVED'}));
 const f=fixture({customer:{externalReference:ref},payments});
 assert((await apply(id,'actor','SANDBOX',f.rpc,f.request)).state==='APPLIED');
 assert(f.requests.some(r=>r.path.endsWith('offset=100')));
});

Deno.test('scope change or new foreign debt during configuration prevents enabling reused customer',async()=>{
 const ref=`tournament-athlete:${id}`;
 const f=fixture({customer:{externalReference:ref},changeScope:true});
 const changed=await apply(id,'actor','SANDBOX',f.rpc,f.request);
 assert(changed.state==='BLOCKED'&&changed.reason==='CUSTOMER_SCOPE_CHANGED'&&changed.notificationDisabled===true);
 assert(!f.requests.some(r=>r.body.notificationDisabled===false));
 const g=fixture({customer:{externalReference:ref}});let paymentReads=0;
 const newDebt=await apply(id,'actor','SANDBOX',g.rpc,async(path,init)=>{
  if(path.startsWith('/payments?')&&++paymentReads>1)return {data:[{id:'pay_new',customer:customerId,status:'PENDING',externalReference:'other'}],totalCount:1,hasMore:false};
  return g.request(path,init);
 });
 assert(newDebt.state==='BLOCKED'&&newDebt.reason==='OTHER_ACTIVE_CUSTOMER_PAYMENT'&&newDebt.notificationDisabled===true);
 assert(!g.requests.some(r=>r.body.notificationDisabled===false));
});
