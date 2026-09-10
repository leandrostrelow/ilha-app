import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const migration = await readFile(
  path.join(projectRoot, 'supabase/migrations/20260910183812_sync_public_tournament_names_from_athletes.sql'),
  'utf8',
);

test('nome público acompanha alterações feitas no cadastro do atleta', () => {
  assert.match(migration, /after update of full_name on public\.tournament_athletes/i);
  assert.match(migration, /set public_name = new\.full_name/i);
  assert.match(migration, /where registration\.athlete_id = new\.id/i);
  assert.match(migration, /set public_name = athlete\.full_name[\s\S]*from public\.tournament_athletes as athlete/i);
});

test('sincronização permanece interna e não amplia a API pública', () => {
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /revoke all on function private\.sync_tournament_registration_public_name\(\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(migration, /grant execute/i);
});
