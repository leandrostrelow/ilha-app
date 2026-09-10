import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const [adminPage, publicPage, adminApi, background] = await Promise.all([
  readFile(path.join(projectRoot, 'adm/index.html'), 'utf8'),
  readFile(path.join(projectRoot, 'torneios/index.html'), 'utf8'),
  readFile(path.join(projectRoot, 'supabase/functions/tournament-admin-api/index.ts'), 'utf8'),
  readFile(path.join(projectRoot, 'fundo-chave-instagram.png')),
]);

function sourceSection(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `trecho inicial ausente: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `trecho final ausente: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('nova arte vertical é o fundo padrão das publicações', () => {
  assert.equal(background.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(background.readUInt32BE(16), 1080);
  assert.equal(background.readUInt32BE(20), 1920);
  assert.match(adminPage, /return String\(configured \|\| ''\)\.trim\(\) \|\| '\/fundo-chave-instagram\.png'/);
});

test('artes usam a paleta verde da identidade espacial', () => {
  const posters = sourceSection(adminPage, 'function drawResultsPoster', '\n    function drawCoverImage');
  assert.match(posters, /dark: '#00a82c'/);
  assert.match(posters, /dark2: '#00ef2a'/);
  assert.match(posters, /connector: hasBackground \? 'rgba\(0, 239, 42, \.42\)'/);
  assert.doesNotMatch(posters, /#003f86|#005bbb|#08264a|#315a87|#b7d2f5|#eaf3ff/);
});

test('configurações permitem enviar, visualizar e restaurar o fundo das artes', () => {
  assert.match(adminPage, /id="tournamentArtBackgroundFile" type="file" accept="image\/png/);
  assert.match(adminPage, /id="tournamentArtBackgroundPreview"/);
  assert.match(adminPage, /id="tournamentArtBackgroundResetBtn"/);
  assert.match(adminPage, /uploadTournamentBrandingImage\(file, 'fundo-artes'\)/);
  assert.match(adminPage, /art_background_url: \$\('tournamentArtBackgroundUrl'\)\.value\.trim\(\)/);
  assert.match(adminApi, /art_background_url: artBackgroundUrl/);
  assert.match(adminApi, /requestedSettings\.art_background_url \?\? currentSettings\.art_background_url/);
});

test('página pública mostra classes somente quando a chave existe', () => {
  assert.match(publicPage, /function publicDrawCategoryIds\(\)/);
  assert.match(publicPage, /function publicDrawCategories\(\)/);
  const classes = sourceSection(publicPage, 'function categoriesHtml()', '\n    function registrationAthlete');
  const brackets = sourceSection(publicPage, 'function bracketsHtml()', '\n    function bracketBoardHtml');
  const registrations = sourceSection(publicPage, 'function registrationsHtml()', '\n    function registrationRowsHtml');
  assert.match(classes, /publicDrawCategories\(\)/);
  assert.match(brackets, /publicDrawCategories\(\)/);
  assert.match(registrations, /publicDrawCategories\(\)/);
  assert.match(publicPage, /if \(!ids\.some\(\(id\) => visibleCategoryIds\.has\(id\)\)\) return false/);
});

test('agenda pública exibe somente dias e classes que possuem jogos', () => {
  const schedule = sourceSection(publicPage, 'function scheduledGameRows()', '\n    function agendaMatchHtml');
  assert.match(schedule, /!isFinalized\(row\) && scheduleDayKey\(row\)/);
  assert.match(schedule, /const gameDays = new Set\(gameRows\.map\(scheduleDayKey\)\)/);
  assert.match(schedule, /events\(\)\.filter\(\(row\) => gameDays\.has\(scheduleDayKey\(row\)\)\)/);
  assert.match(schedule, /agendaCategories\(\)\.map/);
});
