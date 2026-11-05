import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app = fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const adm = fs.readFileSync(new URL('../adm/index.html',import.meta.url),'utf8');
test('pendência no app não depende de autorização financeira',()=>{
 const src=app.match(/    function hasPendingFamilyDetails\(\) \{[\s\S]*?\n    \}/)[0];
 const ctx=vm.createContext({isFamilyDependent:()=>false,familySummary:{members:[{status:'ATIVO',needs_details_confirmation:true,billing_authorized_at:'now'}]}});
 vm.runInContext(src,ctx);
 assert.equal(ctx.hasPendingFamilyDetails(),true);
 ctx.familySummary.members[0].needs_details_confirmation=false;
 assert.equal(ctx.hasPendingFamilyDetails(),false);
 ctx.familySummary.members[0].needs_details_confirmation=true;
 ctx.isFamilyDependent=()=>true;
 assert.equal(ctx.hasPendingFamilyDetails(),false);
});
test('navegação exige cadastro sem bloquear pagamentos e avisos',()=>{
 const src=app.slice(app.indexOf('    function showView(view)'),app.indexOf('    function renderAll()'));
 assert.match(src,/hasPendingFamilyDetails\(\)/);
 assert.match(src,/\['profile', 'payments', 'notifications'\]/);
 assert.match(src,/familyPanel.*scrollIntoView/);
});
test('liberação é explícita, restrita ao financeiro e preserva os dados pendentes',()=>{
 const src=adm.slice(adm.indexOf('    async function authorizeFamilyBillingAction'),adm.indexOf('    async function confirmFamilyMemberAction'));
 assert.match(src,/finance.write/);
 assert.match(src,/window.confirm/);
 assert.match(src,/p_expected_updated_at/);
 assert.doesNotMatch(src,/responsibleConfirmationRequired = false/);
});
