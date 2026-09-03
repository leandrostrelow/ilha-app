import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { exists, projectRoot } from './project-files.mjs';

const destination = path.join(projectRoot, 'dist');
const directories = ['adm', 'assets', 'bar', 'clientes', 'icons', 'inscricoes', 'menu', 'torneios'];
const rootExtensions = new Set(['.html', '.js', '.json', '.png', '.jpg', '.jpeg', '.webp', '.mp3']);
const developmentRootFiles = new Set(['package.json']);

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

for (const directory of directories) {
  const source = path.join(projectRoot, directory);
  if (await exists(source)) await cp(source, path.join(destination, directory), { recursive: true });
}

for (const entry of await readdir(projectRoot, { withFileTypes: true })) {
  if (!entry.isFile() || developmentRootFiles.has(entry.name) || !rootExtensions.has(path.extname(entry.name).toLowerCase())) continue;
  await cp(path.join(projectRoot, entry.name), path.join(destination, entry.name));
}

const versionFile = path.join(destination, 'app-version.json');
const version = JSON.parse(await readFile(versionFile, 'utf8'));
if (!/^\d{4}-\d{2}-\d{2}\.\d{4}$/.test(String(version.version || ''))) {
  throw new Error('app-version.json possui formato de versao invalido.');
}

await writeFile(path.join(destination, 'build-meta.json'), JSON.stringify({ version: version.version, timezone: 'America/Sao_Paulo' }, null, 2) + '\n');
console.log(`Build estatico concluido em dist/ (versao ${version.version}).`);
