import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { exists, inlineScripts, lineAt, localUrlTarget, projectRoot, readUtf8, relative, stripExecutableContent, walk } from './project-files.mjs';

const errors = [];
const warnings = [];
const files = await walk();
const htmlFiles = files.filter((file) => file.endsWith('.html'));
const jsonFiles = files.filter((file) => file.endsWith('.json'));
const scriptFiles = files.filter((file) => /\.(?:js|mjs)$/.test(file));

for (const file of scriptFiles) {
  const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (checked.status !== 0) {
    const detail = String(checked.stderr || checked.stdout || 'erro de sintaxe').trim().split('\n').slice(-1)[0];
    errors.push(`${relative(file)}: JavaScript invalido (${detail}).`);
  }
}

for (const file of jsonFiles) {
  try {
    JSON.parse(await readUtf8(file));
  } catch (error) {
    errors.push(`${relative(file)}: JSON invalido (${error.message}).`);
  }
}

for (const file of htmlFiles) {
  const html = await readUtf8(file);
  const markup = stripExecutableContent(html);
  const ids = new Map();
  for (const match of markup.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)) {
    const id = match[1];
    if (ids.has(id)) errors.push(`${relative(file)}:${lineAt(html, match.index)}: id duplicado "${id}" (primeiro na linha ${ids.get(id)}).`);
    else ids.set(id, lineAt(html, match.index));
  }

  for (const match of markup.matchAll(/<label\b[^>]*\bfor\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    if (!ids.has(match[1])) errors.push(`${relative(file)}:${lineAt(html, match.index)}: label aponta para id inexistente "${match[1]}".`);
  }

  for (const match of markup.matchAll(/<button\b([^>]*)>/gi)) {
    if (!/\btype\s*=/.test(match[1])) warnings.push(`${relative(file)}:${lineAt(html, match.index)}: botao sem type explicito.`);
  }

  for (const script of inlineScripts(html)) {
    try {
      new vm.Script(script.source, { filename: relative(file) });
    } catch (error) {
      errors.push(`${relative(file)}:${lineAt(html, script.offset)}: JavaScript invalido (${error.message}).`);
    }
  }

  const staticIds = new Set(ids.keys());
  for (const match of html.matchAll(/\bid\\?=\\?["']([^"']+)["']/gi)) staticIds.add(match[1]);
  for (const match of html.matchAll(/\.id\s*=\s*["']([^"']+)["']/g)) staticIds.add(match[1]);
  const referencedIds = new Set();
  for (const pattern of [/\$\(\s*["']([^"']+)["']\s*\)/g, /getElementById\(\s*["']([^"']+)["']\s*\)/g]) {
    for (const match of html.matchAll(pattern)) referencedIds.add(match[1]);
  }
  for (const id of referencedIds) {
    const optionalReference = html.includes(`if ($('${id}'))`) || html.includes(`if ($("${id}"))`);
    if (!staticIds.has(id) && !optionalReference) warnings.push(`${relative(file)}: JavaScript referencia id nao declarado no HTML inicial "${id}".`);
  }

  for (const match of markup.matchAll(/\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi)) {
    const target = localUrlTarget(file, match[1]);
    if (!target) continue;
    if (await exists(target)) continue;
    if (await exists(path.join(target, 'index.html'))) continue;
    const extension = path.extname(target);
    if (!extension) continue;
    errors.push(`${relative(file)}:${lineAt(html, match.index)}: recurso local inexistente "${match[1]}".`);
  }
}

for (const file of files.filter((candidate) => /\.(?:html|js|ts|sql)$/.test(candidate))) {
  const source = await readUtf8(file);
  if (/^(?:<{7}|={7}|>{7})/m.test(source)) errors.push(`${relative(file)}: marcador de conflito Git encontrado.`);
  if (/\bsb_secret_[A-Za-z0-9_-]+|\bservice_role\s*[:=]\s*["'][A-Za-z0-9._-]{20,}/i.test(source)) {
    errors.push(`${relative(file)}: possivel chave privilegiada exposta.`);
  }
}

if (warnings.length) console.warn(warnings.map((message) => `AVISO: ${message}`).join('\n'));
if (errors.length) {
  console.error(errors.map((message) => `ERRO: ${message}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Lint concluido: ${htmlFiles.length} HTMLs, ${scriptFiles.length} scripts, ${jsonFiles.length} JSONs e ${warnings.length} aviso(s).`);
}
