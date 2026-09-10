import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const [adminPage, adminApi] = await Promise.all([
  readFile(path.join(projectRoot, 'adm/index.html'), 'utf8'),
  readFile(path.join(projectRoot, 'supabase/functions/tournament-admin-api/index.ts'), 'utf8'),
]);

test('snapshot administrativo extrai a disponibilidade já salva na inscrição', () => {
  assert.match(adminApi, /function registrationAvailabilityDays\(notes: unknown\)/);
  assert.match(adminApi, /disponibilidade:\\s\*\(\[\^\\n\.\]\*\)/);
  assert.match(adminApi, /\["MONDAY", "segunda"\]/);
  assert.match(adminApi, /dias_disponiveis: includeCapabilities \? registrationAvailabilityDays\(row\.notes\) : \[\]/);
});

test('lista de jogadores mostra os dias mesmo quando a Espacial não os repete', () => {
  assert.match(adminPage, /function playerAvailabilityDays\(playerId\)/);
  assert.match(adminPage, /playerRegistrations\(playerId\)\.forEach/);
  assert.match(adminPage, /Pode jogar: /);
  assert.match(adminPage, /Disponibilidade não informada/);
  assert.match(adminPage, /availabilityDaysLabel\(availabilityDays\)/);
});

test('filtro administrativo cobre os quatro dias opcionais e dados ausentes', () => {
  assert.match(adminPage, /id="playerAvailabilityFilter"/);
  for (const value of ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'MISSING']) {
    assert.match(adminPage, new RegExp(`<option value="${value}">`));
  }
  assert.match(adminPage, /availabilityFilter === 'MISSING'/);
  assert.match(adminPage, /availabilityDays\.indexOf\(availabilityFilter\) === -1/);
  assert.match(adminPage, /'playerAvailabilityFilter', 'playerGenderFilter'/);
});
