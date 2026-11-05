import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateRelease({ baseVersion, version, siteChanged, ancestor = true }) {
  const pattern = /^\d{4}-\d{2}-\d{2}\.\d{4}$/;
  if (!pattern.test(version) || !pattern.test(baseVersion)) throw new Error('Versão inválida.');
  if (!ancestor) throw new Error('Atualize a branch com a main antes de publicar.');
  if (version < baseVersion) throw new Error('A versão não pode voltar para trás.');
  if (siteChanged && version === baseVersion) throw new Error('Mudança no site exige pnpm run release:bump.');
}

export async function checkRelease(base, cwd = path.resolve(import.meta.dirname, '..')) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(base || '')) throw new Error('Informe RELEASE_BASE_SHA com o commit base.');
  const version = JSON.parse(await readFile(path.join(cwd, 'app-version.json'), 'utf8')).version;
  const baseVersion = JSON.parse(git('show', `${base}:app-version.json`)).version;
  const currentFiles = JSON.parse(await readFile(path.join(cwd, 'config/site-files.json'), 'utf8'));
  let previousFiles = [];
  try { previousFiles = JSON.parse(git('show', `${base}:config/site-files.json`)); } catch { /* First synchronization predates the manifest. */ }
  const siteFiles = new Set([...currentFiles, ...previousFiles, 'scripts/build.mjs', 'vercel.json', 'config/site-release.json', 'config/site-files.json']);
  const changed = git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean);
  let ancestor = true;
  try { git('merge-base', '--is-ancestor', base, 'HEAD'); } catch { ancestor = false; }
  validateRelease({ baseVersion, version, ancestor, siteChanged: changed.some(file => siteFiles.has(file)) });
  const tracked = new Set(git('ls-files').split('\n'));
  for (const file of currentFiles) if (!tracked.has(file)) throw new Error(`Arquivo do site não está no Git: ${file}`);
  console.log(`Publicação consistente: ${baseVersion} → ${version}; arquivos do site versionados.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkRelease(process.env.RELEASE_BASE_SHA || process.argv[2]);
}
