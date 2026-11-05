import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const html=readFileSync(new URL('../adm/index.html',import.meta.url),'utf8');
const c=vm.createContext({escapeHtml:String});
vm.runInContext(html.slice(html.indexOf('    function lessonSlotCapacity('),html.indexOf('    function lessonDayName(')),c);
test('four visible positions whether a lesson is empty, partial or full',()=>{
 for(let count=0;count<=4;count++){
  const result=c.renderLessonVacantRows({id:'slot',time:'08:00',capacity:4},count);
  assert.equal((result.match(/<button/g)||[]).length,4-count);
  assert.equal((result.match(/data-add-student-slot="slot"/g)||[]).length,4-count);
 }
});
test('extra configured seats remain available and smaller classes do not gain capacity',()=>{
 assert.equal((c.renderLessonVacantRows({id:'s',capacity:6},4).match(/<button/g)||[]).length,2);
 const small=c.renderLessonVacantRows({id:'s',capacity:2},1);
 assert.equal((small.match(/<button/g)||[]).length,1);
 assert.equal((small.match(/lesson-seat-unused/g)||[]).length,2);
});
