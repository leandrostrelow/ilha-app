import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../adm/index.html', import.meta.url), 'utf8');
const fn = name => source.match(new RegExp('    (?:async )?function ' + name + '\\([^]*?\\n    \\}'))[0];
function fixture(options = {}) {
  const calls = [], errors = [];
  const client = {id:'client-demo',name:'Aluno fictício',status:'PENDENTE',type:'aluno',dueDay:'',planAmount:0,weeklyLessons:0};
  const initial = {Name:client.name,Phone:'',Cpf:'52998224725',BirthDate:'1990-01-01',Guardian:'',GuardianPhone:'',Status:'PENDENTE',Notes:'',Plan:'',Amount:'0',DueDay:'',Frequency:'0',Minor:false,GuardianOnly:false};
  const values = {...initial,Status:'ATIVO',Plan:'plan-demo',Amount:'350',DueDay:'5',Frequency:'2'};
  const fields = Object.fromEntries(Object.entries(values).map(([key,value])=>['clientEdit'+key,{value,checked:value,type:typeof value==='boolean'?'checkbox':'text'}]));
  const submit = {disabled:false,isConnected:true,textContent:'Salvar e ativar cobrança'};
  fields.clientModalForm = {inert:false,querySelector:()=>submit};
  fields.clientBillingActivationError = {hidden:true,textContent:''};
  fields.clientMonthlyBillingMethod = {value:'ASAAS_PIX',dataset:{monthlyBillingClient:client.id,monthlyBillingEnabled:'false',monthlyBillingSavedMethod:'ASAAS_PIX'},addEventListener(_name,handler){this.change=handler;}};
  let modalOpen = true;
  fields.clientModal = {classList:{contains:()=>modalOpen}};
  const state = {selectedClientId:client.id,clientFormInitialValues:initial,clientProfileSaving:false,monthlyBillingEnrollments:{},monthlyBillingEnrollmentsLoaded:true,monthlyBillingLoaded:false,clientBillingActivationDraft:{clientId:client.id,billingMethod:'ASAAS_PIX'}};
  const plan = {id:'plan-demo',code:'2x',name:'2x por semana'};
  let stored = {...client};
  const ctx = vm.createContext({opsState:state,$:id=>fields[id],window:{confirm:()=>{calls.push('confirm');return options.confirm!==false;}},
    findClientByKey:()=>client, canUseClubPermission:p=>!(options.noFinance && p==='finance.write'),
    requireClubPermission:p=>{if(options.noFinance && p==='finance.write')throw Error('Sem permissão financeira');},
    activeFamilyLinkForClient:()=>options.dependent?{id:'member-demo'}:null,
    isAdminDemoMode:()=>false,findPlanByValue:()=>plan,isExemptPlan:()=>false,parseOptionalMoney:v=>Number(v.replace(',','.')),
    clientLessonSchedule:()=>[],isValidAdminCpf:()=>true,clientTypeForPlan:()=> 'aluno',normalizedClientType:v=>v,isUuid:()=>true,
    patchClientFromAdmin:async(_client,payload)=>{calls.push(['patch',payload]);if(options.patchFailure)throw Error('Falha no cadastro');stored={...stored,name:payload.full_name??stored.name,status:payload.status??stored.status,planAmount:payload.plan_amount??stored.planAmount,dueDay:payload.due_day??stored.dueDay,weeklyLessons:payload.weekly_lessons??stored.weeklyLessons,officialPlanId:payload.official_plan_id??stored.officialPlanId};return stored;},
    approveClientAccessFromAdmin:async()=>{calls.push('approve');if(options.approveFailure)throw Error('Aprovação recusada');stored={...stored,status:'ATIVO'};return stored;},
    mapClientRow:row=>row,notifyClientAccessReleased:async()=>{calls.push('notify');},
    normalizeMonthlyBillingMethod:value=>value||'ASAAS_PIX',monthlyBillingMethodLabel:v=>v,
    monthlyBillingEnrollmentsRequest:async request=>{calls.push(['billing',request,{...stored}]);if(options.billingFailure)throw Error('Ativação indisponível');return options.badResponse?{}:{clientId:client.id,enabled:request.enabled,billingMethod:request.billingMethod};},
    renderMonthlyBilling:()=>{},renderClientMonthlyBillingControl:()=>{},applyMonthlyBillingEnrollmentsToPayload:()=>{},
    setMonthlyBillingMessage:message=>{state.monthlyBillingMessage=message;},friendlyFamilyBillingError:x=>x,
    closeFamilyEditor:()=>{},hideClubAdminModal:()=>{modalOpen=false;calls.push('close');},
    renderClientsModule:()=>{},renderHomeDashboard:()=>{calls.push('refresh');},selectClientProfileTab:tab=>{calls.push(['tab',tab]);},
    toast:message=>{calls.push(['toast',message]);},reportActionError:error=>errors.push(error.message)
  });
  for(const name of ['clientProfileFormValues','monthlyBillingActivationConfirmation','updateMonthlyBillingEnrollment','toggleClientMonthlyBilling','closeClientModal','saveClientModal']) vm.runInContext(fn(name),ctx);
  vm.runInContext(source.match(/      \$\('clientMonthlyBillingMethod'\)\.addEventListener\('change',[^]*?\n      \}\);/)[0],ctx);
  const save=()=>ctx.saveClientModal({preventDefault(){},submitter:submit});
  return {ctx,state,fields,client,calls,errors,options,save,isOpen:()=>modalOpen};
}
const mutations = f=>f.calls.filter(c=>Array.isArray(c)&&['patch','billing'].includes(c[0]));
test('salva os dados e aprova antes de ativar; cobrança recebe o cadastro persistido',async()=>{
  const f=fixture();await f.save();
  assert.deepEqual(f.calls.filter(c=>typeof c==='string'),['confirm','approve','notify','close','refresh']);
  const writes=mutations(f);assert.deepEqual(writes.map(c=>c[0]),['patch','billing']);
  assert.equal(writes[0][1].status,'PENDENTE');
  assert.equal(writes[1][2].status,'ATIVO');assert.equal(writes[1][2].planAmount,350);assert.equal(writes[1][2].dueDay,5);assert.equal(writes[1][2].weeklyLessons,2);
  assert.equal(f.isOpen(),false);assert.equal(f.state.clientBillingActivationDraft,null);assert.deepEqual(f.errors,[]);
});
test('falha na gravação ou aprovação não ativa cobrança nem fecha a ficha',async()=>{
  for(const option of ['patchFailure','approveFailure']){
    const f=fixture({[option]:true});await f.save();
    assert.equal(mutations(f).some(c=>c[0]==='billing'),false);assert.equal(f.isOpen(),true);assert.ok(f.state.clientBillingActivationDraft);
    assert.equal(f.state.clientProfileSaving,false);assert.equal(f.fields.clientModalForm.inert,false);
  }
});
test('falha na ativação mantém ficha e permite retentar sem repetir aprovação ou aviso',async()=>{
  const f=fixture({billingFailure:true});await f.save();
  assert.equal(f.isOpen(),true);assert.match(f.fields.clientBillingActivationError.textContent,/Cadastro salvo, mas a ativação/);
  f.options.billingFailure=false;await f.save();
  assert.equal(f.isOpen(),false);assert.equal(f.calls.filter(c=>c==='approve').length,1);assert.equal(f.calls.filter(c=>c==='notify').length,1);
  assert.equal(mutations(f).filter(c=>c[0]==='patch').length,1);assert.equal(mutations(f).filter(c=>c[0]==='billing').length,2);
});
test('resposta sem confirmação não declara sucesso nem encerra a ficha',async()=>{
  const f=fixture({badResponse:true});await f.save();
  assert.equal(f.isOpen(),true);assert.equal(f.state.clientBillingActivationDraft.clientId,f.client.id);
  assert.match(f.fields.clientBillingActivationError.textContent,/servidor não confirmou/);
});
test('permissão, responsável financeiro, status, vencimento e confirmação continuam obrigatórios',async()=>{
  const cases=[fixture({noFinance:true}),fixture({dependent:true}),fixture({confirm:false}),fixture(),fixture()];
  cases[3].fields.clientEditStatus.value='PENDENTE';cases[4].fields.clientEditDueDay.value='';
  for(const f of cases){await f.save();assert.equal(mutations(f).length,0);assert.equal(f.isOpen(),true);}
});
test('selecionar método e preparar ou cancelar ativação não grava dados financeiros',()=>{
  const f=fixture();f.state.clientBillingActivationDraft=null;
  f.fields.clientMonthlyBillingMethod.value='CLUB_PIX';f.fields.clientMonthlyBillingMethod.change();
  f.ctx.toggleClientMonthlyBilling();assert.equal(f.state.clientBillingActivationDraft.billingMethod,'CLUB_PIX');
  f.fields.clientMonthlyBillingMethod.value='CASH';f.fields.clientMonthlyBillingMethod.change();
  assert.equal(f.state.clientBillingActivationDraft.billingMethod,'CASH');
  f.ctx.toggleClientMonthlyBilling();assert.equal(f.state.clientBillingActivationDraft,null);assert.equal(mutations(f).length,0);
  f.ctx.toggleClientMonthlyBilling();f.ctx.closeClientModal();assert.equal(f.state.clientBillingActivationDraft,null);
});
test('salvamento em andamento bloqueia reentrada, troca de ativação e fechamento',async()=>{
  const f=fixture();let release;
  f.ctx.patchClientFromAdmin=async()=>{await new Promise(resolve=>{release=resolve;});return {...f.client};};
  const saving=f.save();await f.save();f.ctx.toggleClientMonthlyBilling();f.ctx.closeClientModal();
  assert.equal(f.isOpen(),true);assert.ok(f.state.clientBillingActivationDraft);assert.equal(f.fields.clientModalForm.inert,true);
  release();await saving;assert.equal(f.calls.filter(c=>c==='confirm').length,1);
});
test('Novos alunos e Inadimplentes abrem ficha sem trocar a página do dashboard',async()=>{
  const calls=[];const ctx=vm.createContext({opsState:{},requireClubPermission:()=>{},loadOpsData:async()=>calls.push('read'),openClientModal:(id,tab)=>calls.push([id,tab]),openClientsModule:()=>{throw Error('Saiu do Início');}});
  vm.runInContext(fn('openDashboardClient'),ctx);
  await ctx.openDashboardClient('new',false);await ctx.openDashboardClient('overdue',true);
  assert.deepEqual(calls,['read',['new','Info'],'read',['overdue','Finance']]);
});
