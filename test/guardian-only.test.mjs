import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const admin = fs.readFileSync(new URL('../adm/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function fn(source, name) {
  return source.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))[0];
}
test('responsável não herda aulas do plano nem corresponde ao filho pelo telefone', () => {
  const context = vm.createContext({ client: { client_type: 'responsavel', weekly_lessons: 2, official_plan_code: 'aulas_2x' } });
  vm.runInContext(fn(app, 'hasLessonPlan') + fn(admin, 'findLessonStudentForClient') + fn(admin, 'clientPlanDetails'), context);
  assert.equal(context.hasLessonPlan(), false);
  assert.equal(context.findLessonStudentForClient({ type: 'responsavel', phone: '27999999999' }), null);
  assert.equal(context.clientPlanDetails({ type: 'responsavel', weeklyLessons: 2 }).weeklyLessons, 0);
});
test('seleção de plano não altera implicitamente o papel de responsável', () => {
  const context = vm.createContext({});
  vm.runInContext(fn(admin, 'normalizedClientType') + fn(admin, 'clientTypeForPlan'), context);
  assert.equal(context.clientTypeForPlan({ type: 'aluno' }, 'responsavel'), 'responsavel');
  assert.equal(context.clientTypeForPlan({ type: 'aluno' }, 'cliente'), 'aluno');
});
test('reserva familiar inclui somente membros ativos e envia o id do filho', () => {
  const context = vm.createContext({ familySummary: { members: [{id:'a',status:'ATIVO'}, {id:'b',status:'PENDENTE'}, {id:'c',status:'INATIVO'}] } });
  vm.runInContext(fn(app, 'activeCourtFamilyMembers'), context);
  assert.equal(context.activeCourtFamilyMembers().length, 1);
  assert.match(app, /p_family_member_id: familyMember.id/);
  assert.match(app, /familyMember \? 'book_my_family_court' : 'book_my_app_court'/);
  assert.match(admin, /type: guardianOnly \? 'responsavel'/);
});
