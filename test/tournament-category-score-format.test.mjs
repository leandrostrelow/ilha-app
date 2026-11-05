import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const admin = fs.readFileSync(new URL('../adm/index.html', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../supabase/functions/tournament-admin-api/index.ts', import.meta.url), 'utf8');

test('category editor offers a super set of 8 games', () => {
  assert.match(admin, /id="categoryEditorScoreFormat"/);
  assert.match(admin, /value="SUPER_SET_8">Super set de 8 games/);
  assert.match(admin, /score_format: \$\('categoryEditorScoreFormat'\)\.value/);
});

test('match editor switches to one score pair for super set categories', () => {
  assert.match(admin, /function updateMatchEditorScoreFormat\(categoryId\)/);
  assert.match(admin, /categoryScoreFormat\(categoryId\) === 'SUPER_SET_8'/);
  assert.match(admin, /'Super set \(8\)'/);
  assert.match(admin, /\['editorSet2P1', 'editorSet2P2', 'editorTbP1', 'editorTbP2'\]/);
  assert.match(admin, /super set de 8 games\. Informe o placar no primeiro campo/);
});

test('admin API returns and preserves category score settings', () => {
  assert.match(api, /settings: firstObject\(row\.settings\)/);
  assert.match(api, /settings: \{ \.\.\.firstObject\(current\.settings\), \.\.\.firstObject\(input\.settings\) \}/);
});
