import path from 'node:path';
import { exists, projectRoot, readUtf8, relative, walk } from './project-files.mjs';

const errors = [];
const packageJson = JSON.parse(await readUtf8(path.join(projectRoot, 'package.json')));
for (const [name, version] of Object.entries(packageJson.devDependencies || {})) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(version))) {
    errors.push(`package.json: a dependencia ${name} deve usar uma versao exata (recebido ${version}).`);
  }
}

if (!await exists(path.join(projectRoot, 'pnpm-lock.yaml'))) {
  errors.push('pnpm-lock.yaml ausente; execute pnpm install para registrar dependencias reproduziveis.');
}

const executableSuffix = process.platform === 'win32' ? '.cmd' : '';
for (const executable of ['agent-browser', 'deno', 'supabase']) {
  if (!await exists(path.join(projectRoot, 'node_modules', '.bin', executable + executableSuffix))) {
    errors.push(`Executavel local ausente: ${executable}. Execute pnpm install antes das verificacoes.`);
  }
}

const files = await walk();
const relevant = files.filter((file) => /\.(?:html|js|ts|json)$/.test(file));
const supabaseCdnVersions = new Set();
for (const file of relevant) {
  const source = await readUtf8(file);
  for (const match of source.matchAll(/@supabase\/supabase-js@([^/'"\s]+)/g)) supabaseCdnVersions.add(match[1]);
  for (const match of source.matchAll(/\b(?:npm|jsr):[^'"\s),;]+/g)) {
    const specifier = match[0];
    const packageSpecifier = specifier.replace(/^(?:npm|jsr):/, '');
    const versionIndex = packageSpecifier.lastIndexOf('@');
    const version = versionIndex > 0 ? packageSpecifier.slice(versionIndex + 1).split('/')[0] : '';
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
      errors.push(`${relative(file)}: import remoto sem versao exata: ${specifier}`);
    }
  }
}

if (supabaseCdnVersions.size !== 1) {
  errors.push(`Versoes divergentes do supabase-js: ${Array.from(supabaseCdnVersions).join(', ') || 'nenhuma encontrada'}.`);
}

if (errors.length) {
  console.error(errors.map((message) => `- ${message}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Dependencias verificadas: ${Object.keys(packageJson.devDependencies || {}).length} local(is), supabase-js ${Array.from(supabaseCdnVersions)[0]}.`);
}
