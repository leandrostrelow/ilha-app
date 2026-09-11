import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const [adminPage, adminApi] = await Promise.all([
  readFile(path.join(projectRoot, 'adm/index.html'), 'utf8'),
  readFile(path.join(projectRoot, 'supabase/functions/tournament-admin-api/index.ts'), 'utf8'),
]);

test('alterações rápidas são enfileiradas e a agenda do editor salva automaticamente', () => {
  assert.match(adminPage, /saveQueue: Promise\.resolve\(\)/);
  assert.match(adminPage, /state\.saveQueue\.then\(execute, execute\)/);
  assert.doesNotMatch(adminPage, /Aguarde a operação atual terminar\./);
  assert.match(adminPage, /function scheduleEditorAgendaAutoSave\(\)/);
  assert.match(adminPage, /action: 'scheduleMatch'/);
  assert.match(adminPage, /id="editorAgendaSaveStatus" aria-live="polite"/);
  assert.match(adminPage, /\$\('editorTime'\)\.addEventListener\('input', scheduleEditorAgendaAutoSave\)/);
});

test('abrir jogo pela agenda preserva os atletas da própria classe ao editar o horário', () => {
  const playerOptions = adminPage.slice(
    adminPage.indexOf('function playerOptions'),
    adminPage.indexOf('function dayOptions'),
  );
  const editor = adminPage.slice(
    adminPage.indexOf('function openMatchEditor'),
    adminPage.indexOf('function fillEditorScoreFields'),
  );
  const schedulePayload = adminPage.slice(
    adminPage.indexOf('function editorAgendaPayload'),
    adminPage.indexOf('function agendaEditorSignature'),
  );
  const swapMatches = adminPage.slice(
    adminPage.indexOf('function buildSwapMatches'),
    adminPage.indexOf('function assertNoSameRoundDuplicates'),
  );
  const currentMatches = adminPage.slice(
    adminPage.indexOf('function currentMatches'),
    adminPage.indexOf('function playerRegistrations'),
  );
  const backendSchedule = adminApi.slice(
    adminApi.indexOf('async function updateMatchFields'),
    adminApi.indexOf('async function saveAgendaEvent'),
  );

  assert.match(playerOptions, /function playerOptions\(selected, categoryId\)/);
  assert.match(playerOptions, /effectiveCategoryId = categoryId \|\| state\.selectedCategory/);
  assert.match(playerOptions, /String\(insc\.categoria_id\) === String\(effectiveCategoryId\)/);
  assert.match(playerOptions, /categoryPlayers\.unshift\(selectedPlayer\)/);
  assert.match(editor, /playerOptions\(match\.jogador1_id, match\.categoria_id\)/);
  assert.match(editor, /playerOptions\(match\.jogador2_id, match\.categoria_id\)/);
  assert.match(swapMatches, /currentMatches\(original\.categoria_id\)/);
  assert.match(currentMatches, /function currentMatches\(categoryId\)/);
  assert.match(currentMatches, /effectiveCategoryId = categoryId \|\| state\.selectedCategory/);
  assert.match(adminPage, /title="Abrir jogo e editar horário"/);
  assert.doesNotMatch(schedulePayload, /jogador1_id|jogador2_id/);
  assert.doesNotMatch(backendSchedule.slice(0, backendSchedule.indexOf('} else {')), /side1_athlete_id|side2_athlete_id/);
});

test('agenda usa arrastar e soltar com suporte a mouse, toque e teclado', () => {
  assert.match(adminPage, /data-agenda-drag-handle=/);
  assert.match(adminPage, /document\.addEventListener\('dragstart'/);
  assert.match(adminPage, /document\.addEventListener\('drop'/);
  assert.match(adminPage, /document\.addEventListener\('pointermove'/);
  assert.match(adminPage, /\['ArrowUp', 'ArrowDown'\]/);
  assert.match(adminPage, /function reorderAgendaItem\(sourceKey, targetKey, placement\)/);
  assert.doesNotMatch(adminPage, /data-agenda-move(?:-item)?=/);
});

test('ordenação considera toda a coluna, mesmo quando existe filtro de classe', () => {
  const reorderBlock = adminPage.slice(
    adminPage.indexOf('function agendaGroupForItem'),
    adminPage.indexOf('async function generateBracket'),
  );
  assert.match(reorderBlock, /String\(entry\.data \|\| ''\) === day/);
  assert.match(reorderBlock, /String\(entry\.quadra \|\| 'Sem quadra'\) === court/);
  assert.doesNotMatch(reorderBlock, /agendaCategoryFilter/);
});

test('chave administrativa exibe a agenda compacta do jogo', () => {
  assert.match(adminPage, /class="draw-match-schedule"/);
  assert.match(adminPage, /function bracketMatchScheduleLabel\(match\)/);
  assert.match(adminPage, /scheduled has-schedule/);
  assert.doesNotMatch(adminPage, /Quinta - Feriado/);
});

test('horário relativo Após é preservado fora da coluna SQL time', () => {
  assert.match(adminApi, /metadata\.legacy_time = "Após"/);
  assert.match(adminApi, /delete metadata\.legacy_time/);
  assert.match(adminApi, /text\(metadata\.legacy_time, 20\)/);
  assert.match(adminApi, /if \(rawEventTime && !eventTime\) throw new ApiError\("Horário do evento inválido\."\)/);
});

test('quantidade de quadras é editável sem exclusão de dados', () => {
  assert.match(adminPage, /id="tournamentCourtCount" type="number" min="1" max="12"/);
  assert.match(adminPage, /Eles não serão apagados, mas você deverá remanejá-los/);
  assert.match(adminApi, /async function syncTournamentCourtCount/);
  assert.match(adminApi, /update\(\{ active: false/);
  assert.doesNotMatch(adminApi, /from\("tournament_courts"\)\.delete/);
});
