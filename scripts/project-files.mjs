import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const projectRoot = path.resolve(import.meta.dirname, '..');
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules', 'output', 'playwright-report', 'test-results']);

export async function walk(directory = projectRoot) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...await walk(absolute));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

export function relative(file) {
  return path.relative(projectRoot, file).split(path.sep).join('/');
}

export async function readUtf8(file) {
  return readFile(file, 'utf8');
}

export async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

export function inlineScripts(html) {
  const scripts = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    if (!/\bsrc\s*=/.test(match[1])) scripts.push({ source: match[2], offset: match.index });
  }
  return scripts;
}

export function stripExecutableContent(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, (match) => match.replace(/[^\n]/g, ' '));
}

export function lineAt(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

export function localUrlTarget(htmlFile, reference) {
  const value = String(reference || '').trim();
  if (!value || value.startsWith('#') || /^(?:https?:|data:|blob:|mailto:|tel:|javascript:)/i.test(value)) return null;
  const relativeHtml = relative(htmlFile);
  const base = new URL(relativeHtml, 'https://local.invalid/');
  const target = new URL(value, base);
  let pathname = decodeURIComponent(target.pathname).replace(/^\/+/, '');
  if (!pathname) pathname = 'index.html';
  return path.join(projectRoot, pathname);
}
