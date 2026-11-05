import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../adm/index.html', import.meta.url), 'utf8');
const enrollmentMigration = readFileSync(new URL('../supabase/migrations/20260923204133_lesson_enrollment_configured_capacity.sql', import.meta.url), 'utf8');
const start = html.indexOf('    function lessonSlotCapacity(');
const context = vm.createContext({});
vm.runInContext(html.slice(start, html.indexOf('    function lessonDayName(', start)), context);

test('lesson capacity preserves larger classes and defaults to four', () => {
  for (const capacity of [1,4,5,6,10,20]) assert.equal(context.lessonSlotCapacity({capacity}), capacity);
  for (const capacity of [undefined,null,0,-1,2.5,'invalid']) assert.equal(context.lessonSlotCapacity({capacity}),4);
  assert.equal(context.lessonSlotCapacity({capacity:'6'}),6);
});

test('editor loads and saves capacity, preventing reductions below enrolled students', () => {
  assert.match(html, /id="lessonSlotEditorCapacity" type="number" min="1" step="1" value="4" required/);
  assert.match(html, /lessonSlotEditorCapacity'\)\.value = slot \? lessonSlotCapacity\(slot\) : 4/);
  assert.match(html, /capacity < lessonStudentsForSlot\(slotId\)\.length/);
  assert.match(html, /capacity: capacity,/);
  assert.doesNotMatch(html, /Math\.min\(4, Math\.max\(1/);
});

test('enrollment trigger respects configured capacity and retains locking and authorization', () => {
  assert.match(enrollmentMigration, /select capacity, day, time/);
  assert.doesNotMatch(enrollmentMigration, /least\(4|limite de 4/);
  assert.match(enrollmentMigration, /for update/);
  assert.match(enrollmentMigration, /security invoker/);
  assert.match(enrollmentMigration, /id is distinct from new.id/);
  assert.match(enrollmentMigration, /v_enrolled >= v_capacity/);
});
