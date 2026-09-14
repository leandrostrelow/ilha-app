import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const adminPage = await readFile(path.join(projectRoot, 'adm/index.html'), 'utf8');

test('ADM destaca a observação enviada pelo atleta na inscrição', () => {
  assert.match(adminPage, /function registrationAthleteNote\(registration\)/);
  assert.match(adminPage, /Observação da inscrição:/);
  assert.match(adminPage, /id="playerRegistrationNoteField" hidden/);
  assert.match(adminPage, /id="playerRegistrationNote"/);
  assert.match(adminPage, /Texto original informado pelo atleta/);
});

test('mensagem de confirmação usa a página oficial do torneio', () => {
  assert.match(adminPage, /const tournamentUrl = \(state\.data\.torneio && state\.data\.torneio\.public_url\)/);
  assert.match(adminPage, /aplicativo oficial do torneio/);
  assert.match(adminPage, /'https:\/\/app\.ilhatenis\.com\/torneios\/'/);
});

test('mensagem inclui hora exata e omite o marcador Após', () => {
  assert.match(adminPage, /function whatsappSchedulePhrase\(dayValue, timeValue\)/);
  assert.match(adminPage, /const hasExactTime = \/\^\\d\{2\}:\\d\{2\}\$\//);
  assert.match(adminPage, /hasExactTime \? ', às ' \+ time : ''/);
  assert.match(adminPage, /opponent \+ schedulePhrase \+ '\.'/);
});
