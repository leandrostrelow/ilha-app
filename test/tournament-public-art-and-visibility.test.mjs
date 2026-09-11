import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const [adminPage, publicPage, adminApi, background, relativeTimeMigration] = await Promise.all([
  readFile(path.join(projectRoot, 'adm/index.html'), 'utf8'),
  readFile(path.join(projectRoot, 'torneios/index.html'), 'utf8'),
  readFile(path.join(projectRoot, 'supabase/functions/tournament-admin-api/index.ts'), 'utf8'),
  readFile(path.join(projectRoot, 'fundo-chave-instagram.png')),
  readFile(path.join(projectRoot, 'supabase/migrations/20260910191716_expose_public_tournament_relative_time.sql'), 'utf8'),
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

test('página pública prioriza as duas classes espaciais e comunica as chaves pendentes', () => {
  const categories = sourceSection(publicPage, 'function publicDrawCategories()', '\n    function categoryName');
  const brackets = sourceSection(publicPage, 'function bracketsHtml()', '\n    function bracketBoardHtml');
  const schedule = sourceSection(publicPage, 'function scheduleHtml()', '\n    function scoreText');
  assert.match(categories, /'ESP-A-M': 0, 'ESP-B-M': 1/);
  assert.match(categories, /a\.index - b\.index/);
  assert.match(brackets, /Aviso: as chaves das demais classes serão publicadas em breve\./);
  assert.match(publicPage, /\.public-update-notice/);
  assert.doesNotMatch(brackets, /Selecione a classe e acompanhe o caminho até a final\./);
  assert.doesNotMatch(schedule, /Somente os dias que já possuem jogos publicados\./);
});

test('Sobre o evento abre primeiro e funciona como início da página pública', () => {
  const labels = sourceSection(publicPage, 'const PUBLIC_TAB_LABELS', '\n    let turnstileScriptPromise');
  const renderer = sourceSection(publicPage, 'function renderTournament()', '\n    function renderRegistrationOnly');
  const tabSwitch = sourceSection(publicPage, 'function showTab(tab)', '\n    function formatPhone');
  assert.ok(labels.indexOf("about: 'Sobre o evento'") < labels.indexOf("categories: 'Classes'"));
  assert.match(renderer, /visibleTabs\.includes\('about'\) \? 'about'/);
  assert.match(tabSwitch, /tab === 'about'/);
});

test('Ilha Bet aparece antes de Sobre o evento e convida sem insistência', () => {
  const labels = sourceSection(publicPage, 'const PUBLIC_TAB_LABELS', '\n    let turnstileScriptPromise');
  const loader = sourceSection(publicPage, 'async function getBetCampaign', '\n    async function getRegistrationInviteInfo');
  const invite = sourceSection(publicPage, 'function tournamentBetInviteStorageKey', '\n    function initTournamentPwa');
  assert.ok(labels.indexOf("bet: 'Ilha Bet'") < labels.indexOf("about: 'Sobre o evento'"));
  assert.match(publicPage, /<h2>Ilha Bet<\/h2>/);
  assert.match(publicPage, /\/bet\?torneio=/);
  assert.match(loader, /payload && payload\.data \? payload\.data : payload/);
  assert.match(publicPage, /72 \* 60 \* 60 \* 1000/);
  assert.match(invite, /palpite-ilha:access:/);
  assert.match(invite, /accepting_predictions !== true/);
  assert.match(invite, /registrationModal[\s\S]*tournamentPwaOnboarding[\s\S]*tournamentIntro/);
  assert.match(publicPage, /Sem aposta e sem pagamento/);
});

test('chave pública empilha as duas metades sem rolagem lateral', () => {
  const bracketStyles = sourceSection(publicPage, '.bracket-scroller', '\n    .agenda-list');
  const bracketRenderer = sourceSection(publicPage, 'function bracketBoardHtml', '\n    function matchCardHtml');
  assert.match(bracketStyles, /\.bracket-scroller \{[^}]*overflow: visible/);
  assert.match(bracketStyles, /\.bracket-board \{[^}]*min-width: 0;[^}]*display: grid/);
  assert.doesNotMatch(bracketStyles, /overflow-x:\s*auto|min-width:\s*max-content/);
  assert.match(bracketRenderer, /bracket-upper/);
  assert.match(bracketRenderer, /bracket-final-stage/);
  assert.match(bracketRenderer, /bracket-lower/);
  assert.match(bracketRenderer, /branchRounds\.slice\(\)\.reverse\(\)/);
  assert.match(bracketRenderer, /bracketStageHtml\(round\.label,round\.upper,round\.depth,branchRounds\.length\)/);
  assert.match(bracketRenderer, /bracketStageHtml\(round\.label,round\.lower,round\.depth,branchRounds\.length\)/);
  assert.match(bracketRenderer, /const phaseLevel = Math\.max\(1,Math\.min\(3,4 - \(Number\(totalDepth \|\| 1\) - Number\(depth \|\| 0\)\)\)\)/);
  assert.match(bracketRenderer, /data-bracket-phase=/);
  assert.match(bracketStyles, /\.bracket-stage\.phase-1/);
  assert.match(bracketStyles, /\.bracket-stage\.phase-2/);
  assert.match(bracketStyles, /\.bracket-stage\.phase-3/);
  assert.match(bracketStyles, /border: 2px solid #00ef2a/);
});

test('chave pública mostra BYE nas folgas da primeira rodada como o ADM', () => {
  const playerLabel = sourceSection(publicPage, 'function playerName(match, slot)', '\n    function matchCategoryId');
  assert.match(playerLabel, /roundNumber\(match\) <= 1 \? 'BYE' : 'A definir'/);
});

test('agenda pública exibe somente dias e classes que possuem jogos', () => {
  const schedule = sourceSection(publicPage, 'function scheduledGameRows()', '\n    function agendaMatchHtml');
  assert.match(schedule, /!isFinalized\(row\) && scheduleDayKey\(row\)/);
  assert.match(schedule, /const gameDays = new Set\(gameRows\.map\(scheduleDayKey\)\)/);
  assert.match(schedule, /events\(\)\.filter\(\(row\) => gameDays\.has\(scheduleDayKey\(row\)\)\)/);
  assert.match(schedule, /agendaCategories\(\)\.map/);
  assert.match(schedule, /function agendaDayGroupHtml\(rows\)/);
  assert.match(schedule, /class="agenda-day-group"/);
  assert.match(schedule, /class="agenda-court-group"/);
  assert.match(publicPage, /function scheduleOrderValue\(row\)/);
  assert.match(publicPage, /field\(row,'sort_order','ordem','order'\)/);
  assert.match(schedule, /items\.sort\(scheduleOrderSort\)/);
  assert.doesNotMatch(schedule, /<span>Dia<\/span>/);
});

test('agenda pública preserva o horário relativo Após em cartões compactos', () => {
  const styles = sourceSection(publicPage, '.agenda-list', '\n    .sponsor-grid');
  const renderer = sourceSection(publicPage, 'function agendaDayLabel', '\n    function scoreText');
  assert.match(renderer, /function publicScheduleTime\(row\)/);
  assert.match(renderer, /field\(row,'time_label','schedule_time_label'\)/);
  assert.match(renderer, /startsWith\('apos'\) \? 'Após'/);
  assert.match(renderer, /escapeHtml\(publicScheduleTime\(row\)\)/);
  assert.match(styles, /\.agenda-card\.grouped \{[^}]*min-height: 68px;[^}]*grid-template-columns: 78px minmax\(0,1fr\)/);
  assert.match(styles, /\.agenda-card\.grouped \.time-box \{[^}]*border-radius: 999px;[^}]*background: var\(--lime\)/);
  assert.match(styles, /\.agenda-court-title \{[^}]*background: var\(--lime\);[^}]*color: #284600/);
  assert.match(styles, /\.agenda-card\.grouped \.time-box strong \{[^}]*font-size: 12px/);
});

test('app instalado permite puxar a página pública para atualizar', () => {
  assert.match(publicPage, /id="tournamentPullRefresh"/);
  assert.match(publicPage, /function initTournamentPullToRefresh\(\)/);
  assert.match(publicPage, /if \(!tournamentAppInstalled\(\)/);
  assert.match(publicPage, /addEventListener\('touchmove',handleTournamentPullMove,\{passive:false\}\)/);
  assert.match(publicPage, /distanceY >= 70/);
  assert.match(publicPage, /serviceWorker\.getRegistration\('\/torneios\/'\)/);
  assert.match(publicPage, /window\.location\.reload\(\)/);
});

test('snapshot público expõe somente o rótulo seguro do horário relativo', () => {
  assert.match(relativeTimeMigration, /replacement_fragment text := E'[\s\S]*\\'time_label\\', case/);
  assert.match(relativeTimeMigration, /tournament_match\.metadata ->> \\'legacy_time\\'/);
  assert.match(relativeTimeMigration, /in \(\\'após\\', \\'apos\\'\) then \\'Após\\'/);
  assert.match(relativeTimeMigration, /revoke all on function private\.tournament_public_snapshot_legacy_unsafe\(text\)/);
  assert.match(relativeTimeMigration, /set local lock_timeout = '5s'/);
  assert.doesNotMatch(relativeTimeMigration, /'metadata', tournament_match\.metadata/);
});

test('arte da agenda prioriza os nomes e reduz o destaque do horário', () => {
  const poster = sourceSection(adminPage, 'function drawAgendaPosterCard', '\n    function posterDayName');
  assert.match(poster, /const nameSize = compact \? 18 : 24/);
  assert.match(poster, /const timeWidth = compact \? 72 : 78/);
  assert.match(poster, /shortName\(player1, 30\)/);
  assert.match(poster, /'× ' \+ shortName\(player2, 30\)/);
  assert.match(poster, /maxRows <= 3 \? 112/);
});
