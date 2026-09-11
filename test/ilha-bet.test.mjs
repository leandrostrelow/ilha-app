import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');

test('Ilha Bet entra no build e possui página pública própria', async () => {
  const [build, html, app] = await Promise.all([
    read('scripts/build.mjs'),
    read('bet/index.html'),
    read('bet/app.js')
  ]);
  assert.match(build, /directories = \[[^\]]*'bet'/);
  assert.match(html, /<title>Ilha Bet/);
  assert.match(html, /href="\/bet\/styles\.css"/);
  assert.match(html, /src="\/bet\/app\.js"/);
  assert.match(html, /não há aposta, pagamento, depósito, saque, odds ou pontos convertidos em dinheiro/i);
  assert.match(html, /const SUPABASE_URL = ['"]https:\/\/lkqtgptebkgfwguykxhv\.supabase\.co/);
  assert.match(html, /const SUPABASE_ANON_KEY = ['"]sb_publishable_/);
  assert.doesNotMatch(app, /lkqtgptebkgfwguykxhv|sb_publishable_/);
  assert.doesNotThrow(() => new Function(app));
});

test('acesso público guarda somente código e identificador no aparelho', async () => {
  const app = await read('bet/app.js');
  const storageSection = app.slice(app.indexOf('function rememberAccess'), app.indexOf('function forgetAccess'));
  assert.match(storageSection, /entry_id: access\.entry_id, access_code: access\.access_code/);
  assert.match(storageSection, /JSON\.stringify\(state\.access\)/);
  assert.doesNotMatch(storageSection, /full_name|phone|email/);
  assert.match(app, /crypto\.randomUUID\(\)/);
  assert.match(app, /data-pick[\s\S]*aria-pressed/);
});

test('resumo e filtros públicos permanecem corretos no celular', async () => {
  const [app, styles] = await Promise.all([
    read('bet/app.js'),
    read('bet/styles.css')
  ]);
  assert.match(app, /matchCount === 1 \? 'jogo disponível' : 'jogos disponíveis'/);
  assert.doesNotMatch(app, /disponível\$\{[^}]+\? '' : 'is'\}/);
  assert.match(app, /categoryIdsWithMatches = new Set\(state\.data\.matches\.map/);
  assert.match(app, /availableCategories = state\.data\.categories\.filter/);
  assert.match(styles, /@media \(max-width: 800px\)[\s\S]*\.hero-score \{[^}]*background: var\(--teal\)/);
});

test('link simples escolhe a campanha ativa sem permitir fallback de slug inválido', async () => {
  const [app, publicApi] = await Promise.all([
    read('bet/app.js'),
    read('supabase/functions/bet-public-api/index.ts')
  ]);
  assert.doesNotMatch(app, /DEFAULT_TOURNAMENT/);
  assert.match(app, /slug: \(new URLSearchParams\(location\.search\)\.get\('torneio'\) \|\| ''\)/);
  assert.match(app, /api\(`\?torneio=\$\{encodeURIComponent\(state\.slug\)\}`\)/);
  assert.match(app, /state\.slug = String\(state\.data\.tournament\?\.slug \|\| state\.slug\)/);

  const selection = publicApi.slice(publicApi.indexOf('async function selectCampaign'), publicApi.indexOf('function calculateRanking'));
  assert.match(selection, /if \(tournamentSlug\)[\s\S]*\.eq\("slug", tournamentSlug\)[\s\S]*if \(!tournament\) return \{ campaign: null, tournament: null \}/);
  assert.match(selection, /if \(tournament\) campaignQuery = campaignQuery\.eq\("tournament_id", tournament\.id\)/);
  assert.match(selection, /const tournamentIds = [\s\S]*\.in\("id", tournamentIds\)[\s\S]*orderedCampaigns\.find/);
  assert.doesNotMatch(publicApi, /tournament_required/);
  assert.match(publicApi, /joined_at\)\.localeCompare[\s\S]*left\.entry_id/);
  assert.match(publicApi, /ranking\.map\(\(\{ entry_id: _entryId, joined_at: _joinedAt, \.\.\.row \}\) => row\)/);
});

test('ADM integra o Ilha Bet ao torneio sem administrador fixo', async () => {
  const [adminHtml, adminJs] = await Promise.all([
    read('adm/index.html'),
    read('adm/predictions.js')
  ]);
  assert.match(adminHtml, /data-admin-nav="club-bet"/);
  assert.match(adminHtml, />Ilha Bet</);
  assert.match(adminHtml, /href="\/adm\/predictions\.css"/);
  assert.match(adminHtml, /src="\/adm\/predictions\.js"/);
  assert.match(adminHtml, /id="betTournamentPicker"/);
  assert.match(adminHtml, /id="betParticipantsList"/);
  assert.match(adminHtml, /'club-bet': 'tournaments'/);
  assert.match(adminJs, /\/functions\/v1\/bet-admin-api/);
  assert.match(adminJs, /getSession/);
  assert.match(adminJs, /campaignStatus === 'LOCKED'/);
  assert.match(adminJs, /betFinalizeCampaignBtn'\)\.hidden = !canFinalize/);
  assert.match(adminJs, /betFinalizeCampaignBtn'\)\.disabled = moduleState\.loading \|\| !canFinalize/);
  assert.match(adminJs, /action === 'finalizeCampaign' && status !== 'LOCKED'/);
  assert.doesNotMatch(`${adminHtml}\n${adminJs}`, /brunosilva821@hotmail\.com/i);
  assert.doesNotThrow(() => new Function(adminJs));
});

test('banco do Palpite Ilha mantém PII fechada e prêmio desligado no seed', async () => {
  const [migration, hardening] = await Promise.all([
    read('supabase/migrations/20260911160914_create_palpite_ilha.sql'),
    read('supabase/migrations/20260911203000_harden_palpite_ilha_finalization.sql')
  ]);
  for (const table of [
    'tournament_prediction_campaigns',
    'tournament_prediction_entries',
    'tournament_predictions',
    'tournament_prediction_requests',
    'tournament_prediction_audit_log',
    'tournament_prediction_rate_limits'
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, 'i'));
  }
  assert.match(migration, /prize_enabled,[\s\S]*false,[\s\S]*'Uma camisa oficial do Ilha Tênis'/);
  assert.match(migration, /authorization_reference is not null/);
  assert.match(migration, /references public\.tournament_matches\(id\) on delete restrict/);
  assert.match(migration, /create table public\.tournament_prediction_requests/);
  assert.match(migration, /on conflict \(request_id\) do nothing/);
  assert.match(migration, /message = 'request_conflict'/);
  assert.match(migration, /v_tournament_status <> 'FINISHED'[\s\S]*message = 'tournament_not_finished'/);
  assert.match(migration, /match\.status, ''\)\) in \('FINISHED', 'WALKOVER'\)/);
  for (const functionName of [
    'admin_set_tournament_prediction_entry_status',
    'admin_delete_tournament_prediction_entry'
  ]) {
    const section = hardening.slice(hardening.indexOf(`function public.${functionName}`));
    assert.ok(section.indexOf('from public.tournament_prediction_campaigns') < section.indexOf('for update;\n  if not found then\n    raise exception using errcode = \'P0001\', message = \'entry_not_found\''));
  }
  assert.match(migration, /grant execute on function public\.save_tournament_prediction[\s\S]*to service_role/);
  for (const rpc of [
    'admin_save_tournament_prediction_campaign',
    'admin_set_tournament_prediction_entry_status',
    'admin_delete_tournament_prediction_entry',
    'admin_finalize_tournament_prediction_campaign',
    'admin_reopen_tournament_prediction_campaign'
  ]) {
    assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}[\\s\\S]*?to service_role`, 'i'));
  }
});

test('pgTAP cobre ledger, grants, idempotência e finalização', async () => {
  const sql = await read('test/supabase/ilha_bet.test.sql');
  assert.match(sql, /select plan\(29\)/);
  assert.match(sql, /tournament_prediction_requests/);
  assert.match(sql, /retry exato não duplica palpite, ledger ou auditoria/);
  assert.match(sql, /retry antigo nunca desfaz a escolha mais recente/);
  assert.match(sql, /RPCs administrativas são exclusivas do backend service_role/);
  assert.match(sql, /partida cancelada não impede a finalização/);
  assert.match(sql, /campanha não pode coroar campeão antes de o torneio ser finalizado/);
  assert.match(sql, /partida cancelada com vencedor residual nunca entra na pontuação/);
});

test('Edge Functions usam captcha, rate limit e dupla autorização administrativa', async () => {
  const [publicApi, adminApi, config] = await Promise.all([
    read('supabase/functions/bet-public-api/index.ts'),
    read('supabase/functions/bet-admin-api/index.ts'),
    read('supabase/config.toml')
  ]);
  assert.match(publicApi, /verifyTurnstile/);
  assert.match(publicApi, /consume_tournament_prediction_rate_limit/);
  assert.match(publicApi, /accessCodeHash/);
  assert.match(publicApi, /accepting_predictions/);
  assert.match(publicApi, /registration_conflict[\s\S]*request_conflict/);
  assert.match(publicApi, /function isSettledMatch[\s\S]*\["FINISHED", "WALKOVER"\]/);
  assert.match(adminApi, /protected_access_accounts/);
  assert.match(adminApi, /protectedCan/);
  assert.match(adminApi, /function isSettledMatch[\s\S]*\["FINISHED", "WALKOVER"\]/);
  assert.match(adminApi, /tournament_not_finished/);
  assert.match(config, /\[functions\.bet-public-api\]\s+verify_jwt = false/);
  assert.match(config, /\[functions\.bet-admin-api\]\s+verify_jwt = true/);
});
