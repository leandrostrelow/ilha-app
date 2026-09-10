import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const adminHtml = await readFile(new URL('../adm/index.html', import.meta.url), 'utf8');

test('OBS fica desativado por padrão e pode ser ativado nas configurações do torneio', () => {
  assert.match(adminHtml, /id="tournamentObsEnabled"/);
  assert.match(adminHtml, /<option value="false">Desativada<\/option>/);
  assert.match(adminHtml, /<option value="true">Ativada<\/option>/);
  assert.match(adminHtml, /const obsEnabled = settings\.obs_enabled === true;/);
  assert.match(adminHtml, /syncTournamentObsVisibility\(\);/);
});

test('controles OBS ficam ocultos na edição do jogo enquanto o recurso estiver desligado', () => {
  assert.match(adminHtml, /id="tournamentObsControls" hidden/);
  assert.match(adminHtml, /\$\('tournamentObsControls'\)\.hidden = \$\('tournamentObsEnabled'\)\.value !== 'true';/);
  assert.match(adminHtml, /\$\('tournamentObsEnabled'\)\.addEventListener\('change', syncTournamentObsVisibility\);/);
  assert.match(adminHtml, /obs_enabled: \$\('tournamentObsEnabled'\)\.value === 'true'/);
});
