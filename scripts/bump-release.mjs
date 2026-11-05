import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const current = JSON.parse(await readFile(path.join(root, 'app-version.json'), 'utf8')).version;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const date = today > current.slice(0, 10) ? today : current.slice(0, 10);
const revision = Number(current.split('.')[1]) + 1;
if (revision > 9999) throw new Error('Revisão excedeu o formato esperado.');
const version = `${date}.${String(revision).padStart(4, '0')}`;
await writeFile(path.join(root, 'app-version.json'), JSON.stringify({ version }, null, 2) + '\n');
const sw = path.join(root, 'service-worker.js');
await writeFile(sw, (await readFile(sw, 'utf8')).replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = 'ilha-play-v${version}';`));
await writeFile(path.join(root, 'config/site-release.json'), JSON.stringify({ game2Version: version }, null, 2) + '\n');
console.log(`Nova versão: ${version}. Inclua os três arquivos no commit.`);
