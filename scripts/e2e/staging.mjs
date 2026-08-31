import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPublishedRuntime, loadStagingConfig } from './staging-guard.mjs';

const scriptFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptFile), '..', '..');
const config = loadStagingConfig();
const browserSession = `ilha-staging-e2e-${process.pid}`;
const resultsDirectory = path.join(projectRoot, 'test-results', 'staging');
const browserBinary = process.env.AGENT_BROWSER_BIN || path.join(projectRoot, 'node_modules', '.bin', 'agent-browser');
const sensitiveValues = [
  config.publishableKey,
  config.asaas.apiKey,
  config.asaas.syntheticDocument,
  config.client.email,
  config.client.password,
  config.admin.email,
  config.admin.password,
  config.bar.email,
  config.bar.password
].filter(Boolean);

function redact(value) {
  let output = String(value || '');
  for (const sensitive of sensitiveValues) output = output.split(sensitive).join('[REDACTED]');
  output = output.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
  return output.slice(0, 4000);
}

function browser(args, { json = false, allowFailure = false } = {}) {
  const commandArgs = [
    '--session', browserSession,
    '--namespace', 'ilha-staging-e2e',
    ...args,
    ...(json ? ['--json'] : [])
  ];
  const result = spawnSync(browserBinary, commandArgs, {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      AGENT_BROWSER_ALLOWED_DOMAINS: [
        config.baseUrl.hostname,
        config.supabaseUrl.hostname,
        'cdn.jsdelivr.net',
        'fcm.googleapis.com',
        'fcmregistrations.googleapis.com'
      ].join(','),
      AGENT_BROWSER_DEFAULT_TIMEOUT: process.env.AGENT_BROWSER_DEFAULT_TIMEOUT || '30000',
      AGENT_BROWSER_SCREENSHOT_DIR: resultsDirectory
    }
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`Falha no navegador (${args[0]}): ${redact(result.stderr || result.stdout)}`);
  }
  if (!json) return String(result.stdout || '').trim();
  const lines = String(result.stdout || '').trim().split('\n').filter(Boolean);
  const jsonLine = [...lines].reverse().find((line) => line.trim().startsWith('{'));
  if (!jsonLine) throw new Error(`Resposta JSON ausente do navegador (${args[0]}).`);
  const parsed = JSON.parse(jsonLine);
  if (parsed.success !== true && !allowFailure) throw new Error(`Comando do navegador falhou (${args[0]}).`);
  return parsed;
}

function pageUrl(relativePath = '') {
  const base = config.baseUrl.href.endsWith('/') ? config.baseUrl.href : `${config.baseUrl.href}/`;
  return new URL(relativePath, base);
}

async function fetchText(url, label) {
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'text/html,application/json;q=0.9,*/*;q=0.5' }
  });
  if (!response.ok) throw new Error(`${label} respondeu HTTP ${response.status}.`);
  return response.text();
}

async function fetchJson(url, label) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${label} respondeu HTTP ${response.status}.`);
  return response.json();
}

async function assertPublishedApplication() {
  const [clientHtml, adminHtml, barHtml, menuHtml, tournamentsHtml, manifest, serviceWorker] = await Promise.all([
    fetchText(pageUrl(), 'Ilha Play'),
    fetchText(pageUrl('adm'), 'ADM'),
    fetchText(pageUrl('bar'), 'Bar'),
    fetchText(pageUrl('menu'), 'Menu'),
    fetchText(pageUrl('torneios'), 'Torneios'),
    fetchJson(pageUrl('manifest.json'), 'manifesto PWA'),
    fetchText(pageUrl('service-worker.js'), 'service worker')
  ]);
  assertPublishedRuntime(clientHtml, adminHtml, config, { barHtml, menuHtml, tournamentsHtml });
  if (!manifest.name || !manifest.start_url || !Array.isArray(manifest.icons) || !manifest.icons.length) {
    throw new Error('O manifesto PWA de staging está incompleto.');
  }
  if (!/self\.addEventListener\(['"](?:install|fetch)['"]/.test(serviceWorker)) {
    throw new Error('O service worker publicado não possui os handlers PWA esperados.');
  }
}

function authHeaders(accessToken = '') {
  const headers = { apikey: config.publishableKey, 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

async function supabaseJson(relativePath, accessToken, options = {}) {
  const response = await fetch(new URL(`/rest/v1/${relativePath}`, config.supabaseUrl), {
    method: options.method || 'GET',
    headers: {
      ...authHeaders(accessToken),
      ...(options.prefer ? { Prefer: options.prefer } : {})
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) {
    throw new Error(`${options.label || 'PostgREST/RLS de staging'} falhou (HTTP ${response.status}).`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function signInThroughApi(account) {
  const response = await fetch(new URL('/auth/v1/token?grant_type=password', config.supabaseUrl), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email: account.email, password: account.password }),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`Auth de staging recusou a conta sintética (HTTP ${response.status}).`);
  const payload = await response.json();
  if (!payload.access_token || !payload.user?.id) throw new Error('Auth de staging retornou uma sessão incompleta.');
  return payload;
}

function rememberSessionSecrets(session) {
  for (const token of [session?.access_token, session?.refresh_token]) {
    if (token) sensitiveValues.push(token);
  }
}

async function assertDatabase(accessToken) {
  const rows = await supabaseJson('app_plans?select=id&limit=1', accessToken);
  if (!Array.isArray(rows)) throw new Error('PostgREST de staging retornou formato inesperado.');
}

async function assertAdminPermissions(accessToken) {
  for (const permission of ['communication', 'clients.write']) {
    const allowed = await supabaseJson('rpc/has_club_permission', accessToken, {
      method: 'POST',
      body: { p_permission: permission },
      label: `Permissão ${permission} da conta ADM E2E`
    });
    if (allowed !== true) {
      throw new Error(`A conta ADM sintética não possui a permissão ${permission} exigida pelo E2E.`);
    }
  }
}

async function assertRealtime() {
  if (typeof WebSocket !== 'function') throw new Error('O runtime Node da CI não oferece WebSocket para o teste de Realtime.');
  const websocketUrl = new URL('/realtime/v1/websocket', config.supabaseUrl);
  websocketUrl.protocol = 'wss:';
  websocketUrl.searchParams.set('apikey', config.publishableKey);
  websocketUrl.searchParams.set('vsn', '1.0.0');
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(websocketUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Realtime de staging não abriu a conexão dentro do prazo.'));
    }, 15000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      socket.close();
      resolve();
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('Realtime de staging recusou a conexão WebSocket.'));
    }, { once: true });
  });
}

function saoPauloDate(daysFromToday) {
  const date = new Date(Date.now() + daysFromToday * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function asaasJson(resource, options = {}) {
  const response = await fetch(new URL(String(resource).replace(/^\/+/, ''), config.asaas.baseUrl), {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'IlhaTenis-E2E/1.0 (Node.js; sandbox)',
      access_token: config.asaas.apiKey,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(20000)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${options.label || 'API Asaas Sandbox'} falhou (HTTP ${response.status}).`);
  }
  return payload;
}

async function assertAsaasSandboxLifecycle() {
  const reference = `ilha-e2e-${Date.now()}-${randomUUID().slice(0, 8)}`;
  let customerId = '';
  let paymentId = '';
  let primaryError = null;
  const cleanupErrors = [];

  try {
    const customer = await asaasJson('customers', {
      method: 'POST',
      label: 'Criação do cliente sintético no Asaas Sandbox',
      body: {
        name: 'Ilha E2E Synthetic Fixture',
        cpfCnpj: config.asaas.syntheticDocument,
        externalReference: reference,
        notificationDisabled: true
      }
    });
    customerId = String(customer?.id || '');
    if (!customerId.startsWith('cus_')) throw new Error('Asaas Sandbox não retornou o ID do cliente sintético criado.');

    const customerRead = await asaasJson(`customers/${encodeURIComponent(customerId)}`, {
      label: 'Consulta do cliente sintético no Asaas Sandbox'
    });
    if (customerRead?.id !== customerId || customerRead?.externalReference !== reference) {
      throw new Error('A consulta do Asaas Sandbox não devolveu o cliente sintético recém-criado.');
    }

    const paymentReference = `${reference}-payment`;
    const payment = await asaasJson('payments', {
      method: 'POST',
      label: 'Criação da cobrança sintética no Asaas Sandbox',
      body: {
        customer: customerId,
        billingType: 'PIX',
        value: 5,
        dueDate: saoPauloDate(1),
        description: 'Ilha Tênis E2E sintético; remover ao final',
        externalReference: paymentReference
      }
    });
    paymentId = String(payment?.id || '');
    if (!paymentId.startsWith('pay_')) throw new Error('Asaas Sandbox não retornou o ID da cobrança sintética criada.');

    const paymentRead = await asaasJson(`payments/${encodeURIComponent(paymentId)}`, {
      label: 'Consulta da cobrança sintética no Asaas Sandbox'
    });
    if (paymentRead?.id !== paymentId || paymentRead?.customer !== customerId || paymentRead?.externalReference !== paymentReference) {
      throw new Error('A consulta do Asaas Sandbox não devolveu a cobrança sintética recém-criada.');
    }
  } catch (error) {
    primaryError = error;
  }

  if (paymentId) {
    try {
      const deleted = await asaasJson(`payments/${encodeURIComponent(paymentId)}`, {
        method: 'DELETE',
        label: 'Limpeza da cobrança sintética no Asaas Sandbox'
      });
      if (deleted?.deleted !== true) throw new Error('Asaas Sandbox não confirmou a remoção da cobrança sintética.');
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (customerId) {
    try {
      const deleted = await asaasJson(`customers/${encodeURIComponent(customerId)}`, {
        method: 'DELETE',
        label: 'Limpeza do cliente sintético no Asaas Sandbox'
      });
      if (deleted?.deleted !== true) throw new Error('Asaas Sandbox não confirmou a remoção do cliente sintético.');
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (primaryError) {
    if (cleanupErrors.length) primaryError.message += ' A limpeza do Sandbox também falhou; remova as fixtures pelo externalReference ilha-e2e.';
    throw primaryError;
  }
  if (cleanupErrors.length) throw cleanupErrors[0];
}

async function assertAsaasWebhookIsFailClosed() {
  const response = await fetch(new URL('/functions/v1/asaas-payment-webhook', config.supabaseUrl), {
    method: 'POST',
    headers: {
      apikey: config.publishableKey,
      'Content-Type': 'application/json',
      'asaas-access-token': 'invalid-e2e-probe-token'
    },
    body: JSON.stringify({
      id: `evt_e2e_probe_${Date.now()}`,
      event: 'PAYMENT_CONFIRMED',
      payment: { id: `pay_e2e_probe_${Date.now()}` }
    }),
    signal: AbortSignal.timeout(20000)
  });
  if (response.status !== 401) {
    throw new Error(`O webhook Asaas não recusou token inválido como esperado (HTTP ${response.status}).`);
  }
  const payload = await response.json().catch(() => null);
  if (payload?.error !== 'Webhook não autorizado.') {
    throw new Error('A resposta 401 não veio do contrato protegido da Edge Function Asaas esperada.');
  }
}

function assertBooleanExpression(expression, message) {
  const result = browser(['eval', expression], { json: true });
  if (result.data?.result !== true) throw new Error(message);
}

function browserEvaluation(expression) {
  return browser(['eval', expression], { json: true }).data?.result;
}

function findWebSocketUrl(value, depth = 0) {
  if (depth > 5) return '';
  if (typeof value === 'string' && /^wss?:\/\//.test(value.trim())) return value.trim();
  if (!value || typeof value !== 'object') return '';
  for (const nested of Object.values(value)) {
    const match = findWebSocketUrl(nested, depth + 1);
    if (match) return match;
  }
  return '';
}

async function cdpCommand(method, params) {
  const cdpResult = browser(['get', 'cdp-url'], { json: true });
  const cdpUrl = findWebSocketUrl(cdpResult);
  if (!cdpUrl) throw new Error('O navegador E2E não forneceu uma conexão CDP para configurar a permissão Push.');
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(cdpUrl);
    const commandId = 1;
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`O comando CDP ${method} excedeu o prazo.`));
    }, 10000);
    const finish = (callback, value) => {
      clearTimeout(timer);
      socket.close();
      callback(value);
    };
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ id: commandId, method, params }));
    }, { once: true });
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data || ''));
      } catch (_error) {
        return;
      }
      if (message.id !== commandId) return;
      if (message.error) finish(reject, new Error(`Chrome recusou o comando CDP ${method}.`));
      else finish(resolve, message.result || {});
    });
    socket.addEventListener('error', () => {
      finish(reject, new Error('Não foi possível abrir a conexão CDP do navegador E2E.'));
    }, { once: true });
  });
}

async function grantNotificationPermission() {
  const origin = config.baseUrl.origin;
  try {
    await cdpCommand('Browser.grantPermissions', { origin, permissions: ['notifications'] });
  } catch (_grantError) {
    await cdpCommand('Browser.setPermission', {
      origin,
      permission: { name: 'notifications' },
      setting: 'granted'
    });
  }
  assertBooleanExpression("Notification.permission === 'granted'", 'O Chromium de staging não concedeu a permissão de notificação isolada.');
}

function pushSubscriptionsPath(userId, endpoint = '') {
  const query = new URLSearchParams({
    select: 'id,user_id,endpoint,enabled',
    user_id: `eq.${userId}`
  });
  if (endpoint) query.set('endpoint', `eq.${endpoint}`);
  return `app_push_subscriptions?${query}`;
}

async function deleteSyntheticPushRows(clientSession) {
  const deleted = await supabaseJson(pushSubscriptionsPath(clientSession.user.id), clientSession.access_token, {
    method: 'DELETE',
    prefer: 'return=representation',
    label: 'Limpeza das inscrições Push da conta E2E'
  });
  if (!Array.isArray(deleted)) throw new Error('A limpeza das inscrições Push retornou um formato inesperado.');
}

function filteredTablePath(table, select, filters) {
  const query = new URLSearchParams({ select });
  for (const [name, value] of Object.entries(filters)) query.set(name, `eq.${value}`);
  return `${table}?${query}`;
}

const APP_CLIENT_RESET_SELECT = [
  'id',
  'full_name',
  'email',
  'status',
  'last_login_at',
  'official_plan_id',
  'official_plan_code',
  'official_plan_name',
  'plan_amount',
  'weekly_lessons',
  'preferred_days',
  'due_day',
  'declared_plan_code',
  'declared_plan_name',
  'registration_completed_at',
  'email_verified_at',
  'declared_lesson_slots',
  'plan_cancellation_requested_at',
  'plan_cancel_at',
  'reenrollment_fee_required'
].join(',');

const APP_CLIENT_RESET_FIELDS = APP_CLIENT_RESET_SELECT
  .split(',')
  .filter((field) => !['id', 'full_name', 'email'].includes(field));

async function appClientRows(accessToken, userId) {
  const rows = await supabaseJson(filteredTablePath('app_clients', APP_CLIENT_RESET_SELECT, { id: userId }), accessToken, {
    label: 'Consulta do cadastro Ilha Play da conta Bar E2E'
  });
  if (!Array.isArray(rows)) throw new Error('A consulta do cadastro Ilha Play retornou formato inesperado.');
  return rows;
}

async function pushRows(accessToken, userId) {
  const rows = await supabaseJson(pushSubscriptionsPath(userId), accessToken, {
    label: 'Consulta das inscrições Push da conta Bar E2E'
  });
  if (!Array.isArray(rows)) throw new Error('A consulta das inscrições Push retornou formato inesperado.');
  return rows;
}

async function assertBarIdentityPreserved(barSession) {
  const profileRows = await supabaseJson(
    filteredTablePath('profiles', 'id,email,role,active,permissions', { id: barSession.user.id }),
    barSession.access_token,
    { label: 'Consulta do perfil da conta Bar E2E' }
  );
  if (!Array.isArray(profileRows) || profileRows.length !== 1) {
    throw new Error('O perfil da conta Bar E2E não foi preservado.');
  }
  const profile = profileRows[0];
  const permissions = Array.isArray(profile.permissions) ? profile.permissions.map(String) : [];
  if (
    profile.role !== 'bar' ||
    profile.active !== true ||
    String(profile.email || '').trim().toLowerCase() !== config.bar.email ||
    !permissions.length ||
    permissions.some((permission) => !permission.startsWith('bar.'))
  ) {
    throw new Error('A conta Bar E2E deve ter role=bar, estar ativa e possuir somente permissões bar.*.');
  }

  const currentRole = await supabaseJson('rpc/current_user_role', barSession.access_token, {
    method: 'POST',
    body: {},
    label: 'Validação conjunta de Auth, perfil e allowlist da conta Bar E2E'
  });
  if (currentRole !== 'bar') {
    throw new Error('Auth, perfil e allowlist da conta Bar E2E deixaram de formar uma identidade protegida válida.');
  }
  for (const permission of permissions) {
    const allowed = await supabaseJson('rpc/has_bar_permission', barSession.access_token, {
      method: 'POST',
      body: { p_permission: permission },
      label: `Permissão ${permission} da conta Bar E2E`
    });
    if (allowed !== true) throw new Error(`A allowlist não preservou a permissão Bar ${permission}.`);
  }
  for (const clubPermission of ['clients.write', 'plans', 'finance.write', 'classes', 'store', 'announcements', 'communication', 'tournaments', 'team']) {
    const allowed = await supabaseJson('rpc/has_club_permission', barSession.access_token, {
      method: 'POST',
      body: { p_permission: clubPermission },
      label: `Ausência da permissão de Clube ${clubPermission} na conta Bar E2E`
    });
    if (allowed !== false) throw new Error(`A conta Bar E2E recebeu indevidamente a permissão de Clube ${clubPermission}.`);
  }
}

function resetFieldSnapshot(client) {
  return Object.fromEntries(APP_CLIENT_RESET_FIELDS.map((field) => [field, client?.[field] ?? null]));
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
}

function assertResetFieldsEqual(actual, expected, label) {
  const actualSnapshot = stableJson(resetFieldSnapshot(actual));
  const expectedSnapshot = stableJson(resetFieldSnapshot(expected));
  if (JSON.stringify(actualSnapshot) !== JSON.stringify(expectedSnapshot)) {
    throw new Error(`${label} não devolveu os campos recuperáveis ao estado esperado.`);
  }
}

async function updateBarPlayFixture(adminSession, barUserId, patch, label) {
  const rows = await supabaseJson(
    filteredTablePath('app_clients', APP_CLIENT_RESET_SELECT, { id: barUserId }),
    adminSession.access_token,
    {
      method: 'PATCH',
      prefer: 'return=representation',
      body: patch,
      label
    }
  );
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== barUserId) {
    throw new Error(`${label} não confirmou a ficha sintética esperada.`);
  }
  return rows[0];
}

async function listBarPlayBackups(adminSession, barUserId) {
  const rows = await supabaseJson('rpc/list_app_client_account_backups', adminSession.access_token, {
    method: 'POST',
    body: { p_client_id: barUserId, p_limit: 100 },
    label: 'Listagem dos metadados de backup da conta Bar E2E'
  });
  if (!Array.isArray(rows)) throw new Error('A listagem de backups retornou formato inesperado.');
  return rows;
}

async function restoreBarPlayBackup(adminSession, backupId, label = 'Restauração do backup da conta Bar E2E') {
  const result = await supabaseJson('rpc/restore_app_client_account_backup', adminSession.access_token, {
    method: 'POST',
    body: { p_backup_id: backupId },
    label
  });
  if (result?.restored !== true || result?.backup_id !== backupId) {
    throw new Error(`${label} não confirmou o backup informado.`);
  }
  return result;
}

async function restoreInterruptedBarPlayReset(adminSession, barUserId) {
  const backups = await listBarPlayBackups(adminSession, barUserId);
  const openBackup = backups.find((backup) => backup.status === 'RESET_APPLIED');
  if (!openBackup) return null;
  return restoreBarPlayBackup(
    adminSession,
    openBackup.backup_id,
    'Recuperação da fixture Bar E2E interrompida anteriormente'
  );
}

async function createBarPlayFixture(barSession, adminSession) {
  const client = await supabaseJson('rpc/ensure_current_app_client', barSession.access_token, {
    method: 'POST',
    body: { p_full_name: 'Equipe Bar E2E Sintética', p_phone: null },
    label: 'Recriação do cadastro Ilha Play da conta Bar E2E'
  });
  if (client?.id !== barSession.user.id) throw new Error('O cadastro Ilha Play sintético não foi criado para a identidade Bar esperada.');

  const fixtureTimestamp = new Date().toISOString();
  const expectedClient = await updateBarPlayFixture(
    adminSession,
    barSession.user.id,
    {
      status: 'ATIVO',
      last_login_at: fixtureTimestamp,
      official_plan_id: null,
      official_plan_code: 'e2e_bar_recuperavel',
      official_plan_name: 'Plano Bar E2E recuperável',
      plan_amount: 137.42,
      weekly_lessons: 2,
      preferred_days: ['SEGUNDA', 'QUARTA'],
      due_day: 17,
      declared_plan_code: 'e2e_bar_recuperavel',
      declared_plan_name: 'Plano Bar E2E recuperável',
      registration_completed_at: fixtureTimestamp,
      email_verified_at: barSession.user.email_confirmed_at || fixtureTimestamp,
      declared_lesson_slots: [
        { weekday: 1, time: '18:00' },
        { weekday: 3, time: '18:00' }
      ],
      plan_cancellation_requested_at: fixtureTimestamp,
      plan_cancel_at: saoPauloDate(60),
      reenrollment_fee_required: true
    },
    'Preparação dos dados recuperáveis da conta Bar E2E'
  );

  const endpoint = `https://push.invalid/ilha-e2e/${randomUUID()}`;
  const subscriptions = await supabaseJson('app_push_subscriptions?on_conflict=endpoint', barSession.access_token, {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    label: 'Criação da inscrição Push sintética da conta Bar E2E',
    body: {
      user_id: barSession.user.id,
      endpoint,
      p256dh: 'e2e-synthetic-p256dh',
      auth_key: 'e2e-synthetic-auth',
      user_agent: 'Ilha staging E2E synthetic fixture',
      enabled: true,
      updated_at: new Date().toISOString()
    }
  });
  if (!Array.isArray(subscriptions) || subscriptions.length !== 1 || subscriptions[0].endpoint !== endpoint) {
    throw new Error('A inscrição Push sintética da conta Bar E2E não foi persistida.');
  }
  if ((await appClientRows(barSession.access_token, barSession.user.id)).length !== 1) {
    throw new Error('O cadastro Ilha Play sintético desapareceu antes do reset.');
  }
  if ((await pushRows(barSession.access_token, barSession.user.id)).length !== 1) {
    throw new Error('A inscrição Push sintética desapareceu antes do reset.');
  }
  return { endpoint, expectedClient };
}

async function resetBarPlayFixture(adminSession, barUserId, reason) {
  const result = await supabaseJson('rpc/reset_app_client_account_with_backup', adminSession.access_token, {
    method: 'POST',
    body: { p_client_id: barUserId, p_reason: reason },
    label: 'Reset recuperável do Ilha Play da conta Bar E2E'
  });
  if (
    result?.reset !== true ||
    result?.deleted !== false ||
    result?.preserved_auth_access !== true ||
    result?.preserved_bar_access !== true ||
    result?.preserved_team_access !== true ||
    result?.preserved_history !== true ||
    result?.user_id !== barUserId ||
    !result?.backup_id
  ) {
    throw new Error('O reset não confirmou backup, histórico e preservação de Auth/perfil/Bar.');
  }
  return result;
}

async function assertBarPlayPending(adminSession, barSession, endpoint) {
  const rows = await appClientRows(adminSession.access_token, barSession.user.id);
  if (rows.length !== 1) {
    throw new Error('O reset lógico deveria manter exatamente uma ficha Ilha Play sintética.');
  }
  const client = rows[0];
  const arraysAreEmpty = [client.preferred_days, client.declared_lesson_slots]
    .every((value) => Array.isArray(value) && value.length === 0);
  if (
    client.status !== 'PENDENTE' ||
    client.last_login_at !== null ||
    client.official_plan_id !== null ||
    client.official_plan_code !== null ||
    client.official_plan_name !== null ||
    Number(client.plan_amount) !== 0 ||
    Number(client.weekly_lessons) !== 0 ||
    !arraysAreEmpty ||
    client.due_day !== null ||
    client.declared_plan_code !== null ||
    client.declared_plan_name !== null ||
    client.registration_completed_at !== null ||
    client.email_verified_at !== null ||
    client.plan_cancellation_requested_at !== null ||
    client.plan_cancel_at !== null ||
    client.reenrollment_fee_required !== false
  ) {
    throw new Error('O reset lógico não deixou a ficha PENDENTE com os campos de plano zerados.');
  }

  const pushes = await pushRows(barSession.access_token, barSession.user.id);
  if (pushes.length !== 1 || pushes[0].endpoint !== endpoint || pushes[0].enabled !== true) {
    throw new Error('O reset lógico não preservou exatamente a inscrição Push sintética esperada.');
  }
}

function assertBackupMetadata(metadata, expected) {
  if (
    !metadata ||
    metadata.backup_id !== expected.backupId ||
    metadata.client_id !== expected.clientId ||
    String(metadata.client_email || '').trim().toLowerCase() !== config.bar.email ||
    metadata.reason !== expected.reason ||
    metadata.status !== expected.status ||
    !metadata.created_at ||
    !metadata.expires_at ||
    Number.isNaN(Date.parse(metadata.created_at)) ||
    Date.parse(metadata.expires_at) <= Date.parse(metadata.created_at)
  ) {
    throw new Error(`Os metadados do backup ${expected.status} estão incompletos ou divergentes.`);
  }
  for (const privateField of ['app_client_snapshot', 'snapshot_sha256', 'protected_state_before', 'protected_state_after']) {
    if (Object.hasOwn(metadata, privateField)) {
      throw new Error(`A listagem administrativa expôs indevidamente o campo privado ${privateField}.`);
    }
  }
}

async function assertBarPlayResetLifecycle(adminSession, initialBarSession) {
  let barSession = initialBarSession;
  let baselineClient = null;
  let primaryError = null;
  const cleanupErrors = [];
  try {
    await assertBarIdentityPreserved(barSession);
    await restoreInterruptedBarPlayReset(adminSession, barSession.user.id);
    await deleteSyntheticPushRows(barSession);

    await supabaseJson('rpc/ensure_current_app_client', barSession.access_token, {
      method: 'POST',
      body: { p_full_name: 'Equipe Bar E2E Sintética', p_phone: null },
      label: 'Preparação repetível da ficha Ilha Play da conta Bar E2E'
    });
    const baselineRows = await appClientRows(adminSession.access_token, barSession.user.id);
    if (baselineRows.length !== 1) throw new Error('A fixture Bar E2E não possui uma ficha-base única para restauração final.');
    baselineClient = baselineRows[0];

    const fixture = await createBarPlayFixture(barSession, adminSession);
    const reason = `Reset E2E sintético recuperável ${randomUUID()}`;
    const firstReset = await resetBarPlayFixture(adminSession, barSession.user.id, reason);
    if (firstReset.already_reset !== false) throw new Error('A primeira chamada de reset foi tratada indevidamente como repetida.');
    await assertBarPlayPending(adminSession, barSession, fixture.endpoint);
    await assertBarIdentityPreserved(barSession);

    const repeatedReset = await resetBarPlayFixture(adminSession, barSession.user.id, reason);
    if (repeatedReset.already_reset !== true || repeatedReset.backup_id !== firstReset.backup_id) {
      throw new Error('A repetição do reset não reutilizou idempotentemente o mesmo backup.');
    }
    await assertBarPlayPending(adminSession, barSession, fixture.endpoint);

    const reauthenticatedAfterReset = await signInThroughApi(config.bar);
    rememberSessionSecrets(reauthenticatedAfterReset);
    if (reauthenticatedAfterReset.user.id !== barSession.user.id) {
      throw new Error('A reautenticação após o reset retornou outra identidade Bar.');
    }
    barSession = reauthenticatedAfterReset;
    await assertBarIdentityPreserved(barSession);

    const resetBackups = await listBarPlayBackups(adminSession, barSession.user.id);
    const resetMetadata = resetBackups.find((backup) => backup.backup_id === firstReset.backup_id);
    assertBackupMetadata(resetMetadata, {
      backupId: firstReset.backup_id,
      clientId: barSession.user.id,
      reason,
      status: 'RESET_APPLIED'
    });

    const restored = await restoreBarPlayBackup(adminSession, firstReset.backup_id);
    if (restored.already_restored !== false || restored.user_id !== barSession.user.id) {
      throw new Error('A restauração não confirmou o cliente sintético esperado.');
    }
    const restoredRows = await appClientRows(adminSession.access_token, barSession.user.id);
    if (restoredRows.length !== 1) throw new Error('A restauração não devolveu uma ficha Ilha Play única.');
    assertResetFieldsEqual(restoredRows[0], fixture.expectedClient, 'A restauração do backup');

    const restoredPushes = await pushRows(barSession.access_token, barSession.user.id);
    if (restoredPushes.length !== 1 || restoredPushes[0].endpoint !== fixture.endpoint || restoredPushes[0].enabled !== true) {
      throw new Error('A restauração alterou indevidamente a inscrição Push preservada.');
    }
    await assertBarIdentityPreserved(barSession);

    const restoredBackups = await listBarPlayBackups(adminSession, barSession.user.id);
    const restoredMetadata = restoredBackups.find((backup) => backup.backup_id === firstReset.backup_id);
    assertBackupMetadata(restoredMetadata, {
      backupId: firstReset.backup_id,
      clientId: barSession.user.id,
      reason,
      status: 'RESTORED'
    });
  } catch (error) {
    primaryError = error;
  }

  try {
    await restoreInterruptedBarPlayReset(adminSession, barSession.user.id);
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (baselineClient) {
    try {
      await updateBarPlayFixture(
        adminSession,
        barSession.user.id,
        resetFieldSnapshot(baselineClient),
        'Restauração final da ficha-base da fixture Bar E2E'
      );
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await deleteSyntheticPushRows(barSession);
  } catch (error) {
    cleanupErrors.push(error);
  }

  if (primaryError) {
    if (cleanupErrors.length) primaryError.message += ' A restauração/limpeza final da fixture Bar E2E também falhou.';
    throw primaryError;
  }
  if (cleanupErrors.length) throw cleanupErrors[0];
}

async function waitForSyntheticPushRow(clientSession, endpoint) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const rows = await supabaseJson(pushSubscriptionsPath(clientSession.user.id, endpoint), clientSession.access_token, {
      label: 'Consulta da inscrição Push sintética'
    });
    if (Array.isArray(rows) && rows.length === 1 && rows[0].enabled === true) return;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error('A inscrição Push criada no navegador não foi persistida no banco de staging.');
}

async function sendSyntheticPush(adminSession, clientUserId, notification) {
  const response = await fetch(new URL('/functions/v1/client-broadcast-push', config.supabaseUrl), {
    method: 'POST',
    headers: authHeaders(adminSession.access_token),
    body: JSON.stringify({
      title: notification.title,
      body: notification.body,
      url: '/',
      user_id: clientUserId,
      tag: notification.tag
    }),
    signal: AbortSignal.timeout(30000)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`A Edge Function de Push de staging falhou (HTTP ${response.status}).`);
  if (Number(payload?.queued || 0) < 1 || Number(payload?.recipients || 0) < 1) {
    throw new Error('A Edge Function respondeu, mas não confirmou o enfileiramento do Push sintético.');
  }
  if (payload?.delivery !== 'queued' || payload?.processing_requested !== true) {
    throw new Error('A notificação foi enfileirada, mas o dispatcher não confirmou o início do processamento.');
  }
}

async function waitForVisiblePush(notification) {
  const expression = `navigator.serviceWorker.ready.then(async function (registration) {
    const notifications = await registration.getNotifications({ tag: ${JSON.stringify(notification.tag)} });
    return notifications.some(function (item) {
      return item.title === ${JSON.stringify(notification.title)} && item.body === ${JSON.stringify(notification.body)};
    });
  })`;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (browserEvaluation(expression) === true) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('O provedor Push aceitou o envio, mas a notificação não chegou ao service worker do Ilha Play.');
}

async function cleanupBrowserPush(notificationTag) {
  const cleaned = browserEvaluation(`navigator.serviceWorker.ready.then(async function (registration) {
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
    const notifications = await registration.getNotifications({ tag: ${JSON.stringify(notificationTag)} });
    notifications.forEach(function (item) { item.close(); });
    return true;
  })`);
  if (cleaned !== true) throw new Error('O navegador não confirmou a limpeza da inscrição Push sintética.');
}

function assertNoBrowserErrors(surface) {
  const pageErrors = browser(['errors'], { json: true }).data?.errors || [];
  if (pageErrors.length) throw new Error(`${surface} apresentou erro de página: ${redact(JSON.stringify(pageErrors))}`);
  const messages = browser(['console'], { json: true }).data?.messages || [];
  const errorMessages = messages.filter((entry) => ['error', 'assert'].includes(String(entry.type || entry.level || '').toLowerCase()));
  if (errorMessages.length) throw new Error(`${surface} apresentou erro no console: ${redact(JSON.stringify(errorMessages))}`);
}

function openAndSnapshot(url) {
  browser(['open', url.href]);
  browser(['wait', '1500']);
  browser(['snapshot', '-i'], { json: true });
}

async function testClientBrowserFlow(clientSession, adminSession) {
  await deleteSyntheticPushRows(clientSession);
  openAndSnapshot(pageUrl());
  await grantNotificationPermission();
  browser(['fill', '#loginEmail', config.client.email]);
  browser(['fill', '#loginPassword', config.client.password]);
  browser(['click', '#loginSubmit']);
  browser(['wait', '#clientApp']);
  browser(['snapshot', '-i'], { json: true });
  assertBooleanExpression(
    "document.body.classList.contains('client-unlocked') && document.querySelector('#clientApp')?.getAttribute('aria-hidden') === 'false'",
    'O Ilha Play não desbloqueou para a conta sintética ativa.'
  );
  browser(['reload']);
  browser(['wait', '#clientApp']);
  assertBooleanExpression(
    "document.body.classList.contains('client-unlocked')",
    'A sessão do Ilha Play não persistiu depois do reload.'
  );
  browser(['set', 'viewport', '390', '844']);
  browser(['wait', '300']);
  assertBooleanExpression(
    "document.querySelector('#mobileBottomNav') && getComputedStyle(document.querySelector('#mobileBottomNav')).display !== 'none'",
    'A navegação móvel do Ilha Play não ficou disponível.'
  );
  browser(['screenshot', path.join(resultsDirectory, 'ilha-play-mobile.png')]);
  assertBooleanExpression("Boolean('serviceWorker' in navigator)", 'O navegador não reconheceu suporte PWA.');

  const notification = {
    tag: `ilha-e2e-${Date.now()}-${randomUUID().slice(0, 8)}`,
    title: 'Ilha Play · E2E staging',
    body: 'Notificação sintética de staging; nenhuma ação é necessária.'
  };
  let pushError = null;
  const cleanupErrors = [];
  try {
    const enabled = browserEvaluation('ensureClientPushSubscription(true)');
    if (enabled !== true) throw new Error('O Ilha Play não criou a inscrição Push no Chromium de staging.');
    const endpoint = String(browserEvaluation(`navigator.serviceWorker.ready.then(async function (registration) {
      const subscription = await registration.pushManager.getSubscription();
      return subscription ? subscription.endpoint : '';
    })`) || '');
    if (!endpoint.startsWith('https://')) throw new Error('A inscrição Push do Chromium não retornou um endpoint HTTPS.');
    await waitForSyntheticPushRow(clientSession, endpoint);
    await sendSyntheticPush(adminSession, clientSession.user.id, notification);
    await waitForVisiblePush(notification);
  } catch (error) {
    pushError = error;
  }
  try {
    await cleanupBrowserPush(notification.tag);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await deleteSyntheticPushRows(clientSession);
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (pushError) {
    if (cleanupErrors.length) pushError.message += ' A limpeza da inscrição Push sintética também falhou.';
    throw pushError;
  }
  if (cleanupErrors.length) throw cleanupErrors[0];

  assertNoBrowserErrors('Ilha Play');
  browser(['eval', "document.querySelector('[data-logout]')?.click(); true"], { json: true });
  browser(['wait', '#loginForm']);
  assertBooleanExpression("document.body.classList.contains('client-locked')", 'O logout do Ilha Play não encerrou a sessão.');
}

function testAdminBrowserFlow() {
  openAndSnapshot(pageUrl('adm'));
  browser(['fill', '#adminUser', config.admin.email]);
  browser(['fill', '#adminPassword', config.admin.password]);
  browser(['click', '#adminLoginBtn']);
  browser(['wait', '#adminApp']);
  browser(['snapshot', '-i'], { json: true });
  assertBooleanExpression(
    "document.body.classList.contains('adm-unlocked') && document.querySelector('#adminApp')?.getAttribute('aria-hidden') === 'false'",
    'O ADM não desbloqueou para a conta sintética protegida.'
  );
  browser(['reload']);
  browser(['wait', '#adminApp']);
  assertBooleanExpression("document.body.classList.contains('adm-unlocked')", 'A sessão do ADM não persistiu depois do reload.');
  browser(['set', 'viewport', '390', '844']);
  browser(['wait', '300']);
  assertBooleanExpression(
    "document.documentElement.scrollWidth <= window.innerWidth + 1",
    'O ADM criou rolagem horizontal indevida no viewport móvel.'
  );
  browser(['screenshot', path.join(resultsDirectory, 'adm-mobile.png')]);
  assertNoBrowserErrors('ADM');
  browser(['eval', "document.querySelector('#sidebarLogoutBtn')?.click(); true"], { json: true });
  browser(['wait', '#adminLoginForm']);
  assertBooleanExpression("document.body.classList.contains('adm-locked')", 'O logout do ADM não encerrou a sessão.');
}

await mkdir(resultsDirectory, { recursive: true });

try {
  // This must happen before any credential is submitted. It catches a staging
  // deploy that still points to production even if the URL itself looks safe.
  await assertPublishedApplication();
  const clientSession = await signInThroughApi(config.client);
  const adminSession = await signInThroughApi(config.admin);
  const barSession = await signInThroughApi(config.bar);
  rememberSessionSecrets(clientSession);
  rememberSessionSecrets(adminSession);
  rememberSessionSecrets(barSession);
  await assertDatabase(clientSession.access_token);
  await assertAdminPermissions(adminSession.access_token);
  await assertRealtime();
  await assertAsaasWebhookIsFailClosed();
  await assertAsaasSandboxLifecycle();
  await assertBarPlayResetLifecycle(adminSession, barSession);
  await testClientBrowserFlow(clientSession, adminSession);
  testAdminBrowserFlow();
  console.log('E2E de staging aprovado: runtime isolado; Auth, PostgREST/RLS e Realtime; backup, reset lógico idempotente e restauração do Play preservando Auth/perfil/allowlist/Push Bar; PWA; inscrição e entrega Push reais; webhook Asaas fail-closed; ciclo criar/consultar/remover no Asaas Sandbox; Ilha Play e ADM.');
} finally {
  browser(['close'], { allowFailure: true });
}
