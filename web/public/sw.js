const releaseParams = new URL(self.location.href).searchParams;
const RELEASE_ID = `${releaseParams.get('version') || 'dev'}-${releaseParams.get('sha') || 'dev'}`.replace(/[^a-zA-Z0-9._-]/g, '-');
const CACHE_PREFIX = 'mc-cartolive';
const SHELL_CACHE = `${CACHE_PREFIX}-shell-${RELEASE_ID}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime-${RELEASE_ID}`;
const SNAPSHOT_CACHE = `${CACHE_PREFIX}-snapshot-${RELEASE_ID}`;
const SNAPSHOT_URL = '/api/v1/public/state';
const RUNTIME_CACHE_LIMIT = 72;

const APP_SHELL_URLS = [
  '/',
  '/index.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_URLS))
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && ![SHELL_CACHE, RUNTIME_CACHE, SNAPSHOT_CACHE].includes(name)).map((name) => caches.delete(name)))
    )
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (shouldBypassCache(event.request, url)) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (url.origin === self.location.origin && url.pathname === SNAPSHOT_URL) {
    event.respondWith(networkFirst(event.request, SNAPSHOT_CACHE));
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request, SHELL_CACHE, '/index.html'));
    return;
  }

  event.respondWith(cacheFirst(event.request, RUNTIME_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      await putBounded(cacheName, request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

function shouldBypassCache(request, url) {
  if (request.method !== 'GET') return true;
  if (url.origin !== self.location.origin) return true;
  if (url.search && request.mode !== 'navigate') return true;
  if (url.pathname.startsWith('/api/') && url.pathname !== SNAPSHOT_URL) return true;
  if (url.pathname === '/healthz' || url.pathname === '/readyz' || url.pathname === '/metrics') return true;
  if (url.pathname.startsWith('/ws')) return true;
  return false;
}

async function networkFirst(request, cacheName, fallbackURL) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      await putBounded(cacheName, request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    const fallback = fallbackURL ? await caches.match(fallbackURL) : undefined;
    return cached || fallback || new Response('Offline', { status: 503 });
  }
}

async function putBounded(cacheName, request, response) {
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
  if (cacheName !== RUNTIME_CACHE) return;
  const keys = await cache.keys();
  const overflow = keys.length - RUNTIME_CACHE_LIMIT;
  if (overflow > 0) await Promise.all(keys.slice(0, overflow).map((key) => cache.delete(key)));
}
