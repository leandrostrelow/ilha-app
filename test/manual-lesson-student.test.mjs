import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html=readFileSync(new URL('../adm/index.html',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20260923185936_manual_lesson_student.sql',import.meta.url),'utf8');
const start=html.indexOf('    async function addManualStudentToLessonSlotAction(');
const source=html.slice(start,html.indexOf('    function lessonStudentHasTimeConflict(',start));
function fixture({name='  Ana   Silva  ',full=false,denied=false,demo=false,fail=false}={}) {
  const calls=[],errors=[];
  const fields={lessonManualStudentSave:{disabled:false,textContent:'Adicionar nome à aula'},lessonManualStudentName:{value:name}};
  const state={students:[],enrollments:[]};
  const context=vm.createContext({$:id=>fields[id],lessonPlacementState:{slotId:'slot',saving:false},lessonState:state,
    requireLessonWriteAccess:()=>{if(denied)throw Error('denied');},lessonSlotById:()=>({id:'slot'}),lessonSlotCapacity:()=>4,
    lessonStudentsForSlot:()=>full?[1,2,3,4]:[],crypto:{randomUUID:()=> 'draft-id'},isAdminDemoMode:()=>demo,localId:()=> 'enrollment-id',
    supabaseRest:async(path,options)=>{calls.push({path,options});if(fail)throw Error('offline');return {student:{id:'draft-id',name:options.body.p_name,status:'ATIVO',app_client_id:null},enrollment:{id:'enrollment-id',student_id:'draft-id',slot_id:'slot',active:true}};},
    closeLessonStudentEditor:()=>{},renderLessons:()=>{},toast:()=>{},reportActionError:error=>errors.push(error.message)});
  vm.runInContext(source,context);
  return {context,calls,errors,state,fields,run:()=>context.addManualStudentToLessonSlotAction({preventDefault(){}})};
}
test('manual name uses atomic endpoint without app registration or billing',async()=>{
  const f=fixture();await f.run();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'rpc/add_manual_lesson_student');
  assert.equal(f.calls[0].options.body.p_name,'Ana Silva');assert.equal(f.calls[0].options.body.p_slot_id,'slot');
  assert.equal(f.state.students[0].appClientId,'');assert.equal(f.state.enrollments.length,1);
  assert.equal(f.fields.lessonManualStudentSave.disabled,false);
});
test('invalid names, full slots and unauthorized users make no request',async()=>{
  for(const options of [{name:' '},{name:'A'},{name:'A'.repeat(121)},{full:true},{denied:true}]){
    const f=fixture(options);await f.run();assert.equal(f.calls.length,0);assert.equal(f.errors.length,1);
  }
});
test('failed request retains retry id and does not add optimistic students',async()=>{
  const f=fixture({fail:true});await f.run();await f.run();
  assert.equal(f.calls.length,2);assert.equal(f.calls[0].options.body.p_student_id,f.calls[1].options.body.p_student_id);
  assert.equal(f.state.students.length,0);assert.equal(f.state.enrollments.length,0);assert.equal(f.context.lessonPlacementState.saving,false);
});
test('saving guard prevents duplicate requests and demo makes no network writes',async()=>{
  const f=fixture();f.context.lessonPlacementState.saving=true;await f.run();assert.equal(f.calls.length,0);
  const d=fixture({demo:true});await d.run();assert.equal(d.calls.length,0);assert.equal(d.state.enrollments.length,1);
});
test('manual endpoint retains RLS, permissions, row lock and null app linkage',()=>{
  assert.match(sql,/security invoker/);assert.match(sql,/has_club_permission\('classes'\)/);assert.match(sql,/auth.uid\(\) is null/);
  assert.match(sql,/where id=p_slot_id and active for update/);assert.match(sql,/from public,anon/);
  assert.doesNotMatch(sql,/insert into (?:public\.)?(?:app_clients|auth.users|financial)/i);
  assert.match(html,/lessonManualStudentForm'\)\.addEventListener\('submit', addManualStudentToLessonSlotAction\)/);
});
