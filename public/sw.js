// v2: v1 pre-cached '/', '/record' and '/settings' while signed out, so it held
// the login page under those names, and it cached every signed-in page's HTML
// (one person's meetings, kept for whoever uses the browser next). Pages are no
// longer cached at all; only the offline page is.
const CACHE = 'notetaker-v2';
const SHELL = ['/offline'];

// Install: pre-cache app shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {}))
  );
  self.skipWaiting();
});

// Activate: drop old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Never intercept API calls — always go to network
  if (url.pathname.startsWith('/api/')) return;

  // Static assets (_next/static, images, fonts) — cache first, update in background
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/_next/image') ||
    request.destination === 'image' ||
    request.destination === 'font' ||
    request.destination === 'script' ||
    request.destination === 'style'
  ) {
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const networkFetch = fetch(request).then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        }).catch(() => cached);
        // Return cached immediately, refresh in background
        return cached ?? networkFetch;
      })
    );
    return;
  }

  // Navigation (HTML pages) — always the network; the offline page only when
  // there is no network. A page is never served from cache: it is signed-in
  // content, and a stale copy (or the login page) would be shown as current.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() =>
        caches.match('/offline').then((hit) => hit ?? Response.error())
      )
    );
  }
});
