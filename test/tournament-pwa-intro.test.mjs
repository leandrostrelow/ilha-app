import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { projectRoot } from '../scripts/project-files.mjs';

const migrationName = '20260911002123_add_tournament_intro_video.sql';
const [adminPage, publicPage, serviceWorker, migration, introVideo, server] = await Promise.all([
  readFile(path.join(projectRoot, 'adm', 'index.html'), 'utf8'),
  readFile(path.join(projectRoot, 'torneios', 'index.html'), 'utf8'),
  readFile(path.join(projectRoot, 'torneios', 'service-worker.js'), 'utf8'),
  readFile(path.join(projectRoot, 'supabase', 'migrations', migrationName), 'utf8'),
  readFile(path.join(projectRoot, 'assets', 'tournament', 'ilha-open-intro.mp4')),
  readFile(path.join(projectRoot, 'scripts', 'serve.mjs'), 'utf8'),
]);

function sourceSection(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `trecho inicial ausente: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `trecho final ausente: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('vídeo padrão é MP4 compacto e entra no cache do app', () => {
  assert.ok(introVideo.subarray(0, 32).includes(Buffer.from('ftyp')), 'arquivo não parece ser MP4');
  assert.ok(introVideo.length < 3 * 1024 * 1024, 'vídeo padrão deve permanecer leve para celular');
  assert.match(serviceWorker, /ilha-open-2026-v3/);
  assert.match(serviceWorker, /\/assets\/tournament\/ilha-open-intro\.mp4/);
  assert.match(server, /\['\.mp4', 'video\/mp4'\]/);
});

test('configurações permitem ativar, trocar, visualizar e remover a intro', () => {
  assert.match(adminPage, /id="tournamentIntroVideoEnabled"/);
  assert.match(adminPage, /id="tournamentIntroVideoFile" type="file" accept="video\/mp4/);
  assert.match(adminPage, /id="tournamentIntroVideoPreview"/);
  assert.match(adminPage, /id="tournamentIntroVideoRemoveBtn"/);
  assert.match(adminPage, /file\.size > 15 \* 1024 \* 1024/);
  assert.match(adminPage, /duration > 15/);
  assert.match(adminPage, /URL\.revokeObjectURL\(objectUrl\)/);
  assert.match(adminPage, /'Content-Type'\] = 'video\/mp4'/);
  assert.match(adminPage, /intro_video: \{/);
  assert.match(adminPage, /uploadTournamentIntroVideo\(file\)/);
  assert.match(adminPage, /enabled: \$\('tournamentIntroVideoEnabled'\)\.value === 'true'/);
});

test('intro aparece a cada abertura somente no app instalado e nunca bloqueia a página', () => {
  const loader = sourceSection(publicPage, 'async function loadPage()', '\n    function renderError');
  const intro = sourceSection(publicPage, 'function maybeShowTournamentIntro()', '\n    function tournamentUsesIos');
  assert.match(loader, /renderTournament\(\);[\s\S]*await maybeShowTournamentIntro\(\);[\s\S]*maybeShowTournamentPwaOnboarding/);
  assert.match(intro, /!tournamentAppInstalled\(\)/);
  assert.match(intro, /config\.enabled !== true/);
  assert.match(intro, /video\.muted = true/);
  assert.match(intro, /video\.addEventListener\('ended',onEnded/);
  assert.match(intro, /video\.addEventListener\('error',onError/);
  assert.match(intro, /skip\.addEventListener\('click',onSkip/);
  assert.match(intro, /removeListeners\(\)/);
  assert.match(intro, /setTimeout\(\(\) => finish\('timeout'\),15000\)/);
  assert.match(publicPage, /id="tournamentIntroSkipBtn"[^>]*>Pular intro<\/button>/);
  assert.doesNotMatch(intro, /localStorage|prompt-seen/);
});

test('puxar para atualizar não repete a intro na mesma atualização', () => {
  const refresh = sourceSection(publicPage, 'async function refreshTournamentFromPull()', '\n    function handleTournamentPullEnd');
  assert.match(publicPage, /const TOURNAMENT_INTRO_SKIP_ONCE_KEY/);
  assert.match(publicPage, /function consumeTournamentIntroSkipOnce\(\)/);
  assert.match(refresh, /skipTournamentIntroOnce\(\)/);
  assert.match(refresh, /window\.location\.reload\(\)/);
});

test('migração libera MP4 com limite controlado e expõe somente a configuração pública', () => {
  assert.match(migration, /array\['image\/png', 'video\/mp4'\]/);
  assert.match(migration, /15728640/);
  assert.match(migration, /'intro_video', stored_settings -> 'intro_video'/);
  assert.match(migration, /'enabled', true/);
  assert.match(migration, /'url', '\/assets\/tournament\/ilha-open-intro\.mp4'/);
  assert.match(migration, /revoke all on function public\.tournament_public_snapshot\(text\)/);
  assert.match(migration, /grant execute on function public\.tournament_public_snapshot\(text\)[\s\S]*to anon, authenticated, service_role/);
});
