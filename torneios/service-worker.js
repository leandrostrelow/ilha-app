const CACHE_NAME = 'ilha-open-2026-v2';
const APP_URL = '/torneios/ilha-open-2026';
const ASSETS = [
  APP_URL,
  '/torneios/index.html',
  '/torneios/manifest.json',
  '/icons/ilha-open-192.png',
  '/icons/ilha-open-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('ilha-open-2026-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(self.registration.showNotification(data.title || 'Ilha Open 2026', {
    body: data.body || 'Há uma novidade no torneio.',
    icon: data.icon || '/icons/ilha-open-192.png',
    badge: data.badge || '/icons/ilha-open-192.png',
    tag: data.tag || 'ilha-open-2026',
    data: { url: data.url || APP_URL },
    vibrate: [250, 100, 250],
    renotify: true
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let targetUrl = self.location.origin + APP_URL;
  try {
    const requested = new URL(event.notification.data && event.notification.data.url || APP_URL, self.location.origin);
    if (requested.origin === self.location.origin && requested.pathname.startsWith('/torneios/')) targetUrl = requested.href;
  } catch (error) {}
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => client.url.startsWith(self.location.origin + '/torneios/'));
    if (existing) return existing.navigate(targetUrl).then((client) => (client || existing).focus());
    return self.clients.openWindow(targetUrl);
  }));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || event.request.headers.has('range')) return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(APP_URL, copy));
      return response;
    }).catch(() => caches.match(APP_URL)));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (!response.ok) return response;
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    return response;
  })));
});
