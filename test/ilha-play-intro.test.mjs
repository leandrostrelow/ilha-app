import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { projectRoot } from '../scripts/project-files.mjs';

const migrationName = '20260911130316_add_ilha_play_intro_video.sql';
const [clientPage, adminPage, serviceWorker, appVersion, migration, introVideo, server] = await Promise.all([
  readFile(path.join(projectRoot, 'index.html'), 'utf8'),
  readFile(path.join(projectRoot, 'adm', 'index.html'), 'utf8'),
  readFile(path.join(projectRoot, 'service-worker.js'), 'utf8'),
  readFile(path.join(projectRoot, 'app-version.json'), 'utf8'),
  readFile(path.join(projectRoot, 'supabase', 'migrations', migrationName), 'utf8'),
  readFile(path.join(projectRoot, 'assets', 'app', 'ilha-play-intro.mp4')),
  readFile(path.join(projectRoot, 'scripts', 'serve.mjs'), 'utf8'),
]);

function sourceSection(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `trecho inicial ausente: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `trecho final ausente: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('vídeo padrão do Ilha Play é um MP4 leve e entra no cache do app', () => {
  assert.ok(introVideo.subarray(0, 32).includes(Buffer.from('ftyp')), 'arquivo não parece ser MP4');
  assert.ok(introVideo.length < 4 * 1024 * 1024, 'vídeo padrão deve permanecer leve para celular');
  assert.match(serviceWorker, /ilha-play-v242-agenda-match-editor/);
  assert.match(serviceWorker, /\/assets\/app\/ilha-play-intro\.mp4/);
  assert.match(server, /\['\.mp4', 'video\/mp4'\]/);
  assert.match(appVersion, /2026-09-11/);
});

test('ADM possui módulo próprio para ativar, trocar, visualizar e remover a abertura', () => {
  assert.match(adminPage, /data-admin-nav="club-settings"/);
  assert.match(adminPage, /id="appSettingsModule"/);
  assert.match(adminPage, /id="appIntroVideoEnabled"/);
  assert.match(adminPage, /id="appIntroVideoFile" type="file" accept="video\/mp4/);
  assert.match(adminPage, /id="appIntroVideoPreview"/);
  assert.match(adminPage, /id="appIntroVideoSaveBtn"/);
  assert.match(adminPage, /id="appIntroVideoRemoveBtn"/);
  assert.match(adminPage, /file\.size > 15 \* 1024 \* 1024/);
  assert.match(adminPage, /duration > 15/);
  assert.match(adminPage, /\/storage\/v1\/object\/app-branding\//);
  assert.match(adminPage, /\/storage\/v1\/object\/public\/app-branding\//);
  assert.match(adminPage, /key: 'settings', label: 'Configurações do app'/);
  assert.match(adminPage, /'club-settings': 'settings'/);
});

test('intro aparece somente no app instalado, sem controles sobre o vídeo', () => {
  const intro = sourceSection(clientPage, 'function maybeShowClientAppIntro(appReady)', '\n    function clientUsesIos');
  assert.match(intro, /!clientAppIsInstalled\(\)/);
  assert.match(intro, /consumeClientIntroSkipOnce\(\)/);
  assert.match(intro, /config\.enabled !== true/);
  assert.match(intro, /video\.muted = true/);
  assert.match(intro, /video\.addEventListener\('ended', onEnded\)/);
  assert.match(intro, /video\.addEventListener\('error', onError\)/);
  assert.match(intro, /finish\('play-error'\)/);
  assert.match(intro, /finish\('timeout'\)/);
  assert.match(intro, /removeListeners\(\)/);
  assert.doesNotMatch(clientPage, /clientAppIntroSkipBtn|Pular intro|Abrindo Ilha Play/);
});

test('o app carrega por trás da intro e só troca para uma tela pronta', () => {
  const intro = sourceSection(clientPage, 'function maybeShowClientAppIntro(appReady)', '\n    function clientUsesIos');
  assert.match(intro, /const startupReady = Promise\.resolve\(appReady\)/);
  assert.match(intro, /Promise\.race\(\[\s*startupReady/);
  assert.match(intro, /readinessTimeout = window\.setTimeout\(ready, 4000\)/);
  assert.match(clientPage, /function waitForClientAppReady\(\)[\s\S]*client-checking[\s\S]*MutationObserver/);
  assert.match(clientPage, /\.client-app-intro \{[\s\S]*z-index: 3000/);
  assert.match(clientPage, /const clientStartup = Promise\.resolve\(\)\.then\(function \(\) \{\s*return restore\(\);\s*\}\)\.then\(function \(\) \{\s*return waitForClientAppReady\(\);\s*\}\);\s*maybeShowClientAppIntro\(clientStartup\)[\s\S]*\.finally\(function \(\) \{\s*showWelcomeUpdateModal\(\);/);
});

test('configuração remota tem cache de segurança e o gesto de atualizar não repete a intro', () => {
  const loader = sourceSection(clientPage, 'async function loadClientIntroConfig()', '\n    function maybeShowClientAppIntro');
  const refresh = sourceSection(clientPage, 'async function runPullRefresh()', '\n    function handlePullEnd');
  assert.match(loader, /app_client_experience_settings\?select=intro_enabled,intro_video_url/);
  assert.match(loader, /cache: 'no-store'/);
  assert.match(loader, /controller\.abort\(\)/);
  assert.match(loader, /cachedClientIntroConfig\(\) \|\| DEFAULT_CLIENT_INTRO_CONFIG/);
  assert.match(clientPage, /const CLIENT_INTRO_SKIP_ONCE_KEY/);
  assert.match(refresh, /skipClientIntroOnce\(\)/);
  assert.match(refresh, /window\.location\.reload\(\)/);
});

test('migração publica só a preferência e restringe upload e alteração à equipe autorizada', () => {
  assert.match(migration, /create table if not exists public\.app_client_experience_settings/);
  assert.match(migration, /'\/assets\/app\/ilha-play-intro\.mp4'/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /grant select \(singleton, intro_enabled, intro_video_url, updated_at\)[\s\S]*to anon, authenticated/);
  assert.match(migration, /has_club_permission\('settings'\)/);
  assert.match(migration, /'app-branding'/);
  assert.match(migration, /15728640/);
  assert.match(migration, /array\['video\/mp4'\]/);
  assert.match(migration, /app_branding_staff_insert/);
  assert.match(migration, /storage\.extension\(name\) = 'mp4'/);
});
