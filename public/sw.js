/**
 * FincaOS Service Worker — v3
 *
 * Estrategias de caché:
 *  - Shell estático (/offline, /manifest.json) → precache en install
 *  - Next.js JS/CSS (/_next/static/) + fuentes  → cache-first (inmutables)
 *  - Imágenes (.png/.jpg/.svg/etc.)             → cache-first
 *  - Navegación (HTML)                          → network-first + fallback /offline
 *  - APIs, Firebase, auth                       → network-only (nunca interceptar)
 *
 * Versionado: incrementar CACHE_STATIC y CACHE_PAGES cuando cambie el deploy.
 */

const CACHE_STATIC  = 'fincaos-static-v4';   // JS, CSS, fuentes, imágenes
const CACHE_PAGES   = 'fincaos-pages-v4';     // páginas HTML navegadas
const ALL_CACHES    = [CACHE_STATIC, CACHE_PAGES];

/** Recursos precacheados en install — offline fallback garantizado. */
const SHELL_URLS = [
  '/offline',
  '/manifest.json',
];

/* ── Helpers ───────────────────────────────────────────────────────────────── */

function isCacheable(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Guarda en caché de forma segura: nunca lanza. */
async function safePut(cacheName, request, response) {
  try {
    const url = typeof request === 'string' ? request : request.url;
    if (!isCacheable(url)) return;
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch {
    // Silencioso: cuota llena, protocolo inválido, etc.
  }
}

/**
 * fetch con AbortController timeout.
 * Si la red no responde en `ms` ms → rechaza con AbortError.
 */
function fetchWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(request, { signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

/** Devuelve true si la URL es de una API o servicio externo que no debe cachearse. */
function isNetworkOnly(url) {
  return (
    url.includes('/api/')                            ||
    url.includes('firestore.googleapis.com')         ||
    url.includes('identitytoolkit.googleapis.com')   ||
    url.includes('securetoken.googleapis.com')       ||
    url.includes('fcmregistrations.googleapis.com')  ||
    url.includes('fcm.googleapis.com')               ||
    url.includes('googleapis.com/upload')            ||
    url.includes('storage.googleapis.com')           ||
    url.includes('stripe.com')                       ||
    url.includes('cloudinary.com')
  );
}

/* ── Install: precache shell ───────────────────────────────────────────────── */

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_STATIC);
      await Promise.allSettled(
        SHELL_URLS.map((url) =>
          fetch(url)
            .then((res) => { if (res.ok) return safePut(CACHE_STATIC, url, res); })
            .catch(() => { /* sin red — se intentará más tarde */ })
        )
      );
      await self.skipWaiting();
    })()
  );
});

/* ── Activate: eliminar caches anteriores ──────────────────────────────────── */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !ALL_CACHES.includes(k))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ── Fetch ─────────────────────────────────────────────────────────────────── */

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Solo GET
  if (request.method !== 'GET') return;

  // Solo http/https (ignorar chrome-extension://, blob:, etc.)
  if (!isCacheable(request.url)) return;

  // APIs y servicios externos: network-only (nunca interceptar)
  if (isNetworkOnly(request.url)) return;

  // ── A. Activos estáticos Next.js (/_next/static/) — cache-first ───────────
  // Son inmutables (nombre incluye hash): servir desde caché siempre.
  if (request.url.includes('/_next/static/')) {
    event.respondWith(
      caches.match(request, { cacheName: CACHE_STATIC }).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res.ok) safePut(CACHE_STATIC, request.clone(), res.clone());
          return res;
        });
      })
    );
    return;
  }

  // ── B. Fuentes web — cache-first ──────────────────────────────────────────
  if (request.url.match(/\.(woff2?|ttf|otf|eot)(\?.*)?$/)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res.ok) safePut(CACHE_STATIC, request.clone(), res.clone());
          return res;
        });
      })
    );
    return;
  }

  // ── C. Imágenes — cache-first ─────────────────────────────────────────────
  if (request.url.match(/\.(png|jpe?g|gif|svg|ico|webp|avif)(\?.*)?$/)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((res) => {
            if (res.ok) safePut(CACHE_STATIC, request.clone(), res.clone());
            return res;
          })
          .catch(() => new Response('', { status: 408, statusText: 'Request Timeout' }));
      })
    );
    return;
  }

  // ── D. Navegación HTML — network-first (3s timeout), fallback /offline ──────
  // La app usa Firebase JS SDK (no SSR con datos), por lo que la shell HTML
  // no caduca: podemos cachearla y servirla offline sin problemas de stale data.
  // Timeout de 3s evita esperar indefinidamente en redes lentas/portal cautivo.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetchWithTimeout(request, 3000)
        .then((res) => {
          if (res.ok) safePut(CACHE_PAGES, request.clone(), res.clone());
          return res;
        })
        .catch(() =>
          caches.match(request, { cacheName: CACHE_PAGES })
            .then((cached) => cached || caches.match('/offline', { cacheName: CACHE_STATIC }))
        )
    );
    return;
  }

  // ── E. Resto (JS de terceros, etc.) — network-first simple ───────────────
  // No almacenar en caché para evitar crecer indefinidamente.
});

/* ── Push notifications ────────────────────────────────────────────────────── */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  // Supports both FCM webpush format { notification:{title,body}, fcmOptions:{link} }
  // and direct format { title, body, url }
  let payload = {};
  try { payload = event.data.json(); } catch { return; }

  const title = payload.notification?.title || payload.title || 'FincaOS';
  const body  = payload.notification?.body  || payload.body  || '';
  const url   = payload.fcmOptions?.link    || payload.data?.url || payload.url || '/inicio';
  const icon  = payload.notification?.icon  || '/logo-app.png';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge:   '/logo-app.png',
      data:    { url },
      vibrate: [200, 100, 200],
    })
  );
});

/* ── Notification click ────────────────────────────────────────────────────── */

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
