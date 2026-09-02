import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prepareSupabaseCiProject } from '../scripts/prepare-supabase-ci.mjs';
import { assertPublishedRuntime, loadStagingConfig } from '../scripts/e2e/staging-guard.mjs';
import {
  loadStagingPublicConfig,
  rewriteStagingHtml,
  rewriteStagingVercelConfig
} from '../scripts/build-staging.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');

const validEnvironment = {
  E2E_REMOTE_CONFIRMATION: 'STAGING_ONLY_NO_REAL_DATA',
  E2E_ASAAS_MODE: 'sandbox',
  E2E_PUSH_MODE: 'REAL_STAGING_DELIVERY',
  STAGING_ASAAS_DOCUMENT_CONFIRMATION: 'SYNTHETIC_SANDBOX_FIXTURE',
  STAGING_BASE_URL: 'https://staging.ilha.example/',
  STAGING_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  STAGING_SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
  STAGING_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abcdefghijklmnopqrstuvwxyz012345',
  STAGING_VAPID_PUBLIC_KEY: 'B'.repeat(87),
  STAGING_ASAAS_SANDBOX_API_KEY: '$aact_hmlg_abcdefghijklmnopqrstuvwxyz012345',
  STAGING_ASAAS_E2E_DOCUMENT: '24971563792',
  STAGING_E2E_CLIENT_EMAIL: 'cliente+e2e@tests.invalid',
  STAGING_E2E_CLIENT_PASSWORD: 'senha-cliente-e2e-123',
  STAGING_E2E_ADMIN_EMAIL: 'admin+e2e@tests.invalid',
  STAGING_E2E_ADMIN_PASSWORD: 'senha-admin-e2e-123',
  STAGING_E2E_BAR_EMAIL: 'bar+e2e@tests.invalid',
  STAGING_E2E_BAR_PASSWORD: 'senha-bar-e2e-123'
};

test('guard de staging aceita somente configuração sintética e explicitamente isolada', () => {
  const config = loadStagingConfig(validEnvironment);
  assert.equal(config.baseUrl.hostname, 'staging.ilha.example');
  assert.equal(config.projectRef, 'abcdefghijklmnopqrst');
});

test('guard de staging rejeita hosts e projeto Supabase de produção', () => {
  assert.throws(
    () => loadStagingConfig({ ...validEnvironment, STAGING_BASE_URL: 'https://app.ilhatenis.com' }),
    /produção/
  );
  assert.throws(
    () => loadStagingConfig({
      ...validEnvironment,
      STAGING_SUPABASE_URL: 'https://lkqtgptebkgfwguykxhv.supabase.co',
      STAGING_SUPABASE_PROJECT_REF: 'lkqtgptebkgfwguykxhv'
    }),
    /produção/
  );
});

test('guard de staging rejeita conta que não esteja marcada como E2E', () => {
  assert.throws(
    () => loadStagingConfig({ ...validEnvironment, STAGING_E2E_CLIENT_EMAIL: 'cliente@empresa.example' }),
    /marcador e2e/
  );
});

test('guard remoto rejeita chave Asaas de produção e modo Push sem entrega real', () => {
  assert.throws(
    () => loadStagingConfig({
      ...validEnvironment,
      STAGING_ASAAS_SANDBOX_API_KEY: '$aact_prod_abcdefghijklmnopqrstuvwxyz012345'
    }),
    /Sandbox/
  );
  assert.throws(
    () => loadStagingConfig({ ...validEnvironment, E2E_PUSH_MODE: 'config-only' }),
    /Push real/
  );
});

test('preflight publicado bloqueia frontend conectado a outro Supabase antes do login', () => {
  const config = loadStagingConfig(validEnvironment);
  const clientHtml = `
    const SUPABASE_URL = 'https://outroprojetoref12345.supabase.co';
    const SUPABASE_ANON_KEY = '${config.publishableKey}';
    const CLIENT_PUSH_VAPID_KEY = '${config.vapidPublicKey}';
  `;
  const adminHtml = `
    const TOURNAMENT_API_URL = '${config.supabaseUrl.origin}/functions/v1/tournament-admin-api';
    const LESSONS_SUPABASE_URL = '${config.supabaseUrl.origin}';
    const LESSONS_SUPABASE_ANON_KEY = '${config.publishableKey}';
    const BAR_PUSH_PUBLIC_KEY = '${config.vapidPublicKey}';
  `;
  assert.throws(() => assertPublishedRuntime(clientHtml, adminHtml, config), /não está conectado/);
});

test('preflight bloqueia deploy parcial de Bar, Menu ou Torneios', () => {
  const config = loadStagingConfig(validEnvironment);
  const clientHtml = `
    const SUPABASE_URL = '${config.supabaseUrl.origin}';
    const SUPABASE_ANON_KEY = '${config.publishableKey}';
    const CLIENT_PUSH_VAPID_KEY = '${config.vapidPublicKey}';
  `;
  const adminHtml = `
    const TOURNAMENT_API_URL = '${config.supabaseUrl.origin}/functions/v1/tournament-admin-api';
    const LESSONS_SUPABASE_URL = '${config.supabaseUrl.origin}';
    const LESSONS_SUPABASE_ANON_KEY = '${config.publishableKey}';
    const BAR_PUSH_PUBLIC_KEY = '${config.vapidPublicKey}';
  `;
  const surface = (keyName, url = config.supabaseUrl.origin) => `
    const SUPABASE_URL = '${url}';
    const ${keyName} = '${config.publishableKey}';
  `;
  assert.throws(
    () => assertPublishedRuntime(clientHtml, adminHtml, config, {
      barHtml: surface('SUPABASE_KEY'),
      menuHtml: surface('SUPABASE_ANON_KEY', 'https://outroprojetoref12345.supabase.co'),
      tournamentsHtml: surface('SUPABASE_ANON_KEY')
    }),
    /Menu/
  );
});

test('preparador de Supabase cria baseline e bootstrap sintético na ordem do runbook', async (context) => {
  const target = await mkdtemp(path.join(os.tmpdir(), 'ilha-supabase-ci-test-'));
  context.after(() => rm(target, { recursive: true, force: true }));
  const result = await prepareSupabaseCiProject(target);
  const allowlistIndex = result.migrations.indexOf('20260821185000_create_protected_access_allowlist.sql');
  const fixtureIndex = result.migrations.indexOf('20260821187500_ci_seed_protected_access.sql');
  const hardeningIndex = result.migrations.indexOf('20260821190000_backend_security_integrity_hardening.sql');
  const recoverableResetIndex = result.migrations.indexOf('20260825205732_add_recoverable_app_client_reset.sql');
  assert.equal(result.migrations[0], '20260801000000_schema_baseline.sql');
  assert.equal(result.migrations[1], '20260801001000_native_court_booking.sql');
  assert.equal(result.migrations[2], '20260801002000_tournament_manager.sql');
  assert.equal(fixtureIndex, allowlistIndex + 1);
  assert.equal(hardeningIndex, fixtureIndex + 1);
  assert.ok(recoverableResetIndex > hardeningIndex);
  const nativeCourt = await readFile(path.join(target, 'supabase', 'migrations', result.migrations[1]), 'utf8');
  const tournaments = await readFile(path.join(target, 'supabase', 'migrations', result.migrations[2]), 'utf8');
  assert.match(nativeCourt, /app_court_schedule_days/);
  assert.match(tournaments, /tournaments/);
  const fixture = await readFile(path.join(target, 'supabase', 'migrations', result.migrations[fixtureIndex]), 'utf8');
  assert.match(fixture, /ci-protected-admin@tests\.invalid/);
  assert.match(fixture, /'ilha-open-2026'/);
  assert.match(fixture, /'REGISTRATION_CLOSED',[\s\S]*false/);
  assert.doesNotMatch(fixture, /@ilhatenis\.com/);
  const recoverableReset = await readFile(
    path.join(target, 'supabase', 'migrations', result.migrations[recoverableResetIndex]),
    'utf8'
  );
  assert.match(recoverableReset, /private\.app_client_account_backups/);
  assert.match(recoverableReset, /reset_app_client_account_with_backup/);
  assert.match(recoverableReset, /restore_app_client_account_backup/);
  assert.match(recoverableReset, /'preserved_auth_access', true/);
  assert.doesNotMatch(recoverableReset, /delete from auth\.users/);
});

test('CI de banco opera somente no Supabase local e repete migrations do zero', async () => {
  const workflow = await readFile(path.join(projectRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(workflow, /supabase --workdir "\$SUPABASE_CI_DIR" db start/);
  assert.match(workflow, /db reset --local/);
  assert.match(workflow, /test db --local/);
  assert.match(workflow, /db lint --local/);
  assert.match(workflow, /SUPABASE_CI_DIR: \/tmp\/ilha-supabase-ci-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.doesNotMatch(workflow, /\$\{\{ runner\.temp \}\}/);
  assert.doesNotMatch(workflow, /\b(?:db push|link|--linked)\b/);
  assert.doesNotMatch(workflow, /SUPABASE_(?:ACCESS_TOKEN|DB_PASSWORD|SERVICE_ROLE)/);
});

test('E2E remoto é manual, protegido por environment e não recebe chave privilegiada', async () => {
  const workflow = await readFile(path.join(projectRoot, '.github', 'workflows', 'staging-e2e.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /E2E_REMOTE_CONFIRMATION: STAGING_ONLY_NO_REAL_DATA/);
  assert.match(workflow, /E2E_PUSH_MODE: REAL_STAGING_DELIVERY/);
  assert.match(workflow, /STAGING_ASAAS_SANDBOX_API_KEY: \$\{\{ secrets\.STAGING_ASAAS_SANDBOX_API_KEY \}\}/);
  assert.doesNotMatch(workflow, /SERVICE_ROLE|SUPABASE_SECRET|ASAAS_WEBHOOK_TOKEN|api\.asaas\.com\/v3/);
});

test('E2E exercita Push real, reset lógico e ciclo sintético completo no Asaas Sandbox', async () => {
  const source = await readFile(path.join(projectRoot, 'scripts', 'e2e', 'staging.mjs'), 'utf8');
  const guard = await readFile(path.join(projectRoot, 'scripts', 'e2e', 'staging-guard.mjs'), 'utf8');
  assert.match(source, /Browser\.grantPermissions/);
  assert.match(source, /client-broadcast-push/);
  assert.match(source, /getNotifications/);
  assert.match(source, /reset_app_client_account/);
  assert.match(source, /assertBarIdentityPreserved/);
  assert.match(guard, /api-sandbox\.asaas\.com\/v3/);
  assert.match(source, /sandbox\/payment\/\$\{encodeURIComponent\(paymentId\)\}\/confirm/);
  assert.match(source, /waitForAsaasPaymentSettlement\(paymentId\)/);
  assert.match(source, /payments\/\$\{encodeURIComponent\(paymentId\)\}\/refund/);
  assert.match(source, /paymentSettled/);
  assert.match(source, /for \(let delivery = 1; delivery <= 2; delivery \+= 1\)/);
  assert.doesNotMatch(`${source}\n${guard}`, /https:\/\/api\.asaas\.com\/v3/);
});

test('build de staging troca somente constantes públicas e recusa produção', () => {
  const config = loadStagingPublicConfig(validEnvironment);
  const source = `
    const SUPABASE_URL = 'https://lkqtgptebkgfwguykxhv.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_oldproductionkey123456789';
    const CLIENT_PUSH_VAPID_KEY = '${'A'.repeat(87)}';
    const IDENTIDADE_VISUAL = 'ilha-tenis';
  `;
  const output = rewriteStagingHtml('index.html', source, config);
  assert.match(output, new RegExp(config.projectRef));
  assert.match(output, new RegExp(config.publishableKey));
  assert.match(output, new RegExp(config.vapidPublicKey));
  assert.match(output, /const IDENTIDADE_VISUAL = 'ilha-tenis'/);
  assert.doesNotMatch(output, /lkqtgptebkgfwguykxhv/);
  assert.throws(
    () => loadStagingPublicConfig({
      ...validEnvironment,
      STAGING_SUPABASE_URL: 'https://lkqtgptebkgfwguykxhv.supabase.co',
      STAGING_SUPABASE_PROJECT_REF: 'lkqtgptebkgfwguykxhv'
    }),
    /produção/
  );
});

test('build de staging preserva slugs de teste removendo apenas redirects para o canônico', async () => {
  const productionSource = await readFile(path.join(projectRoot, 'vercel.json'), 'utf8');
  const productionConfig = JSON.parse(productionSource);
  const stagingConfig = JSON.parse(rewriteStagingVercelConfig(productionSource));
  const canonicalRedirects = [
    {
      source: '/inscricoes/ilha-open-2026-teste',
      destination: '/inscricoes/ilha-open-2026'
    },
    {
      source: '/torneios/ilha-open-2026-teste',
      destination: '/torneios/ilha-open-2026'
    }
  ];

  for (const expected of canonicalRedirects) {
    assert.ok(
      productionConfig.redirects.some((rule) => rule.source === expected.source && rule.destination === expected.destination),
      `produção deve preservar ${expected.source}`
    );
    assert.ok(
      !stagingConfig.redirects.some((rule) => rule.source === expected.source),
      `staging não deve redirecionar ${expected.source}`
    );
  }

  const customSource = JSON.stringify({
    redirects: [
      { source: '/evento-teste', destination: '/evento', permanent: false },
      { source: '/arquivo-teste', destination: '/outro-destino', permanent: false },
      { source: '/clientes', destination: '/', permanent: true }
    ],
    rewrites: [{ source: '/evento/:slug', destination: '/evento' }]
  });
  const customStaging = JSON.parse(rewriteStagingVercelConfig(customSource));
  assert.deepEqual(customStaging.redirects, [
    { source: '/arquivo-teste', destination: '/outro-destino', permanent: false },
    { source: '/clientes', destination: '/', permanent: true }
  ]);
  assert.deepEqual(customStaging.rewrites, [{ source: '/evento/:slug', destination: '/evento' }]);
});

test('workflow de artefato staging não possui deploy nem recebe segredos', async () => {
  const workflow = await readFile(path.join(projectRoot, '.github', 'workflows', 'staging-build.yml'), 'utf8');
  assert.match(workflow, /Gerar dist isolado, sem deploy/);
  assert.match(workflow, /node scripts\/build-staging\.mjs/);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\.|vercel\s+(?:deploy|--prod)|supabase\s+db\s+push/);
});
