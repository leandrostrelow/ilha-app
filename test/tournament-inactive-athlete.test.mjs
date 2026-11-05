import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const apiSource = await readFile(
  new URL('../supabase/functions/tournament-admin-api/index.ts', import.meta.url),
  'utf8',
);
const adminSource = await readFile(new URL('../adm/index.html', import.meta.url), 'utf8');
const migrationSource = await readFile(
  new URL('../supabase/migrations/20260921121930_exclude_inactive_tournament_athletes.sql', import.meta.url),
  'utf8',
);

test('normal draw and group generation exclude inactive athletes', () => {
  const draw = apiSource.slice(
    apiSource.indexOf('async function generateBracket'),
    apiSource.indexOf('Deno.serve'),
  );

  assert.equal((draw.match(/tournament_athletes\(ranking,\s*seed,\s*status,\s*active\)/g) || []).length, 2);
  assert.equal((draw.match(/athlete\?\.active !== false/g) || []).length, 2);
  assert.equal((draw.match(/!== "INACTIVE"/g) || []).length, 2);
});

test('database rejects inactive athletes in newly inserted matches', () => {
  assert.match(migrationSource, /create or replace function private\.guard_active_tournament_match_athletes/);
  assert.match(migrationSource, /before insert on public\.tournament_matches/);
  assert.match(migrationSource, /athlete\.active is false/);
  assert.match(migrationSource, /Jogadores desativados não podem entrar em chaves ou grupos\./);
});

test('inactive athlete remains visible and is labelled as deactivated in admin', () => {
  assert.match(adminSource, /player\.status \|\| 'ATIVO'\) === 'INATIVO' \? 'DESATIVADO'/);
});
