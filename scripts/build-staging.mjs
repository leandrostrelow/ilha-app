import { cp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { knownProduction } from './e2e/staging-guard.mjs';

const scriptFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptFile), '..');

const PUBLIC_CONSTANTS = Object.freeze({
  'index.html': {
    SUPABASE_URL: 'supabaseUrl',
    SUPABASE_ANON_KEY: 'publishableKey',
    CLIENT_PUSH_VAPID_KEY: 'vapidPublicKey'
  },
  'adm/index.html': {
    TOURNAMENT_API_URL: 'tournamentApiUrl',
    LESSONS_SUPABASE_URL: 'supabaseUrl',
    LESSONS_SUPABASE_ANON_KEY: 'publishableKey',
    BAR_PUSH_PUBLIC_KEY: 'vapidPublicKey'
  },
  'torneios/index.html': {
    SUPABASE_URL: 'supabaseUrl',
    SUPABASE_ANON_KEY: 'publishableKey'
  },
  'bar/index.html': {
    SUPABASE_URL: 'supabaseUrl',
    SUPABASE_KEY: 'publishableKey'
  },
  'menu/index.html': {
    SUPABASE_URL: 'supabaseUrl',
    SUPABASE_ANON_KEY: 'publishableKey'
  }
});

function required(env, name) {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`Variável pública obrigatória ausente: ${name}.`);
  return value;
}

export function loadStagingPublicConfig(env = process.env) {
  const projectRef = required(env, 'STAGING_SUPABASE_PROJECT_REF').toLowerCase();
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error('STAGING_SUPABASE_PROJECT_REF possui formato inválido.');
  if (knownProduction.supabaseRefs.includes(projectRef)) throw new Error('Build de staging recusou o project ref de produção conhecido.');

  let supabaseUrl;
  try {
    supabaseUrl = new URL(required(env, 'STAGING_SUPABASE_URL'));
  } catch (_error) {
    throw new Error('STAGING_SUPABASE_URL não é uma URL válida.');
  }
  if (
    supabaseUrl.protocol !== 'https:' ||
    supabaseUrl.username ||
    supabaseUrl.password ||
    supabaseUrl.hostname !== `${projectRef}.supabase.co` ||
    !['', '/'].includes(supabaseUrl.pathname) ||
    supabaseUrl.search ||
    supabaseUrl.hash
  ) {
    throw new Error('STAGING_SUPABASE_URL deve ser a origem HTTPS exata do project ref de staging.');
  }

  const publishableKey = required(env, 'STAGING_SUPABASE_PUBLISHABLE_KEY');
  if (!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(publishableKey)) {
    throw new Error('O build aceita somente chave pública sb_publishable_ de staging.');
  }
  const vapidPublicKey = required(env, 'STAGING_VAPID_PUBLIC_KEY');
  if (!/^[A-Za-z0-9_-]{80,120}$/.test(vapidPublicKey)) throw new Error('STAGING_VAPID_PUBLIC_KEY possui formato inválido.');

  return Object.freeze({
    projectRef,
    supabaseUrl: supabaseUrl.origin,
    publishableKey,
    vapidPublicKey,
    tournamentApiUrl: `${supabaseUrl.origin}/functions/v1/tournament-admin-api`
  });
}

function replacePublicConstant(source, name, value, relativePath) {
  const pattern = new RegExp(`(\\bconst\\s+${name}\\s*=\\s*)(['"])([^'"]*)(\\2)(\\s*;)`, 'g');
  let replacements = 0;
  const output = source.replace(pattern, (_match, prefix, quote, _oldValue, _closingQuote, suffix) => {
    replacements += 1;
    return `${prefix}${quote}${value}${quote}${suffix}`;
  });
  if (replacements !== 1) {
    throw new Error(`${relativePath}: esperava exatamente uma declaração pública de ${name}, encontrei ${replacements}.`);
  }
  return output;
}

export function rewriteStagingHtml(relativePath, source, config) {
  const mapping = PUBLIC_CONSTANTS[relativePath];
  if (!mapping) throw new Error(`HTML fora da lista explícita de staging: ${relativePath}.`);
  let output = source;
  for (const [constantName, configName] of Object.entries(mapping)) {
    output = replacePublicConstant(output, constantName, config[configName], relativePath);
  }
  return output;
}

async function collectHtml(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectHtml(absolute));
    else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.html') files.push(absolute);
  }
  return files;
}

async function assertStagingArtifact(destination, config) {
  const projectUrlPattern = /https:\/\/([a-z0-9]{20})\.supabase\.co/gi;
  const publishableKeyPattern = /\bsb_publishable_[A-Za-z0-9_-]{20,}\b/g;
  const publicConstantPattern = /\bconst\s+([A-Z0-9_]*(?:VAPID|PUSH_PUBLIC)[A-Z0-9_]*)\s*=\s*(['"])([^'"]+)\2/g;

  for (const htmlFile of await collectHtml(destination)) {
    const source = await readFile(htmlFile, 'utf8');
    for (const productionRef of knownProduction.supabaseRefs) {
      if (source.includes(productionRef)) throw new Error(`${path.relative(destination, htmlFile)} ainda contém o project ref de produção.`);
    }
    for (const match of source.matchAll(projectUrlPattern)) {
      if (match[1] !== config.projectRef) throw new Error(`${path.relative(destination, htmlFile)} aponta para outro projeto Supabase.`);
    }
    for (const match of source.matchAll(publishableKeyPattern)) {
      if (match[0] !== config.publishableKey) throw new Error(`${path.relative(destination, htmlFile)} contém outra chave publicável Supabase.`);
    }
    for (const match of source.matchAll(publicConstantPattern)) {
      if (match[3] !== config.vapidPublicKey) throw new Error(`${path.relative(destination, htmlFile)} contém outra chave VAPID pública.`);
    }
  }
}

export async function buildStagingArtifact(env = process.env) {
  const config = loadStagingPublicConfig(env);
  const baseBuild = spawnSync(process.execPath, [path.join(projectRoot, 'scripts', 'build.mjs')], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
  if (baseBuild.error) throw baseBuild.error;
  if (baseBuild.status !== 0) throw new Error(`O build estático base falhou: ${String(baseBuild.stderr || '').slice(0, 1000)}`);

  const destination = path.join(projectRoot, 'dist');
  const destinationStat = await stat(destination);
  if (!destinationStat.isDirectory()) throw new Error('O build estático não gerou dist/.');

  for (const relativePath of Object.keys(PUBLIC_CONSTANTS)) {
    const htmlFile = path.join(destination, relativePath);
    const source = await readFile(htmlFile, 'utf8');
    await writeFile(htmlFile, rewriteStagingHtml(relativePath, source, config));
  }
  await cp(path.join(projectRoot, 'vercel.json'), path.join(destination, 'vercel.json'));
  await assertStagingArtifact(destination, config);
  return { destination, projectRef: config.projectRef, htmlFiles: Object.keys(PUBLIC_CONSTANTS) };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === scriptFile;
if (invokedDirectly) {
  const result = await buildStagingArtifact();
  console.log(`Artefato público de staging criado em dist/ com ${result.htmlFiles.length} superfícies e sem credenciais privadas.`);
}
