import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const [adminPage, adminApi, publicSnapshot] = await Promise.all([
  readFile(path.join(projectRoot, 'adm/index.html'), 'utf8'),
  readFile(path.join(projectRoot, 'supabase/functions/tournament-admin-api/index.ts'), 'utf8'),
  readFile(path.join(projectRoot, 'supabase/migrations/20260907161030_block_full_tournament_classes_and_warn_admins.sql'), 'utf8'),
]);

test('novas chaves nascem privadas e possuem publicação explícita no ADM', () => {
  assert.match(adminApi, /published: false/);
  assert.match(adminApi, /"setBracketPublication"/);
  assert.match(adminApi, /async function setBracketPublication/);
  assert.match(adminApi, /\.eq\("tournament_id", tournament\.id\)[\s\S]*\.eq\("category_id", categoryId\)/);
  assert.match(adminPage, /id="publishBracketBtn"/);
  assert.match(adminPage, /function toggleBracketPublication\(\)/);
  assert.match(adminPage, /Chave criada em modo privado/);
});

test('snapshot público continua expondo somente jogos publicados', () => {
  assert.match(publicSnapshot, /tournament_match\.published = true/);
});
