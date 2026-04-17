const CACHE_NAME = 'fincaos-v1';

const PRECACHE_URLS = [
  '/inicio',
  '/incidencias',
  '/comunidad',
  '/perfil',
  '/manifest.json',
];

/** Devuelve true solo para URLs que Cache API acepta (http / https). */
function isCacheable(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Wrapper seguro: nunca lanza, solo loguea en dev. */
async function safePut(cache, request, response) {
  try {
    const url = typeof request === 'string' ? request : request.url;
    if (!isCacheable(url)) return;
    await cache.put(request, response);
  } catch (err) {
    // Silencia errores de caché (cuota llena, protocolo inválido, etc.)
    if (process?.env?.NODE_ENV !== 'production') {
      console.warn('[SW] cache.put ignorado:', err?.message ?? err);
    }
  }
}

// Install: precache shell — usa fetch individual para que un fallo no bloquee el resto
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          fetch(url)
            .then((res) => {
              if (res.ok) return safePut(cache, url, res);
            })
            .catch(() => { /* red no disponible — ignorar */ })
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for navigations, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 1. Solo GET
  if (request.method !== 'GET') return;

  // 2. Solo http / https — ignorar chrome-extension://, devtools://, blob:, data:, etc.
  if (!isCacheable(request.url)) return;

  // 3. Ignorar APIs y servicios externos de Firebase
  if (request.url.includes('/api/')) return;
  if (request.url.includes('firestore.googleapis.com')) return;
  if (request.url.includes('identitytoolkit.googleapis.com')) return;

  // Navigation requests: network-first
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => safePut(cache, request, clone));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/inicio'))
        )
    );
    return;
  }

  // Static assets: cache-first
  if (
    request.url.includes('/_next/static/') ||
    request.url.match(/\.(png|jpg|svg|ico|woff2?)$/)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => safePut(cache, request, clone));
          return response;
        });
      })
    );
    return;
  }
});

// Push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body:     data.body || '',
    icon:     '/navegador.png',
    badge:    '/navegador.png',
    data:     { url: data.url || '/inicio' },
    vibrate:  [200, 100, 200],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'FincaOS', options)
  );
});

// Click on notification: open the relevant page
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/inicio';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((c) => c.url.includes(url));
        if (existing) return existing.focus();
        return self.clients.openWindow(url);
      })
  );
});
