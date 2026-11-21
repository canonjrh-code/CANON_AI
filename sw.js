/* Canon Jr AI service worker
   - Pages: network first (so updates arrive), saved copy when offline
   - Other files: instant from cache, refreshed in the background
   - /api/* is never touched
   Change CACHE (v1 -> v2) whenever you want every device to drop old files. */
const CACHE = 'canon-jr-ai-v1';

const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(CORE.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Opening the app / a page
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match(req)
            .then((r) => r || caches.match('./index.html'))
            .then((r) => r || caches.match('./'))
        )
    );
    return;
  }

  // Icons, manifest and other files
  event.respondWith(
    caches.match(req).then((cached) => {
      const refresh = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      if (cached) {
        event.waitUntil(refresh.catch(() => {}));
        return cached;
      }
      return refresh;
    })
  );
});
