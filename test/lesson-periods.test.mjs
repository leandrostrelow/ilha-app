import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../adm/index.html', import.meta.url), 'utf8');
const start = html.indexOf('    function periodFromTime(');
const context = vm.createContext({});
vm.runInContext(html.slice(start, html.indexOf('    async function ', start)), context);

test('lesson periods classify noon and evening boundaries without losing late slots', () => {
  for (const [time, period] of [['06:00','manha'], ['11:59','manha'], ['12:00','tarde'], ['17:59','tarde'], ['18:00','noite'], ['21:00','noite'], ['22:00','noite']]) {
    assert.equal(context.periodFromTime(time), period);
  }
});

test('each court groups its displayed lessons by actual time, keeping slot actions', () => {
  const render = html.slice(html.indexOf('    function renderLessons('), html.indexOf('    function openLessonsModule('));
  assert.match(render, /lessonPeriodOrder\.map/);
  assert.match(render, /courtSlots\.filter\(function \(slot\) \{ return periodFromTime\(slot.time\) === period;/);
  assert.match(render, /periodSlots\.map\(renderSlot\)/);
  assert.match(render, /if \(!periodSlots.length\) return ''/);
  assert.match(render, /renderLessonVacantRows\(slot, students.length\)/);
});
