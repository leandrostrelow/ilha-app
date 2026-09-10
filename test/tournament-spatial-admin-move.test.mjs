import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const [adminPage, adminApi, migration] = await Promise.all([
  readFile(path.join(projectRoot, 'adm/index.html'), 'utf8'),
  readFile(path.join(projectRoot, 'supabase/functions/tournament-admin-api/index.ts'), 'utf8'),
  readFile(path.join(projectRoot, 'supabase/migrations/20260910111657_allow_spatial_registration_category_moves.sql'), 'utf8'),
]);

test('ADM permite escolher a inscrição exata de atleta com várias classes', () => {
  assert.match(adminPage, /id="playerRegistrationField" hidden/);
  assert.match(adminPage, /id="playerRegistration"/);
  assert.match(adminPage, /function populatePlayerRegistrationEditor\(playerId, requestedRegistrationId\)/);
  assert.match(adminPage, /function selectPlayerRegistrationForEdit\(registrationId\)/);
  assert.match(adminPage, /data-edit-player-registration=/);
  assert.match(adminPage, /editPlayerRegistrationBtn\.dataset\.editPlayerRegistration/);
});

test('troca preserva o registro e impede escolher uma classe já ocupada pelo atleta', () => {
  assert.match(adminPage, /String\(registration\.inscricao_id\) !== String\(registrationId\)/);
  assert.match(adminPage, /occupied\.has\(id\) \? ' disabled' : ''/);
  assert.match(adminPage, /const spatialCodes = new Set\(\['ESP-A-M', 'ESP-B-M'\]\)/);
  assert.match(adminPage, /A mesma inscrição e a situação do pagamento serão mantidas/);
  assert.match(adminApi, /Este atleta já possui uma inscrição ativa na classe escolhida\./);
});

test('convite Espacial usado acompanha a categoria quando a inscrição é movida', () => {
  assert.match(migration, /drop constraint if exists tournament_spatial_courtesy_invites_used_scope_fk/);
  assert.match(migration, /foreign key \(used_registration_id, tournament_id, athlete_id, target_category_id\)/);
  assert.match(migration, /on update cascade/);
  assert.match(migration, /on delete restrict/);
  assert.match(migration, /commit;\s*$/);
});
