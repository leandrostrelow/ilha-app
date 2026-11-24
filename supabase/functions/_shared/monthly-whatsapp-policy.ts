type Data = Record<string, unknown>;
export type MonthlyWhatsappRpc = (name: string, args?: Data) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
export type MonthlyWhatsappRequest = (path: string, init?: RequestInit) => Promise<Data>;
type PolicyResult = Data & {state:string;reason:string|null;configured?:boolean;notificationDisabled?:boolean|null;auditId?:unknown};
const obj = (v: unknown): Data => v && typeof v === 'object' && !Array.isArray(v) ? v as Data : {};
const digits = (v: unknown) => String(v || '').replace(/\D/g, '');
const flags = ['emailEnabledForProvider', 'smsEnabledForProvider', 'emailEnabledForCustomer', 'smsEnabledForCustomer', 'phoneCallEnabledForCustomer', 'whatsappEnabledForCustomer'] as const;
const notificationEvents = ['PAYMENT_CREATED','PAYMENT_UPDATED','PAYMENT_RECEIVED','PAYMENT_OVERDUE','PAYMENT_DUEDATE_WARNING','SEND_LINHA_DIGITAVEL'];
class PolicyError extends Error { constructor(readonly code: string, readonly diagnostics: Data = {}) { super(code); } }
const fail = (code: string, diagnostics: Data = {}): never => { throw new PolicyError(code,diagnostics); };
const codeOf = (error: unknown) => error instanceof PolicyError ? error.code : 'PROVIDER_POLICY_FAILED';
const diagnosticsOf = (error: unknown) => error instanceof PolicyError ? error.diagnostics : {};
async function call(rpc: MonthlyWhatsappRpc, name: string, args: Data = {}) {
 const result = await rpc(name, args);
 if (result.error) throw new PolicyError(name === 'record_monthly_whatsapp_result' ? 'AUDIT_REJECTED' : 'POLICY_STATE_UNAVAILABLE');
 return result.data;
}
export function normalizeMonthlyWhatsappPhone(value: unknown) {
 let phone = digits(value);
 if (phone.length === 13 && phone.startsWith('55')) phone = phone.slice(2);
 if (!/^[1-9]{2}9\d{8}$/.test(phone)) return '';
 return phone;
}

export function monthlyCustomerContactChanged(remote: Data, desired: Data) {
 return Object.entries(desired).some(([key,value]) => {
  if (value === undefined) return false;
  if (key === 'cpfCnpj') return digits(remote[key]) !== digits(value);
  if (key === 'mobilePhone') return normalizeMonthlyWhatsappPhone(remote[key]) !== normalizeMonthlyWhatsappPhone(value);
  return String(remote[key] || '').trim() !== String(value || '').trim();
 });
}

function notificationChannelDiagnostics(rows: Data[]) {
 const issues = new Map<string,Data>();
 const typeOf = (value:unknown) => value === undefined ? 'MISSING' : value === null ? 'NULL' : Array.isArray(value) ? 'ARRAY' :
  ['boolean','string','number','object'].includes(typeof value) ? typeof value === 'boolean' ? 'BOOLEAN' : typeof value === 'string' ? 'STRING' : typeof value === 'number' ? 'NUMBER' : 'OBJECT' : 'OTHER';
 for (const row of rows) {
  const event = notificationEvents.includes(String(row.event)) ? String(row.event) : 'UNKNOWN_EVENT';
  const add = (field:string,value:unknown) => {
   const issue = {field,type:typeOf(value),event};
   if (issues.size < 64) issues.set(JSON.stringify(issue),issue);
  };
  for (const key of flags) if (typeof row[key] !== 'boolean') add(key,row[key]);
  // Unknown field names and values can contain provider or personal data; never return them.
  for (const key of Object.keys(row)) if (key.includes('EnabledFor') && !flags.includes(key as typeof flags[number]) && row[key] !== false) add('UNKNOWN_CHANNEL',row[key]);
 }
 return [...issues.values()];
}
function notificationRows(response: Data, customerId: string) {
 if (!Array.isArray(response.data) || response.data.length === 0 || response.data.length > 50 || response.hasMore === true ||
     (response.totalCount !== undefined && response.totalCount !== response.data.length)) return fail('INCOMPLETE_NOTIFICATION_RULES');
 const rows = response.data.map(obj), ids = new Set<string>();
 for (const row of rows) {
  const id = String(row.id || '');
  if (!/^not_[a-zA-Z0-9_-]{1,116}$/.test(id) || ids.has(id) || row.customer !== customerId || typeof row.event !== 'string' ||
      typeof row.enabled !== 'boolean' || (row.deleted !== undefined && typeof row.deleted !== 'boolean')) return fail('INVALID_NOTIFICATION_RULES');
  ids.add(id);
 }
 const notificationChannels = notificationChannelDiagnostics(rows);
 // Optional known fields remain unknown, never false. The plan writes all six
 // booleans explicitly; active rules still require exact readback equality.
 // Validation must inspect every raw field, independently from the bounded diagnostic list.
 const unknownChannel=rows.some(row=>Object.keys(row).some(key=>key.includes('EnabledFor')&&!flags.includes(key as typeof flags[number])&&row[key]!==false));
 const invalidChannel=rows.some(row=>flags.some(key=>typeof row[key]!=='boolean'&&row[key]!==undefined&&row[key]!==null));
 if (unknownChannel||invalidChannel) return fail(unknownChannel ? 'UNKNOWN_NOTIFICATION_CHANNEL' : 'INVALID_NOTIFICATION_CHANNEL',{notificationChannels});
 return rows;
}
// Two provider-created slots only; no new rules, send calls or payment mutations.
export function planMonthlyWhatsappRules(response: Data, customerId: string): Data[] {
 const rows = notificationRows(response, customerId);
 const due = rows.filter(row => row.event === 'PAYMENT_DUEDATE_WARNING' && row.deleted !== true);
 if (due.length !== 2) return fail('AMBIGUOUS_DUE_DATE_RULES');
 const onDate = due.filter(row => row.scheduleOffset === 0);
 const before = due.filter(row => row.scheduleOffset === 5 || row.scheduleOffset === 10);
 if (onDate.length !== 1 || before.length !== 1) return fail('AMBIGUOUS_DUE_DATE_RULES');
 return rows.map(row => {
  const chosen = row.id === onDate[0].id || row.id === before[0].id;
  return {id:row.id, enabled:chosen, ...Object.fromEntries(flags.map(key => [key, chosen && key === 'whatsappEnabledForCustomer'])),
   ...(row.id === before[0].id ? {scheduleOffset:5} : chosen ? {scheduleOffset:0} : {})};
 });
}
function verifiedRules(response: Data, customerId: string, plan: Data[]) {
 const rows = notificationRows(response, customerId);
 if (rows.length !== plan.length) return false;
 return plan.every(want => {
  const got = rows.find(row => row.id === want.id);
  // Asaas may omit an unavailable channel on a disabled rule (for example,
  // WhatsApp on SEND_LINHA_DIGITAVEL). enabled:false guarantees no delivery;
  // keep the unknown value in the audit instead of coercing it to false.
  return got && got.enabled === want.enabled && flags.every(key => got[key] === want[key] ||
   want.enabled === false && got.enabled === false && want[key] === false && (got[key] === undefined || got[key] === null)) &&
   (!want.enabled || got.deleted !== true && got.event === 'PAYMENT_DUEDATE_WARNING' && got.scheduleOffset === want.scheduleOffset);
 });
}
function safeConfig(customer: Data, rules: Data, recipientKind: unknown) {
 return {notificationDisabled:customer.notificationDisabled, recipientKind,
  notifications: Array.isArray(rules.data) ? rules.data.map(value => {const row=obj(value);return {id:row.id,event:row.event,scheduleOffset:row.scheduleOffset,enabled:row.enabled,...Object.fromEntries(flags.map(key=>[key,row[key]]))};}) : []};
}
function ownedCustomer(remote: Data, target: Data) {
 return remote.id === target.providerCustomerId && remote.externalReference === `ilha-monthly-customer:${target.clientId}` &&
   digits(remote.cpfCnpj).length === 11 && digits(remote.cpfCnpj) === digits(target.cpf) && remote.deleted !== true;
}
function sameCustomerIdentity(remote: Data,target: Data) {
 return remote.id===target.providerCustomerId&&digits(remote.cpfCnpj).length===11&&digits(remote.cpfCnpj)===digits(target.cpf)&&remote.deleted!==true;
}
async function readCustomerScope(target: Data,environment:string,rpc:MonthlyWhatsappRpc) {
 const scope=obj(await call(rpc,'get_monthly_whatsapp_customer_scope',{p_client_id:target.clientId,p_provider_environment:environment}));
 if (scope.state!=='READY'||scope.hasOtherActiveProduct===true) return fail('CUSTOMER_SCOPE_BLOCKED');
 if (scope.clientId!==target.clientId||scope.customerId!==target.providerCustomerId||scope.targetVersion!==target.targetVersion||
  scope.hasOtherActiveProduct!==false||typeof scope.scopeVersion!=='string'||!/^[a-f0-9]{32}$/.test(scope.scopeVersion)||
  !Array.isArray(scope.allowedExternalReferences)||!Array.isArray(scope.monthlyPayments)||scope.monthlyPayments.length>500) return fail('CUSTOMER_SCOPE_UNVERIFIED');
 return scope;
}
async function verifyRemotePaymentScope(customerId:string,scope:Data,request:MonthlyWhatsappRequest) {
 const known=(scope.monthlyPayments as unknown[]).map(obj),ids=new Set<string>();
 const settled=['RECEIVED','CONFIRMED','RECEIVED_IN_CASH','REFUNDED'];
 // These are current Asaas statuses. Anything else is unknown, not evidence of settlement.
 const active=['PENDING','OVERDUE','REFUND_REQUESTED','REFUND_IN_PROGRESS','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE','AWAITING_CHARGEBACK_REVERSAL','DUNNING_REQUESTED','DUNNING_RECEIVED','AWAITING_RISK_ANALYSIS'];
 let offset=0,total:number|undefined;
 for(let page=0;page<5;page++) {
  const response=await request(`/payments?customer=${encodeURIComponent(customerId)}&limit=100&offset=${offset}`);
  if (!Array.isArray(response.data)||response.data.length>100||typeof response.hasMore!=='boolean'||
   !Number.isInteger(response.totalCount)||Number(response.totalCount)<0||Number(response.totalCount)>500||
   response.offset!==undefined&&response.offset!==offset||total!==undefined&&response.totalCount!==total) return fail('REMOTE_PAYMENT_SCOPE_INCOMPLETE');
  total=Number(response.totalCount);
  for(const value of response.data) {
   const payment=obj(value),id=String(payment.id||'');
   if(!/^pay_[a-zA-Z0-9_-]{1,116}$/.test(id)||ids.has(id)||payment.customer!==customerId||
    payment.deleted!==undefined&&typeof payment.deleted!=='boolean') return fail('REMOTE_PAYMENT_SCOPE_UNVERIFIED');
   ids.add(id);
   if(payment.deleted===true||settled.includes(String(payment.status)))continue;
   if(!active.includes(String(payment.status)))return fail('REMOTE_PAYMENT_SCOPE_UNVERIFIED');
   if(!known.some(local=>local.providerPaymentId===id&&typeof local.externalReference==='string'&&local.externalReference!==''&&local.externalReference===payment.externalReference))return fail('OTHER_ACTIVE_CUSTOMER_PAYMENT');
  }
  offset+=response.data.length;
  if(!response.hasMore) {
   if(offset!==total)return fail('REMOTE_PAYMENT_SCOPE_INCOMPLETE');
   return;
  }
  if(response.data.length===0||offset>=total)return fail('REMOTE_PAYMENT_SCOPE_INCOMPLETE');
 }
 return fail('REMOTE_PAYMENT_SCOPE_INCOMPLETE');
}
async function proveReusableCustomer(remote:Data,target:Data,environment:string,rpc:MonthlyWhatsappRpc|undefined,request:MonthlyWhatsappRequest) {
 if(ownedCustomer(remote,target))return null;
 if(!sameCustomerIdentity(remote,target)||target.state!=='READY'||!rpc||typeof remote.externalReference!=='string'||!remote.externalReference)return fail('SHARED_OR_DIVERGENT_CUSTOMER');
 const scope=await readCustomerScope(target,environment,rpc);
 // Exact references come only from matching customer + CPF records in our own database.
 if(!(scope.allowedExternalReferences as unknown[]).includes(remote.externalReference))return fail('SHARED_OR_DIVERGENT_CUSTOMER');
 await verifyRemotePaymentScope(String(target.providerCustomerId),scope,request);
 return {scopeVersion:scope.scopeVersion,externalReference:remote.externalReference};
}
function customerIdentityDiagnostics(remote: Data,target: Data) {
 return {idMatches:remote.id===target.providerCustomerId,documentMatches:digits(remote.cpfCnpj).length===11&&digits(remote.cpfCnpj)===digits(target.cpf),
  referenceKind:remote.externalReference===`ilha-monthly-customer:${target.clientId}` ? 'OWNED' : remote.externalReference==null||remote.externalReference==='' ? 'EMPTY' : 'FOREIGN',
  deleted:typeof remote.deleted==='boolean'?remote.deleted:null};
}
function publicTarget(target: Data) {
 const phone = normalizeMonthlyWhatsappPhone(target.phone);
 return {clientId:target.clientId,name:target.name,isFamily:target.isFamily,isMinor:target.isMinor,recipientKind:target.recipientKind,
  maskedPhone:phone ? `(**) *****-${phone.slice(-4)}` : null,providerCustomerId:target.providerCustomerId || null};
}
async function readTarget(clientId: string, environment: string, rpc: MonthlyWhatsappRpc) {
 return obj(await call(rpc,'get_monthly_whatsapp_target',{p_client_id:clientId,p_provider_environment:environment}));
}
export async function previewMonthlyWhatsappTarget(target: Data, request: MonthlyWhatsappRequest,rpc?:MonthlyWhatsappRpc,environment='PRODUCTION') {
 const base = {...publicTarget(target),state:String(target.state || 'BLOCKED'),reason:target.reason || null,configured:false,notificationDisabled:null as boolean|null};
 let diagnostics: Data = {};
 if (!target.providerCustomerId) return {...base,state:target.state === 'READY' ? 'WAITING_CUSTOMER' : 'BLOCKED',reason:target.reason || 'CUSTOMER_NOT_CREATED',diagnostics};
 try {
  const customerId = String(target.providerCustomerId), remote = await request(`/customers/${encodeURIComponent(customerId)}`);
  diagnostics = {identity:customerIdentityDiagnostics(remote,target)};
  base.notificationDisabled = typeof remote.notificationDisabled === 'boolean' ? remote.notificationDisabled : null;
  const scopeProof=await proveReusableCustomer(remote,target,environment,rpc,request);
  diagnostics={...diagnostics,scopeVerified:scopeProof!==null};
  const rules = await request(`/customers/${encodeURIComponent(customerId)}/notifications`);
  const plan = planMonthlyWhatsappRules(rules,customerId);
  diagnostics = {...diagnostics,notificationChannels:notificationChannelDiagnostics((rules.data as unknown[]).map(obj))};
  return {...base,diagnostics,configured:target.state === 'READY' && verifiedRules(rules,customerId,plan) && remote.notificationDisabled === false &&
   normalizeMonthlyWhatsappPhone(remote.mobilePhone) === normalizeMonthlyWhatsappPhone(target.phone)};
 } catch(error) { return {...base,state:'BLOCKED',reason:codeOf(error),diagnostics:{...diagnostics,...diagnosticsOf(error)}}; }
}
export async function applyMonthlyWhatsappPolicy(clientId: string, actorId: string|null, environment: string,
 rpc: MonthlyWhatsappRpc, rawRequest: MonthlyWhatsappRequest, budgetMs = 15_000): Promise<PolicyResult> {
 const deadline = Date.now() + budgetMs;
 const request: MonthlyWhatsappRequest = (path,init) => {
  if (Date.now() >= deadline) return Promise.reject(new PolicyError("POLICY_DEADLINE_EXCEEDED"));
  return rawRequest(path,init);
 };
 let target: Data = {}, before: Data = {}, after: Data = {}, diagnostics: Data = {}, customerId = '', owned = false;
 let needsDisable = false;
 const disable = async () => {
  const disabled = await rawRequest(`/customers/${encodeURIComponent(customerId)}`,{method:'PUT',body:JSON.stringify({notificationDisabled:true})});
  if (disabled.id !== customerId || disabled.notificationDisabled !== true) return fail('GLOBAL_DISABLE_NOT_CONFIRMED');
  needsDisable = false;
  after = {...after,notificationDisabled:true};
 };
 const audit = (status:string,errorCode:string|null) => call(rpc,'record_monthly_whatsapp_result',{
  p_client_id:clientId,p_actor_id:actorId,p_environment:environment,p_customer_id:customerId || null,
  p_target_version:target.targetVersion || null,p_status:status,p_before_config:before,p_after_config:after,p_error_code:errorCode,
 });
 try {
  target = await readTarget(clientId,environment,rpc);
  if (target.policyEnabled !== true) return {...publicTarget(target),state:'SKIPPED',reason:'POLICY_DISABLED'};
  customerId = String(target.providerCustomerId || '');
  if (!customerId) return {...publicTarget(target),state:target.state === 'READY' ? 'WAITING_CUSTOMER' : 'BLOCKED',reason:String(target.reason || 'CUSTOMER_NOT_CREATED')};
  const path = `/customers/${encodeURIComponent(customerId)}`;
  const remote = await request(path);
  diagnostics = {identity:customerIdentityDiagnostics(remote,target)};
  const scopeProof=await proveReusableCustomer(remote,target,environment,rpc,request);
  diagnostics={...diagnostics,scopeVerified:scopeProof!==null};
  owned = true;
  // Unknown state is never evidence that delivery is disabled.
  needsDisable = true;
  if (typeof remote.notificationDisabled !== 'boolean') return fail('UNKNOWN_NOTIFICATION_STATE');
  needsDisable = remote.notificationDisabled !== true;
  if (target.state !== 'READY') return fail(String(target.reason || 'RECIPIENT_BLOCKED'));
  const phone = normalizeMonthlyWhatsappPhone(target.phone);
  if (!phone || !['PAYER','GUARDIAN'].includes(String(target.recipientKind))) return fail('INVALID_RECIPIENT_PHONE');
  const rules = await request(`${path}/notifications`);
  before = safeConfig(remote,rules,target.recipientKind);
  const plan = planMonthlyWhatsappRules(rules,customerId);
  diagnostics = {...diagnostics,notificationChannels:notificationChannelDiagnostics((rules.data as unknown[]).map(obj))};
  const alreadyConfigured = verifiedRules(rules,customerId,plan) && remote.notificationDisabled === false && normalizeMonthlyWhatsappPhone(remote.mobilePhone) === phone;
  if (!alreadyConfigured) {
   if (needsDisable) await disable();
   await request('/notifications/batch',{method:'PUT',body:JSON.stringify({customer:customerId,notifications:plan})});
   const verified = await request(`${path}/notifications`);
   let rulesMatch=false;
   try {rulesMatch=verifiedRules(verified,customerId,plan);} catch(error) {
    return fail(codeOf(error),{verificationChannels:diagnosticsOf(error).notificationChannels||[]});
   }
   if (!rulesMatch) return fail('NOTIFICATION_READBACK_MISMATCH',{
    verificationChannels:notificationChannelDiagnostics(Array.isArray(verified.data)?verified.data.map(obj):[]),
   });
   const fresh = await readTarget(clientId,environment,rpc);
   if (fresh.state !== 'READY' || fresh.policyEnabled !== true || fresh.targetVersion !== target.targetVersion || fresh.providerCustomerId !== customerId) return fail('TARGET_CHANGED');
   if(scopeProof) {
    const freshScope=await readCustomerScope(fresh,environment,rpc);
    if(freshScope.scopeVersion!==scopeProof.scopeVersion||!(freshScope.allowedExternalReferences as unknown[]).includes(scopeProof.externalReference))return fail('CUSTOMER_SCOPE_CHANGED');
    await verifyRemotePaymentScope(customerId,freshScope,request);
   }
   // The recipient is taken from the current financial target, including the guardian for an isolated minor.
   needsDisable = true;
   await request(path,{method:'PUT',body:JSON.stringify({mobilePhone:phone,notificationDisabled:false})});
   const confirmed = await request(path);
   if (!sameCustomerIdentity(confirmed,target) || confirmed.externalReference!==remote.externalReference || confirmed.notificationDisabled !== false || normalizeMonthlyWhatsappPhone(confirmed.mobilePhone) !== phone) return fail('CUSTOMER_READBACK_MISMATCH');
   after = safeConfig(confirmed,verified,target.recipientKind);
  } else {after = before;needsDisable = true;}
  const auditId = obj(await audit('APPLIED',null)).auditId;
  needsDisable = false;
  return {...publicTarget(target),state:'APPLIED',reason:null,configured:true,notificationDisabled:false,auditId,diagnostics};
 } catch(error) {
  let reason = codeOf(error);
  if (owned && needsDisable) {try {await disable();} catch {reason='GLOBAL_DISABLE_UNCONFIRMED';}}
  const state = reason === 'POLICY_DEADLINE_EXCEEDED' || reason === 'PROVIDER_POLICY_FAILED' || reason === 'GLOBAL_DISABLE_UNCONFIRMED' || reason === 'POLICY_STATE_UNAVAILABLE' ? 'FAILED' : 'BLOCKED';
  if (target.targetVersion) {try {await audit(state,reason);} catch {reason = 'AUDIT_FAILED';}}
  return {...publicTarget(target),clientId,state,reason,configured:false,notificationDisabled:owned && !needsDisable ? true : null,diagnostics:{...diagnostics,...diagnosticsOf(error)}};
 }
}
export async function monthlyWhatsappBatch(body: Data,actorId: string,environment: string,rpc: MonthlyWhatsappRpc,request: MonthlyWhatsappRequest) {
 const applying = body.action === 'notify_apply';
 if (!['notify_preview','notify_apply'].includes(String(body.action)) || Object.keys(body).some(key=>!['action','cursor','limit',...(applying?['enabled','reason']:[])].includes(key)) ||
  body.cursor != null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body.cursor)) ||
  body.limit != null && (!Number.isInteger(body.limit) || Number(body.limit)<1 || Number(body.limit)>5) ||
  applying && (body.enabled !== true || typeof body.reason !== 'string' || body.reason.trim().length<10 || body.reason.length>400)) return fail('INVALID_POLICY_REQUEST');
 if (applying) await call(rpc,'set_monthly_whatsapp_policy',{p_actor_id:actorId,p_enabled:true,p_reason:String(body.reason).trim()});
 const policy = obj(await call(rpc,'get_monthly_whatsapp_policy'));
 const page = obj(await call(rpc,'list_monthly_whatsapp_targets',{p_after_client_id:body.cursor || null,p_limit:body.limit || 5,p_provider_environment:environment}));
 if (!Array.isArray(page.targets) || page.targets.length>5) return fail('INVALID_TARGET_PAGE');
 const items = await Promise.all(page.targets.map(async value => {
  const target = obj(value);
  return applying ? await applyMonthlyWhatsappPolicy(String(target.clientId),actorId,environment,rpc,request) : await previewMonthlyWhatsappTarget(target,request,rpc,environment);
 }));
 return {policy,items,nextCursor:page.nextCursor || null,hasMore:page.hasMore === true,
  counts:{applied:items.filter(i=>i.state==='APPLIED').length,blocked:items.filter(i=>i.state==='BLOCKED').length,failed:items.filter(i=>i.state==='FAILED').length,waiting:items.filter(i=>i.state==='WAITING_CUSTOMER').length}};
}
