import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const adm = fs.readFileSync(new URL('../adm/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const fn = (source, name) => source.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))[0];
function fixture() {
  const opsData = { clients: [{ id: 'payer', name: 'Leonardo', type: 'responsavel', planAmount: 0 }],
    familyMembers: [{ id: 'nina', fullName: 'Nina', billingResponsibleId: 'payer', studentId: 'student-nina', monthlyAmount: 350, status: 'ATIVO', responsibleConfirmationRequired: true },
      { id: 'joaquim', fullName: 'Joaquim', billingResponsibleId: 'payer', studentId: 'student-joaquim', monthlyAmount: 250, status: 'ATIVO', responsibleConfirmationRequired: true }],
    students: [{ id: 'student-joaquim', phone: '27999999999', weeklyLessons: 1 }, { id: 'student-nina', phone: '27999999999', weeklyLessons: 2 }], plans: [], planRequests: [] };
  const ctx = vm.createContext({ opsData, lessonState: { students: opsData.students },
    operationalStudentById: id => opsData.students.find(s => s.id === id) });
  for (const name of ['familyMemberById','familyClientById','activeFamilyLinkForClient','familyDirectoryClients','clubClientDirectory','findClientByKey','findLessonStudentForClient','familyContextForClient','familyMemberBillingAmount','billingAccountComposition','findClientRequest','findPlanByValue']) vm.runInContext(fn(adm, name), ctx);
  return { ctx, opsData };
}
test('membros pendentes de confirmação já aparecem como alunos com ficha própria', () => {
  const { ctx } = fixture();
  assert.equal(ctx.clubClientDirectory().length, 3);
  const nina = ctx.findClientByKey('family-member:nina');
  assert.equal(nina.name, 'Nina'); assert.equal(nina.planAmount, 350); assert.equal(nina.weeklyLessons, 2);
  assert.equal(ctx.billingAccountComposition(nina).total, 600);
});
test('irmãos com telefone compartilhado usam somente seu student_id', () => {
  const { ctx, opsData } = fixture();
  const nina = ctx.findClientByKey('family-member:nina');
  assert.equal(ctx.findLessonStudentForClient(nina).id, 'student-nina');
  opsData.students.pop();
  assert.equal(ctx.findLessonStudentForClient(nina), null);
});
test('membro com acesso ao app não duplica ficha; família é fonte do valor', () => {
  const { ctx, opsData } = fixture();
  opsData.familyMembers[0].memberClientId = 'nina-login';
  opsData.clients.push({ id: 'nina-login', name: 'Nina', planAmount: 999 });
  assert.equal(ctx.clubClientDirectory().length, 3);
  assert.equal(ctx.findClientByKey('nina-login').planAmount, 350);
  assert.equal(ctx.findPlanByValue(''), null);
  opsData.planRequests.push({ email: '', client: 'Outra pessoa' });
  assert.equal(ctx.findClientRequest(ctx.findClientByKey('family-member:joaquim')), undefined);
});
test('total atual de 600 é independente da fatura cancelada de 1000', () => {
  const ctx = vm.createContext({ familySummary: { is_billing_responsible: true, total_monthly_amount: 600,
    members: [{ full_name: 'Nina', monthly_amount: 350, status: 'ATIVO' }, { full_name: 'Joaquim', monthly_amount: 250, status: 'ATIVO' }] },
    client: { client_type: 'responsavel', plan_amount: 0 }, money: n => Number(n).toFixed(2), escapeHtml: String,
    invoicePixExpired: () => false, localDateString: () => '2026-10-06' });
  for (const name of ['hasCurrentFamilyAccount','currentFamilyAccountHtml','invoiceEffectiveStatus']) vm.runInContext(fn(app, name), ctx);
  const html = ctx.currentFamilyAccountHtml();
  assert.match(html, /600\.00/); assert.match(html, /350\.00/); assert.match(html, /250\.00/); assert.doesNotMatch(html, /1000/);
  assert.equal(ctx.invoiceEffectiveStatus({status:'ABERTA',provider_status:'CANCELLED',amount:1000}), 'CANCELADA');
  assert.match(fn(app,'renderPayments'), /invoice-cancelled-history/);
});
