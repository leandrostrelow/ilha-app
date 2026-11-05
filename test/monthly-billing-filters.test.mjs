import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../adm/index.html', import.meta.url), 'utf8');
const fn = name => source.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))[0];
function setup() {
  const client = {id:'payer',name:'José Teste',phone:'(27) 99999-1234',cpf:'123.456.789-00',type:'responsavel',status:'ATIVO',officialPlanName:'Família',planAmount:0};
  const member = {fullName:'Micheli Teste',phone:'27988881234',cpf:'111.222.333-44',monthlyAmount:350};
  const invoice = {id:'invoice',clientId:'payer',status:'AGUARDANDO',amount:350,paymentMethod:'ASAAS_PIX',pixPayload:'fixture-only',providerStatus:'PENDING',pixExpiresAt:'2099-01-01T00:00:00Z'};
  const candidate = {clientId:'payer',clientName:client.name,amount:350,billingEnabled:true,billingMethod:'ASAAS_PIX',invoicePaymentMethod:'ASAAS_PIX',dueDate:'2026-10-20',state:'ELIGIBLE',invoiceId:'',reason:''};
  const ctx = vm.createContext({opsData:{paymentInvoices:[invoice]},findClientByKey:()=>client,billingAccountComposition:()=>({total:350,members:[member]}),activeFamilyLinkForClient:()=>null,normalizeMatchText:value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()});
  for (const name of ['normalizeMonthlyBillingMethod','financeDateValue','monthlyBillingFilterDefaults','monthlyBillingFilterFacts','monthlyBillingFilterError','monthlyBillingMatchesFilters']) vm.runInContext(fn(name),ctx);
  const facts = () => ctx.monthlyBillingFilterFacts(candidate,'2026-10-05');
  const matches = (filters={},search='',status='todos',method='todos') => ctx.monthlyBillingMatchesFilters(candidate,facts(),{...ctx.monthlyBillingFilterDefaults(),...filters},search,status,method);
  return {ctx,client,invoice,candidate,facts,matches};
}
test('15-day window is inclusive, handles overdue dates and does not include disabled, paid or dependent accounts',()=>{
  const {ctx,candidate,facts}=setup();
  assert.equal(facts().missingInWindow,true);
  candidate.dueDate='2026-10-21';assert.equal(facts().missingInWindow,false);
  candidate.dueDate='2026-10-01';assert.equal(facts().missingInWindow,true);
  candidate.billingEnabled=false;assert.equal(facts().missingInWindow,false);
  candidate.billingEnabled=true;candidate.invoiceId='invoice';assert.equal(facts().missingInWindow,false);
  candidate.invoiceId='';candidate.state='PAID';assert.equal(facts().missingInWindow,false);
  candidate.state='ELIGIBLE';ctx.activeFamilyLinkForClient=()=>({});assert.equal(facts().missingInWindow,false);
});
test('available Pix requires invoice, pending provider, payload and unexpired date; paid/expired/manual not offered',()=>{
  const {candidate,invoice,facts}=setup();
  assert.equal(facts().pixAvailable,false);
  candidate.invoiceId='invoice';candidate.state='EXISTING';assert.equal(facts().pixAvailable,true);
  invoice.pixExpiresAt='2020-01-01';assert.equal(facts().pixAvailable,false);
  invoice.pixExpiresAt='';invoice.pixPayload='';assert.equal(facts().pendingPix,true);
  invoice.pixPayload='fixture';candidate.state='PAID';assert.equal(facts().pixAvailable,false);assert.equal(facts().pendingPix,false);
  candidate.state='EXISTING';candidate.providerStatus='CONFIRMED';assert.equal(facts().pixAvailable,false);
  candidate.providerStatus='PENDING';candidate.invoicePaymentMethod='CASH';assert.equal(facts().pixAvailable,false);
});
test('search finds accentless names, dependents and unformatted phone/CPF',()=>{
  const {matches}=setup();
  for(const query of ['jose','MICHELI','27999991234','(27) 98888-1234','11122233344','123.456.789-00']) assert.equal(matches({},query),true,query);
  assert.equal(matches({},'Nao Existe'),false);
});
test('filters combine activation, family, type, plan, status, due ranges and inclusive zero/amount boundaries',()=>{
  const {matches,candidate}=setup();
  assert.equal(matches({enabled:'ativadas',account:'familiar',type:'responsavel',plan:'Família',clientStatus:'ATIVO',due:'15',dueDay:'20',dueFrom:'2026-10-20',dueTo:'2026-10-20',minAmount:'350',maxAmount:'350'}),true);
  for(const filters of [{enabled:'desativadas'},{account:'individual'},{type:'aluno'},{plan:'Outro'},{clientStatus:'BLOQUEADO'},{due:'7'},{dueDay:'10'},{dueFrom:'2026-10-21'},{dueTo:'2026-10-19'},{minAmount:'351'},{maxAmount:'349'}]) assert.equal(matches(filters),false,JSON.stringify(filters));
  assert.equal(matches({},'','sem_fatura'),true);
  assert.equal(matches({},'','gerados'),false);
  assert.equal(matches({},'','todos','CASH'),false);
  candidate.amount=0;assert.equal(matches({minAmount:'0',maxAmount:'0'}),true);
  candidate.dueDate='';assert.equal(matches({due:'sem_data'}),true);assert.equal(matches({due:'15'}),false);
});
test('amount difference is review-only and does not flag paid invoices or historical dependents',()=>{
  const {ctx,candidate,invoice,facts}=setup();
  candidate.invoiceId='invoice';candidate.state='EXISTING';candidate.amount=1000;
  const before=JSON.stringify(invoice);assert.equal(facts().differentAmount,true);assert.equal(JSON.stringify(invoice),before);
  candidate.state='PAID';assert.equal(facts().differentAmount,false);
  candidate.state='EXISTING';ctx.activeFamilyLinkForClient=()=>({});assert.equal(facts().differentAmount,false);
});
test('invalid ranges produce useful errors; filters never invoke financial writes',()=>{
  const {ctx}=setup();const defaults=ctx.monthlyBillingFilterDefaults();
  assert.match(ctx.monthlyBillingFilterError({...defaults,dueFrom:'2026-10-20',dueTo:'2026-10-01'}),/data inicial/);
  assert.match(ctx.monthlyBillingFilterError({...defaults,minAmount:'500',maxAmount:'350'}),/valor mínimo/);
  assert.match(ctx.monthlyBillingFilterError({...defaults,dueDay:'32'}),/1 e 31/);
  assert.match(ctx.monthlyBillingFilterError({...defaults,minAmount:'-1'}),/negativos/);
  assert.equal(ctx.monthlyBillingFilterError(defaults),'');
  assert.doesNotMatch(fn('resetMonthlyBillingFilters'),/Request|generateMonthly|supabase|enrollment/i);
  assert.match(source,/independentemente dos filtros da lista/);
  assert.match(source,/Resumo completo do mês/);
});
