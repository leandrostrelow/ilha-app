const CACHE_NAME = 'ilha-play-v34';
const ASSETS = [
  './',
  './index.html',
  './clientes/',
  './clientes/index.html',
  './clientes/manifest.json',
  './adm/',
  './adm/index.html',
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
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
