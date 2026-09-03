import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { exists, projectRoot } from './project-files.mjs';

const root = path.join(projectRoot, 'dist');
const host = process.env.ILHA_HOST || '127.0.0.1';
const port = Number(process.env.ILHA_PORT || 8769);

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp']
]);

function cleanPathname(rawUrl) {
  try {
    return decodeURIComponent(new URL(rawUrl || '/', 'http://localhost').pathname);
  } catch {
    return '/';
  }
}

function rewrittenPath(pathname) {
  if (pathname === '/favicon.ico') return '/icon.png';
  if (/^\/inscricoes\/[^/]+\/espacial\/?$/.test(pathname)) return '/inscricoes/espacial/index.html';
  if (/^\/(?:torneios|inscricoes)\/[^/]+(?:\/.*)?$/.test(pathname)) return '/torneios/index.html';
  if (pathname === '/torneios' || pathname === '/inscricoes') return '/torneios/index.html';
  if (pathname === '/menu' || pathname === '/cardapio') return '/menu/index.html';
  if (pathname === '/adm' || pathname === '/admin' || pathname === '/gestao' || pathname === '/admbar' || pathname.startsWith('/admbar/')) return '/adm/index.html';
  if (pathname === '/bar') return '/bar/index.html';
  if (pathname === '/quadras' || pathname === '/agenda' || pathname === '/cliente' || pathname === '/alunos' || pathname === '/clientes' || pathname.startsWith('/clientes/')) return '/index.html';
  return pathname;
}

async function resolveFile(pathname) {
  const direct = path.resolve(root, `.${pathname}`);
  if (direct !== root && direct.startsWith(`${root}${path.sep}`) && await exists(direct)) {
    const directDetails = await stat(direct);
    if (directDetails.isFile()) return direct;
    if (directDetails.isDirectory()) {
      const directIndex = path.join(direct, 'index.html');
      if (await exists(directIndex)) return directIndex;
    }
  }
  let candidate = rewrittenPath(pathname);
  if (candidate.endsWith('/')) candidate += 'index.html';
  const absolute = path.resolve(root, `.${candidate}`);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) return null;
  if (!await exists(absolute)) return null;
  const details = await stat(absolute);
  if (details.isDirectory()) {
    const indexFile = path.join(absolute, 'index.html');
    return await exists(indexFile) ? indexFile : null;
  }
  return details.isFile() ? absolute : null;
}

const server = http.createServer(async (request, response) => {
  const pathname = cleanPathname(request.url);
  const file = request.method === 'GET' || request.method === 'HEAD'
    ? await resolveFile(pathname)
    : null;

  if (!file) {
    response.writeHead(request.method === 'GET' || request.method === 'HEAD' ? 404 : 405, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    response.end(request.method === 'GET' || request.method === 'HEAD' ? 'Arquivo não encontrado.\n' : 'Método não permitido.\n');
    console.log(`${request.method} ${pathname} -> ${response.statusCode}`);
    return;
  }

  const extension = path.extname(file).toLowerCase();
  const noCache = new Set(['/service-worker.js', '/torneios/service-worker.js', '/torneios/manifest.json', '/auto-update.js', '/app-version.json', '/', '/adm', '/admbar', '/bar', '/menu', '/torneios', '/quadras']);
  response.writeHead(200, {
    'Content-Type': contentTypes.get(extension) || 'application/octet-stream',
    'Cache-Control': noCache.has(pathname) ? 'no-cache, no-store, must-revalidate' : 'no-cache'
  });
  console.log(`${request.method} ${pathname} -> 200`);
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).pipe(response);
});

server.listen(port, host, () => {
  console.log(`Ilha local em http://${host}:${port} (dist/)`);
});
