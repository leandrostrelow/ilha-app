import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { projectRoot } from '../scripts/project-files.mjs';

const indexSource = await readFile(path.join(projectRoot, 'index.html'), 'utf8');
const adminSource = await readFile(path.join(projectRoot, 'adm', 'index.html'), 'utf8');
const clientPreviewSource = await readFile(path.join(projectRoot, 'client-preview.html'), 'utf8');
const barPublicSource = await readFile(path.join(projectRoot, 'bar', 'index.html'), 'utf8');
const menuSource = await readFile(path.join(projectRoot, 'menu', 'index.html'), 'utf8');
const tournamentSource = await readFile(path.join(projectRoot, 'torneios', 'index.html'), 'utf8');
const tournamentRegisterSource = await readFile(path.join(projectRoot, 'supabase', 'functions', 'tournament-register', 'index.ts'), 'utf8');
const tournamentInternalRegisterSource = await readFile(path.join(projectRoot, 'supabase', 'functions', 'tournament-internal-register', 'index.ts'), 'utf8');
const tournamentAdminSource = await readFile(path.join(projectRoot, 'supabase', 'functions', 'tournament-admin-api', 'index.ts'), 'utf8');
const tournamentPaymentExpirySource = await readFile(path.join(projectRoot, 'supabase', 'functions', 'tournament-payment-expiry', 'index.ts'), 'utf8');
const protectedRecoverySource = await readFile(path.join(projectRoot, 'supabase', 'functions', 'protected-access-recovery', 'index.ts'), 'utf8');
const clubUserAccessSource = await readFile(path.join(projectRoot, 'supabase', 'functions', 'club-user-access', 'index.ts'), 'utf8');
const barUserAccessSource = await readFile(path.join(projectRoot, 'supabase', 'functions', 'bar-user-access', 'index.ts'), 'utf8');
const asaasWebhookSource = await readFile(path.join(projectRoot, 'supabase', 'functions', 'asaas-payment-webhook', 'index.ts'), 'utf8');
const clientBroadcastPushSource = await readFile(path.join(projectRoot, 'supabase', 'functions', 'client-broadcast-push', 'index.ts'), 'utf8');
const clientNotificationDispatchSource = await readFile(path.join(projectRoot, 'supabase', 'functions', 'client-notification-dispatch', 'index.ts'), 'utf8');
const atomicClientBroadcastSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260828105000_atomic_client_broadcast_enqueue.sql'),
  'utf8'
);
const scopedPushSubscriptionsSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260901001500_scope_play_and_admin_push_subscriptions.sql'),
  'utf8'
);
const tournamentFamilyCheckoutSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260901032343_add_tournament_family_checkout.sql'),
  'utf8'
);
const atomicTournamentFamilyCheckoutSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260902134031_atomic_tournament_family_checkout.sql'),
  'utf8'
);
const tournamentInviteSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260901040358_add_single_use_tournament_invites.sql'),
  'utf8'
);
const tournamentInviteManagementSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260901143732_add_tournament_invite_management.sql'),
  'utf8'
);
const tournamentInviteShareSecretSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260901150918_add_tournament_invite_share_secret.sql'),
  'utf8'
);
const tournamentPublicCapabilityHardeningSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260901202913_harden_tournament_public_capabilities.sql'),
  'utf8'
);
const barOrderPushSource = await readFile(path.join(projectRoot, 'supabase', 'functions', 'bar-order-push', 'index.ts'), 'utf8');
const sharedCorsSource = await readFile(path.join(projectRoot, 'supabase', 'functions', '_shared', 'cors.ts'), 'utf8');
const serviceWorkerSource = await readFile(path.join(projectRoot, 'service-worker.js'), 'utf8');
const autoUpdateSource = await readFile(path.join(projectRoot, 'auto-update.js'), 'utf8');
const clientRedirectSource = await readFile(path.join(projectRoot, 'clientes', 'index.html'), 'utf8');
const localServerSource = await readFile(path.join(projectRoot, 'scripts', 'serve.mjs'), 'utf8');
const productionBuildSource = await readFile(path.join(projectRoot, 'scripts', 'build.mjs'), 'utf8');
const vercelConfigSource = await readFile(path.join(projectRoot, 'vercel.json'), 'utf8');
const schemaBaselineSource = await readFile(path.join(projectRoot, 'supabase-schema.sql'), 'utf8');
const legacyProtectedAccessSource = await readFile(path.join(projectRoot, 'supabase', '20260817_protected_staff_access.sql'), 'utf8');
const supabaseConfigSource = await readFile(path.join(projectRoot, 'supabase', 'config.toml'), 'utf8');
const securityMigrationSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260821190000_backend_security_integrity_hardening.sql'),
  'utf8'
);
const recoverableClientResetSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260825205732_add_recoverable_app_client_reset.sql'),
  'utf8'
);
const pendingClientAccessSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260824121447_pending_client_access_and_auth_session.sql'),
  'utf8'
);
const jwtRoleGuardSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260824131000_use_auth_jwt_for_request_role_guards.sql'),
  'utf8'
);
const historicalDispatcherSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260820173000_court_participant_notifications.sql'),
  'utf8'
);
const dispatcherExternalizationSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260822090000_externalize_notification_dispatcher.sql'),
  'utf8'
);
const publicRegistrationRateLimitSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260822091000_public_registration_abuse_protection.sql'),
  'utf8'
);
const ilhaOpenClassesAndLimitsSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260831100000_configure_ilha_open_2026_classes_and_registration_limits.sql'),
  'utf8'
);
const ilhaOpenSpatialCheckoutSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260831110000_add_ilha_open_spatial_single_checkout.sql'),
  'utf8'
);
const ilhaOpenSpatialBundleRepairSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260831111500_repair_ilha_open_spatial_bundle_claim.sql'),
  'utf8'
);
const ilhaOpenServiceRoleAuthFixSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260831123000_fix_spatial_bundle_service_role_auth.sql'),
  'utf8'
);
const ilhaOpenSpatialCopyAndPixOnlySource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260831171907_ilha_open_spatial_copy_and_pix_only.sql'),
  'utf8'
);
const ilhaOpenSpatialClassRulesSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260831182036_align_ilha_open_spatial_class_rules.sql'),
  'utf8'
);
const tournamentLogoStorageSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260831192934_add_tournament_logo_storage.sql'),
  'utf8'
);
const asaasWebhookEventPrivilegesSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260831132000_restore_asaas_webhook_event_service_role_crud.sql'),
  'utf8'
);
const asaasWebhookClaimSource = await readFile(
  path.join(projectRoot, 'supabase', '20260812_harden_tournament_registration_payments.sql'),
  'utf8'
);
const tournamentPaymentExpiryMigrationSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260831162642_tournament_payment_expiry.sql'),
  'utf8'
);
const tournamentPaymentExpiryAuthFixSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260831163730_repair_tournament_payment_expiry_service_role_auth.sql'),
  'utf8'
);
const tournamentPaymentReconciliationSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260901202936_harden_tournament_payment_reconciliation.sql'),
  'utf8'
);
const terminalPaymentArtifactCleanupSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260902104500_clear_terminal_tournament_payment_artifacts.sql'),
  'utf8'
);
const asaasGoLiveRunbookSource = await readFile(
  path.join(projectRoot, 'docs', 'asaas-go-live-runbook.md'),
  'utf8'
);
const internalTournamentSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260824170451_add_internal_tournament_registration.sql'),
  'utf8'
);
const internalTournamentGenderSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260824184722_split_internal_tournament_categories_by_gender.sql'),
  'utf8'
);
const internalTournamentPaidSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260824200006_add_internal_tournament_paid_status.sql'),
  'utf8'
);
const adminSignupEscalationHotfixSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260824213000_close_admin_metadata_signup_escalation.sql'),
  'utf8'
);
const barPerformanceMigrationSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260824214500_optimize_adm_bar_operational_queries.sql'),
  'utf8'
);
const storeCatalogMigrationSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260825180134_create_ilha_store_product_catalog.sql'),
  'utf8'
);
const familyAccountMigrationSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260825190353_create_family_billing_accounts.sql'),
  'utf8'
);
const familyRepairMigrationSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260825191434_repair_family_summary_and_service_audit.sql'),
  'utf8'
);
const familyIndexMigrationSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260825192500_index_family_foreign_keys.sql'),
  'utf8'
);
const manualFamilyMemberMigrationSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260826162300_allow_incomplete_manual_family_members.sql'),
  'utf8'
);
const minorFamilyMemberMigrationSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260826170146_allow_minor_family_member_without_cpf.sql'),
  'utf8'
);
const barQrPhoneRepairMigrationSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260826172043_repair_bar_qr_phone_and_customer_identity.sql'),
  'utf8'
);
const barQrStockRepairMigrationSource = await readFile(
  path.join(projectRoot, 'supabase', 'migrations', '20260828211500_repair_public_bar_qr_stock_decrement.sql'),
  'utf8'
);
const securityOperationsSource = await readFile(path.join(projectRoot, 'SECURITY_OPERATIONS.md'), 'utf8');
const gitignoreSource = await readFile(path.join(projectRoot, '.gitignore'), 'utf8');
const sqlFiles = (await readdir(path.join(projectRoot, 'supabase'), { recursive: true }))
  .filter((file) => file.endsWith('.sql'))
  .map((file) => path.join(projectRoot, 'supabase', file));
const sqlCorpus = [path.join(projectRoot, 'supabase-schema.sql'), ...sqlFiles]
  .map((file) => readFile(file, 'utf8'));
const sql = (await Promise.all(sqlCorpus)).join('\n').toLowerCase();

function functionSource(source, name) {
  const functionStart = source.indexOf(`function ${name}(`);
  assert.notEqual(functionStart, -1, `funcao ${name} nao encontrada`);
  const start = source.slice(Math.max(0, functionStart - 6), functionStart) === 'async '
    ? functionStart - 6
    : functionStart;
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`corpo incompleto para ${name}`);
}

function loadFunction(source, name, context = {}) {
  return vm.runInNewContext(`(${functionSource(source, name)})`, context);
}

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `marcador inicial ausente: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `marcador final ausente: ${endMarker}`);
  return source.slice(start, end);
}

test('validacao de CPF usa a implementacao real do Ilha Play', () => {
  const isValidCpf = loadFunction(indexSource, 'isValidCpf', {
    digitsOnly: loadFunction(indexSource, 'digitsOnly')
  });
  assert.equal(isValidCpf('529.982.247-25'), true);
  assert.equal(isValidCpf('111.111.111-11'), false);
  assert.equal(isValidCpf('529.982.247-24'), false);
});

test('schema-base contem os pre-requisitos de cadastro e Push das migrations canonicas', () => {
  for (const column of [
    'declared_plan_code',
    'declared_plan_name',
    'registration_completed_at',
    'email_verified_at',
    'birth_date',
    'declared_lesson_slots'
  ]) {
    assert.match(schemaBaselineSource, new RegExp(`app_clients add column if not exists ${column}`));
  }
  assert.match(schemaBaselineSource, /function public\.is_valid_cpf\(p_cpf text\)/);
  assert.match(schemaBaselineSource, /create table if not exists public\.app_push_subscriptions/);
  assert.match(schemaBaselineSource, /clients manage own push subscriptions/);
  assert.match(securityMigrationSource, /\('public\.app_push_subscriptions'\)/);
});

test('datas locais nao convertem o dia pelo UTC', () => {
  const clubDateTimeParts = loadFunction(indexSource, 'clubDateTimeParts', {
    Intl,
    CLUB_TIME_ZONE: 'America/Sao_Paulo'
  });
  const localDateString = loadFunction(indexSource, 'localDateString', {
    clubDateTimeParts
  });
  assert.equal(localDateString(new Date('2026-08-21T00:05:00-03:00')), '2026-08-21');
});

test('cadastro pendente nunca persiste a senha', () => {
  const source = functionSource(indexSource, 'savePendingSignup');
  assert.match(source, /delete pendingSignup\.password/);
  assert.doesNotMatch(source, /JSON\.stringify\(value\)/);
});

test('login persiste sessao com coordenacao entre abas sem armazenar senha', () => {
  const refresh = functionSource(indexSource, 'forceRefreshSession');
  const storeSession = functionSource(indexSource, 'storeSession');
  const scheduleRefresh = functionSource(indexSource, 'scheduleSessionRefresh');
  const passwordSave = functionSource(indexSource, 'offerPasswordSave');
  const restore = functionSource(indexSource, 'restore');
  assert.match(refresh, /navigator\.locks\.request\('ilha-client-auth-refresh'/);
  assert.match(storeSession, /scheduleSessionRefresh\(nextSession\)/);
  assert.match(scheduleRefresh, /forceRefreshSession\(\)/);
  assert.match(scheduleRefresh, /scheduleSessionRefresh\(session, 30000\)/);
  assert.match(indexSource, /window\.addEventListener\('storage'/);
  assert.match(indexSource, /window\.addEventListener\('online'/);
  assert.match(indexSource, /name="username"[^>]+autocomplete="username"/);
  assert.match(indexSource, /name="password"[^>]+autocomplete="current-password"/);
  assert.match(passwordSave, /navigator\.credentials\.store/);
  assert.doesNotMatch(passwordSave, /localStorage|sessionStorage|storageSet/);
  assert.match(restore, /showAuthTab\('login'\)/);
  assert.match(restore, /!isDefinitiveSessionError\(error\)/);
  assert.match(restore, /scheduleSessionRestoreRetry\(\)/);
});

test('falha temporaria ao reabrir nao encerra a sessao do Ilha Play', () => {
  const sessionErrorText = loadFunction(indexSource, 'sessionErrorText');
  const isDefinitiveSessionError = loadFunction(indexSource, 'isDefinitiveSessionError', { sessionErrorText });
  assert.equal(isDefinitiveSessionError(new Error('Não foi possível conectar ao servidor.')), false);
  assert.equal(isDefinitiveSessionError({ status: 500, message: 'Erro temporário' }), false);
  assert.equal(isDefinitiveSessionError({ status: 401, message: 'Unauthorized' }), true);
  assert.equal(isDefinitiveSessionError({ code: 'refresh_token_not_found' }), true);
});

test('aviso inicial não bloqueia clientes existentes e orienta cadastro pendente', () => {
  assert.match(indexSource, /id="welcomeContinueBtn">Já tenho conta: entrar</);
  assert.match(indexSource, /id="welcomeSignupBtn">Fazer meu cadastro</);
  assert.match(indexSource, /showAuthTab\('login'\)/);
  assert.match(indexSource, /showAuthTab\('signup'\)/);
  assert.match(indexSource, /áreas e ações permanecem bloqueadas até a liberação do clube/);
  assert.doesNotMatch(indexSource, /Confira seu e-mail para confirmar a conta/);
});

test('cliente pendente autentica mas dados e acoes permanecem bloqueados', () => {
  const finish = functionSource(indexSource, 'finishAuthenticatedAccess');
  const pendingScreen = functionSource(indexSource, 'unlockPendingAccess');
  assert.match(finish, /status !== 'ATIVO'[\s\S]*unlockPendingAccess\(\)/);
  assert.ok(finish.indexOf("status !== 'ATIVO'") < finish.indexOf('loadClientData()'));
  assert.match(pendingScreen, /client-pending-access/);
  assert.match(indexSource, /id="pendingAccessRefreshBtn"/);
  assert.match(pendingClientAccessSource, /new\.status := 'PENDENTE'/);
  assert.match(pendingClientAccessSource, /upper\(coalesce\(client\.status, ''\)\) = 'ATIVO'/);
  for (const table of [
    'app_plans',
    'app_announcements',
    'app_plan_requests',
    'app_store_requests',
    'app_court_bookings',
    'app_payment_invoices',
    'app_client_notifications',
    'app_notification_dismissals',
    'app_push_subscriptions'
  ]) assert.match(pendingClientAccessSource, new RegExp(`on public\\.${table}`));
});

test('recuperacao de senha retorna ao mesmo caminho e nao enumera contas', () => {
  const recovery = functionSource(indexSource, 'requestPasswordRecovery');
  assert.match(recovery, /window\.location\.origin \+ window\.location\.pathname/);
  assert.match(indexSource, /Se houver uma conta para este e-mail/);
  assert.match(indexSource, /flow_type === 'recovery'/);
  assert.match(indexSource, /updateRecoveredPassword/);
});

test('autenticacao traduz email invalido e guards usam o JWT oficial do Supabase', () => {
  assert.match(indexSource, /Informe um e-mail válido\./);
  assert.match(jwtRoleGuardSource, /auth\.jwt\(\) ->> ''role''/);
  assert.match(jwtRoleGuardSource, /like '%request\.jwt\.claim\.role%'/);
});

test('modo demo intercepta reservas antes do RPC remoto', () => {
  for (const name of ['saveClientCourtBooking', 'cancelClientCourtBooking', 'respondToCourtChallenge']) {
    const source = functionSource(indexSource, name);
    const demoBranch = source.indexOf('demoMode');
    const remoteCall = source.indexOf("rest('rpc/");
    assert.notEqual(demoBranch, -1, `${name} sem isolamento demo`);
    assert.ok(remoteCall === -1 || demoBranch < remoteCall, `${name} chama RPC antes do isolamento demo`);
  }
});

test('permissoes de conteudo distinguem cliente com e sem aulas', () => {
  const withoutPlan = loadFunction(indexSource, 'hasLessonPlan', {
    client: { official_plan_code: '', weekly_lessons: 0 },
    currentClientPlanName: () => ''
  });
  const courtOnly = loadFunction(indexSource, 'hasLessonPlan', {
    client: { official_plan_code: 'jogar_mensal', weekly_lessons: 0 },
    currentClientPlanName: () => 'Somente jogar'
  });
  const lessonPlan = loadFunction(indexSource, 'hasLessonPlan', {
    client: { official_plan_code: 'aulas_mensal_1x', weekly_lessons: 1 },
    currentClientPlanName: () => '1x Aula por semana'
  });
  assert.equal(withoutPlan(), false);
  assert.equal(courtOnly(), false);
  assert.equal(lessonPlan(), true);
});

test('home do Ilha Play mantém somente a Store e usa cartões compactos', () => {
  const home = sourceSection(
    indexSource,
    '<section class="view active" id="view-home">',
    '<section class="view" id="view-profile">'
  );
  assert.equal((home.match(/data-view="store"/g) || []).length, 1);
  assert.match(home, /class="home-store-card"/);
  assert.match(home, /client-icon-store/);
  assert.doesNotMatch(home, /Jogue no Ilha/);
  assert.doesNotMatch(home, /dashboard-finance-card|home-menu-grid|home-menu-card/);
  assert.doesNotMatch(home, />Planos<|>Ranking<|>Torneios</);
  assert.match(indexSource, /\.dashboard-plan-card \{[^}]*min-height: 0;/);
  assert.match(indexSource, /\.dashboard-reserve-card \{[^}]*min-height: 58px;/);
});

test('home personaliza saudação e oferece controle completo das notificações', () => {
  const home = sourceSection(
    indexSource,
    '<section class="view active" id="view-home">',
    '<section class="view" id="view-profile">'
  );
  const renderHome = functionSource(indexSource, 'renderHome');
  const renderPush = functionSource(indexSource, 'renderClientPushState');
  const disablePush = functionSource(indexSource, 'disableClientPushSubscription');
  assert.match(renderHome, /Bem-vindo, /);
  assert.match(home, /id="clientPushConsent"/);
  assert.doesNotMatch(home, /id="clientPushStatus"|>Ligadas</);
  assert.match(home, /É importante ativar para receber convites, aulas e informações financeiras/);
  assert.doesNotMatch(home, /Escolha o melhor horário/);
  assert.doesNotMatch(home, /dashboard-notices-head|Avisos do clube|Ver todos/);
  assert.ok(home.indexOf('id="homeAnnouncements"') < home.indexOf('id="clientPushConsent"'));
  assert.match(indexSource, /\.push-consent-card \{ grid-template-columns: 38px minmax\(0, 1fr\) auto;/);
  assert.match(indexSource, /id="clientPushPromptModal"/);
  assert.match(indexSource, /Receba convites de adversários/);
  assert.match(renderPush, /options\.prompt/);
  assert.match(renderPush, /maybeShowClientPushPrompt/);
  assert.match(renderPush, /card\.hidden = state === 'active'/);
  assert.match(renderPush, /profileControl\.hidden = false/);
  assert.match(indexSource, /id="clientPushProfileControl"[\s\S]*id="clientDisableNotificationsBtn"/);
  assert.match(disablePush, /app_push_subscriptions\?endpoint=eq\./);
  assert.match(disablePush, /subscription\.unsubscribe\(\)/);
  assert.match(disablePush, /CLIENT_PUSH_PREFERENCE_KEY\), false/);
  assert.match(functionSource(indexSource, 'ensureClientPushSubscription'), /CLIENT_PUSH_PREFERENCE_KEY[\s\S]*=== false/);
});

test('comunicados usam a fila resiliente e não enviam Web Push diretamente', () => {
  const saveAnnouncement = functionSource(adminSource, 'createAnnouncementAction');
  assert.doesNotMatch(clientBroadcastPushSource, /npm:web-push|sendNotification|bar_push_config/);
  assert.match(clientBroadcastPushSource, /enqueue_app_client_broadcast/);
  assert.match(atomicClientBroadcastSource, /with targeted as materialized/);
  assert.match(atomicClientBroadcastSource, /join auth\.users/);
  assert.match(atomicClientBroadcastSource, /on conflict \(dedupe_key\).*do nothing/);
  assert.match(atomicClientBroadcastSource, /grant execute[\s\S]*to service_role/);
  assert.doesNotMatch(atomicClientBroadcastSource, /to (?:public|anon|authenticated);/);
  assert.match(clientBroadcastPushSource, /delivery: "queued"/);
  assert.match(clientBroadcastPushSource, /dedupe_key/);
  assert.match(adminSource, /com push ativo/);
  assert.doesNotMatch(saveAnnouncement, /\.catch\(function \(\) \{ return null; \}\)/);
  assert.match(adminSource, /data-announcement-edit=/);
  assert.match(adminSource, /id="announcementCancelEditBtn"/);
  assert.match(adminSource, /function editAnnouncementAction\(id\)/);
  assert.match(saveAnnouncement, /method: 'PATCH'/);
  assert.match(saveAnnouncement, /!editingItem && payload\.body/);
  assert.match(saveAnnouncement, /A notificação não foi reenviada/);
  assert.match(saveAnnouncement, /if \(!editingItem\) payload\.published_at/);
  assert.match(adminSource, /data-announcement-resend/);
  assert.match(adminSource, /function resendAnnouncementAction\(id, button\)/);
  assert.match(adminSource, /function loadAnnouncementDeliveryStatuses\(\)/);
  assert.match(clientBroadcastPushSource, /p_permission: "announcements"/);
  assert.match(clientBroadcastPushSource, /action === "status"/);
  assert.match(clientBroadcastPushSource, /push_enabled_recipients/);
  assert.match(clientBroadcastPushSource, /invoke_app_client_notification_dispatch/);
  assert.match(adminSource, /announcementStatusRequestVersion/);
  assert.match(adminSource, /pollAnnouncementDeliveryStatus/);
  assert.match(adminSource, /data\.stage, data\.error_code/);
  assert.match(adminSource, /response\.status === 401[\s\S]*refreshAdminSession/);
  assert.match(adminSource, /Number\(stats\.failed \|\| 0\)/);
  assert.match(adminSource, /Number\(stats\.partial \|\| 0\)/);
  assert.doesNotMatch(functionSource(adminSource, 'notifyClientAccessReleased'), /sendClientAnnouncementPush/);
  assert.match(functionSource(indexSource, 'loadClientData'), /'NOVO_ALUNO', 'COMUNICADO'/);
  assert.match(functionSource(indexSource, 'handleClientNotificationInsert'), /event_type[\s\S]*COMUNICADO[\s\S]*return/);
  assert.match(functionSource(adminSource, 'handleAdminNotificationInsert'), /event_type[\s\S]*COMUNICADO[\s\S]*return/);
  assert.match(functionSource(adminSource, 'saveAdminPushSubscription'), /app_surface:\s*'ADM'/);
  assert.match(scopedPushSubscriptionsSource, /app_surface text not null default 'ILHA_PLAY'/);
  assert.match(scopedPushSubscriptionsSource, /subscription\.app_surface = 'ILHA_PLAY'/);
  assert.match(clientNotificationDispatchSource, /subscriptionSurface[\s\S]*NOVO_ALUNO[\s\S]*ADM[\s\S]*ILHA_PLAY[\s\S]*\.eq\("app_surface", subscriptionSurface\)/);
});

test('Ilha Store usa catálogo persistente com valor, estoque e CRUD administrativo', () => {
  const clientLoad = functionSource(indexSource, 'loadClientData');
  const clientRender = functionSource(indexSource, 'renderStore');
  const adminSave = functionSource(adminSource, 'saveStoreProductAction');
  assert.match(clientLoad, /app_store_products\?select=\*/);
  assert.match(clientRender, /storeProductAvailable/);
  assert.match(clientRender, /money\(product\.amount\)/);
  assert.match(indexSource, /product_id: product\.id/);
  assert.match(adminSource, /id="storeProductForm"/);
  assert.match(adminSource, /id="storeProductStock"/);
  assert.match(adminSource, /id="storeProductTrackStock"/);
  assert.match(adminSave, /app_store_products/);
  assert.match(adminSource, /data-store-product-edit/);
  assert.match(adminSource, /data-store-product-toggle/);
  assert.match(adminSource, /data-store-product-delete/);
});

test('catálogo da Store protege escrita e valida preço e estoque no banco', () => {
  assert.match(storeCatalogMigrationSource, /create table if not exists public\.app_store_products/);
  assert.match(storeCatalogMigrationSource, /alter table public\.app_store_products enable row level security/);
  assert.match(storeCatalogMigrationSource, /is_club_office\(\)/);
  assert.match(storeCatalogMigrationSource, /validate_app_store_request_product/);
  assert.match(storeCatalogMigrationSource, /new\.amount := product_row\.sale_price \* new\.quantity/);
  assert.match(storeCatalogMigrationSource, /sync_app_store_request_inventory/);
  assert.match(storeCatalogMigrationSource, /stock_quantity = stock_quantity - new\.quantity/);
  assert.match(storeCatalogMigrationSource, /bucket_id = 'ilha-store-products'/);
});

test('financeiro do Play exibe somente faturas oficiais e Pix fornecido pelo backend', () => {
  const invoices = functionSource(indexSource, 'buildMonthlyInvoices');
  const pix = functionSource(indexSource, 'invoicePixText');
  assert.match(invoices, /paymentInvoices\.slice\(\)/);
  assert.doesNotMatch(invoices, /plan_amount|generated_|dueDateForMonth/);
  assert.match(pix, /invoice\.pix_payload/);
  assert.doesNotMatch(indexSource, /const PIX_KEY|function pixPayload/);
  assert.doesNotMatch(indexSource, /data-view="payments"[^>]*disabled/);
});

test('inscricao paga envia CPF ao backend e cortesia permanece opcional', () => {
  assert.match(tournamentSource, /id="athleteCpf"/);
  assert.match(tournamentSource, /cpf:\s*digitsOnly\(form\.get\('cpf'\)\)/);
  assert.match(tournamentSource, /athleteCpf[^\n]+required\s*=\s*!internal\s*&&\s*!state\.courtesyMode/);
  assert.match(tournamentRegisterSource, /const submittedCpf = digits\(payload\.cpf\)/);
  assert.match(tournamentRegisterSource, /participantType !== "COURTESY" && !isValidCpf\(submittedCpf\)/);
  assert.match(tournamentRegisterSource, /Este link de cortesia foi substituído por um convite exclusivo/);
  assert.doesNotMatch(tournamentRegisterSource, /tournament\.courtesy_registration_token/);
  assert.match(tournamentRegisterSource, /cpf:\s*effectiveCpf \|\| null/);
});

test('Ilha Open limita as classes a oito atletas e protege a segunda inscrição no banco', () => {
  for (const category of [
    '2ª Classe Masculina', '4ª Classe Masculina', '5ª Classe Masculina',
    '6ª Classe Masculina', '7ª Classe Masculina (Iniciante)',
    '1ª Classe Masculina', '3ª Classe Masculina', '2ª Classe Feminina',
    '3ª Classe Feminina', '4ª Classe Feminina (Iniciante)',
    'Espacial A Masculino 🚀', 'Espacial B Masculino 🚀'
  ]) assert.match(ilhaOpenClassesAndLimitsSource, new RegExp(category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(ilhaOpenClassesAndLimitsSource, /'2026-09-11'[\s\S]*'2026-09-20'/);
  assert.match(ilhaOpenClassesAndLimitsSource, /'2026-09-21'[\s\S]*'2026-09-27'/);
  assert.match(ilhaOpenClassesAndLimitsSource, /draw_size[\s\S]*\n\+?\s*8,/i);
  assert.match(ilhaOpenClassesAndLimitsSource, /max_entries[\s\S]*\n\+?\s*8,/i);
  assert.match(ilhaOpenClassesAndLimitsSource, /requires_existing_codes/);
  assert.match(ilhaOpenClassesAndLimitsSource, /'M2', 'M3', 'M4', 'M5', 'M6'/);
  assert.match(ilhaOpenClassesAndLimitsSource, /pg_advisory_xact_lock/);
  assert.match(ilhaOpenClassesAndLimitsSource, /before insert on public\.tournament_registrations/i);
  assert.match(tournamentRegisterSource, /publicRegistrationRuleErrors/);
  assert.match(tournamentRegisterSource, /result\.error\?\.code === "P0001"/);
});

test('Ilha Open oferece a Espacial correta por mais R$ 80 no mesmo pagamento', () => {
  assert.match(ilhaOpenSpatialCheckoutSource, /'M2'[\s\S]*'ESP-A-M'[\s\S]*'fee', 80/);
  assert.match(ilhaOpenSpatialCheckoutSource, /'M3'[\s\S]*'ESP-A-M'[\s\S]*'fee', 80/);
  assert.match(ilhaOpenSpatialCheckoutSource, /'M4'[\s\S]*'ESP-A-M'[\s\S]*'fee', 80/);
  assert.match(ilhaOpenSpatialCheckoutSource, /'M5'[\s\S]*'ESP-B-M'[\s\S]*'fee', 80/);
  assert.match(ilhaOpenSpatialCheckoutSource, /'M6'[\s\S]*'ESP-B-M'[\s\S]*'fee', 80/);
  assert.match(ilhaOpenSpatialCheckoutSource, /'M7'[\s\S]*'ESP-B-M'[\s\S]*'fee', 80/);
  assert.match(ilhaOpenSpatialCheckoutSource, /claim_public_tournament_registration_bundle/);
  assert.match(ilhaOpenSpatialCheckoutSource, /parent_registration_id/);
  assert.match(ilhaOpenSpatialCheckoutSource, /sync_tournament_registration_payment_group/);
  assert.match(ilhaOpenSpatialBundleRepairSource, /insert into public\.tournament_registrations/);
  assert.doesNotMatch(ilhaOpenSpatialBundleRepairSource, /tournament_claim_public_registration\s*\(/);
  assert.match(ilhaOpenSpatialBundleRepairSource, /current_setting\('request\.jwt\.claim\.role'/);
  assert.match(ilhaOpenServiceRoleAuthFixSource, /claim_public_tournament_registration_bundle/);
  assert.match(ilhaOpenServiceRoleAuthFixSource, /sync_tournament_registration_payment_group/);
  assert.match(ilhaOpenServiceRoleAuthFixSource, /auth\.jwt\(\) ->> ''role''/);
  assert.match(ilhaOpenServiceRoleAuthFixSource, /corrected_count <> 2/);
  assert.match(tournamentSource, /id="spatialAddonField"/);
  assert.match(tournamentSource, /Você pode jogar também na Classe Espacial/);
  assert.match(tournamentSource, /⚠️ não conta pontos para o CINCATE/);
  assert.match(tournamentSource, /SIM, quero participar da/);
  assert.match(tournamentSource, /Sexta-feira e sábado são dias obrigatórios de jogo e não permitem restrição de horário\. As finais serão disputadas no domingo\./);
  assert.doesNotMatch(tournamentSource, /Escolha seu perfil e a classe\. O valor é definido pela classe selecionada\./);
  assert.doesNotMatch(tournamentSource, /Restrição de horário ou informação importante/);
  assert.doesNotMatch(tournamentSource, /Pagamento disponível somente via Pix\./);
  assert.doesNotMatch(tournamentSource, /SIM, quero participar também da/);
  assert.doesNotMatch(tournamentSource, /identificada pela cor amarela/);
  assert.match(tournamentSource, /spatial-addon-option/);
  assert.match(tournamentSource, /spatialAddonPeriodLabel/);
  assert.match(ilhaOpenSpatialCopyAndPixOnlySource, /allowed_payment_methods\s*=\s*'\["PIX"\]'::jsonb/);
  assert.match(ilhaOpenSpatialCopyAndPixOnlySource, /spatial_event_period_label'[\s\S]*'21 a 27 de setembro'/);
  assert.match(ilhaOpenSpatialClassRulesSource, /'ESP-A-M'[\s\S]*jsonb_build_array\('M2', 'M3', 'M4'\)/);
  assert.match(ilhaOpenSpatialClassRulesSource, /'ESP-B-M'[\s\S]*jsonb_build_array\('M5', 'M6', 'M7'\)/);
  assert.doesNotMatch(ilhaOpenSpatialClassRulesSource, /'(?:M1|F2|F3|F4)'\s*,\s*jsonb_build_object\('category_code'/);
  assert.match(ilhaOpenSpatialClassRulesSource, /A Espacial A é exclusiva para atletas inscritos na 2ª, 3ª ou 4ª Classe Masculina\./);
  assert.match(ilhaOpenSpatialClassRulesSource, /A Espacial B é exclusiva para atletas inscritos na 5ª, 6ª ou 7ª Classe Masculina\./);
  assert.match(tournamentRegisterSource, /A segunda inscrição só é permitida na Espacial A para atletas da 2ª, 3ª e 4ª Classe Masculina ou na Espacial B para atletas da 5ª, 6ª e 7ª Classe Masculina\./);
  assert.match(tournamentSource, /additional_category_id:\s*\$\('spatialAddon'\)\.checked/);
  assert.match(tournamentSource, /participantRegistrationAmount\(selected\) \+ addonFee/);
  assert.match(tournamentSource, /class="reservation-warning" role="alert"/);
  assert.match(tournamentSource, /Sua vaga fica reservada por 2 horas e só é confirmada após o pagamento\./);
  assert.match(tournamentSource, /Suas vagas ficam reservadas por 2 horas e só são confirmadas após o pagamento\./);
  assert.match(tournamentSource, /Seja um patrocinador do torneio/);
  assert.match(tournamentSource, /wa\.me\/5527999805814/);
  assert.match(tournamentSource, /function tournamentTitleHtml/);
  assert.doesNotMatch(tournamentSource, />Ilha Play<|<p class="eyebrow">' \+ escapeHtml\(field\(item,'club_name'/);
  assert.doesNotMatch(functionSource(tournamentSource, 'renderTournament'), /short_description|Acompanhe todas as informações do torneio/);
  assert.match(tournamentSource, /id="tournamentHeadActions" hidden/);
  assert.match(tournamentSource, /id="headRegisterBtn"[\s\S]*Fazer inscrição/);
  assert.match(tournamentSource, /class="mobile-label">Inscreva-se/);
  assert.match(tournamentSource, /Seja um patrocinador/);
  assert.match(functionSource(tournamentSource, 'renderTournament'), /state\.activeTab = visibleTabs\.includes\('categories'\)/);
  assert.doesNotMatch(functionSource(tournamentSource, 'renderTournament'), /tabButton\('overview','Visão geral'\)|data-panel="overview"|hero-actions/);
  assert.doesNotMatch(functionSource(tournamentSource, 'overviewHtml'), /summary-grid|<h3>Informações<\/h3>/);
  assert.match(tournamentSource, /registrations:\s*false[\s\S]*about:\s*true/);
  assert.match(tournamentSource, /Sobre o evento/);
  assert.match(functionSource(tournamentSource, 'heroMetaHtml'), /Data do evento[\s\S]*Local[\s\S]*status-pill/);
  assert.match(functionSource(tournamentSource, 'heroMetaHtml'), /club_name','clube','venue','location','local/);
  assert.doesNotMatch(functionSource(tournamentSource, 'heroMetaHtml'), /<small>Inscrições<\/small>/);
  assert.match(tournamentSource, /\.meta-pill\.status-open[^}]*rgba\(37,211,102/);
  assert.match(functionSource(tournamentSource, 'aboutHtml'), /about-contact-list[\s\S]*Instagram[\s\S]*wa\.me\/5527999805814[\s\S]*Ilha Tênis — Colatina[\s\S]*about-image[\s\S]*sponsorsHtml\(true\)/);
  assert.match(adminSource, /id="tournamentLogoFile"[^>]*accept="image\/png/);
  assert.match(adminSource, /1600 × 600 px/);
  assert.match(functionSource(adminSource, 'uploadTournamentLogo'), /file\.size > 2 \* 1024 \* 1024/);
  assert.match(tournamentAdminSource, /logo_url: nullableText\(input\.logo_url/);
  assert.match(tournamentLogoStorageSource, /'tournament-branding'[\s\S]*2097152[\s\S]*'image\/png'/);
  assert.match(tournamentLogoStorageSource, /has_tournament_permission\('tournaments\.write'\)/);
  for (const id of ['publicTabCategories', 'publicTabRegistrations', 'publicTabBrackets', 'publicTabSchedule', 'publicTabResults', 'publicTabAbout', 'tournamentAboutTitle', 'tournamentAboutText', 'tournamentSponsorText', 'tournamentAboutImageFile', 'aboutSponsorList']) {
    assert.match(adminSource, new RegExp(`id="${id}"`));
  }
  assert.match(adminSource, /id="tournamentLocation"/);
  assert.match(functionSource(adminSource, 'renderTournament'), /tournamentLocation'[\s\S]*t\.clube \|\| t\.club_name/);
  assert.match(functionSource(adminSource, 'saveTournament'), /clube:\s*\$\('tournamentLocation'\)\.value\.trim\(\)/);
  assert.match(functionSource(adminSource, 'saveTournament'), /sponsor_text:\s*\$\('tournamentSponsorText'\)[\s\S]*public_tabs:\s*publicTabs[\s\S]*about_event:\s*aboutEvent/);
  assert.match(functionSource(adminSource, 'uploadTournamentBrandingImage'), /2 \* 1024 \* 1024[\s\S]*tournament-branding/);
  assert.match(tournamentAdminSource, /const publicTabs = \{[\s\S]*registrations:[\s\S]*const aboutEvent = \{/);
  assert.match(tournamentAdminSource, /sponsor_text:\s*text\(requestedAboutEvent\.sponsor_text, 1000\)[\s\S]*public_tabs:\s*publicTabs[\s\S]*about_event:\s*aboutEvent/);
  assert.match(functionSource(tournamentSource, 'sponsorsHtml'), /aboutEventSettings\(\)\.sponsor_text[\s\S]*escapeHtml\(sponsorText\)/);
  assert.match(functionSource(tournamentSource, 'sponsorsHtml'), /sponsorHref[\s\S]*href \? '<a class="sponsor"[\s\S]*'<div class="sponsor">'/);
  assert.match(functionSource(tournamentSource, 'sponsorHref'), /if \(!raw \|\|[\s\S]*instagram\.com/);
  assert.match(tournamentSource, /\.sponsor \{[^}]*aspect-ratio:\s*1 \/ 1/);
  assert.match(adminSource, /Instagram<input data-sponsor-field="link_url"[\s\S]*1080 × 1080 px/);
  const retryPayment = sourceSection(tournamentSource, "const retry = $('retryPaymentBtn')", 'if (state.registrationOnly)');
  assert.match(retryPayment, /initializeRegistrationCaptcha\(\)/);
  assert.match(retryPayment, /registrationFoot'\)\.hidden = false/);
  assert.doesNotMatch(retryPayment, /requestSubmit\(\)/);
  const pixRepair = functionSource(tournamentRegisterSource, 'repairExistingPixPayment');
  assert.match(pixRepair, /provider_payment_id/);
  assert.match(pixRepair, /pix_payload\s*&&\s*localPayment\.pix_encoded_image/);
  assert.match(pixRepair, /payments\/\$\{encodeURIComponent\(providerPaymentId\)\}/);
  assert.match(pixRepair, /saveProviderPayment/);
  const existingProviderPayment = sourceSection(
    tournamentRegisterSource,
    'if (localPayment.provider_payment_id)',
    'if (!retryablePaymentStatuses.has',
  );
  assert.match(existingProviderPayment, /repairExistingPixPayment/);
  assert.doesNotMatch(existingProviderPayment, /createOrRecoverPayment/);
  assert.match(tournamentRegisterSource, /claim_public_tournament_registration_checkout/);
  assert.match(tournamentRegisterSource, /baseAmount \+ additionalFee/);
  const asaasCustomer = functionSource(tournamentRegisterSource, 'ensureAsaasCustomer');
  assert.doesNotMatch(asaasCustomer, /if \(athlete\.asaas_customer_id\) return/);
  assert.match(asaasCustomer, /customers\?cpfCnpj=/);
  assert.match(asaasCustomer, /externalReference:\s*`tournament-athlete:\$\{athlete\.id\}`/);
  assert.match(tournamentRegisterSource, /providerErrorSnapshot\(error\)/);
  assert.match(tournamentRegisterSource, /provider_status/);
  assert.match(tournamentRegisterSource, /provider_codes/);
  assert.doesNotMatch(
    tournamentRegisterSource,
    /console\.warn\("tournament-register(?: family)? PIX repair deferred",\s*\{[\s\S]{0,250}error\.message/,
  );
  assert.match(
    tournamentRegisterSource,
    /console\.warn\("tournament-register(?: family)? PIX repair deferred",\s*\{[\s\S]{0,250}provider_error:\s*providerErrorSnapshot\(error\)/,
  );
  const safePayment = vm.runInNewContext(
    `(${functionSource(tournamentRegisterSource, 'safePayment').replace('row: JsonRecord | null', 'row')})`,
  );
  for (const status of ['REFUNDED', 'CANCELLED', 'CHARGEBACK']) {
    const terminalPayment = safePayment({
      id: 'pay_terminal',
      status,
      invoice_url: 'https://provider.invalid/invoice',
      pix_payload: 'stale-pix-payload',
      pix_encoded_image: 'stale-qr-image',
      pix_expires_at: '2026-09-02T12:00:00Z',
    });
    for (const field of ['invoice_url', 'pix_payload', 'pix_encoded_image', 'pix_expires_at']) {
      assert.equal(terminalPayment[field], null);
    }
  }
  assert.equal(safePayment({ status: 'PENDING', pix_payload: 'active-pix' }).pix_payload, 'active-pix');
  assert.match(
    terminalPaymentArtifactCleanupSource,
    /before insert or update of status, invoice_url, pix_payload, pix_encoded_image, pix_expires_at[\s\S]*'REFUNDED', 'CANCELLED', 'CHARGEBACK'/,
  );
  const safeDescription = vm.runInNewContext(
    `(${functionSource(tournamentRegisterSource, 'asaasSafeDescription').replace('value: unknown', 'value')})`,
  );
  assert.equal(
    safeDescription('Inscrição Ilha Open 2026 · 2ª Classe Masculina + Espacial A Masculino 🚀'),
    'Inscricao Ilha Open 2026 2a Classe Masculina Espacial A Masculino',
  );
  assert.match(functionSource(tournamentRegisterSource, 'createOrRecoverPayment'), /description:\s*asaasSafeDescription/);
  assert.match(
    functionSource(tournamentRegisterSource, 'ensureAsaasCustomer'),
    /notificationDisabled:\s*asaasConfig\(\)\.environment === "SANDBOX"/
  );
  assert.match(
    functionSource(tournamentRegisterSource, 'ensureAsaasFamilyCustomer'),
    /notificationDisabled:\s*asaasConfig\(\)\.environment === "SANDBOX"/
  );
  const billingDate = functionSource(tournamentRegisterSource, 'saoPauloDate');
  assert.match(billingDate, /timeZone: "America\/Sao_Paulo"/);
  assert.match(billingDate, /formatToParts/);
  assert.match(billingDate, /`\$\{values\.year\}-\$\{values\.month\}-\$\{values\.day\}`/);
  assert.match(asaasWebhookSource, /apply_tournament_payment_reconciliation/);
});

test('valores por perfil e adicional espacial do Ilha Open são editáveis no ADM e validados no backend', () => {
  for (const id of ['tournamentPriceCincate', 'tournamentPriceStudent', 'tournamentPriceNonMember', 'tournamentPriceSpatialAddon']) {
    assert.match(adminSource, new RegExp(`id="${id}"`));
  }
  assert.match(adminSource, /registration_pricing:\s*pricing/);
  assert.match(adminSource, /spatial_addon_fee:\s*spatialAddonFee/);
  assert.match(tournamentAdminSource, /registrationPricing/);
  assert.match(tournamentAdminSource, /spatialAddonFee/);
  assert.match(tournamentAdminSource, /99999\.99/);
  assert.match(tournamentRegisterSource, /registrationPricing\[participantType\]/);
  assert.doesNotMatch(tournamentRegisterSource, /const configuredBaseAmount/);
  assert.match(tournamentSource, /function participantRegistrationAmount/);
  assert.match(tournamentSource, /function spatialAddonFee/);
  assert.match(tournamentSource, /participantPriceCincate/);
  assert.match(tournamentSource, /participantPriceStudent/);
  assert.match(tournamentSource, /participantPriceNonMember/);
});

test('inscrição online reserva a vaga por duas horas e o ADM permite reenviar a cobrança', () => {
  assert.match(tournamentPaymentExpiryMigrationSource, /expires_at[\s\S]*interval '2 hours'/);
  assert.match(tournamentPaymentExpiryMigrationSource, /archive_expired_tournament_payment/);
  assert.match(tournamentPaymentExpiryMigrationSource, /private\.tournament_expired_registration_attempts/);
  assert.match(tournamentPaymentExpiryMigrationSource, /ilha-open-expire-unpaid-registrations/);
  assert.match(tournamentPaymentExpiryMigrationSource, /tournament_payment_expiry_publishable_key/);
  assert.match(tournamentPaymentExpiryAuthFixSource, /auth\.jwt\(\) ->> ''role''/);
  assert.match(tournamentPaymentExpirySource, /payments\/\$\{encodeURIComponent\(providerPaymentId\)\}/);
  assert.match(tournamentPaymentExpirySource, /method: "DELETE"/);
  assert.match(tournamentPaymentExpirySource, /EXPIRY_REMOVABLE_PROVIDER_STATUSES = new Set\(\["PENDING", "OVERDUE"\]\)/);
  const expiryDispositionSource = functionSource(tournamentPaymentExpirySource, 'paymentExpiryRemoteDisposition')
    .replace(/:\s*(?:boolean|number|string)/g, '');
  const expiryDisposition = vm.runInNewContext(
    `(() => {
      const EXPIRY_REMOVABLE_PROVIDER_STATUSES = new Set(["PENDING", "OVERDUE"]);
      return (${expiryDispositionSource});
    })()`,
  );
  assert.equal(expiryDisposition(true, true, 200, false, 'pay_pending', 'PENDING'), 'DELETE_THEN_ARCHIVE');
  assert.equal(expiryDisposition(true, true, 200, false, 'pay_overdue', 'OVERDUE'), 'DELETE_THEN_ARCHIVE');
  assert.equal(expiryDisposition(true, false, 404, true, '', ''), 'ARCHIVE_REMOTE_ABSENT');
  assert.equal(expiryDisposition(false, true, 200, true, '', ''), 'ARCHIVE_REMOTE_ABSENT');
  for (const status of [
    'CREATED',
    'CONFIRMED',
    'RECEIVED',
    'REFUND_IN_PROGRESS',
    'AWAITING_CHARGEBACK_REVERSAL',
    'UNKNOWN_FUTURE_STATUS',
    '',
  ]) {
    assert.equal(
      expiryDisposition(true, true, 200, false, 'pay_review', status),
      'DEFER',
      `status ${status || '(empty)'} must fail closed`,
    );
  }
  assert.equal(
    expiryDisposition(true, true, 200, true, '', ''),
    'DEFER',
    'a malformed successful lookup for a stored provider id is not safe absence',
  );
  assert.match(
    tournamentPaymentExpirySource,
    /if \(!\["DELETE_THEN_ARCHIVE", "ARCHIVE_REMOTE_ABSENT"\]\.includes\(remoteDisposition\)\) \{\s*await scheduleReconciliation\(client, payment\);\s*summary\.deferred \+= 1;\s*return;/,
  );
  assert.match(tournamentPaymentExpirySource, /status === "RECEIVED"/);
  assert.match(tournamentPaymentExpirySource, /status === "CONFIRMED"[\s\S]*persistConfirmedReview/);
  assert.match(tournamentPaymentExpirySource, /CONFIRMED_REVIEW_WINDOW_MS = 72 \* 60 \* 60 \* 1000/);
  assert.match(tournamentPaymentExpirySource, /TOURNAMENT_PAYMENT_EXPIRY_TOKEN/);
  assert.match(tournamentPaymentExpirySource, /x-tournament-expiry-token/);
  assert.match(tournamentPaymentExpirySource, /const MAX_BATCH = 12[\s\S]*const MAX_CONCURRENCY = 3[\s\S]*const MAX_RUNTIME_MS/);
  assert.match(tournamentPaymentExpirySource, /next_reconciliation_at[\s\S]*lte\("next_reconciliation_at", now\)/);
  assert.match(functionSource(tournamentPaymentExpirySource, 'archiveLocally'), /if \(!isExpired\(payment\)\) return false/);
  assert.match(tournamentPaymentExpirySource, /archive_expired_tournament_payment/);
  assert.match(tournamentPaymentReconciliationSource, /'RECONCILING'[\s\S]*'REVIEW_REQUIRED'/);
  assert.match(tournamentPaymentReconciliationSource, /tournament_payments_reconciliation_due_idx/);
  assert.match(tournamentPaymentReconciliationSource, /tournament_payment_expiry_token/);
  assert.match(tournamentPaymentReconciliationSource, /'x-tournament-expiry-token', expiry_token/);
  assert.doesNotMatch(tournamentPaymentReconciliationSource, /'Authorization', 'Bearer '/);
  assert.doesNotMatch(tournamentPaymentReconciliationSource, /request\.jwt\.claim\.role/);
  assert.ok((tournamentPaymentReconciliationSource.match(/auth\.jwt\(\) ->> 'role'/g) || []).length >= 3);
  assert.match(tournamentRegisterSource, /claimProviderPaymentAttempt/);
  assert.match(tournamentRegisterSource, /AmbiguousPaymentCreationError/);
  assert.match(tournamentRegisterSource, /status: "RECONCILING"/);
  const markClaimedFailure = functionSource(tournamentRegisterSource, 'markClaimedProviderFailure');
  assert.match(markClaimedFailure, /eq\("status", claimedPayment\.status\)/);
  assert.match(markClaimedFailure, /eq\("updated_at", claimedPayment\.updated_at\)/);
  assert.match(markClaimedFailure, /select\("\*"\)[\s\S]*eq\("id", claimedPayment\.id\)[\s\S]*single\(\)/);
  assert.match(tournamentSource, /payload\.request_token = loadIndividualRequestToken\(requestKey\)/);
  assert.match(functionSource(tournamentSource, 'loadIndividualRequestToken'), /localStorage\.setItem\(storageKey,token\)/);
  const registrationTokenFactory = functionSource(tournamentSource, 'registrationRequestToken');
  assert.match(registrationTokenFactory, /crypto\.getRandomValues/);
  assert.doesNotMatch(registrationTokenFactory, /Math\.random/);
  const storageFingerprint = functionSource(tournamentSource, 'secureStorageFingerprint');
  assert.match(storageFingerprint, /crypto\.subtle\.digest\('SHA-256'/);
  const familyStorageKey = functionSource(tournamentSource, 'familyRequestStorageKey');
  assert.match(familyStorageKey, /secureStorageFingerprint/);
  assert.match(familyStorageKey, /digitsOnly\(payer && payer\.cpf\)/);
  const familyRequestToken = functionSource(tournamentSource, 'loadFamilyRequestToken');
  assert.match(familyRequestToken, /state\.familyRequestKey = storageKey;[\s\S]*state\.familyRequestToken = '';[\s\S]*localStorage\.getItem\(storageKey\)/);
  const individualStorageKey = functionSource(tournamentSource, 'individualRequestStorageKey');
  assert.match(individualStorageKey, /individualStorageFingerprint/);
  const legacyStorageCleanup = functionSource(tournamentSource, 'clearLegacyIndividualStorage');
  assert.match(legacyStorageCleanup, /oldTrackingKey[\s\S]*oldCapabilityKey/);
  assert.match(legacyStorageCleanup, /!opaqueKey\.test\(key\)/);
  assert.match(legacyStorageCleanup, /localStorage\.removeItem\(key\)/);
  assert.doesNotMatch(tournamentSource, /\['ilha_torneio',state\.slug,payload\.category_id,payload\.phone/);
  assert.match(tournamentPaymentReconciliationSource, /create or replace function public\.claim_public_tournament_registration_checkout/);
  assert.match(tournamentPaymentReconciliationSource, /registration\.request_token = p_request_token/);
  assert.match(tournamentPaymentReconciliationSource, /insert into public\.tournament_payments[\s\S]*on conflict \(registration_id\) do nothing/);
  assert.match(functionSource(tournamentRegisterSource, 'reconcileAmbiguousPayment'), /findAsaasPayment/);
  assert.doesNotMatch(functionSource(tournamentRegisterSource, 'reconcileAmbiguousPayment'), /method:\s*"POST"/);
  assert.match(functionSource(tournamentRegisterSource, 'saveProviderPayment'), /moneyCents\(providerAmount\)[\s\S]*moneyCents\(localPayment\.amount\)/);
  assert.match(functionSource(tournamentPaymentExpirySource, 'completedRefundAmountCents'), /moneyCents\(refund\.value\)/);
  assert.match(tournamentPaymentExpirySource, /refundTotalCents >= paymentAmountCents/);
  assert.match(tournamentPaymentReconciliationSource, /provider_environment text not null default 'UNKNOWN'/);
  assert.match(tournamentPaymentReconciliationSource, /quarantine_tournament_payment_environment/);
  assert.match(tournamentPaymentReconciliationSource, /provider_environment = 'UNKNOWN'[\s\S]*invoice_url = null[\s\S]*pix_payload = null/);
  assert.match(tournamentRegisterSource, /provider_environment: providerEnvironment/);
  assert.match(tournamentRegisterSource, /p_provider_environment: providerEnvironment/);
  for (const source of [tournamentRegisterSource, asaasWebhookSource, tournamentPaymentExpirySource]) {
    assert.match(source, /\$aact_hmlg_/);
    assert.match(source, /\$aact_prod_/);
    assert.match(source, /provider_environment/);
  }
  assert.match(functionSource(tournamentRegisterSource, 'saveProviderPayment'), /providerBillingType !== "PIX"/);
  assert.match(asaasWebhookSource, /providerBillingType !== "PIX"/);
  assert.match(functionSource(tournamentPaymentExpirySource, 'remoteMismatch'), /billingType[\s\S]*!== "PIX"/);
  assert.match(asaasGoLiveRunbookSource, /incompatible_active_charges[\s\S]*deve ser \*\*zero\*\*/i);
  const saveProviderPayment = functionSource(tournamentRegisterSource, 'saveProviderPayment');
  assert.match(saveProviderPayment, /status === "RECEIVED"[\s\S]*apply_tournament_payment_reconciliation/);
  assert.match(tournamentPaymentReconciliationSource, /create or replace function public\.apply_tournament_payment_reconciliation/);
  assert.match(tournamentPaymentReconciliationSource, /for update[\s\S]*sync_tournament_registration_payment_group/);
  assert.doesNotMatch(adminSource, /const onlinePaid = \['RECEIVED', 'CONFIRMED'\]/);
  assert.match(adminSource, /onlineReview = onlineStatus === 'CONFIRMED'/);
  assert.match(adminSource, /onlineManualReview = onlineStatus === 'REVIEW_REQUIRED'/);
  assert.match(adminSource, /onlinePartialReview = onlineStatus === 'PARTIALLY_REFUNDED'/);
  assert.match(tournamentSource, /CONFIRMED:'Pagamento em análise'/);
  assert.match(tournamentSource, /PARTIALLY_REFUNDED:'Estorno parcial · em revisão'/);
  const publicPaymentResult = functionSource(tournamentSource, 'renderRegistrationSuccess');
  assert.match(publicPaymentResult, /const payable = \['PENDING','PENDENTE'\]\.includes\(normalizedStatus\)/);
  assert.match(publicPaymentResult, /invoiceUrl && payable/);
  assert.match(publicPaymentResult, /pixImage && payable/);
  assert.match(publicPaymentResult, /pix && payable/);
  assert.match(publicPaymentResult, /\['CANCELLED','CHARGEBACK'\]/);
  assert.match(publicPaymentResult, /OVERDUE:'Prazo vencido'/);
  assert.match(publicPaymentResult, /terminalCheckout[\s\S]*clearFamilyRequestToken\(\)/);
  assert.match(publicPaymentResult, /terminalCheckout[\s\S]*clearIndividualRequestToken\(state\.individualRequestKey\)/);
  assert.match(tournamentSource, /class="modal" role="dialog" aria-modal="true"[^>]*tabindex="-1"/);
  assert.match(tournamentSource, /class="success-box"[^>]*role="status"[^>]*tabindex="-1"/);
  assert.match(tournamentSource, /choice-card:has\(input:focus-visible\)/);
  assert.match(tournamentSource, /family-day-option:has\(input:focus-visible\)/);
  const modalInert = functionSource(tournamentSource, 'setRegistrationBackgroundInert');
  assert.match(modalInert, /setAttribute\('inert'/);
  assert.match(modalInert, /removeAttribute\('inert'/);
  const modalKeyboard = functionSource(tournamentSource, 'handleRegistrationModalKeydown');
  assert.match(modalKeyboard, /event\.key !== 'Tab'/);
  assert.match(modalKeyboard, /first[\s\S]*last/);
  const modalFocusable = functionSource(tournamentSource, 'registrationModalFocusableElements');
  assert.match(modalFocusable, /not\(\[tabindex="-1"\]\)/);
  assert.match(modalFocusable, /closest\('\[hidden\],\[inert\]'\)/);
  assert.match(functionSource(tournamentSource, 'closeRegistration'), /trigger\.focus\(\)/);
  assert.match(tournamentRegisterSource, /expires_at: row\.expires_at \|\| null/);
  assert.match(tournamentSource, /Sua vaga fica reservada por 2 horas e só é confirmada após o pagamento/);
  assert.match(tournamentAdminSource, /pagamentos_online/);
  assert.match(adminSource, /Enviar cobrança no WhatsApp/);
  assert.match(adminSource, /data-tournament-payment-copy/);
  assert.match(adminSource, /data-tournament-payment-pix/);
});

test('inscrição familiar reúne menores e adultos em um único Pix sem usar o cadastro de alunos', () => {
  for (const marker of [
    'data-registration-mode="individual"',
    'data-registration-mode="minor"',
    'data-registration-mode="family"',
    'CPF e telefone são opcionais para menores de idade',
    'O responsável também vai jogar',
    'Adicionar outro atleta',
    'Total em um único Pix'
  ]) assert.match(tournamentSource, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(tournamentSource, /payer:\s*payer/);
  assert.match(tournamentSource, /athletes:\s*payloadAthletes/);
  assert.match(tournamentSource, /additional_category_id:\s*additional/);
  assert.match(tournamentRegisterSource, /handleFamilyRegistration/);
  assert.match(tournamentRegisterSource, /if \(isMinor\)[\s\S]*cpf && !isValidCpf/);
  assert.match(tournamentRegisterSource, /ensureAsaasFamilyCustomer/);
  assert.match(tournamentRegisterSource, /tournament-family:\$\{group\.id\}/);
  assert.match(tournamentRegisterSource, /claim_public_tournament_family_checkout/);
  assert.match(tournamentRegisterSource, /athlete_source_key:\s*await familyAthleteSourceKey/);
  assert.doesNotMatch(
    functionSource(tournamentRegisterSource, 'handleFamilyRegistration'),
    /from\("tournament_athletes"\)\.(?:insert|update|delete)/,
  );
  const familyRegistrationHandler = functionSource(tournamentRegisterSource, 'handleFamilyRegistration');
  assert.doesNotMatch(familyRegistrationHandler, /existingGroupResult|retryEntries|primary_amount:\s*0/);
  assert.equal((familyRegistrationHandler.match(/await claimFamilyCheckout\(/g) || []).length, 2);
  assert.match(familyRegistrationHandler, /if \(billingType !== "PIX"\)/);
  assert.doesNotMatch(familyRegistrationHandler, /allowedBillingTypes\.has\(billingType\)/);
  assert.match(familyRegistrationHandler, /p_billing_type:\s*"PIX"/);
  assert.match(familyRegistrationHandler, /tournament,\s*"PIX",\s*Object\.keys\(record\(claimed\.payment\)\)/);
  assert.match(familyRegistrationHandler, /p_create_if_missing:\s*createIfMissing/);
  assert.match(familyRegistrationHandler, /!inviteMode\s*&&\s*!allowedMethods\.includes\("PIX"\)/);
  assert.match(familyRegistrationHandler, /primary_amount:\s*primaryAmount/);
  assert.match(atomicTournamentFamilyCheckoutSource, /normalized_billing_type <> 'PIX'/);
  const familyProbeIndex = familyRegistrationHandler.indexOf('await claimFamilyCheckout(probeEntries, false)');
  const familyOpenGateIndex = familyRegistrationHandler.indexOf('tournament.status !== "REGISTRATION_OPEN"');
  const familyCategoryGateIndex = familyRegistrationHandler.indexOf('failureStage = "family_category_lookup"');
  const familyCreateIndex = familyRegistrationHandler.indexOf('await claimFamilyCheckout(rpcEntries, true)');
  assert.ok(
    familyProbeIndex >= 0 && familyOpenGateIndex > familyProbeIndex &&
      familyCategoryGateIndex > familyOpenGateIndex && familyCreateIndex > familyCategoryGateIndex,
    'o retry existente precisa ser recuperado antes dos gates mutáveis; uma criação nova só ocorre depois deles',
  );
  assert.match(tournamentFamilyCheckoutSource, /create table public\.tournament_registration_groups/i);
  assert.match(tournamentFamilyCheckoutSource, /alter table public\.tournament_registration_groups enable row level security/i);
  assert.match(tournamentFamilyCheckoutSource, /claim_public_tournament_family_bundle/);
  assert.match(tournamentFamilyCheckoutSource, /jsonb_array_elements\(p_entries\) with ordinality/);
  assert.match(tournamentFamilyCheckoutSource, /registration\.registration_group_id = target_group_id/);
  assert.match(tournamentFamilyCheckoutSource, /archive_expired_tournament_payment[\s\S]*target_group_id/);
  assert.match(tournamentFamilyCheckoutSource, /delete from public\.tournament_payments[\s\S]*payment_row\.id/);
  assert.equal((tournamentFamilyCheckoutSource.match(/auth\.jwt\(\) ->> 'role'/g) || []).length, 3);
  assert.doesNotMatch(tournamentFamilyCheckoutSource, /current_setting\('request\.jwt\.claim\.role'/);
  assert.doesNotMatch(tournamentFamilyCheckoutSource, /app_clients|app_family_members|students/);
  assert.match(
    atomicTournamentFamilyCheckoutSource,
    /create or replace function public\.claim_public_tournament_family_checkout[\s\S]*security invoker/i,
  );
  const familyPreReadIndex = atomicTournamentFamilyCheckoutSource.indexOf('into pre_read_group');
  const familyPaymentLockIndex = atomicTournamentFamilyCheckoutSource.indexOf(
    'where payment.registration_group_id = pre_read_group.id',
    familyPreReadIndex,
  );
  const familyGroupLockIndex = atomicTournamentFamilyCheckoutSource.indexOf(
    'where registration_group.id = pre_read_group.id',
    familyPaymentLockIndex,
  );
  const familyExistingDecisionIndex = atomicTournamentFamilyCheckoutSource.indexOf(
    'if existing_group.id is not null then',
    familyGroupLockIndex,
  );
  assert.ok(
    familyPreReadIndex >= 0 && familyPaymentLockIndex > familyPreReadIndex &&
      familyGroupLockIndex > familyPaymentLockIndex && familyExistingDecisionIndex > familyGroupLockIndex,
    'o retry familiar precisa bloquear payment -> group antes de decidir entre existente e novo',
  );
  assert.doesNotMatch(
    atomicTournamentFamilyCheckoutSource.slice(familyPreReadIndex, familyPaymentLockIndex),
    /for update/i,
  );
  assert.match(
    atomicTournamentFamilyCheckoutSource.slice(familyPaymentLockIndex, familyGroupLockIndex),
    /for update/i,
  );
  const familyProbeMissIndex = atomicTournamentFamilyCheckoutSource.indexOf('if not p_create_if_missing then');
  const familyAthleteWriteIndex = atomicTournamentFamilyCheckoutSource.indexOf('insert into public.tournament_athletes');
  assert.ok(
    familyProbeMissIndex >= 0 && familyAthleteWriteIndex > familyProbeMissIndex,
    'um probe sem grupo precisa retornar antes de qualquer gravação de atleta',
  );
  assert.match(
    atomicTournamentFamilyCheckoutSource.slice(familyProbeMissIndex, familyAthleteWriteIndex),
    /'found', false/,
  );
  assert.match(
    atomicTournamentFamilyCheckoutSource,
    /claimed_group_id := coalesce\([\s\S]*existing_group\.id[\s\S]*registration_group,id/,
  );
  assert.match(
    atomicTournamentFamilyCheckoutSource,
    /if payment_row\.id is null then[\s\S]{0,800}insert into public\.tournament_payments/i,
  );
  assert.doesNotMatch(
    atomicTournamentFamilyCheckoutSource,
    /payment_row\.id is null and p_create_if_missing/,
  );
  assert.match(
    atomicTournamentFamilyCheckoutSource,
    /existing_group\.id is not null[\s\S]*payment_row\.provider_payment_id is null[\s\S]*payment_row\.status in \('CREATED', 'FAILED'\)[\s\S]*archive_expired_tournament_payment\(payment_row\.id\)[\s\S]*'expired', true/,
  );
  assert.match(
    familyRegistrationHandler,
    /if \(probedCheckout\.expired === true\) \{[\s\S]{0,300}\}, 410\);/,
  );
  assert.match(atomicTournamentFamilyCheckoutSource, /'found', true/);
  assert.match(
    atomicTournamentFamilyCheckoutSource,
    /insert into public\.tournament_athletes[\s\S]*claim_public_tournament_family_bundle[\s\S]*insert into public\.tournament_payments/i,
  );
  assert.match(
    atomicTournamentFamilyCheckoutSource,
    /'tournament-family:' \|\| group_row\.id::text[\s\S]*on conflict \(registration_group_id\)/i,
  );
  assert.match(atomicTournamentFamilyCheckoutSource, /group_row\.created_at \+ interval '2 hours'/i);
  assert.match(
    atomicTournamentFamilyCheckoutSource,
    /claim_public_tournament_invite_bundle[\s\S]*'payment_created', payment_created/i,
  );
  assert.match(
    atomicTournamentFamilyCheckoutSource,
    /revoke all on function public\.claim_public_tournament_family_checkout[\s\S]*from public, anon, authenticated, service_role[\s\S]*to service_role/i,
  );
});

test('convite isento é único, limitado e consumido atomicamente com a inscrição', () => {
  assert.match(adminSource, /id="registrationInviteBtn"[^>]*>Gerar convite</);
  assert.doesNotMatch(adminSource, /id="courtesyTournamentLink"/);
  assert.match(functionSource(adminSource, 'registrationInviteMessage'), /Use o link abaixo[\s\S]*único e exclusivo para você/);
  assert.doesNotMatch(functionSource(adminSource, 'registrationInviteMessage'), /🎾|🚀|�/);
  const downloadInviteCard = functionSource(adminSource, 'downloadRegistrationInviteCard');
  assert.match(downloadInviteCard, /canvas\.width = 1080[\s\S]*canvas\.height = 1350/);
  assert.match(adminSource, /id="registrationInviteTournamentLogo"/);
  assert.match(adminSource, /class="tournament-invite-brand club"[\s\S]*src="\/assets\/branding\/ilha-tenis-ball\.png"/);
  assert.match(downloadInviteCard, /torneio\.logo_url[\s\S]*new URL\('\/assets\/branding\/ilha-tenis-ball\.png'/);
  assert.doesNotMatch(downloadInviteCard, /'PARA '\s*\+/);
  assert.doesNotMatch(downloadInviteCard, /moveTo\(78, 220\)/);
  assert.match(functionSource(adminSource, 'sendRegistrationInviteWhatsApp'), /registrationInviteMessage\(invite\)[\s\S]*window\.open/);
  assert.match(adminSource, /id="sendRegistrationInviteWhatsAppBtn"[^>]*>Enviar no WhatsApp</);
  assert.match(tournamentAdminSource, /createRegistrationInvite/);
  assert.match(tournamentAdminSource, /crypto\.randomUUID\(\)/);
  assert.match(tournamentAdminSource, /token_hash:\s*tokenHash/);
  assert.match(tournamentInviteSource, /create table public\.tournament_registration_invites/);
  assert.match(tournamentInviteSource, /alter table public\.tournament_registration_invites enable row level security/);
  assert.match(tournamentInviteSource, /revoke all on table public\.tournament_registration_invites from public, anon, authenticated/);
  assert.match(tournamentInviteSource, /for update/);
  assert.match(tournamentInviteSource, /athlete_count > invite_row\.athlete_limit/);
  assert.match(tournamentInviteSource, /set status = 'USED'/);
  assert.match(tournamentInviteSource, /update public\.tournaments[\s\S]*courtesy_registration_token = null/);
  assert.match(tournamentRegisterSource, /claim_public_tournament_family_checkout/);
  assert.match(atomicTournamentFamilyCheckoutSource, /claim_public_tournament_invite_bundle/);
  assert.match(
    functionSource(tournamentRegisterSource, 'handleFamilyRegistration'),
    /inviteMode \? "NOT_APPLICABLE" : asaasConfig\(\)\.environment/,
  );
  assert.match(tournamentRegisterSource, /await sha256Hex\(inviteToken\)/);
  assert.match(tournamentRegisterSource, /Este convite já foi utilizado/);
});

test('ADM identifica, acompanha, cancela e exclui convites não utilizados sem expor o token', () => {
  assert.match(adminSource, /data-tab="invitations">Convites/);
  assert.match(adminSource, /id="registrationInviteRecipientName"/);
  assert.match(adminSource, /id="registrationInviteRecipientPhone"/);
  assert.match(functionSource(adminSource, 'renderRegistrationInvites'), /used_athletes[\s\S]*data-revoke-registration-invite[\s\S]*data-delete-registration-invite/);
  assert.match(functionSource(adminSource, 'renderRegistrationInvites'), /data-share-registration-invite/);
  assert.match(functionSource(adminSource, 'shareManagedRegistrationInvite'), /getRegistrationInviteShareLink[\s\S]*registrationInviteMessage\(invite\)[\s\S]*window\.open/);
  assert.match(tournamentAdminSource, /recipient_name: recipientName/);
  assert.match(tournamentAdminSource, /convites:[\s\S]*used_athletes/);
  assert.match(tournamentAdminSource, /revokeRegistrationInvite/);
  assert.match(functionSource(tournamentAdminSource, 'deleteRegistrationInvite'), /status === "USED"[\s\S]*\.delete\(\)[\s\S]*\.neq\("status", "USED"\)[\s\S]*\.is\("used_registration_group_id", null\)/);
  assert.match(tournamentAdminSource, /action === "deleteRegistrationInvite"/);
  assert.match(functionSource(tournamentAdminSource, 'createRegistrationInvite'), /encryptRegistrationInviteToken\(rawToken\)[\s\S]*token_ciphertext: tokenCiphertext/);
  assert.match(functionSource(tournamentAdminSource, 'getRegistrationInviteShareLink'), /decryptRegistrationInviteToken[\s\S]*token_hash[\s\S]*invite_url/);
  assert.doesNotMatch(functionSource(tournamentAdminSource, 'loadSnapshot'), /token_hash/);
  assert.match(functionSource(tournamentAdminSource, 'loadSnapshot'), /share_ready: Boolean\(invite\.token_ciphertext\)/);
  assert.match(tournamentInviteManagementSource, /add column if not exists recipient_name text/);
  assert.match(tournamentInviteManagementSource, /recipient_phone is null or recipient_phone ~ '\^\[0-9\]\{10,13\}\$'/);
  assert.match(tournamentInviteManagementSource, /tournament_id, created_at desc/);
  assert.match(tournamentInviteShareSecretSource, /add column if not exists token_ciphertext text/);
  assert.match(tournamentInviteShareSecretSource, /revoke all on table public\.tournament_registration_invites from public, anon, authenticated/);
});

test('inscrição avisa sobre elegibilidade e permite ajuste administrativo de classe', () => {
  assert.match(tournamentSource, /CINCATE e Aluno Ilha Tênis serão conferidos/);
  assert.match(tournamentSource, /organização poderá alterar a classe escolhida/);
  assert.match(adminSource, /<label>Classe da inscrição<\/label>/);
  assert.match(adminSource, /esta inscrição será movida para a classe escolhida/);
});

test('rota residual de inscrição interna permanece privada e falha fechada por padrão', () => {
  for (const marker of [
    'name="is_minor"',
    'name="guardian_name"',
    'name="guardian_phone"',
    'Confirmar inscrição',
    'currentRegistrationFunction()',
    'MONTHLY_BILLING_SIMPLE'
  ]) assert.match(tournamentSource, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(tournamentSource, /category_ids:\s*selectedIds/);
  assert.match(tournamentSource, /internalRegistrationAmount\(count\)/);
  assert.match(tournamentInternalRegisterSource, /create_internal_tournament_registration/);
  assert.match(tournamentInternalRegisterSource, /consume_tournament_registration_network_rate_limits/);
  assert.match(tournamentInternalRegisterSource, /consume_tournament_registration_identity_rate_limit/);
  assert.doesNotMatch(tournamentInternalRegisterSource, /challenges\.cloudflare\.com|TURNSTILE_/);
  assert.match(tournamentInternalRegisterSource, /captcha_provider:\s*"none"/);
  assert.match(tournamentInternalRegisterSource, /const honeypot = text\(payload\.website/);
  assert.match(tournamentInternalRegisterSource, /category_gender_validation/);
  const internalSecurityConfig = functionSource(tournamentInternalRegisterSource, 'securityConfig');
  assert.match(internalSecurityConfig, /TOURNAMENT_INTERNAL_REGISTRATION_ENABLED/);
  assert.match(internalSecurityConfig, /=== "true"/);
  assert.match(internalSecurityConfig, /if \(!explicitlyEnabled\) return null/);
  assert.match(internalSecurityConfig, /PUBLIC_REGISTRATION_RATE_LIMIT_SALT/);
  assert.doesNotMatch(internalSecurityConfig, /serviceRoleKey|synthetic-staging-only/);
  assert.match(tournamentSource, /gender:\s*clean\(form\.get\('gender'\)\)/);
  assert.match(tournamentSource, /website:\s*clean\(form\.get\('website'\)\)/);
  assert.doesNotMatch(tournamentInternalRegisterSource, /ASAAS|paymentLink|billingType/);
});

test('inscrição interna é atômica, privada e editável no ADM', () => {
  assert.match(internalTournamentSource, /create table if not exists public\.tournament_registration_orders/i);
  assert.match(internalTournamentSource, /alter table public\.tournament_registration_orders enable row level security/i);
  assert.match(internalTournamentSource, /revoke all on table public\.tournament_registration_orders from public, anon, authenticated/i);
  assert.match(internalTournamentSource, /grant all on table public\.tournament_registration_orders to service_role/i);
  assert.match(internalTournamentSource, /security definer[\s\S]*set search_path = ''/i);
  assert.match(internalTournamentSource, /registration_mode', 'MONTHLY_BILLING_SIMPLE'/);
  assert.match(internalTournamentSource, /single_registration_fee', 50/);
  assert.match(internalTournamentSource, /double_registration_fee', 80/);
  assert.match(internalTournamentSource, /grant execute on function public\.create_internal_tournament_registration[\s\S]*to service_role/i);
  assert.match(internalTournamentGenderSource, /Infantil Masculino/);
  assert.match(internalTournamentGenderSource, /Infantil Feminino/);
  assert.match(internalTournamentGenderSource, /Adulto Iniciante Masculino/);
  assert.match(internalTournamentGenderSource, /Adulto Iniciante Feminino/);
  assert.match(internalTournamentGenderSource, /'requires_gender', true/);
  assert.match(tournamentAdminSource, /tournament_registration_orders/);
  assert.match(tournamentAdminSource, /guardian_name/);
  assert.match(tournamentAdminSource, /billing_status/);
  assert.match(tournamentAdminSource, /legacyOrderPaymentStatus/);
  assert.match(tournamentAdminSource, /relevantAthleteIds/);
  assert.match(tournamentAdminSource, /registration_order[\s\S]*billing_status:\s*billingStatus/);
  assert.match(internalTournamentPaidSource, /'PAID'/);
  assert.match(internalTournamentPaidSource, /paid_at timestamptz/);
  assert.match(adminSource, /id="playerMinor"/);
  assert.match(adminSource, /id="playerGuardianName"/);
  assert.match(adminSource, /id="playerGuardianPhone"/);
  assert.match(adminSource, /Pagamento da inscrição/);
  assert.match(adminSource, /PAID:\s*'PAGO/);
});

test('PWA remove somente caches do proprio aplicativo', () => {
  assert.match(serviceWorkerSource, /key\.startsWith\(CACHE_PREFIX\)/);
  assert.doesNotMatch(serviceWorkerSource, /filter\(key => key !== CACHE_NAME\)/);
  assert.match(serviceWorkerSource, /requestedUrl\.origin === self\.location\.origin/);
});

test('rota legada de clientes preserva query string e hash', () => {
  assert.match(clientRedirectSource, /window\.location\.search \+ window\.location\.hash/);
  assert.match(clientRedirectSource, /window\.location\.replace\(destination\)/);
});

test('autorizacao administrativa exige allowlist protegida e evita lockout', () => {
  assert.match(securityMigrationSource, /join public\.protected_access_accounts/);
  assert.match(securityMigrationSource, /não há administrador confiável ativo/);
  assert.match(securityMigrationSource, /unprotected_staff_count/);
  assert.doesNotMatch(securityMigrationSource, /when not exists \(select 1 from public\.profiles\) then 'admin'/i);
});

test('permissoes de Clube e Bar precisam existir no perfil e na allowlist', () => {
  const permissionHelpers = sourceSection(
    securityMigrationSource,
    'create or replace function public.has_bar_permission',
    'create or replace function public.is_bar_staff'
  );
  assert.match(permissionHelpers, /coalesce\(profile\.permissions, '\[\]'::jsonb\) \? p_permission/g);
  assert.match(permissionHelpers, /coalesce\(protected_account\.permissions, '\[\]'::jsonb\) \? p_permission/g);
  assert.equal((permissionHelpers.match(/protected_account\.active is true/g) || []).length, 2);
  assert.equal((permissionHelpers.match(/profile\.active is true/g) || []).length, 2);
});

test('preflight da migration recusa allowlist orfa, permissao ambigua e divergencia', () => {
  for (const marker of [
    'orphaned_protected_count',
    'ambiguous_staff_permission_count',
    'mismatched_staff_permission_count',
    'duplicate_athlete_cpf_groups',
    'duplicate_client_cpf_groups'
  ]) assert.match(securityMigrationSource, new RegExp(marker));
  assert.match(securityMigrationSource, /entrada\(s\) ativa\(s\) da allowlist não possui\(em\) Auth e perfil ativo correspondentes/);
  assert.match(securityMigrationSource, /permissões vazias ou o marcador legado do Bar/);
  assert.match(securityMigrationSource, /\('public\.tournaments'\)/);
  assert.match(securityMigrationSource, /\('public\.app_push_subscriptions'\)/);
  assert.match(securityMigrationSource, /missing_columns/);
  assert.match(securityMigrationSource, /\('public\.app_clients', 'registration_completed_at'\)/);
});

test('revogacao de administrador e troca de email nao permitem lockout silencioso', () => {
  const protectedProfiles = sourceSection(
    securityMigrationSource,
    'create or replace function public.remember_protected_profile',
    'create or replace function public.count_active_protected_admins'
  );
  assert.match(protectedProfiles, /create trigger remember_protected_profile_trigger\s+before insert or update/);
  assert.match(protectedProfiles, /create trigger guard_protected_auth_email_change\s+before update of email on auth\.users/);
  assert.match(protectedProfiles, /O e-mail de uma conta protegida não pode ser alterado pelo fluxo comum/);
  assert.match(protectedProfiles, /update public\.protected_access_accounts\s+set active = false/);
  assert.match(protectedProfiles, /pg_advisory_xact_lock/);
  assert.match(protectedProfiles, /O último administrador ativo não pode ser removido/);
});

test('reset recuperavel cria backup privado e zera somente a ficha do Ilha Play', () => {
  assert.match(recoverableClientResetSource, /create table if not exists private\.app_client_account_backups/);
  assert.match(recoverableClientResetSource, /alter table private\.app_client_account_backups enable row level security/);
  assert.match(
    recoverableClientResetSource,
    /revoke all on table private\.app_client_account_backups\s+from public, anon, authenticated, service_role/
  );
  assert.match(recoverableClientResetSource, /Nunca armazena senha, hash de senha, sessão ou token Auth/);
  assert.match(recoverableClientResetSource, /expires_at timestamptz not null default \(now\(\) \+ interval '90 days'\)/);

  const reset = sourceSection(
    recoverableClientResetSource,
    'create or replace function public.reset_app_client_account_with_backup',
    'revoke all on function public.reset_app_client_account_with_backup'
  );
  assert.match(reset, /not coalesce\(public\.has_club_permission\('clients\.write'\), false\)/);
  assert.match(reset, /Você não pode zerar a própria conta administrativa/);
  assert.match(reset, /pg_advisory_xact_lock/);
  assert.ok(
    reset.indexOf('insert into private.app_client_account_backups')
      < reset.indexOf('update public.app_clients')
  );
  assert.match(reset, /extensions\.digest[\s\S]*'sha256'/);
  assert.match(reset, /protected_after is distinct from protected_before/);
  assert.match(reset, /O reset tentou alterar dados protegidos e foi integralmente cancelado/);
  assert.match(reset, /'deleted', false/);
  assert.match(reset, /'preserved_auth_access', true/);
  assert.match(reset, /'preserved_history', true/);
  assert.doesNotMatch(reset, /delete from (?:auth\.users|public\.)/);

  const restore = sourceSection(
    recoverableClientResetSource,
    'create or replace function public.restore_app_client_account_backup',
    'revoke all on function public.restore_app_client_account_backup'
  );
  assert.match(restore, /backup_row\.expires_at <= now\(\)/);
  assert.match(restore, /backup_row\.app_client_snapshot::text[\s\S]*'sha256'/);
  assert.match(restore, /current_fingerprint is distinct from backup_row\.protected_state_after/);
  assert.match(restore, /O cliente já iniciou um novo cadastro\. Nada foi sobrescrito/);
  assert.match(restore, /pg_catalog\.jsonb_populate_record/);
  assert.match(restore, /set state = 'RESTORED'/);
  assert.doesNotMatch(restore, /update (?:auth\.users|public\.profiles)/);

  const list = sourceSection(
    recoverableClientResetSource,
    'create or replace function public.list_app_client_account_backups',
    'revoke all on function public.list_app_client_account_backups'
  );
  assert.match(list, /has_club_permission\('clients\.write'\)/);
  assert.doesNotMatch(list, /app_client_snapshot|snapshot_sha256|protected_state_/);

  for (const rpcSignature of [
    'reset_app_client_account_with_backup\\(uuid, text\\)',
    'reset_app_client_account\\(uuid\\)',
    'delete_app_client_account\\(uuid\\)',
    'list_app_client_account_backups\\(uuid, integer\\)',
    'restore_app_client_account_backup\\(uuid\\)'
  ]) {
    assert.match(recoverableClientResetSource, new RegExp(`revoke all on function public\\.${rpcSignature}[\\s\\S]{0,80}from public, anon`));
    assert.match(recoverableClientResetSource, new RegExp(`grant execute on function public\\.${rpcSignature}[\\s\\S]{0,80}to authenticated`));
  }

  const adminReset = functionSource(adminSource, 'deleteClientFromAdmin');
  assert.match(adminReset, /rpc\/reset_app_client_account_with_backup/);
  assert.match(adminReset, /backup_id/);
  assert.match(adminSource, /rpc\/list_app_client_account_backups/);
  assert.match(adminSource, /rpc\/restore_app_client_account_backup/);
});

test('aprovacao de cliente valida cadastro completo antes de ativar Auth', () => {
  const approval = sourceSection(
    securityMigrationSource,
    'create or replace function public.approve_app_client',
    'revoke all on function public.approve_app_client'
  );
  for (const marker of [
    'registration_completed_at',
    'public.is_valid_cpf',
    'America/Sao_Paulo',
    'guardian_name',
    'declared_lesson_slots',
    'weekly_lessons'
  ]) assert.match(approval, new RegExp(marker.replace('/', '\\/')));
  assert.ok(approval.indexOf('registration_completed_at') < approval.indexOf('update auth.users'));
  assert.ok(approval.indexOf('declared_lesson_slots') < approval.indexOf("set status = 'ATIVO'"));
});

test('agenda exige cliente ativo e mascara nomes de terceiros', () => {
  const availability = sourceSection(
    securityMigrationSource,
    'create or replace function public.get_app_court_availability',
    'revoke all on function public.get_app_court_availability'
  );
  assert.match(availability, /upper\(coalesce\(client\.status, ''\)\) = 'ATIVO'/);
  assert.match(availability, /client\.registration_completed_at is not null/);
  assert.match(availability, /p_end_date > today_sp \+ 45/);
  assert.match(availability, /when caller_is_staff[\s\S]*or booking\.client_id = caller_id[\s\S]*else null/);
  assert.match(securityMigrationSource, /drop policy if exists "court bookings insert own"/);
  assert.match(securityMigrationSource, /create policy "court bookings office insert"/);
});

test('ADM preserva reservas antigas em histórico e permite limpar só a configuração passada', () => {
  const removal = functionSource(adminSource, 'removeCourtExtraDate');
  const agendaDates = functionSource(adminSource, 'courtAgendaDates');
  assert.match(adminSource, /data-court-view="history"/);
  assert.match(adminSource, /id="courtHistoryList"/);
  assert.match(adminSource, /id="courtRankingList"/);
  assert.match(adminSource, /id="courtPastDaysList"/);
  assert.match(removal, /isPastDate/);
  assert.match(removal, /As .*reserva\(s\) continuarão no histórico/);
  assert.doesNotMatch(removal, /app_court_bookings[^\n]+method:\s*'DELETE'/);
  assert.match(removal, /app_court_schedule_days/);
  assert.match(agendaDates, />= today/);
});

test('ranking das quadras conta os dois jogadores apenas em partidas confirmadas', () => {
  const courtRankingForRows = loadFunction(adminSource, 'courtRankingForRows', {
    Map,
    normalizedClientText: (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(),
    findCourtRegisteredClient: (id, name) => id === 'a' || name === 'Ana' ? { id: 'a', name: 'Ana' } : null
  });
  const ranking = courtRankingForRows([
    { id: '1', date: '2026-08-20', status: 'CONFIRMADO', clientId: 'a', client: 'Ana', opponentClientId: 'b', opponent: 'Beto' },
    { id: '2', date: '2026-08-19', status: 'CONFIRMADO', clientId: 'c', client: 'Caio', opponentClientId: '', opponent: 'Ana' },
    { id: '3', date: '2026-08-18', status: 'CANCELADO', clientId: 'b', client: 'Beto', opponentClientId: '', opponent: 'Duda' },
    { id: '4', date: '2026-08-17', status: 'BLOQUEADO', clientId: '', client: 'Bloqueado', opponentClientId: '', opponent: '' }
  ]);
  assert.equal(ranking[0].name, 'Ana');
  assert.equal(ranking[0].matches, 2);
  assert.equal(ranking.find((player) => player.name === 'Beto').matches, 1);
  assert.equal(ranking.find((player) => player.name === 'Caio').matches, 1);
  assert.equal(ranking.some((player) => player.name === 'Duda'), false);
  assert.equal(ranking.filter((player) => player.name === 'Ana').length, 1);
  const save = functionSource(adminSource, 'saveCourtSlotAction');
  assert.match(save, /opponent_client_id/);
  assert.match(save, /Esse adversário já tem horário nesse dia/);
});

test('ajuste de estoque e REST direto exigem permissao de produtos', () => {
  const stockRpc = sourceSection(
    securityMigrationSource,
    'create or replace function public.bar_adjust_stock',
    'revoke all on function public.bar_adjust_stock'
  );
  const inventoryPolicies = sourceSection(
    securityMigrationSource,
    'drop policy if exists "bar staff manage inventory"',
    'drop policy if exists "bar staff manage finance"'
  );
  assert.match(stockRpc, /has_bar_permission\('bar\.products'\)/);
  assert.doesNotMatch(stockRpc, /has_bar_permission\('bar\.orders'\)/);
  assert.match(inventoryPolicies, /write inventory by permission[\s\S]*has_bar_permission\('bar\.products'\)/);
  assert.doesNotMatch(inventoryPolicies, /has_bar_permission\('bar\.orders'\)/);
});

test('RPCs legadas de comanda exigem bar.orders sem bloquear o perfil do Bar', () => {
  const orderGate = sourceSection(
    securityMigrationSource,
    'create or replace function public.is_bar_staff',
    'create or replace function public.has_any_bar_permission'
  );
  const anyBarGate = sourceSection(
    securityMigrationSource,
    'create or replace function public.has_any_bar_permission',
    'create or replace function public.is_club_staff'
  );
  const ownProfile = sourceSection(
    securityMigrationSource,
    'create or replace function public.bar_update_own_profile',
    'revoke all on function public.bar_update_own_profile'
  );
  assert.match(orderGate, /has_bar_permission\('bar\.orders'\)/);
  assert.equal((orderGate.match(/has_bar_permission\(/g) || []).length, 1);
  for (const permission of ['bar.overview', 'bar.orders', 'bar.kitchen', 'bar.products', 'bar.events', 'bar.access']) {
    assert.match(anyBarGate, new RegExp(`has_bar_permission\\('${permission.replace('.', '\\.')}\\'`));
  }
  assert.match(ownProfile, /has_any_bar_permission\(\)/);
  assert.doesNotMatch(ownProfile, /is_bar_staff\(\)/);
});

test('Bar publico limita espera e nao sobrepoe atualizacoes de cardapio ou comanda', () => {
  const timedFetch = functionSource(barPublicSource, 'fetchBarRequest');
  const menuRequest = functionSource(barPublicSource, 'requestPublicMenu');
  const orderStatus = functionSource(barPublicSource, 'loadOrderStatus');
  const pushRequest = functionSource(barPublicSource, 'notifyBarTeamAboutOrder');
  assert.match(barPublicSource, /const BAR_REQUEST_TIMEOUT_MS = 12000/);
  assert.match(timedFetch, /new AbortController\(\)/);
  assert.match(timedFetch, /controller\.abort\(\)/);
  assert.match(timedFetch, /await readBody\(response\)/);
  assert.match(timedFetch, /clearTimeout\(timeout\)/);
  assert.match(functionSource(barPublicSource, 'rpc'), /fetchBarRequest\(/);
  assert.match(menuRequest, /state\.menuRequestPromise/);
  assert.match(orderStatus, /state\.orderRefreshPromise/);
  assert.match(orderStatus, /forceRefresh/);
  assert.match(barPublicSource, /const BAR_ORDER_REFRESH_INTERVAL_MS = 5000/);
  assert.match(barPublicSource, /const BAR_MENU_REFRESH_INTERVAL_MS = 15000/);
  assert.match(functionSource(barPublicSource, 'loadMenu'), /startMenuPolling\(\)/);
  assert.doesNotMatch(
    sourceSection(barPublicSource, 'initAppSync();', "if ('serviceWorker' in navigator)"),
    /startMenuPolling\(\)/
  );
  assert.match(pushRequest, /fetchBarRequest\(/);
  assert.doesNotMatch(pushRequest, /Authorization/);
  assert.match(barPublicSource, /'bar_public_card_order_status'\]\.includes\(name\)/);
});

test('QR do Bar exige telefone valido antes de reutilizar comanda vinculada', () => {
  const state = {
    access: {
      kind: 'CARTAO',
      linked: true,
      linked_customer_name: 'Cliente Teste',
      fixed_table_id: ''
    }
  };
  const linkedAccessIdentityWithoutPhone = loadFunction(barPublicSource, 'linkedAccessIdentity', {
    state,
    readSession: () => ({ name: 'Cliente Teste', phone: '' }),
    validPhone: () => false,
    normalizePhone: (value) => String(value || '').replace(/\D/g, '')
  });
  assert.equal(linkedAccessIdentityWithoutPhone(), null);

  const linkedAccessIdentityWithPhone = loadFunction(barPublicSource, 'linkedAccessIdentity', {
    state,
    readSession: () => ({ name: 'Cliente Teste', phone: '(27) 99999-0000' }),
    validPhone: () => true,
    normalizePhone: (value) => String(value || '').replace(/\D/g, '')
  });
  assert.equal(linkedAccessIdentityWithPhone().phone, '27999990000');

  const accessSubmit = sourceSection(
    barPublicSource,
    "$('accessForm').addEventListener('submit'",
    "$('categoryNav').addEventListener('click'"
  );
  assert.match(accessSubmit, /if \(isQrAccess\) \{[\s\S]*bar_public_claim_access/);
  assert.doesNotMatch(accessSubmit, /isQrAccess && !state\.access\.linked/);

  assert.match(barQrPhoneRepairMigrationSource, /customer_phone = phone_value/);
  assert.match(barQrPhoneRepairMigrationSource, /returning \* into order_row/);
  assert.match(barQrPhoneRepairMigrationSource, /grant execute on function public\.bar_public_claim_access[\s\S]*to anon, authenticated/);
});

test('pedido público do QR baixa estoque sem exigir permissão administrativa', () => {
  assert.match(
    barQrStockRepairMigrationSource,
    /create or replace function public\.bar_public_submit_order[\s\S]*security definer/
  );
  assert.doesNotMatch(barQrStockRepairMigrationSource, /perform public\.bar_adjust_stock\s*\(/);
  assert.match(
    barQrStockRepairMigrationSource,
    /update public\.bar_products[\s\S]*stock_quantity = stock_quantity - quantity_value[\s\S]*stock_quantity >= quantity_value/
  );
  assert.match(
    barQrStockRepairMigrationSource,
    /insert into public\.bar_inventory_movements[\s\S]*order_item_id[\s\S]*'Pedido QR #'/
  );
  assert.match(
    barQrStockRepairMigrationSource,
    /grant execute on function public\.bar_public_submit_order[\s\S]*to anon, authenticated/
  );
});

test('Clientes do Bar preservam pessoas diferentes que compartilham telefone', () => {
  const summaries = functionSource(adminSource, 'barCustomerSummaries');
  const card = functionSource(adminSource, 'barCustomerCardMarkup');
  const detail = functionSource(adminSource, 'openBarCustomerDetail');
  assert.match(summaries, /barCustomerPhoneKey\(phone\) \+ '::' \+ normalizeMatchText\(name\)/);
  assert.match(summaries, /if \(!groups\.has\(key\)\)/);
  assert.match(summaries, /ordersByCustomer/);
  assert.match(card, /customer\.customerKey/);
  assert.match(detail, /item\.customerKey === customerKey/);

  const summarize = loadFunction(adminSource, 'barCustomerSummaries', {
    opsData: {
      barCustomers: [{ id: 'current', name: 'Patrik', phone: '27999990000', lastOrderAt: '2026-08-25T12:00:00Z' }],
      barOrders: [{
        id: 'legacy-order',
        customerName: 'Leandro Strelow',
        customerPhone: '27999990000',
        status: 'FECHADA',
        paymentStatus: 'PAGO',
        total: 20,
        openedAt: '2026-08-21T12:00:00Z',
        closedAt: '2026-08-21T13:00:00Z'
      }],
      barOrderItems: []
    },
    barCustomerPhoneKey: (value) => String(value || '').replace(/\D/g, ''),
    normalizeMatchText: (value) => String(value || '').trim().toLocaleLowerCase('pt-BR'),
    barOrderIsPaid: (order) => order.paymentStatus === 'PAGO',
    barOrderIsOpen: (order) => ['ABERTA', 'EM_PREPARO', 'PRONTA'].includes(order.status),
    barOrderTotal: (order) => Number(order.total || 0)
  });
  const result = summarize();
  assert.deepEqual(Array.from(result, (customer) => customer.name).sort(), ['Leandro Strelow', 'Patrik']);
  assert.equal(result.find((customer) => customer.name === 'Leandro Strelow').commandCount, 1);
});

test('ADM Bar carrega a operacao primeiro e deixa o historico fora do polling', () => {
  const snapshot = functionSource(adminSource, 'fetchBarOperationalSnapshot');
  const loadData = functionSource(adminSource, 'loadBarData');
  const liveData = functionSource(adminSource, 'loadBarLiveData');
  const history = functionSource(adminSource, 'loadBarHistoryData');
  const tab = functionSource(adminSource, 'setBarTab');
  const render = functionSource(adminSource, 'renderBarModule');
  const openModule = functionSource(adminSource, 'openBarModule');

  assert.match(snapshot, /status=in\.\(ABERTA,EM_PREPARO,PRONTA\)/);
  assert.match(snapshot, /closed_at=gte\./);
  assert.match(snapshot, /limit=200/);
  assert.match(snapshot, /barOrderScopedRows\('items'/);
  assert.doesNotMatch(snapshot, /bar_orders\?select=\*,bar_tables\(number,name\)&order=opened_at/);
  assert.match(loadData, /barDataForceQueued = true/);
  assert.match(loadData, /loadBarData\(true\)/);
  assert.match(liveData, /beforeSignature !== barOperationalSignature\(\)/);
  assert.match(liveData, /barHistoryLoading/);
  assert.match(history, /barHistoryLoadPromise/);
  assert.match(tab, /\['customers', 'finance'\]\.includes\(opsState\.barTab\)/);
  assert.match(render, /if \(!liveOnly \|\| opsState\.barTab === 'kitchen'\) renderBarKitchenQueue\(\)/);
  assert.match(openModule, /if \(!changed\) return;[\s\S]*renderBarModule\(true\)/);
  assert.match(openModule, /}, 10000\)/);
});

test('ADM Bar evita refresh de sessao e acoes concorrentes', () => {
  const refresh = functionSource(adminSource, 'refreshAdminSession');
  const performRefresh = functionSource(adminSource, 'performAdminSessionRefresh');
  const timeoutFetch = functionSource(adminSource, 'fetchWithAdminTimeout');
  const access = functionSource(adminSource, 'canReadBarDataset');
  const beginAction = functionSource(adminSource, 'beginBarAction');

  assert.match(refresh, /adminSessionRefreshPromise/);
  assert.match(performRefresh, /navigator\.locks\.request\(ADMIN_SESSION_REFRESH_LOCK/);
  assert.match(performRefresh, /newerStoredAdminSession/);
  assert.match(performRefresh, /waitForNewerStoredAdminSession/);
  assert.match(adminSource, /refresh_token_already_used/);
  assert.match(timeoutFetch, /AbortController/);
  assert.match(timeoutFetch, /await response\.arrayBuffer\(\)/);
  assert.match(access, /products:[\s\S]*orders:[\s\S]*finance:[\s\S]*paymentParts:/);
  assert.match(beginAction, /barActionLocks\.has\(key\)/);
  assert.match(beginAction, /button\.disabled = true/);
});

test('modal de evento do ADM Bar rola no celular e mantém as ações acessíveis', () => {
  assert.match(
    adminSource,
    /body\.bar-admin-surface \.admin-modal:not\(\.bar-command-modal\) > form \{[\s\S]*?min-height: 0;[\s\S]*?display: flex;[\s\S]*?overflow: hidden;/
  );
  assert.match(
    adminSource,
    /form > \.admin-modal-body \{[\s\S]*?flex: 1 1 auto;[\s\S]*?overflow-y: auto;[\s\S]*?-webkit-overflow-scrolling: touch;/
  );
  assert.match(
    adminSource,
    /\.bar-event-modal-actions \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns:/
  );
  assert.match(
    adminSource,
    /#barEventSaveBtn \{[\s\S]*?grid-column: 2;[\s\S]*?order: 2;/
  );
});

test('indices do Bar cobrem snapshot, historico e chaves estrangeiras operacionais', () => {
  for (const indexName of [
    'bar_orders_opened_at_idx',
    'bar_orders_closed_at_idx',
    'bar_order_items_created_at_idx',
    'bar_inventory_occurred_at_idx',
    'bar_financial_entries_created_at_idx',
    'bar_financial_entries_order_created_idx',
    'bar_financial_entries_paid_at_idx',
    'bar_order_items_product_idx',
    'bar_order_payment_parts_created_by_idx',
    'bar_orders_opened_by_idx',
    'bar_service_requests_handled_by_idx'
  ]) assert.match(barPerformanceMigrationSource, new RegExp(`create index if not exists ${indexName}`));
  assert.match(barPerformanceMigrationSource, /where status = 'FECHADA' and closed_at is not null/);
  assert.match(barPerformanceMigrationSource, /set local lock_timeout = '5s'/);
  assert.match(barPerformanceMigrationSource, /set local statement_timeout = '90s'/);
});

test('cardapio publico libera o polling quando a rede nao responde', () => {
  const timedFetch = functionSource(menuSource, 'fetchMenuRequest');
  const loadMenu = functionSource(menuSource, 'loadMenu');
  assert.match(menuSource, /const MENU_REQUEST_TIMEOUT_MS = 12000/);
  assert.match(timedFetch, /new AbortController\(\)/);
  assert.match(timedFetch, /controller\.abort\(\)/);
  assert.match(timedFetch, /await readBody\(response\)/);
  assert.match(timedFetch, /clearTimeout\(timeout\)/);
  assert.match(loadMenu, /if \(refreshInFlight\) return/);
  assert.match(loadMenu, /fetchMenuRequest\(/);
  assert.match(loadMenu, /finally[\s\S]*refreshInFlight = false/);
  assert.match(menuSource, /const MENU_REFRESH_INTERVAL = 15000/);
});

test('deadline das superficies publicas aborta uma conexao que nunca responde', async () => {
  const neverResponds = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  const context = {
    AbortController,
    BAR_REQUEST_TIMEOUT_MS: 1,
    MENU_REQUEST_TIMEOUT_MS: 1,
    clearTimeout,
    fetch: neverResponds,
    navigator: { onLine: true },
    setTimeout
  };
  const fetchBarRequest = loadFunction(barPublicSource, 'fetchBarRequest', context);
  const fetchMenuRequest = loadFunction(menuSource, 'fetchMenuRequest', context);
  await assert.rejects(fetchBarRequest('https://example.invalid', {}), /demorou mais do que o esperado/);
  await assert.rejects(fetchMenuRequest('https://example.invalid', {}), { name: 'AbortError' });
});

test('gestao de acessos preserva contas vinculadas e reativa revogadas somente por admin', () => {
  assert.match(clubUserAccessSource, /protectedLookup\.data\?\.active === false/);
  assert.match(clubUserAccessSource, /crossSurfaceBarLink/);
  assert.match(clubUserAccessSource, /permissionsForLinkedAccount/);
  assert.match(clubUserAccessSource, /linked_existing/);
  assert.match(clubUserAccessSource, /auth\.admin\.inviteUserByEmail\(email/);
  assert.match(clubUserAccessSource, /invited: !linkedExisting/);
  assert.doesNotMatch(clubUserAccessSource, /Esta pessoa ainda não possui login\. Informe uma senha provisória/);
  assert.doesNotMatch(adminSource, /id="teamPassword"/);
  assert.match(clubUserAccessSource, /const savedRole = role === "admin"/);
  assert.match(clubUserAccessSource, /const nextRole = role === "admin"/);
  assert.match(clubUserAccessSource, /create_protected_access/);
  assert.match(clubUserAccessSource, /update_protected_access/);
  assert.match(clubUserAccessSource, /preserveOnlyBar/);
  assert.match(clubUserAccessSource, /role: "bar", permissions: barPermissions, active: true/);
  assert.match(clubUserAccessSource, /\.from\("protected_access_accounts"\)\.upsert/);
  assert.doesNotMatch(clubUserAccessSource, /if \(password\.length < 8\) return json\(request, \{ error: "A senha provisória/);
  assert.match(barUserAccessSource, /if \(protectedLookup\.data\)/);
  assert.match(barUserAccessSource, /nonBarPermissions/);
  assert.match(barUserAccessSource, /effectiveActive/);
  assert.match(barUserAccessSource, /Somente a administração do Clube pode alterar a senha desta conta vinculada/);
});

test('webhook Asaas trata chargeback repetido como idempotente', () => {
  const precedence = functionSource(asaasWebhookSource, 'preservesStrongerPaymentState');
  const executablePrecedence = precedence
    .replace(/: string/g, '')
    .replace(/: boolean/g, '');
  const preservesStrongerPaymentState = vm.runInNewContext(`(${executablePrecedence})`);
  const claimPosition = asaasWebhookSource.indexOf('supabase.rpc("claim_asaas_webhook_event"');
  const paymentLookupPosition = asaasWebhookSource.indexOf('failureStage = "payment_lookup"');
  assert.equal(preservesStrongerPaymentState('REFUNDED', 'RECEIVED', 'PAYMENT_RECEIVED'), true);
  assert.equal(preservesStrongerPaymentState('CANCELLED', 'RECEIVED', 'PAYMENT_RECEIVED', false), true);
  assert.equal(preservesStrongerPaymentState('CANCELLED', 'RECEIVED', 'PAYMENT_RECEIVED', true), false);
  assert.equal(preservesStrongerPaymentState('CANCELLED', 'DISPUTED', 'PAYMENT_CHARGEBACK_REQUESTED', true), false);
  assert.match(precedence, /currentStatus === "CANCELLED"[\s\S]*reversibleCancellation/);
  assert.match(asaasWebhookSource, /disputed\s*\?\s*"CANCELLED"/);
  assert.match(asaasWebhookSource, /disputed[\s\S]*6 \* 60 \* 60/);
  assert.match(tournamentPaymentExpirySource, /status === "CHARGEBACK"[\s\S]*reconcileCancellation/);
  assert.match(asaasWebhookSource, /payment_status: "PARTIALLY_REFUNDED"/);
  assert.match(tournamentPaymentExpirySource, /"PARTIALLY_REFUNDED"[\s\S]*registrationPaidAmount/);
  assert.ok(claimPosition > -1 && paymentLookupPosition > claimPosition, 'o ID do evento precisa ser reservado antes da baixa');
  assert.match(asaasWebhookClaimSource, /event_id text not null unique|on conflict \(event_id\) do nothing/i);
  assert.match(asaasWebhookSource, /claimStatus === "DONE"\) return json\(\{ received: true, duplicate: true \}\)/);
  assert.match(asaasWebhookSource, /claimStatus === "BUSY"\) return json\(\{ received: false, processing: true \}, 503\)/);
  assert.match(asaasWebhookSource, /const settled = !mismatchReason && paymentStatus === "RECEIVED"/);
  assert.doesNotMatch(asaasWebhookSource, /PAYMENT_DUNNING_RECEIVED:\s*"RECEIVED"/);
  assert.match(asaasWebhookSource, /apply_tournament_payment_reconciliation/);
  assert.match(asaasWebhookSource, /processing_token/);
  assert.match(asaasWebhookSource, /A posse do processamento do evento foi perdida/);
  assert.match(asaasWebhookEventPrivilegesSource, /revoke all on table public\.asaas_webhook_events from anon, authenticated/);
  assert.match(asaasWebhookEventPrivilegesSource, /grant select, insert, update, delete on table public\.asaas_webhook_events to service_role/);
  assert.match(asaasWebhookEventPrivilegesSource, /has_table_privilege\('service_role'/);
});

test('webhook Asaas calcula estornos e bloqueia transicoes financeiras regressivas', () => {
  const executableRefundTransition = functionSource(asaasWebhookSource, 'refundTransitionState')
    .replace(/: string/g, '')
    .replace(/: number \| null/g, '')
    .replace(/: number/g, '');
  const refundTransitionState = vm.runInNewContext(`(${executableRefundTransition})`);
  const executablePrecedence = functionSource(asaasWebhookSource, 'preservesStrongerPaymentState')
    .replace(/: string/g, '')
    .replace(/: boolean/g, '');
  const preservesStrongerPaymentState = vm.runInNewContext(`(${executablePrecedence})`);

  const partial = refundTransitionState('RECEIVED', 'PARTIALLY_REFUNDED', 18000, 8000);
  assert.equal(partial.partialRefund, true);
  assert.equal(partial.reversed, false);
  assert.equal(partial.remainingPaidCents, 10000);

  const fullByRefundTotal = refundTransitionState('PARTIALLY_REFUNDED', 'RECEIVED', 18000, 18000);
  assert.equal(fullByRefundTotal.fullRefund, true);
  assert.equal(fullByRefundTotal.reversed, true);
  assert.equal(fullByRefundTotal.remainingPaidCents, 0);

  const fullByEvent = refundTransitionState('PARTIALLY_REFUNDED', 'REFUNDED', 18000, 0);
  assert.equal(fullByEvent.reversed, true);
  assert.equal(fullByEvent.partialRefund, false);

  const pending = refundTransitionState('RECEIVED', 'REFUND_PENDING', 18000, 0);
  assert.equal(pending.refundPending, true);
  assert.equal(pending.reversed, false);
  assert.equal(pending.partialRefund, false);

  const staleReceived = refundTransitionState('PARTIALLY_REFUNDED', 'RECEIVED', 18000, 0);
  assert.equal(staleReceived.partialRefund, true);
  assert.equal(staleReceived.remainingPaidCents, null);
  assert.equal(preservesStrongerPaymentState('REFUNDED', 'RECEIVED', 'PAYMENT_RECEIVED'), true);
  assert.equal(
    preservesStrongerPaymentState('REFUNDED', 'PARTIALLY_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED'),
    true
  );

  const deletedAfterPartial = refundTransitionState('PARTIALLY_REFUNDED', 'CANCELLED', 18000, 8000);
  assert.equal(deletedAfterPartial.manualReview, true);
  assert.equal(deletedAfterPartial.reversed, false);
  assert.match(asaasWebhookSource, /manualReview\s*\?\s*"REVIEW_REQUIRED"/);
  assert.match(asaasWebhookSource, /error_code: "partial_refund_cancelled"/);
  assert.match(asaasWebhookSource, /next_reconciliation_at: manualReview[\s\S]*\? null/);
  assert.match(asaasWebhookSource, /else if \(manualReview\)[\s\S]*registrationUpdate = null/);
});

test('runbook financeiro separa o E2E válido, expiração, estorno e limite de chargeback', () => {
  assert.match(
    asaasGoLiveRunbookSource,
    /ohndgphxtwhokekjyobu\.supabase\.co\/functions\/v1\/asaas-payment-webhook/
  );
  assert.match(asaasGoLiveRunbookSource, /PAYMENT_RECEIVED[\s\S]*event_rows/);
  assert.match(asaasGoLiveRunbookSource, /public\.invoke_tournament_payment_expiry\(\)/);
  assert.match(asaasGoLiveRunbookSource, /net\._http_response/);
  assert.match(asaasGoLiveRunbookSource, /PAYMENT_PARTIALLY_REFUNDED[\s\S]*PARTIALLY_REFUNDED/);
  assert.match(asaasGoLiveRunbookSource, /Integration Success/);
  assert.match(asaasGoLiveRunbookSource, /não envie[\s\S]*ASAAS_WEBHOOK_TOKEN/i);
});

test('webhook Asaas isola cobrancas com o mesmo ID por ambiente', async () => {
  const executableLookupSource = functionSource(asaasWebhookSource, 'findTournamentPayment')
    .replace(/: DbClient/g, '')
    .replace(/: string/g, '')
    .replace(/ as JsonRecord \| null/g, '');
  const findTournamentPayment = vm.runInNewContext(`(${executableLookupSource})`);
  const payments = [
    {
      id: 'sandbox-payment',
      provider: 'ASAAS',
      provider_environment: 'SANDBOX',
      provider_payment_id: 'pay_same_environment_scoped_id',
      external_reference: 'tournament-registration:sandbox'
    },
    {
      id: 'production-payment',
      provider: 'ASAAS',
      provider_environment: 'PRODUCTION',
      provider_payment_id: 'pay_same_environment_scoped_id',
      external_reference: 'tournament-registration:production'
    }
  ];
  const supabase = {
    from(tableName) {
      assert.equal(tableName, 'tournament_payments');
      const filters = [];
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          filters.push([column, value]);
          return query;
        },
        async maybeSingle() {
          const matches = payments.filter((payment) => filters.every(([column, value]) => payment[column] === value));
          if (matches.length > 1) return { data: null, error: new Error('multiple rows') };
          return { data: matches[0] || null, error: null };
        }
      };
      return query;
    }
  };

  const sandboxPayment = await findTournamentPayment(
    supabase,
    'SANDBOX',
    'pay_same_environment_scoped_id',
    'tournament-registration:sandbox'
  );
  const productionPayment = await findTournamentPayment(
    supabase,
    'PRODUCTION',
    'pay_same_environment_scoped_id',
    'tournament-registration:production'
  );

  assert.equal(sandboxPayment.id, 'sandbox-payment');
  assert.equal(productionPayment.id, 'production-payment');
  assert.notEqual(sandboxPayment.id, productionPayment.id);
  assert.match(
    functionSource(asaasWebhookSource, 'findTournamentPayment'),
    /eq\("provider_environment", providerEnvironment\)[\s\S]*eq\("provider_payment_id", providerPaymentId\)/
  );
  assert.match(asaasWebhookSource, /p_payment_id: localPayment\.id[\s\S]*p_provider_environment: providerEnvironment/);
});

test('onboarding e cancelamento usam RPCs validadas sem fallback local de producao', () => {
  const guardStart = securityMigrationSource.indexOf('create or replace function public.guard_app_client_entitlements');
  const guardEnd = securityMigrationSource.indexOf('drop trigger if exists guard_app_client_entitlements', guardStart);
  const guard = securityMigrationSource.slice(guardStart, guardEnd);
  assert.match(guard, /ilha\.onboarding_client_id/);
  assert.match(guard, /ilha\.plan_cancellation_client_id/);
  assert.match(securityMigrationSource, /function public\.request_my_app_plan_cancellation\(\)/);
  assert.match(functionSource(indexSource, 'requestClientPlanCancellation'), /rest\('rpc\/request_my_app_plan_cancellation'/);
  assert.doesNotMatch(functionSource(indexSource, 'requestClientPlanCancellation'), /patchClientProfile/);
  assert.doesNotMatch(functionSource(indexSource, 'ensureClient'), /fallbackClient/);
});

test('migration de hardening nao contem duplicacoes sintaticas conhecidas', () => {
  assert.doesNotMatch(securityMigrationSource, /return\s+query\s+return\s+query/i);
  assert.equal((securityMigrationSource.match(/^begin;$/gmi) || []).length, 1);
  assert.equal((securityMigrationSource.match(/^commit;$/gmi) || []).length, 1);
  const functionBlocks = securityMigrationSource
    .split(/(?=create or replace function public\.)/i)
    .filter((block) => /^create or replace function public\./i.test(block));
  const definers = functionBlocks.filter((block) => /security definer/i.test(block));
  assert.ok(definers.length >= 25);
  assert.deepEqual(
    definers.filter((block) => !/set search_path\s*=\s*''/i.test(block)),
    []
  );
});

test('hotfix de cadastro administrativo falha fechado sem alterar onboarding de clientes', () => {
  const roleStart = adminSignupEscalationHotfixSource.indexOf(
    'create or replace function public.current_user_role()'
  );
  const handlerStart = adminSignupEscalationHotfixSource.indexOf(
    'create or replace function public.handle_new_user_profile()'
  );
  const ensureStart = adminSignupEscalationHotfixSource.indexOf(
    'create or replace function public.ensure_current_user_profile()'
  );
  const commentsStart = adminSignupEscalationHotfixSource.indexOf(
    'comment on function public.handle_new_user_profile()'
  );
  assert.ok(roleStart > 0 && handlerStart > roleStart && ensureStart > handlerStart && commentsStart > ensureStart);

  const preflight = adminSignupEscalationHotfixSource.slice(0, roleStart);
  const roleFunction = adminSignupEscalationHotfixSource.slice(roleStart, handlerStart);
  const handlerFunction = adminSignupEscalationHotfixSource.slice(handlerStart, ensureStart);
  const ensureFunction = adminSignupEscalationHotfixSource.slice(ensureStart, commentsStart);

  assert.equal((adminSignupEscalationHotfixSource.match(/^begin;$/gmi) || []).length, 1);
  assert.equal((adminSignupEscalationHotfixSource.match(/^commit;$/gmi) || []).length, 1);
  assert.doesNotMatch(preflight, /\b(?:insert\s+into|update|delete\s+from)\b/i);
  assert.match(preflight, /set local lock_timeout\s*=\s*'5s'/i);
  assert.match(
    preflight,
    /lock table auth\.users, public\.profiles, public\.protected_access_accounts\s+in share row exclusive mode/i
  );
  assert.match(preflight, /unprotected_profile_count/);
  assert.match(preflight, /orphan_allowlist_count/);
  assert.match(preflight, /permission_mismatch_count/);
  assert.match(preflight, /protected_admin_count/);

  for (const source of [roleFunction, handlerFunction, ensureFunction]) {
    assert.match(source, /security definer/i);
    assert.match(source, /set search_path\s*=\s*''/i);
    assert.match(source, /protected_access_accounts/);
  }
  assert.match(roleFunction, /join auth\.users/);
  assert.match(roleFunction, /protected_account\.active is true/);
  assert.match(handlerFunction, /account\.email = lower\(trim\(new\.email\)\)/);
  assert.doesNotMatch(handlerFunction, /new\.raw_user_meta_data|assigned_role|not exists\s*\(\s*select 1 from public\.profiles/i);
  assert.match(ensureFunction, /Seu perfil ainda não está liberado no clube\./);
  assert.doesNotMatch(ensureFunction, /raw_user_meta_data|assigned_role|else\s+'secretaria'/i);
  assert.match(
    adminSignupEscalationHotfixSource,
    /revoke all on function public\.handle_new_user_profile\(\)[^]*from public, anon, authenticated/i
  );
  assert.match(
    adminSignupEscalationHotfixSource,
    /revoke all on function public\.ensure_current_user_profile\(\)[^]*from public, anon;[^]*grant execute on function public\.ensure_current_user_profile\(\)[^]*to authenticated/i
  );
  assert.doesNotMatch(
    adminSignupEscalationHotfixSource,
    /create or replace function public\.(?:handle_new_app_client|ensure_current_app_client|complete_current_app_registration)\(/i
  );
  assert.doesNotMatch(
    adminSignupEscalationHotfixSource,
    /(?:insert\s+into|update|delete\s+from)\s+public\.app_clients/i
  );
});

test('recuperacao administrativa atende a allowlist e o formulario conclui o reset', () => {
  assert.doesNotMatch(protectedRecoverySource, /PROTECTED_ACCESS_RECOVERY_EMAIL/);
  assert.match(protectedRecoverySource, /protected_access_accounts/);
  assert.match(protectedRecoverySource, /\.update\(\{ last_recovery_at: claimedAt, updated_at: claimedAt \}\)/);
  assert.match(protectedRecoverySource, /\.from\("profiles"\)\.upsert/);
  assert.match(protectedRecoverySource, /permission === "bar" \|\| permission\.startsWith\("bar\."\)/);
  assert.doesNotMatch(protectedRecoverySource, /admin\.rpc\("(?:claim_protected_access_recovery|restore_protected_profile)"/);
  assert.match(adminSource, /finishAdminPasswordRecovery/);
  assert.match(adminSource, /cancelAdminPasswordRecovery/);
  assert.match(adminSource, /protected-access-recovery/);
  assert.match(adminSource, /name="username"[^>]+autocomplete="username"/);
  assert.match(adminSource, /name="password"[^>]+autocomplete="current-password"/);
  assert.match(adminSource, /name="new-password"[^>]+autocomplete="new-password"[^>]+disabled/);
  assert.match(adminSource, /id="adminRememberPassword"[^>]+checked/);
  assert.match(adminSource, /Salvar a nova senha neste navegador/);
  const panel = functionSource(adminSource, 'setAdminRecoveryPanel');
  assert.match(panel, /\$\(id\)\.disabled = adminRecoveryActive/);
  assert.match(panel, /\$\(id\)\.required = !adminRecoveryActive/);
  assert.match(panel, /\$\(id\)\.disabled = !adminRecoveryActive/);
  assert.match(panel, /\$\(id\)\.required = adminRecoveryActive/);
  const passwordSave = functionSource(adminSource, 'offerAdminPasswordSave');
  assert.match(passwordSave, /navigator\.credentials\.store/);
  assert.doesNotMatch(passwordSave, /localStorage|sessionStorage|safeLocalStorage/);
  assert.match(functionSource(adminSource, 'finishAdminPasswordRecovery'), /offerAdminPasswordSave/);
  assert.match(functionSource(adminSource, 'signInAdmin'), /offerAdminPasswordSave/);
  assert.doesNotMatch(functionSource(adminSource, 'prepareAdminPasswordRecovery'), /clearAdminRecoveryUrl/);
  assert.match(functionSource(adminSource, 'validateAdminRecoveryUrl'), /clearAdminRecoveryUrl/);
  assert.match(autoUpdateSource, /sensitiveAuthFlowActive/);
  assert.match(autoUpdateSource, /admin-recovery-active/);
  assert.match(autoUpdateSource, /newPasswordForm/);
  assert.match(functionSource(autoUpdateSource, 'reloadForVersion'), /sensitiveAuthFlowActive\(\)/);
});

test('configuracao de deploy explicita verificacao JWT por Edge Function', () => {
  for (const name of ['asaas-payment-webhook', 'bar-order-push', 'client-notification-dispatch', 'protected-access-recovery', 'tournament-register', 'tournament-internal-register']) {
    assert.match(supabaseConfigSource, new RegExp(`functions\\.${name.replaceAll('-', '\\-')}[^]*?verify_jwt\\s*=\\s*false`));
  }
  for (const name of ['bar-user-access', 'client-broadcast-push', 'club-user-access', 'tournament-admin-api']) {
    assert.match(supabaseConfigSource, new RegExp(`functions\\.${name.replaceAll('-', '\\-')}[^]*?verify_jwt\\s*=\\s*true`));
  }
});

test('CORS das Edge Functions aceita staging somente por origin exata configurada', () => {
  assert.match(sharedCorsSource, /"https:\/\/ilha-app-staging\.vercel\.app"/);
  assert.match(sharedCorsSource, /Deno\.env\.get\("APP_ALLOWED_ORIGINS"\)/);
  assert.match(sharedCorsSource, /candidate === "\*"/);
  assert.match(sharedCorsSource, /url\.username \|\| url\.password/);
  assert.match(sharedCorsSource, /url\.pathname !== "\/" \|\| url\.search \|\| url\.hash/);
  assert.match(sharedCorsSource, /allowedOrigins\?\.has\(origin\)/);
  for (const source of [
    tournamentAdminSource,
    clubUserAccessSource,
    barUserAccessSource,
    protectedRecoverySource,
    clientBroadcastPushSource,
    barOrderPushSource
  ]) {
    assert.match(source, /\.\.\/_shared\/cors\.ts/);
    assert.doesNotMatch(source, /const allowedOrigins = new Set/);
  }
});

test('scripts e dados demo nao versionam credenciais ou identidade pessoal', () => {
  assert.doesNotMatch(adminSource, /BAR_STICKER_WIFI_PASSWORD\s*=\s*['"][^'"]+['"]/);
  assert.doesNotMatch(legacyProtectedAccessSource, /insert\s+into\s+public\.protected_access_accounts/i);
  assert.doesNotMatch(legacyProtectedAccessSource, /@[a-z0-9.-]+\.[a-z]{2,}/i);
  assert.match(gitignoreSource, /^\.env$/m);
  assert.match(gitignoreSource, /^supabase\/functions\/\.env$/m);
  assert.match(securityOperationsSource, /permanece no histórico Git/i);
  assert.match(securityOperationsSource, /no mínimo 16 caracteres/i);
  assert.match(securityOperationsSource, /credencial anterior não autentica mais/i);
});

test('dispatcher historico usa somente configuracao externa e falha fechado', () => {
  const dispatcherSql = historicalDispatcherSource + '\n' + dispatcherExternalizationSource;
  assert.doesNotMatch(dispatcherSql, /https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/client-notification-dispatch/i);
  assert.doesNotMatch(dispatcherSql, /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
  assert.match(dispatcherSql, /court_dispatch_url/);
  assert.match(dispatcherSql, /court_dispatch_publishable_key/);
  assert.match(dispatcherSql, /\^sb_publishable_/);
  assert.match(dispatcherSql, /return null/);
  assert.doesNotMatch(dispatcherSql, /['"]Authorization['"]/);
  assert.match(dispatcherExternalizationSource, /delete from vault\.secrets[\s\S]*court_dispatch_anon_key/i);
  assert.match(dispatcherExternalizationSource, /cron\.unschedule/);
  assert.match(dispatcherExternalizationSource, /public\.invoke_app_client_notification_dispatch\(\)/);
});

test('inscricao publica exige Turnstile e rate limit persistente sem PII em claro', () => {
  assert.match(publicRegistrationRateLimitSource, /create table if not exists public\.public_registration_rate_limits/i);
  assert.match(publicRegistrationRateLimitSource, /enable row level security/i);
  assert.match(publicRegistrationRateLimitSource, /revoke all[\s\S]*from public, anon, authenticated/i);
  assert.match(publicRegistrationRateLimitSource, /security definer[\s\S]*set search_path = ''/i);
  assert.match(publicRegistrationRateLimitSource, /\('global'::text, 60, 300\)/);
  assert.match(publicRegistrationRateLimitSource, /\('ip:' \|\| p_ip_hash, 600, 30\)/);
  assert.match(publicRegistrationRateLimitSource, /'identity:' \|\| p_identity_hash/);
  assert.match(publicRegistrationRateLimitSource, /v_window_seconds integer := 1800/);
  assert.match(publicRegistrationRateLimitSource, /v_attempts <= 5/);
  const rateLimitTable = sourceSection(
    publicRegistrationRateLimitSource,
    'create table if not exists public.public_registration_rate_limits',
    'create index if not exists public_registration_rate_limits_expiry_idx'
  );
  assert.doesNotMatch(rateLimitTable, /email|phone|telefone|cpf/i);

  for (const variable of [
    'TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY',
    'TURNSTILE_ALLOWED_HOSTNAMES',
    'PUBLIC_REGISTRATION_RATE_LIMIT_SALT',
    'PUBLIC_REGISTRATION_ALLOWED_ORIGINS'
  ]) assert.match(tournamentRegisterSource, new RegExp(`Deno\\.env\\.get\\("${variable}"\\)`));
  const origins = functionSource(tournamentRegisterSource, 'publicRegistrationAllowedOrigins');
  assert.match(origins, /candidate === "\*"/);
  assert.match(origins, /url\.username \|\| url\.password/);
  assert.match(origins, /url\.pathname !== "\/" \|\| url\.search \|\| url\.hash/);
  assert.match(tournamentRegisterSource, /configuredAllowedOrigins\?\.has\(origin\)/);
  assert.match(tournamentRegisterSource, /if \(!configuredAllowedOrigins \|\|/);
  assert.match(tournamentRegisterSource, /\?\s*"null"/);
  assert.match(tournamentRegisterSource, /challenges\.cloudflare\.com\/turnstile\/v0\/siteverify/);
  assert.match(tournamentRegisterSource, /outcome\.action === "tournament_registration"/);
  assert.match(tournamentRegisterSource, /turnstileAllowedHostnames\.has/);
  assert.match(tournamentRegisterSource, /const syntheticStagingRef = "ohndgphxtwhokekjyobu"/);
  assert.match(tournamentRegisterSource, /config\.turnstileSiteKey === cloudflareTestSiteKey/);
  assert.match(tournamentRegisterSource, /config\.turnstileSecretKey === cloudflareTestSecretKey/);
  assert.match(tournamentRegisterSource, /isSyntheticStagingProject\(\)/);
  assert.match(tournamentRegisterSource, /if \(usesOfficialTestKeys\) return outcome\.success === true/);
  assert.match(tournamentRegisterSource, /consume_tournament_registration_network_rate_limits/);
  assert.match(tournamentRegisterSource, /consume_tournament_registration_identity_rate_limit/);
  assert.match(tournamentRegisterSource, /"Retry-After"/);
  const trustedIp = functionSource(tournamentRegisterSource, 'trustedClientIp');
  assert.match(trustedIp, /cf-connecting-ip/);
  assert.doesNotMatch(trustedIp, /x-forwarded-for|x-real-ip/);
  assert.match(tournamentRegisterSource, /p_ip_hash: ipHash/);
  assert.match(publicRegistrationRateLimitSource, /p_ip_hash is not null/);
  assert.match(publicRegistrationRateLimitSource, /where limits\.scope_key is not null/);
  const networkLimit = tournamentRegisterSource.indexOf('consume_tournament_registration_network_rate_limits');
  const captcha = tournamentRegisterSource.indexOf('captcha_verification');
  const identityLimit = tournamentRegisterSource.indexOf('consume_tournament_registration_identity_rate_limit');
  const tournamentLookup = tournamentRegisterSource.indexOf('tournament_lookup');
  assert.ok(networkLimit < captcha, 'limite de rede deve proteger a validação CAPTCHA');
  assert.ok(captcha < identityLimit, 'token inválido não pode consumir o limite de outra identidade');
  assert.ok(identityLimit < tournamentLookup, 'proteções devem anteceder leitura ou alteração do torneio');
  assert.match(tournamentSource, /captcha_site_key/);
  assert.match(tournamentSource, /captcha_token: state\.captchaToken/);
  assert.match(tournamentSource, /render=explicit/);
});

test('reinscricao publica exige prova antes de alterar atleta existente', () => {
  assert.match(tournamentRegisterSource, /submittedCpf/);
  assert.match(tournamentRegisterSource, /athlete\?\.cpf/);
  assert.match(tournamentRegisterSource, /CPF[^\n]*(?:não corresponde|diverge|vinculado)/i);
  assert.match(tournamentRegisterSource, /athleteHasAnyRegistration/);
  assert.match(tournamentRegisterSource, /!registration && athleteHasAnyRegistration/);
  assert.doesNotMatch(tournamentRegisterSource, /\.from\(["']app_clients["']\)/);
  const authorization = tournamentRegisterSource.indexOf('registration_authorization');
  const athleteMutation = tournamentRegisterSource.indexOf('.from("tournament_athletes").update', authorization);
  assert.ok(authorization !== -1 && authorization < athleteMutation);
});

test('snapshot administrativo nao entrega bearer tokens a permissao somente leitura', () => {
  assert.match(tournamentAdminSource, /public_token/);
  assert.match(tournamentAdminSource, /canWrite|tournaments\.write/);
  const settingsSanitizer = functionSource(tournamentAdminSource, 'sanitizeTournamentSettings');
  assert.match(settingsSanitizer, /courtesy_registration_token/);
  assert.match(settingsSanitizer, /privateTournamentSettingKey/);
  assert.doesNotMatch(functionSource(tournamentAdminSource, 'mapTournament'), /courtesy_registration_token/);
  assert.doesNotMatch(tournamentAdminSource, /settings\.courtesy_registration_token\s*=/);
  const tournamentPayloadSource = sourceSection(
    tournamentAdminSource,
    'function tournamentPayload',
    'async function saveTournament'
  );
  assert.match(tournamentPayloadSource, /sanitizeTournamentSettings\(firstObject\(input\.settings/);
  assert.match(tournamentAdminSource, /if \(includeCapabilities\) registration\.public_token/);
  assert.match(tournamentAdminSource, /loadSnapshot\(trustedClient, tournamentId, slug, canWrite\)/);
});

test('snapshot público usa allow-list e relações sensíveis têm grants mínimos', () => {
  assert.match(tournamentPublicCapabilityHardeningSource, /settings = coalesce\(settings, '\{\}'::jsonb\) - 'courtesy_registration_token'/);
  assert.match(tournamentPublicCapabilityHardeningSource, /tournaments_settings_without_legacy_courtesy_check[\s\S]*courtesy_registration_token[\s\S]*validate constraint/);
  assert.match(tournamentPublicCapabilityHardeningSource, /set schema private/);
  assert.match(tournamentPublicCapabilityHardeningSource, /revoke all on function private\.tournament_public_snapshot_legacy_unsafe\(text\)[\s\S]*from public, anon, authenticated, service_role/);
  const publicSnapshot = sourceSection(
    tournamentPublicCapabilityHardeningSource,
    'create function public.tournament_public_snapshot',
    'comment on function public.tournament_public_snapshot'
  );
  for (const key of ['public_tabs', 'about_event', 'registration_pricing', 'spatial_addon_fee', 'spatial_addons', 'spatial_event_period_label']) {
    assert.match(publicSnapshot, new RegExp(`'${key}'`));
  }
  const publicSettingsProjection = sourceSection(
    publicSnapshot,
    'public_settings := jsonb_strip_nulls',
    'stored_theme :='
  );
  for (const forbidden of ['courtesy_registration_token', 'registration_function', 'api_key']) {
    assert.doesNotMatch(publicSettingsProjection, new RegExp(`'${forbidden}'`));
  }
  assert.match(publicSnapshot, /snapshot\s*->\s*'tournament'[\s\S]*-\s*'courtesy_registration_token'/);
  assert.match(tournamentPublicCapabilityHardeningSource, /revoke all on table[\s\S]*public\.asaas_webhook_events[\s\S]*public\.tournament_registration_invites[\s\S]*from public, anon, authenticated, service_role/);
  assert.doesNotMatch(tournamentPublicCapabilityHardeningSource, /grant\s+(?:all|truncate|references|trigger)[\s\S]*to authenticated/i);
  assert.match(tournamentPublicCapabilityHardeningSource, /grant select, insert on table public\.tournament_audit_log to authenticated/);
  assert.match(tournamentPublicCapabilityHardeningSource, /grant select, insert on table public\.tournament_audit_log to service_role/);
  assert.match(tournamentPublicCapabilityHardeningSource, /revoke all on sequence public\.tournament_audit_log_id_seq[\s\S]*from public, anon, authenticated, service_role/);
});

test('alterações do torneio recarregam a agenda pelo cliente administrativo já autorizado', () => {
  assert.match(tournamentAdminSource, /response\.data = await loadSnapshot\(trustedClient, responseTournamentId, "", true\)/);
  assert.doesNotMatch(tournamentAdminSource, /response\.data = await loadSnapshot\(client, responseTournamentId, "", true\)/);
});

test('ADM preserva o rascunho do torneio durante a atualização automática', () => {
  const openTournament = functionSource(adminSource, 'openTournamentModule');
  assert.match(openTournament, /hasUnsavedTournamentDraft\(\)/);
  assert.match(openTournament, /atualização automática pausada/);
  assert.doesNotMatch(openTournament, /if \(!state\.saving && document\.body\.classList\.contains\('club-tournament'\)\) loadData\(false\)/);
  assert.match(functionSource(adminSource, 'markTournamentDraftDirty'), /state\.tournamentDraftDirty = true/);
  assert.match(functionSource(adminSource, 'reloadTournamentManually'), /Há alterações não salvas[\s\S]*loadData\(true\)/);
  assert.match(functionSource(adminSource, 'saveTournament'), /state\.tournamentDraftDirty = false[\s\S]*loadData\(false\)/);
  assert.match(adminSource, /\$\('settings'\)\.addEventListener\('input'[\s\S]*markTournamentDraftDirty\(\)/);
  assert.match(adminSource, /beforeunload[\s\S]*hasUnsavedTournamentDraft\(\)/);
});

test('tabelas sensiveis de torneio reservam leitura REST para escritores', () => {
  const policies = sourceSection(
    securityMigrationSource,
    '-- These base tables contain private athlete data and bearer capabilities',
    'commit;'
  );
  for (const table of [
    'public.tournaments',
    'public.tournament_athletes',
    'public.tournament_registrations',
    'public.tournament_audit_log'
  ]) {
    assert.match(policies, new RegExp(`on ${table.replace('.', '\\.')} for select`));
  }
  assert.equal((policies.match(/has_tournament_permission\('tournaments\.write'\)/g) || []).length, 4);
  assert.doesNotMatch(policies, /has_tournament_permission\('tournaments\.read'\)/);
});

test('notificacao de novo cliente alcanca admins protegidos sem exigir app_client', () => {
  const notification = sourceSection(
    securityMigrationSource,
    'create or replace function public.notify_admins_about_new_app_client',
    'revoke all on function public.notify_admins_about_new_app_client'
  );
  assert.match(notification, /from public\.profiles as profile/);
  assert.match(notification, /join auth\.users as auth_user/);
  assert.match(notification, /join public\.protected_access_accounts as protected_account/);
  assert.doesNotMatch(notification, /join public\.app_clients/);
});

test('servidor local reproduz rotas limpas publicadas', () => {
  for (const route of [
    "pathname === '/adm'",
    "pathname === '/admin'",
    "pathname === '/admbar'",
    "pathname === '/torneios'",
    "pathname === '/inscricoes'",
    "pathname === '/menu'",
    "pathname === '/cardapio'",
    "pathname === '/quadras'",
    "pathname === '/agenda'"
  ]) assert.match(localServerSource, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(localServerSource, /\^\\\/\(\?:torneios\|inscricoes\)\\\/\[\^\/\]\+/);
  assert.match(localServerSource, /pathname === '\/favicon\.ico'/);
});

test('build de produção inclui as regras de rotas limpas da Vercel', () => {
  assert.match(vercelConfigSource, /"outputDirectory"\s*:\s*"dist"/);
  assert.match(productionBuildSource, /developmentRootFiles\s*=\s*new Set\(\['package\.json'\]\)/);
  assert.doesNotMatch(productionBuildSource, /new Set\(\['package\.json',\s*'vercel\.json'\]\)/);
});

test('RPCs literais usados pelos frontends existem no SQL versionado', () => {
  const names = new Set();
  for (const source of [indexSource, adminSource]) {
    for (const match of source.matchAll(/["']rpc\/([a-zA-Z0-9_]+)/g)) names.add(match[1].toLowerCase());
  }
  const missing = Array.from(names).filter((name) => !sql.includes(`function public.${name}(`));
  assert.deepEqual(missing, []);
});

test('Edge Functions chamadas pelo frontend possuem implementacao', async () => {
  const names = new Set();
  for (const source of [indexSource, adminSource]) {
    for (const match of source.matchAll(/functions\/v1\/([a-zA-Z0-9_-]+)/g)) names.add(match[1]);
  }
  const directories = new Set(await readdir(path.join(projectRoot, 'supabase', 'functions')));
  assert.deepEqual(Array.from(names).filter((name) => !directories.has(name)), []);
});

test('manifesto PWA aponta para icone 512x512 real', async () => {
  const manifest = JSON.parse(await readFile(path.join(projectRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, '/');
  const icon = await readFile(path.join(projectRoot, manifest.icons[0].src.replace(/^\//, '')));
  assert.equal(icon.readUInt32BE(16), 512);
  assert.equal(icon.readUInt32BE(20), 512);
});

test('PWAs do ADM do Clube e do ADM Bar possuem identidades e escopos isolados', async () => {
  const clubManifest = JSON.parse(await readFile(path.join(projectRoot, 'adm-manifest.json'), 'utf8'));
  const barManifest = JSON.parse(await readFile(path.join(projectRoot, 'admbar-manifest.json'), 'utf8'));
  assert.equal(clubManifest.id, '/adm');
  assert.equal(clubManifest.scope, '/adm');
  assert.match(clubManifest.start_url, /^\/adm(?:\?|$)/);
  assert.equal(barManifest.id, '/admbar');
  assert.equal(barManifest.scope, '/admbar');
  assert.match(barManifest.start_url, /^\/admbar(?:\?|$)/);
  assert.ok(barManifest.icons.every((icon) => icon.src.includes('/icons/ilha-bar-app-')));
  assert.ok(barManifest.shortcuts.every((shortcut) => shortcut.url.startsWith('/admbar')));

  for (const icon of barManifest.icons) {
    const image = await readFile(path.join(projectRoot, icon.src.replace(/^\//, '')));
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.equal(image.readUInt32BE(16), width);
    assert.equal(image.readUInt32BE(20), height);
  }
});

test('ADM escolhe o manifesto correto antes de o navegador registrar a PWA', () => {
  assert.match(adminSource, /<link id="adminAppManifest" href="\/adm-manifest\.json" \/>/);
  assert.doesNotMatch(adminSource, /<link id="adminAppManifest" rel="manifest"/);
  const chooseManifest = adminSource.indexOf("manifest.href = bar ? '/admbar-manifest.json' : '/adm-manifest.json'");
  const activateManifest = adminSource.indexOf("manifest.rel = 'manifest'", chooseManifest);
  assert.ok(chooseManifest > -1 && activateManifest > chooseManifest);
  assert.match(adminSource, /\/icons\/ilha-bar-app-180\.png/);
  assert.match(adminSource, /\/icons\/ilha-bar-app-192\.png/);
});

test('contas familiares preservam integridade, privacidade e cobranca consolidada', () => {
  assert.match(familyAccountMigrationSource, /alter table public\.app_family_members enable row level security/i);
  assert.match(familyAccountMigrationSource, /revoke all on table public\.app_family_members from anon, authenticated/i);
  assert.match(familyAccountMigrationSource, /grant select, insert, update on table public\.app_family_members to authenticated/i);
  assert.match(familyAccountMigrationSource, /create policy app_family_members_requester_insert[\s\S]*status = 'PENDENTE'/i);
  assert.match(familyAccountMigrationSource, /create policy app_family_members_staff_update[\s\S]*has_club_permission\('clients\.write'\)/i);

  const memberValidation = sourceSection(
    familyAccountMigrationSource,
    'create or replace function private.validate_app_family_member()',
    'revoke all on function private.validate_app_family_member()'
  );
  assert.match(memberValidation, /new\.birth_date <= \(today_sp - interval '18 years'\)::date[\s\S]*new\.cpf is null/i);
  assert.match(memberValidation, /CPF [^']*obrigat.rio para membros adultos/i);
  assert.doesNotMatch(memberValidation, /if new\.cpf is null then/i);
  const memberRequest = sourceSection(
    familyAccountMigrationSource,
    'create or replace function public.request_family_member(',
    'revoke all on function public.request_family_member('
  );
  assert.match(memberRequest, /p_cpf text default null/i);
  assert.match(memberRequest, /p_phone text default null/i);
  assert.match(memberRequest, /responsible\.full_name,[\s\S]*responsible\.phone,[\s\S]*'PENDENTE'/i);

  assert.match(adminSource, /clientFamilyBirthDate'\)\.required = false/);
  assert.match(adminSource, /clientFamilyCpf'\)\.required = !mayStayIncomplete && !minor/);
  assert.match(adminSource, /birthDate: birthDate \|\| null/);
  assert.doesNotMatch(adminSource, /if \(!birthDate\) throw new Error\('Informe a data de nascimento do membro\.'/);
  assert.match(adminSource, /Informe o CPF ou a data de nascimento do membro\./);

  const familySummary = sourceSection(
    familyRepairMigrationSource,
    'create or replace function private.get_my_family_summary_impl(p_user_id uuid)',
    'revoke all on function private.get_my_family_summary_impl(uuid)'
  );
  assert.match(familySummary, /effective_responsible_id/i);
  assert.match(familySummary, /when context\.caller_is_member then 0/i);
  assert.match(familySummary, /not context\.caller_is_member[\s\S]*member\.member_client_id = p_user_id/i);
  assert.match(familySummary, /member\.birth_date > \([\s\S]*interval '18 years'[\s\S]*'lessons'/i);
  assert.match(familySummary, /else '\[\]'::jsonb/i);
  assert.doesNotMatch(familySummary, /'cpf'|'email'/i);

  const accessRpc = sourceSection(
    familyAccountMigrationSource,
    'create or replace function public.admin_enable_family_member_access(',
    'comment on function public.request_family_member('
  );
  assert.match(accessRpc, /revoke all on function public\.admin_enable_family_member_access\(uuid, uuid, text\)[\s\S]*from public, anon, authenticated/i);
  assert.match(accessRpc, /grant execute on function public\.admin_enable_family_member_access\(uuid, uuid, text\)[\s\S]*to service_role/i);

  const invoiceGuard = sourceSection(
    familyAccountMigrationSource,
    'create or replace function private.guard_family_member_direct_invoice()',
    'drop policy if exists "payment invoices read own or permitted staff"'
  );
  assert.match(invoiceGuard, /member\.member_client_id = new\.client_id[\s\S]*member\.status = 'ATIVO'/i);
  assert.match(invoiceGuard, /before insert or update of client_id on public\.app_payment_invoices/i);
  const familyInvoice = sourceSection(
    familyAccountMigrationSource,
    'create or replace function public.admin_generate_family_invoice(',
    'revoke all on function public.admin_generate_family_invoice('
  );
  assert.match(familyInvoice, /where member\.billing_responsible_id = responsible\.id[\s\S]*member\.status = 'ATIVO'/i);
  assert.match(familyInvoice, /'Mensalidade familiar Ilha T.nis'/i);
  assert.match(familyInvoice, /family_billing[\s\S]*true/i);

  for (const column of [
    'reviewed_by',
    'actor_id',
    'family_member_id',
    'beneficiary_client_id'
  ]) {
    assert.match(familyIndexMigrationSource, new RegExp(`\\(${column}\\)`, 'i'));
  }
});

test('membro manual pode iniciar incompleto e o responsavel confirma sem impersonacao', () => {
  const memberValidation = sourceSection(
    manualFamilyMemberMigrationSource,
    'create or replace function private.validate_app_family_member()',
    'revoke all on function private.validate_app_family_member()'
  );
  assert.match(memberValidation, /responsible_confirmation_required is true[\s\S]*requested_by_client_id is null/i);
  assert.match(manualFamilyMemberMigrationSource, /confirmation_required boolean := p_member_client_id is null/i);
  assert.match(manualFamilyMemberMigrationSource, /MEMBRO_FAMILIA_CONFIRMAR/i);
  assert.match(manualFamilyMemberMigrationSource, /family-member-confirm:/i);
  assert.match(manualFamilyMemberMigrationSource, /after insert on public\.app_family_members/i);

  const confirmImpl = sourceSection(
    manualFamilyMemberMigrationSource,
    'create or replace function private.confirm_family_member_details_impl(',
    'revoke all on function private.confirm_family_member_details_impl('
  );
  assert.match(confirmImpl, /member\.billing_responsible_id = caller_id/i);
  assert.match(confirmImpl, /upper\(coalesce\(client\.status, ''\)\) = 'ATIVO'/i);
  assert.match(confirmImpl, /responsible_confirmation_required = false/i);
  assert.match(manualFamilyMemberMigrationSource, /revoke all on function public\.confirm_family_member_details[\s\S]*from public, anon/i);
  assert.match(manualFamilyMemberMigrationSource, /grant execute on function public\.confirm_family_member_details[\s\S]*to authenticated/i);
  assert.match(manualFamilyMemberMigrationSource, /'has_cpf', member\.cpf is not null/i);
  assert.doesNotMatch(manualFamilyMemberMigrationSource, /'cpf', member\.cpf/i);

  assert.match(indexSource, /rpc\/confirm_family_member_details/);
  assert.match(indexSource, /data-family-confirm-form/);
  assert.match(adminSource, /id="clientAreaPreviewBtn"[^>]*>Abrir área do cliente</);
  assert.match(adminSource, /window\.open\('about:blank', '_blank'\)/);
  assert.match(adminSource, /kind: 'ilha-client-readonly-preview-v1'/);
  assert.match(adminSource, /previewWindow\.name = JSON\.stringify\(buildClientAreaPreviewPayload\(client\)\)/);
  assert.match(adminSource, /previewWindow\.location\.replace\('\/client-preview'\)/);
  assert.doesNotMatch(adminSource, /impersonat|access_token=.*client/i);

  assert.match(clientPreviewSource, /Visualização pelo ADM · somente leitura/);
  assert.match(clientPreviewSource, /window\.name = ''/);
  assert.match(clientPreviewSource, /window\.opener = null/);
  assert.match(clientPreviewSource, /data-page="home"/);
  assert.match(clientPreviewSource, /data-page="play"/);
  assert.match(clientPreviewSource, /data-page="lessons"/);
  assert.match(clientPreviewSource, /data-page="payments"/);
  assert.match(clientPreviewSource, /data-page="store"/);
  assert.match(clientPreviewSource, /data-page="profile"/);
  assert.doesNotMatch(clientPreviewSource, /SUPABASE_|supabase|fetch\s*\(|XMLHttpRequest|<form\b/i);
});

test('membro familiar ativo vira aluno operacional e pode receber plano e aula no ADM', () => {
  const studentSync = sourceSection(
    familyAccountMigrationSource,
    'create or replace function private.sync_app_family_member_student()',
    'revoke all on function private.sync_app_family_member_student()'
  );
  assert.match(studentSync, /if new\.status <> 'ATIVO' then[\s\S]*return new/i);
  assert.match(studentSync, /insert into public\.students[\s\S]*'ATIVO'[\s\S]*new\.monthly_amount/i);
  assert.match(studentSync, /new\.student_id := linked_student\.id/i);
  assert.match(familyAccountMigrationSource, /before insert or update of[\s\S]*on public\.app_family_members[\s\S]*sync_app_family_member_student/i);

  assert.match(adminSource, /member\.studentId \? '<span class="ops-pill good">Aluno do clube<\/span>'/);
  assert.match(adminSource, /data-family-open-student=/);
  assert.match(adminSource, /data-student-plan-edit=/);
  assert.match(adminSource, /data-student-open-lessons=/);
  assert.match(adminSource, /body: \{ plan_name: planName, weekly_lessons: weeklyLessons \}/);
  assert.match(adminSource, /lessonPlacementState\.prefillStudentName = student\.name/);
  assert.match(adminSource, /lessonStudentPickerSearch'\)\.value = lessonPlacementState\.prefillStudentName/);
  assert.match(adminSource, /function clubClientDirectory\(\)/);
  assert.match(adminSource, /status === 'ATIVO' && Boolean\(member\.studentId\) && member\.responsibleConfirmationRequired !== true/);
  assert.match(adminSource, /const allRows = clubClientDirectory\(\)\.map\(buildClientOverview\)/);
  assert.match(adminSource, /id: 'family-member:' \+ member\.id/);
  assert.match(adminSource, /data-family-directory-open=/);
  assert.match(adminSource, /data-family-directory-student=/);
  assert.match(adminSource, /Plano individual · cobrança na conta da família/);
  assert.match(adminSource, /if \(studentId && String\(student\.id \|\| ''\) === studentId\) return true/);
  assert.match(serviceWorkerSource, /ilha-play-v234-announcement-redelivery/);
});

test('grade de aulas usa cartões compactos e filtros responsivos', () => {
  assert.match(adminSource, /placeholder="Buscar na grade" aria-label="Buscar aluno, professor ou horário"/);
  assert.match(adminSource, /function lessonActiveFilterCount\(\)/);
  assert.match(adminSource, /data-lesson-clear-filters/);
  assert.match(adminSource, /setTimeout\(renderLessons, 140\)/);
  assert.match(adminSource, /const visibleCourts = narrowingFilters \? courts\.filter/);
  assert.match(adminSource, /className = 'lesson-grid' \+ \(visibleCourts\.length === 1 \? ' has-one-court' : ''\)/);
  assert.match(adminSource, /class="lesson-student-action lesson-slot-edit"/);
  assert.match(adminSource, /role="progressbar" aria-label="Ocupação do horário"/);
  assert.match(adminSource, /\.lesson-time \{[\s\S]{0,240}min-height: 34px/);
  assert.match(adminSource, /\.lesson-summary::-webkit-scrollbar/);
});

test('responsavel pode confirmar menor sem CPF e sem data inventada pelo navegador', () => {
  const confirmImpl = sourceSection(
    minorFamilyMemberMigrationSource,
    'create or replace function private.confirm_family_member_details_impl(',
    'revoke all on function private.confirm_family_member_details_impl('
  );
  const familySummary = sourceSection(
    minorFamilyMemberMigrationSource,
    'create or replace function private.get_my_family_summary_impl(p_user_id uuid)',
    'revoke all on function private.get_my_family_summary_impl(uuid)'
  );

  assert.match(minorFamilyMemberMigrationSource, /minor_without_cpf_declared boolean not null default false/i);
  assert.match(confirmImpl, /member\.billing_responsible_id = caller_id/i);
  assert.match(confirmImpl, /if p_minor_without_cpf is true/i);
  assert.match(confirmImpl, /next_birth_date := p_birth_date/i);
  assert.match(confirmImpl, /next_cpf := null/i);
  assert.match(confirmImpl, /responsible_confirmation_required = false/i);
  assert.match(familySummary, /'minor_without_cpf_declared', member\.minor_without_cpf_declared/i);
  assert.match(familySummary, /'is_minor',[\s\S]*member\.minor_without_cpf_declared is true/i);
  assert.doesNotMatch(familySummary, /'cpf', member\.cpf/i);

  assert.match(indexSource, /name="minor_without_cpf"/i);
  assert.match(indexSource, /Este membro é menor de idade e não possui CPF/i);
  assert.match(indexSource, /p_minor_without_cpf: minorWithoutCpf/i);
  assert.match(indexSource, /autocomplete="off" max=/i);
  assert.match(indexSource, /if \(birthInput && birthInput\.value && !familyMemberIsMinor\(birthInput\.value\)\) birthInput\.value = ''/i);
});

test('Realtime de notificacoes assina somente eventos suportados pelas dispensas', () => {
  assert.match(
    indexSource,
    /async function initClientCourtRealtime\(\)[\s\S]*await courtRealtimeClient\.realtime\.setAuth\(session\.access_token\)/
  );
  assert.match(
    adminSource,
    /async function initAdminNotificationRealtime\(\)[\s\S]*await adminNotificationRealtimeClient\.realtime\.setAuth\(adminSession\.access_token\)/
  );
  assert.match(
    indexSource,
    /event: 'INSERT',[\s\S]{0,120}table: 'app_notification_dismissals'/
  );
  assert.doesNotMatch(
    indexSource,
    /event: '\*',[\s\S]{0,120}table: 'app_notification_dismissals'/
  );
});

test('Ilha Play organiza reserva, regras, convite e saida com hierarquia clara', () => {
  const topbarMatch = indexSource.match(/<header class="topbar">([\s\S]*?)<\/header>/i);
  const profileView = sourceSection(indexSource, '<section class="view" id="view-profile">', '<section class="view" id="view-lessons">');
  const courtHeroMatch = indexSource.match(/<div class="court-hero">([\s\S]*?)<\/div>\s*<div class="court-plan-gate"/i);

  assert.equal(topbarMatch, null);
  assert.doesNotMatch(indexSource, /id="pageTitle"/i);
  assert.match(profileView, /data-logout[^>]*>Sair da conta/i);
  assert.ok(courtHeroMatch);
  assert.match(courtHeroMatch[1], /id="clientCourtRulesBtn"[^>]*>Ver regras/i);
  assert.doesNotMatch(courtHeroMatch[1], /id="clientCourtChallengeBtn"/i);
  assert.match(indexSource, /class="court-challenge-callout"[\s\S]*id="clientCourtChallengeBtn"/i);
  assert.match(indexSource, /<strong>Está sem adversário\?<\/strong>[\s\S]*<span>Convide alguém para jogar<\/span>/i);
  assert.match(functionSource(indexSource, 'setCourtChallengeSelecting'), /Escolha agora um horário/);
  assert.match(functionSource(indexSource, 'clientCourtDayLabel'), /Domingo[\s\S]*Sábado/);
  assert.match(indexSource, /\.client-court-slot\.mine \{[\s\S]*border-left-color: var\(--lime\)/);
  assert.match(indexSource, /\.mobile-bottom-nav \{[\s\S]*position: fixed !important;[\s\S]*bottom: 0 !important;/);
  assert.match(indexSource, /--client-bottom-nav-height: 76px/);
  assert.match(indexSource, /\.mobile-bottom-nav button\.active \{[\s\S]*linear-gradient/);
  assert.match(indexSource, /<\/main>\s*<nav class="mobile-bottom-nav"/);
  assert.match(indexSource, /data-view="courts" aria-label="Reservar quadra"[\s\S]*?<span>Jogar<\/span>/);
  assert.match(indexSource, /body:not\(\.client-unlocked\) > \.mobile-bottom-nav/);
  assert.match(indexSource, /backdrop-filter: none !important/);
  assert.match(indexSource, /transform: none !important/);
  assert.match(indexSource, /class="court-cancel-btn"[^>]*data-cancel-client-court/i);
  assert.match(indexSource, /class="court-my-booking-kicker">Minha reserva/i);
  assert.match(indexSource, /data-view="payments" aria-label="Financeiro"[\s\S]{0,120}<span>Financeiro<\/span>/i);
});

test('popup de reserva fica acima do menu e preserva confirmacao no celular', () => {
  assert.match(indexSource, /\.court-booking-modal,[\s\S]*?z-index:\s*1200/);
  assert.match(indexSource, /\.court-booking-modal \.court-dialog \{[\s\S]*?display:\s*flex;[\s\S]*?overflow:\s*hidden;/);
  assert.match(indexSource, /\.court-booking-modal form \{[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/);
  assert.match(indexSource, /\.court-booking-modal \.court-dialog-body \{[\s\S]*?overflow-y:\s*auto;[\s\S]*?-webkit-overflow-scrolling:\s*touch;/);
  assert.match(indexSource, /\.court-booking-modal \{ align-items:\s*center; padding:\s*10px; \}/);
  assert.match(indexSource, /max-height:\s*calc\(100dvh - 20px\)/);
  assert.match(indexSource, /border-radius:\s*22px;/);
  assert.match(functionSource(indexSource, 'openClientCourtBooking'), /classList\.add\('court-booking-open'\)/);
  assert.match(functionSource(indexSource, 'closeClientCourtBooking'), /classList\.remove\('court-booking-open'\)/);
});

test('popups públicos e administrativos ficam centralizados', () => {
  assert.match(tournamentSource, /\.modal-backdrop \{[^}]*place-items:\s*center/);
  assert.match(adminSource, /body\.bar-admin-surface \.admin-modal-overlay\.show \{[\s\S]*place-items:\s*center/);
  assert.match(indexSource, /\.external-modal \{[\s\S]*align-items:\s*center;[\s\S]*place-items:\s*center;/);
  assert.match(barPublicSource, /\.sheet-backdrop \{[\s\S]*align-items:\s*center;/);
});

test('migrations canonicas possuem timestamps unicos e crescentes', async () => {
  const names = (await readdir(path.join(projectRoot, 'supabase', 'migrations'))).filter((name) => name.endsWith('.sql')).sort();
  const timestamps = names.map((name) => name.slice(0, 14));
  assert.equal(new Set(timestamps).size, timestamps.length);
  assert.deepEqual(timestamps, [...timestamps].sort());
});
