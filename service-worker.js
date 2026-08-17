const CACHE_NAME = 'ilha-play-v180-direct';
const ASSETS = [
  './',
  './index.html',
  './auto-update.js',
  './adm/',
  './adm/index.html',
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
  './bar/',
  './bar/index.html',
  './bar/manifest.json',
  './publico.html',
  './manifest.json',
  './icon.png',
  './logo.png',
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
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.registration.showNotification('O novo Ilha Play chegou', {
        body: 'O acesso antigo foi encerrado. Faça seu novo cadastro para reservar quadras e usar os serviços do clube.',
        icon: '/icon.png',
        badge: '/icon.png',
        tag: 'ilha-play-novo-cadastro',
        data: { url: '/' }
      }).catch(() => {}))
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
  const targetUrl = new URL(event.notification.data && event.notification.data.url || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => client.url.startsWith(self.location.origin));
    if (existing) {
      existing.navigate(targetUrl);
      return existing.focus();
    }
    return self.clients.openWindow(targetUrl);
  }));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isBarProductImage = url.origin === self.location.origin && url.pathname.startsWith('/assets/bar-products/');
  if (isBarProductImage) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => cache.match(event.request).then(cached => {
        const network = fetch(event.request).then(response => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
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
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (url.pathname === '/admbar' || url.pathname.startsWith('/admbar/') || url.pathname === '/adm' || url.pathname.startsWith('/adm/')) {
            return caches.match('./adm/index.html');
          }
          if (url.pathname === '/menu' || url.pathname.startsWith('/menu/')) {
            return caches.match('./menu/index.html');
          }
          return caches.match('./');
        }))
    );
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
