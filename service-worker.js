const CACHE_PREFIX = 'ilha-play-v';
const CACHE_NAME = 'ilha-play-v236-tournament-pwa';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/auto-update.js',
  '/app-version.json',
  '/manifest.json',
  '/icon.png',
  '/logo.png',
  '/assets/branding/ilha-tenis-logo-light.png',
  '/assets/audio/notification-tennis-serve.mp3',
  '/assets/vendor/qrcode-generator.js'
];
const OPTIONAL_ASSETS = [
  './adm/',
  './adm/index.html',
  './adm-manifest.json',
  './menu/',
  './menu/index.html',
  './assets/branding/ilha-bar-logo-dark.png',
  './assets/branding/ilha-bar-logo-light.png',
  './assets/ilha-bar-cardapio-qr.png',
  './admbar-manifest.json',
  './icons/ilha-bar-180.png',
  './icons/ilha-bar-192.png',
  './icons/ilha-bar-512.png',
  './icons/ilha-bar-maskable-512.png',
  './icons/ilha-bar-app-180.png',
  './icons/ilha-bar-app-192.png',
  './icons/ilha-bar-app-512.png',
  './icons/ilha-bar-app-maskable-512.png',
  './bar/',
  './bar/index.html',
  './bar/manifest.json',
  './torneios/',
  './torneios/index.html',
  './torneios/manifest.json',
  './icons/ilha-open-180.png',
  './icons/ilha-open-192.png',
  './icons/ilha-open-512.png',
  './inscricoes/espacial/index.html',
  './publico.html',
  './bannerviafor.jpg',
  './cincate.png',
  './camisapreta.png',
  './camisaroxa.png',
  './camisaverde.png',
  './bolas.png',
  './cordas.png',
  './ford.png',
  './disk.png',
  './plus.png',
  './otica.png',
  './lotus.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS).then(() => Promise.all(
        OPTIONAL_ASSETS.map(asset => cache.add(asset).catch(() => null))
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then(clients => clients.forEach(client => client.postMessage({ type: 'APP_UPDATED', version: CACHE_NAME, cache: CACHE_NAME })))
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = { title: 'Ilha Play', body: event.data ? event.data.text() : 'Abra o app para conferir.' };
  }
  const title = data.title || 'Ilha Play';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || 'Abra o app para conferir.',
    icon: data.icon || '/icon.png',
    badge: data.badge || '/icon.png',
    tag: data.tag || 'ilha-play-aviso',
    data: { url: data.url || '/', orderId: data.orderId || '' },
    vibrate: [300, 120, 300, 120, 650],
    requireInteraction: true,
    renotify: true,
    silent: false
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  let targetUrl = self.location.origin + '/';
  try {
    const requestedUrl = new URL(event.notification.data && event.notification.data.url || '/', self.location.origin);
    if (requestedUrl.origin === self.location.origin) targetUrl = requestedUrl.href;
  } catch (error) {}
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => client.url.startsWith(self.location.origin));
    if (existing) {
      return existing.navigate(targetUrl)
        .then(client => (client || existing).focus())
        .catch(() => self.clients.openWindow(targetUrl));
    }
    return self.clients.openWindow(targetUrl);
  }));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.headers.has('range')) return;
  const url = new URL(event.request.url);
  const isVersionResource = url.origin === self.location.origin && url.pathname === '/app-version.json';
  if (isVersionResource) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }
  const isUpdaterResource = url.origin === self.location.origin && url.pathname === '/auto-update.js';
  if (isUpdaterResource) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(response => {
          if (!response.ok) return response;
          const copy = response.clone();
          return caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).then(() => response);
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('/auto-update.js')))
    );
    return;
  }
  const isBarProductImage = url.origin === self.location.origin && url.pathname.startsWith('/assets/bar-products/');
  if (isBarProductImage) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => cache.match(event.request).then(cached => {
        const network = fetch(event.request).then(response => {
          if (!response.ok) return response;
          const copy = response.clone();
          return cache.put(event.request, copy).then(() => response);
        }).catch(error => {
          if (cached) return cached;
          throw error;
        });
        return cached || network;
      }))
    );
    return;
  }
  const isAppShell = url.origin === self.location.origin && (
    event.request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('.html')
  );
  if (isAppShell) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.status >= 500) throw new Error('App shell unavailable');
          if (!response.ok) return response;
          const copy = response.clone();
          return caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).then(() => response);
        })
        .catch(() => caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (url.pathname === '/admbar' || url.pathname.startsWith('/admbar/') || url.pathname === '/adm' || url.pathname.startsWith('/adm/')) {
            return caches.match('./adm/index.html');
          }
          if (url.pathname === '/menu' || url.pathname.startsWith('/menu/')) {
            return caches.match('./menu/index.html');
          }
          if (url.pathname === '/bar' || url.pathname.startsWith('/bar/')) {
            return caches.match('./bar/index.html');
          }
          if (/^\/inscricoes\/[^/]+\/espacial\/?$/.test(url.pathname)) {
            return caches.match('./inscricoes/espacial/index.html');
          }
          if (url.pathname === '/torneios' || url.pathname.startsWith('/torneios/') || url.pathname === '/inscricoes' || url.pathname.startsWith('/inscricoes/')) {
            return caches.match('./torneios/index.html');
          }
          return caches.match('/');
        }))
    );
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
