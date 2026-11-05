import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const html=readFileSync(new URL('../adm/index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('    async function renameManualLessonStudentAction('),html.indexOf('    function lessonStudentHasTimeConflict('));
function setup(answer, linked=false, rows=[{name:'Novo Nome'}]) {
  const student={id:'s1',name:'Anterior',appClientId:linked?'client':''};
  const calls=[]; const errors=[];
  const c=vm.createContext({requireLessonWriteAccess(){},lessonPlacementState:{saving:false},lessonStudentById:()=>student,prompt:()=>answer,isAdminDemoMode:()=>false,
    supabaseRest:async(...args)=>{calls.push(args);return rows;},lessonState:{students:[student]},renderLessons(){},toast(){},reportActionError:e=>errors.push(e.message)});
  vm.runInContext(source,c);return {c,student,calls,errors};
}
test('rename saves only name and keeps same student identity',async()=>{
  const s=setup(' Novo   Nome ');await s.c.renameManualLessonStudentAction('s1');
  assert.equal(s.student.name,'Novo Nome');assert.equal(s.student.id,'s1');
  assert.equal(s.calls[0][0],'students?id=eq.s1&app_client_id=is.null&select=id,name');
  assert.equal(JSON.stringify(s.calls[0][1].body),' {"name":"Novo Nome"}'.trim());
});
test('cancel, blank and linked records do not write',async()=>{
  for(const [answer,linked] of [[null,false],[' ',false],['Novo Nome',true]]) {
    const s=setup(answer,linked);await s.c.renameManualLessonStudentAction('s1');assert.equal(s.calls.length,0);assert.equal(s.student.name,'Anterior');
  }
});
test('empty server response preserves old name; busy guard preserves lock',async()=>{
  const s=setup('Novo Nome',false,[]);await s.c.renameManualLessonStudentAction('s1');assert.equal(s.student.name,'Anterior');assert.equal(s.errors.length,1);
  s.c.lessonPlacementState.saving=true;await s.c.renameManualLessonStudentAction('s1');assert.equal(s.c.lessonPlacementState.saving,true);
});
