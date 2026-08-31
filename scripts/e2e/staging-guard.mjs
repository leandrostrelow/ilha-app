const PRODUCTION_WEB_HOSTS = new Set([
  'app.ilhatenis.com',
  'ilhatenis.com',
  'www.ilhatenis.com'
]);

const PRODUCTION_SUPABASE_REFS = new Set([
  'lkqtgptebkgfwguykxhv'
]);

const REQUIRED_ENV = [
  'STAGING_BASE_URL',
  'STAGING_SUPABASE_URL',
  'STAGING_SUPABASE_PROJECT_REF',
  'STAGING_SUPABASE_PUBLISHABLE_KEY',
  'STAGING_VAPID_PUBLIC_KEY',
  'STAGING_ASAAS_SANDBOX_API_KEY',
  'STAGING_ASAAS_E2E_DOCUMENT',
  'STAGING_E2E_CLIENT_EMAIL',
  'STAGING_E2E_CLIENT_PASSWORD',
  'STAGING_E2E_ADMIN_EMAIL',
  'STAGING_E2E_ADMIN_PASSWORD',
  'STAGING_E2E_BAR_EMAIL',
  'STAGING_E2E_BAR_PASSWORD'
];

function required(env, name) {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}.`);
  return value;
}

function httpsUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_error) {
    throw new Error(`${label} não é uma URL válida.`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error(`${label} deve usar HTTPS e não pode conter credenciais.`);
  }
  return parsed;
}

function stagingWebUrl(value) {
  const parsed = httpsUrl(value, 'STAGING_BASE_URL');
  const host = parsed.hostname.toLowerCase();
  if (PRODUCTION_WEB_HOSTS.has(host) || host.endsWith('.ilhatenis.com') && !/(^|[.-])staging([.-]|$)/.test(host)) {
    throw new Error('STAGING_BASE_URL aponta para um host de produção do Ilha Tênis.');
  }
  if (!/(^|[.-])(staging|preview|sandbox|test)([.-]|$)/.test(host)) {
    throw new Error('O host de E2E deve conter um marcador explícito: staging, preview, sandbox ou test.');
  }
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed;
}

function stagingSupabaseUrl(value, expectedRef) {
  const parsed = httpsUrl(value, 'STAGING_SUPABASE_URL');
  const hostMatch = parsed.hostname.toLowerCase().match(/^([a-z0-9-]+)\.supabase\.co$/);
  if (!hostMatch) throw new Error('STAGING_SUPABASE_URL deve apontar para um projeto hospedado no Supabase.');
  const actualRef = hostMatch[1];
  if (PRODUCTION_SUPABASE_REFS.has(actualRef)) {
    throw new Error('STAGING_SUPABASE_URL aponta para o projeto Supabase de produção conhecido.');
  }
  if (actualRef !== expectedRef) {
    throw new Error('STAGING_SUPABASE_PROJECT_REF não corresponde ao host configurado.');
  }
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed;
}

function syntheticEmail(value, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new Error(`${label} não é um e-mail válido.`);
  const localPart = normalized.split('@')[0];
  if (!/(^|[+._-])e2e([+._-]|$)/.test(localPart)) {
    throw new Error(`${label} deve identificar explicitamente uma conta sintética com o marcador e2e.`);
  }
  return normalized;
}

function password(value, label) {
  const normalized = String(value || '');
  if (normalized.length < 12) throw new Error(`${label} deve ter pelo menos 12 caracteres.`);
  return normalized;
}

function asaasSandboxKey(value) {
  const normalized = String(value || '').trim();
  if (!/^\$aact_hmlg_[A-Za-z0-9_-]{20,}$/.test(normalized)) {
    throw new Error('STAGING_ASAAS_SANDBOX_API_KEY deve usar o prefixo moderno exclusivo do Sandbox ($aact_hmlg_).');
  }
  return normalized;
}

function syntheticDocument(value) {
  const normalized = String(value || '').replace(/\D/g, '');
  if (!/^(?:\d{11}|\d{14})$/.test(normalized) || /^(\d)\1+$/.test(normalized)) {
    throw new Error('STAGING_ASAAS_E2E_DOCUMENT deve ser um CPF/CNPJ sintético válido para a fixture de Sandbox.');
  }
  return normalized;
}

export function loadStagingConfig(env = process.env) {
  if (String(env.E2E_REMOTE_CONFIRMATION || '') !== 'STAGING_ONLY_NO_REAL_DATA') {
    throw new Error('Execução remota bloqueada: confirmação de staging ausente.');
  }
  if (String(env.E2E_ASAAS_MODE || '').toLowerCase() !== 'sandbox') {
    throw new Error('Execução remota bloqueada: E2E_ASAAS_MODE deve ser sandbox.');
  }
  if (String(env.E2E_PUSH_MODE || '') !== 'REAL_STAGING_DELIVERY') {
    throw new Error('Execução remota bloqueada: E2E_PUSH_MODE deve exigir entrega Push real em staging.');
  }
  if (String(env.STAGING_ASAAS_DOCUMENT_CONFIRMATION || '') !== 'SYNTHETIC_SANDBOX_FIXTURE') {
    throw new Error('Execução remota bloqueada: confirme que o documento Asaas é uma fixture sintética.');
  }
  for (const name of REQUIRED_ENV) required(env, name);

  const projectRef = required(env, 'STAGING_SUPABASE_PROJECT_REF').toLowerCase();
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error('STAGING_SUPABASE_PROJECT_REF possui formato inválido.');
  const baseUrl = stagingWebUrl(required(env, 'STAGING_BASE_URL'));
  const supabaseUrl = stagingSupabaseUrl(required(env, 'STAGING_SUPABASE_URL'), projectRef);
  const publishableKey = required(env, 'STAGING_SUPABASE_PUBLISHABLE_KEY');
  if (!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(publishableKey)) {
    throw new Error('Use uma chave publicável moderna de staging; chaves secretas/service_role são proibidas no E2E do navegador.');
  }
  const vapidPublicKey = required(env, 'STAGING_VAPID_PUBLIC_KEY');
  if (!/^[A-Za-z0-9_-]{80,120}$/.test(vapidPublicKey)) throw new Error('STAGING_VAPID_PUBLIC_KEY possui formato inválido.');

  return {
    baseUrl,
    supabaseUrl,
    projectRef,
    publishableKey,
    vapidPublicKey,
    asaas: {
      baseUrl: new URL('https://api-sandbox.asaas.com/v3/'),
      apiKey: asaasSandboxKey(env.STAGING_ASAAS_SANDBOX_API_KEY),
      syntheticDocument: syntheticDocument(env.STAGING_ASAAS_E2E_DOCUMENT)
    },
    client: {
      email: syntheticEmail(env.STAGING_E2E_CLIENT_EMAIL, 'STAGING_E2E_CLIENT_EMAIL'),
      password: password(env.STAGING_E2E_CLIENT_PASSWORD, 'STAGING_E2E_CLIENT_PASSWORD')
    },
    admin: {
      email: syntheticEmail(env.STAGING_E2E_ADMIN_EMAIL, 'STAGING_E2E_ADMIN_EMAIL'),
      password: password(env.STAGING_E2E_ADMIN_PASSWORD, 'STAGING_E2E_ADMIN_PASSWORD')
    },
    bar: {
      email: syntheticEmail(env.STAGING_E2E_BAR_EMAIL, 'STAGING_E2E_BAR_EMAIL'),
      password: password(env.STAGING_E2E_BAR_PASSWORD, 'STAGING_E2E_BAR_PASSWORD')
    }
  };
}

function constant(source, name) {
  const match = source.match(new RegExp(`\\bconst\\s+${name}\\s*=\\s*['\"]([^'\"]+)['\"]`));
  if (!match) throw new Error(`A página publicada não declara ${name}.`);
  return match[1];
}

export function assertPublishedRuntime(clientHtml, adminHtml, config, surfaces = {}) {
  const clientUrl = constant(clientHtml, 'SUPABASE_URL');
  const adminUrl = constant(adminHtml, 'LESSONS_SUPABASE_URL');
  const tournamentApiUrl = constant(adminHtml, 'TOURNAMENT_API_URL');
  const clientKey = constant(clientHtml, 'SUPABASE_ANON_KEY');
  const adminKey = constant(adminHtml, 'LESSONS_SUPABASE_ANON_KEY');
  const clientVapid = constant(clientHtml, 'CLIENT_PUSH_VAPID_KEY');
  const adminVapid = constant(adminHtml, 'BAR_PUSH_PUBLIC_KEY');

  if (clientUrl !== config.supabaseUrl.origin || adminUrl !== config.supabaseUrl.origin) {
    throw new Error('O frontend publicado não está conectado ao Supabase de staging esperado. Nenhuma credencial foi enviada.');
  }
  if (clientKey !== config.publishableKey || adminKey !== config.publishableKey) {
    throw new Error('A chave publicável do frontend não corresponde ao projeto de staging esperado.');
  }
  if (clientVapid !== config.vapidPublicKey || adminVapid !== config.vapidPublicKey) {
    throw new Error('A chave VAPID pública do frontend diverge da configuração de Push de staging.');
  }
  if (tournamentApiUrl !== `${config.supabaseUrl.origin}/functions/v1/tournament-admin-api`) {
    throw new Error('O ADM publicado aponta a API administrativa de torneios para outro ambiente.');
  }

  const additionalConstants = [
    ['Bar', surfaces.barHtml, 'SUPABASE_URL', 'SUPABASE_KEY'],
    ['Menu', surfaces.menuHtml, 'SUPABASE_URL', 'SUPABASE_ANON_KEY'],
    ['Torneios', surfaces.tournamentsHtml, 'SUPABASE_URL', 'SUPABASE_ANON_KEY']
  ];
  for (const [label, source, urlName, keyName] of additionalConstants) {
    if (!source) throw new Error(`O preflight de staging não recebeu o HTML de ${label}.`);
    if (constant(source, urlName) !== config.supabaseUrl.origin || constant(source, keyName) !== config.publishableKey) {
      throw new Error(`${label} publicado não está conectado ao Supabase de staging esperado.`);
    }
  }
}

export const knownProduction = Object.freeze({
  webHosts: [...PRODUCTION_WEB_HOSTS],
  supabaseRefs: [...PRODUCTION_SUPABASE_REFS]
});
