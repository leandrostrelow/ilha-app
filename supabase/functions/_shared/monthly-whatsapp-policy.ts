type Data = Record<string, unknown>;
export type MonthlyWhatsappRpc = (name: string, args?: Data) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
export type MonthlyWhatsappRequest = (path: string, init?: RequestInit) => Promise<Data>;
type PolicyResult = Data & {state:string;reason:string|null;configured?:boolean;notificationDisabled?:boolean|null;auditId?:unknown};
const obj = (v: unknown): Data => v && typeof v === 'object' && !Array.isArray(v) ? v as Data : {};
const digits = (v: unknown) => String(v || '').replace(/\D/g, '');
const flags = ['emailEnabledForProvider', 'smsEnabledForProvider', 'emailEnabledForCustomer', 'smsEnabledForCustomer', 'phoneCallEnabledForCustomer', 'whatsappEnabledForCustomer'] as const;
class PolicyError extends Error { constructor(readonly code: string) { super(code); } }
const fail = (code: string): never => { throw new PolicyError(code); };
const codeOf = (error: unknown) => error instanceof PolicyError ? error.code : 'PROVIDER_POLICY_FAILED';
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

function notificationRows(response: Data, customerId: string) {
 if (!Array.isArray(response.data) || response.data.length === 0 || response.data.length > 50 || response.hasMore === true ||
     (response.totalCount !== undefined && response.totalCount !== response.data.length)) return fail('INCOMPLETE_NOTIFICATION_RULES');
 const rows = response.data.map(obj), ids = new Set<string>();
 for (const row of rows) {
  const id = String(row.id || '');
  if (!/^not_[a-zA-Z0-9_-]{1,116}$/.test(id) || ids.has(id) || row.customer !== customerId || typeof row.event !== 'string' ||
      typeof row.enabled !== 'boolean' || (row.deleted !== undefined && typeof row.deleted !== 'boolean')) return fail('INVALID_NOTIFICATION_RULES');
  for (const key of Object.keys(row)) if (key.includes('EnabledFor') && !flags.includes(key as typeof flags[number]) && row[key] !== false) return fail('UNKNOWN_NOTIFICATION_CHANNEL');
  for (const key of flags) if (typeof row[key] !== 'boolean') return fail('INVALID_NOTIFICATION_CHANNEL');
  ids.add(id);
 }
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
  return got && got.enabled === want.enabled && flags.every(key => got[key] === want[key]) &&
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
function publicTarget(target: Data) {
 const phone = normalizeMonthlyWhatsappPhone(target.phone);
 return {clientId:target.clientId,name:target.name,isFamily:target.isFamily,isMinor:target.isMinor,recipientKind:target.recipientKind,
  maskedPhone:phone ? `(**) *****-${phone.slice(-4)}` : null,providerCustomerId:target.providerCustomerId || null};
}
async function readTarget(clientId: string, environment: string, rpc: MonthlyWhatsappRpc) {
 return obj(await call(rpc,'get_monthly_whatsapp_target',{p_client_id:clientId,p_provider_environment:environment}));
}
export async function previewMonthlyWhatsappTarget(target: Data, request: MonthlyWhatsappRequest) {
 const base = {...publicTarget(target),state:String(target.state || 'BLOCKED'),reason:target.reason || null,configured:false,notificationDisabled:null as boolean|null};
 if (!target.providerCustomerId) return {...base,state:target.state === 'READY' ? 'WAITING_CUSTOMER' : 'BLOCKED',reason:target.reason || 'CUSTOMER_NOT_CREATED'};
 try {
  const customerId = String(target.providerCustomerId), remote = await request(`/customers/${encodeURIComponent(customerId)}`);
  base.notificationDisabled = typeof remote.notificationDisabled === 'boolean' ? remote.notificationDisabled : null;
  if (!ownedCustomer(remote,target)) return {...base,state:'BLOCKED',reason:'SHARED_OR_DIVERGENT_CUSTOMER'};
  const rules = await request(`/customers/${encodeURIComponent(customerId)}/notifications`);
  const plan = planMonthlyWhatsappRules(rules,customerId);
  return {...base,configured:target.state === 'READY' && verifiedRules(rules,customerId,plan) && remote.notificationDisabled === false &&
   normalizeMonthlyWhatsappPhone(remote.mobilePhone) === normalizeMonthlyWhatsappPhone(target.phone)};
 } catch(error) { return {...base,state:'BLOCKED',reason:codeOf(error)}; }
}
export async function applyMonthlyWhatsappPolicy(clientId: string, actorId: string|null, environment: string,
 rpc: MonthlyWhatsappRpc, rawRequest: MonthlyWhatsappRequest, budgetMs = 15_000): Promise<PolicyResult> {
 const deadline = Date.now() + budgetMs;
 const request: MonthlyWhatsappRequest = (path,init) => {
  if (Date.now() >= deadline) return Promise.reject(new PolicyError("POLICY_DEADLINE_EXCEEDED"));
  return rawRequest(path,init);
 };
 let target: Data = {}, before: Data = {}, after: Data = {}, customerId = '', owned = false;
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
  if (!ownedCustomer(remote,target)) return fail('SHARED_OR_DIVERGENT_CUSTOMER');
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
  const alreadyConfigured = verifiedRules(rules,customerId,plan) && remote.notificationDisabled === false && normalizeMonthlyWhatsappPhone(remote.mobilePhone) === phone;
  if (!alreadyConfigured) {
   if (needsDisable) await disable();
   await request('/notifications/batch',{method:'PUT',body:JSON.stringify({customer:customerId,notifications:plan})});
   const verified = await request(`${path}/notifications`);
   if (!verifiedRules(verified,customerId,plan)) return fail('NOTIFICATION_READBACK_MISMATCH');
   const fresh = await readTarget(clientId,environment,rpc);
   if (fresh.state !== 'READY' || fresh.policyEnabled !== true || fresh.targetVersion !== target.targetVersion || fresh.providerCustomerId !== customerId) return fail('TARGET_CHANGED');
   // The recipient is taken from the current financial target, including the guardian for an isolated minor.
   needsDisable = true;
   await request(path,{method:'PUT',body:JSON.stringify({mobilePhone:phone,notificationDisabled:false})});
   const confirmed = await request(path);
   if (!ownedCustomer(confirmed,target) || confirmed.notificationDisabled !== false || normalizeMonthlyWhatsappPhone(confirmed.mobilePhone) !== phone) return fail('CUSTOMER_READBACK_MISMATCH');
   after = safeConfig(confirmed,verified,target.recipientKind);
  } else {after = before;needsDisable = true;}
  const auditId = obj(await audit('APPLIED',null)).auditId;
  needsDisable = false;
  return {...publicTarget(target),state:'APPLIED',reason:null,configured:true,notificationDisabled:false,auditId};
 } catch(error) {
  let reason = codeOf(error);
  if (owned && needsDisable) {try {await disable();} catch {reason='GLOBAL_DISABLE_UNCONFIRMED';}}
  const state = reason === 'POLICY_DEADLINE_EXCEEDED' || reason === 'PROVIDER_POLICY_FAILED' || reason === 'GLOBAL_DISABLE_UNCONFIRMED' || reason === 'POLICY_STATE_UNAVAILABLE' ? 'FAILED' : 'BLOCKED';
  if (target.targetVersion) {try {await audit(state,reason);} catch {reason = 'AUDIT_FAILED';}}
  return {...publicTarget(target),clientId,state,reason,configured:false,notificationDisabled:owned && !needsDisable ? true : null};
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
  return applying ? await applyMonthlyWhatsappPolicy(String(target.clientId),actorId,environment,rpc,request) : await previewMonthlyWhatsappTarget(target,request);
 }));
 return {policy,items,nextCursor:page.nextCursor || null,hasMore:page.hasMore === true,
  counts:{applied:items.filter(i=>i.state==='APPLIED').length,blocked:items.filter(i=>i.state==='BLOCKED').length,failed:items.filter(i=>i.state==='FAILED').length,waiting:items.filter(i=>i.state==='WAITING_CUSTOMER').length}};
}
