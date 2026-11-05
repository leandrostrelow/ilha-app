import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../adm/index.html', import.meta.url), 'utf8');
const section = (name, next) => html.slice(html.indexOf('    function ' + name), html.indexOf('    function ' + next, html.indexOf('    function ' + name)));
const context = vm.createContext({escapeHtml: value => String(value)});
vm.runInContext(section('compareLessonCourts(', 'lessonSlotCapacity(') + section('lessonSelectOptions(', 'openLessonSlotEditor('), context);

test('lesson courts keep numbered tennis courts first and pickleball last', () => {
  const courts = ['Pickleball', 'Quadra 10', 'Quadra 2', 'Quadra 1'].map((name, i) => ({id: i, name}));
  assert.deepEqual(courts.slice().sort(context.compareLessonCourts).map(c => c.name), ['Quadra 1', 'Quadra 2', 'Quadra 10', 'Pickleball']);
  assert.equal(courts[0].name, 'Pickleball');
  for (const name of ['PICLEBALL', 'Quadra de Pickleball', 'Pickbol']) {
    assert.ok(context.compareLessonCourts({name}, {name: 'Quadra 2'}) > 0);
  }
});

test('lesson court selector preserves selected id and excludes inactive courts', () => {
  const courts = [{id:'pb',name:'Pickleball'}, {id:'q2',name:'Quadra 2'}, {id:'q1',name:'Quadra 1'}, {id:'old',name:'Quadra antiga',active:false}];
  const options = context.lessonSelectOptions(courts, 'pb', context.compareLessonCourts);
  assert.ok(options.indexOf('Quadra 1') < options.indexOf('Quadra 2'));
  assert.ok(options.indexOf('Quadra 2') < options.indexOf('Pickleball'));
  assert.match(options, /value="pb" selected/);
  assert.doesNotMatch(options, /Quadra antiga/);
  assert.equal(courts.length, 4);
});

test('all lesson court surfaces use the same order including the fallback grid', () => {
  assert.equal((html.match(/lessonState\.courts\.filter[^\n]+sort\(compareLessonCourts\)/g) || []).length, 5);
  assert.match(section('renderLessons(', 'openLessonsModule('), /const fallbackCourts =[\s\S]*?\}\)\.sort\(compareLessonCourts\)/);
  assert.match(section('openLessonSlotEditor(', 'closeLessonSlotEditor('), /lessonSelectOptions\(lessonState\.courts,[^\n]+compareLessonCourts\)/);
});
