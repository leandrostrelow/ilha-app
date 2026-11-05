import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../adm/index.html',import.meta.url),'utf8');
const fn=name=>source.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
function setup(){
 const data={clients:[{id:'payer',name:'Higor',type:'responsavel',planAmount:0},{id:'child',name:'Micheli',planAmount:350}],familyMembers:[{id:'family',billingResponsibleId:'payer',memberClientId:'child',fullName:'Micheli',monthlyAmount:350,status:'ATIVO'}]};
 const ctx=vm.createContext({opsData:data,findClientPlan:()=>({amount:500,weeklyLessons:2}),normalizeMonthlyBillingMethod:x=>x,monthlyBillingMethodIsManual:x=>x==='CASH'});
 for(const name of ['activeFamilyLinkForClient','familyClientById','familyContextForClient','billingAccountComposition','syncClientsWithPlanCatalog','monthlyBillingCandidateNeedsGeneration','monthlyBillingCandidateNeedsManualGeneration']) vm.runInContext(fn(name),ctx);
 return {data,ctx};
}
test('responsável sem jogar paga somente o total dos dependentes, sem duplicidade',()=>{
 const {ctx,data}=setup();
 assert.equal(ctx.billingAccountComposition(data.clients[0]).total,350);
 assert.equal(ctx.billingAccountComposition(data.clients[1]).total,350);
 data.clients[0].type='aluno'; data.clients[0].planAmount=170;
 assert.equal(ctx.billingAccountComposition(data.clients[0]).total,520);
 data.familyMembers.push({billingResponsibleId:'payer',fullName:'Outro',monthlyAmount:250,status:'ATIVO'},{billingResponsibleId:'payer',monthlyAmount:999,status:'INATIVO'});
 assert.equal(ctx.billingAccountComposition(data.clients[0]).total,770);
});
test('zero e valores negociados não são sobrescritos pelo catálogo',()=>{
 const {ctx,data}=setup();
 data.clients.push({id:'zero',type:'aluno',planAmount:0,weeklyLessons:0},{id:'custom',type:'aluno',planAmount:230,weeklyLessons:1});
 ctx.syncClientsWithPlanCatalog();
 assert.equal(data.clients[2].planAmount,0);assert.equal(data.clients[2].weeklyLessons,0);
 assert.equal(data.clients[3].planAmount,230);assert.equal(data.clients[3].weeklyLessons,1);
});
test('dependentes não podem entrar na geração individual nem em lote, inclusive com prévia antiga',()=>{
 const {ctx}=setup();
 assert.equal(ctx.monthlyBillingCandidateNeedsGeneration({clientId:'child',billingEnabled:true,billingMethod:'ASAAS_PIX',state:'ELIGIBLE'}),false);
 assert.equal(ctx.monthlyBillingCandidateNeedsManualGeneration({clientId:'child',billingEnabled:true,billingMethod:'CASH',state:'ELIGIBLE'}),false);
 assert.equal(ctx.monthlyBillingCandidateNeedsGeneration({clientId:'payer',billingEnabled:true,billingMethod:'ASAAS_PIX',state:'ELIGIBLE'}),true);
});
test('centralização usa os registros existentes e não reatribui nem apaga faturas históricas',()=>{
 assert.match(fn('renderClientInvoices'),/historicalOwnerIds/);
 assert.match(fn('renderClientInvoices'),/registro original preservado/);
 assert.match(fn('renderMonthlyBilling'),/Boolean\(candidate.invoiceId\) \|\|/);
 assert.match(fn('openFamilyDirectoryMember'),/openBillingAccount\(responsible.id, 'Family'\)/);
 const save=source.match(/    async function saveClientModal\([^]*?\n    \}/)[0];
 assert.match(save,/patchClientFromAdmin\(client, payload\)/);
 assert.doesNotMatch(save,/supabaseDelete|paymentInvoices\.splice/);
 assert.match(save,/if \(!planChanged\)/);
 assert.match(save,/if \(!amountChanged\) delete payload\.plan_amount/);
 assert.match(save,/if \(!dueChanged\) delete payload\.due_day/);
 assert.doesNotMatch(source,/function saveBillingAccountSettings/);
 assert.doesNotMatch(fn('selectClientProfileTab'),/openBillingAccount/);
 assert.doesNotMatch(fn('openBillingAccount'),/openFinanceModule|setClubMode/);
});
