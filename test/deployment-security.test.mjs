import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const vercelConfig = JSON.parse(await readFile(path.join(projectRoot, 'vercel.json'), 'utf8'));

function globalSecurityHeaders() {
  const rule = (vercelConfig.headers || []).find((item) => item.source === '/(.*)');
  assert.ok(rule, 'vercel.json precisa aplicar cabeçalhos de segurança a todas as rotas');
  return new Map((rule.headers || []).map((item) => [String(item.key).toLowerCase(), String(item.value)]));
}

function parseCsp(value) {
  const directives = new Map();
  for (const rawDirective of String(value || '').split(';')) {
    const tokens = rawDirective.trim().split(/\s+/).filter(Boolean);
    if (tokens.length) directives.set(tokens[0], tokens.slice(1));
  }
  return directives;
}

test('runtime de produção permanece fixado no Node 22', () => {
  assert.equal(packageJson.engines?.node, '22.x');
  assert.doesNotMatch(packageJson.engines.node, />=|\*|\|/);
});

test('Vercel aplica proteções HTTP globais sem bloquear recursos usados pelo app', () => {
  const headers = globalSecurityHeaders();
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
  assert.equal(headers.get('referrer-policy'), 'strict-origin-when-cross-origin');

  const permissions = headers.get('permissions-policy') || '';
  for (const denied of ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()', 'usb=()']) {
    assert.match(permissions, new RegExp(denied.replace(/[()]/g, '\\$&')));
  }
  assert.match(permissions, /clipboard-write=\(self\)/);
  assert.match(permissions, /fullscreen=\(self "https:\/\/www\.youtube\.com"\)/);

  const cspValue = headers.get('content-security-policy');
  assert.ok(cspValue, 'Content-Security-Policy ausente');
  const csp = parseCsp(cspValue);
  assert.deepEqual(csp.get('default-src'), ["'self'"]);
  assert.deepEqual(csp.get('base-uri'), ["'self'"]);
  assert.deepEqual(csp.get('object-src'), ["'none'"]);
  assert.deepEqual(csp.get('frame-ancestors'), ["'self'"]);
  assert.deepEqual(csp.get('form-action'), ["'self'"]);
  assert.deepEqual(csp.get('manifest-src'), ["'self'"]);
  assert.ok(csp.has('upgrade-insecure-requests'));

  const scriptSources = csp.get('script-src') || [];
  for (const required of [
    "'self'",
    "'unsafe-inline'",
    'https://cdn.jsdelivr.net',
    'https://challenges.cloudflare.com',
    'https://www.youtube.com',
    'https://script.google.com',
    'https://script.googleusercontent.com'
  ]) assert.ok(scriptSources.includes(required), `script-src precisa permitir ${required}`);
  assert.ok(!scriptSources.includes("'unsafe-eval'"), 'unsafe-eval não é necessário neste app');
  assert.ok(!scriptSources.includes('*'), 'script-src não pode liberar origem universal');

  const connectSources = csp.get('connect-src') || [];
  assert.ok(connectSources.includes("'self'"));
  assert.ok(connectSources.includes('https://*.supabase.co'), 'as APIs Supabase usam HTTPS em produção e staging');
  assert.ok(connectSources.includes('wss://*.supabase.co'), 'Realtime do Supabase precisa de WebSocket');
  assert.ok(connectSources.includes('https://challenges.cloudflare.com'), 'Turnstile usa o domínio oficial do Cloudflare');
  assert.ok(connectSources.includes('https://script.google.com'), 'a página pública ainda consulta o feed do Google Apps Script');
  assert.ok(!connectSources.includes('https:'), 'connect-src não deve liberar qualquer host HTTPS');

  const imageSources = csp.get('img-src') || [];
  for (const required of ["'self'", 'data:', 'blob:', 'https:']) {
    assert.ok(imageSources.includes(required), `img-src precisa permitir ${required}`);
  }
  assert.deepEqual(csp.get('worker-src'), ["'self'", 'blob:']);
  assert.ok((csp.get('frame-src') || []).includes('https:'), 'conteúdo externo e YouTube usam frames HTTPS');
  assert.doesNotMatch(cspValue, /(?:^|\s)http:(?:\s|;|$)/);
});

test('cabeçalhos de segurança preservam as regras de cache do PWA', () => {
  const cacheRules = new Map((vercelConfig.headers || [])
    .filter((item) => item.source !== '/(.*)')
    .map((item) => [item.source, new Map((item.headers || []).map((header) => [header.key.toLowerCase(), header.value]))]));
  for (const source of ['/service-worker.js', '/auto-update.js', '/app-version.json']) {
    assert.equal(cacheRules.get(source)?.get('cache-control'), 'no-cache, no-store, must-revalidate');
  }
});
