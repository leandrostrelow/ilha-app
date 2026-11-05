import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../adm/index.html', import.meta.url), 'utf8');

test('ADM deixa classes em andamento em ordem numérica e finalizadas no fim', () => {
  const start = source.indexOf('function renderCategoryStrip()');
  const end = source.indexOf('\n    function isCategoryFinalized', start);
  const section = source.slice(start, end);

  assert.match(section, /state\.data\.categorias\.slice\(\)\.sort/);
  assert.match(section, /Number\(aFinished\) - Number\(bFinished\)/);
  assert.match(section, /aNumber - bNumber/);
  assert.match(section, /localeCompare\(bName, 'pt-BR', \{ numeric: true \}\)/);
  assert.match(section, /orderedCategories\.map/);
});
