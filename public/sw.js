/**
 * FincaOS Service Worker — v7
 *
 * Handles:
 *  1. Push notifications via native push event (no Firebase SDK dependency)
 *  2. Cache strategies for offline / PWA support
 *
 * Why no Firebase compat SDK here:
 *  - importScripts from CDN can fail silently (CSP, network, CDN change)
 *  - FCM delivers webpush as standard WebPush; any SW can handle it natively
 *  - Raw push handler is simpler, faster, and always reliable
 */

// ── Cache constants ──────────────────────────────────────────────────────────

const CACHE_STATIC = 'fincaos-static-v7';
const CACHE_PAGES  = 'fincaos-pages-v7';
const ALL_CACHES   = [CACHE_STATIC, CACHE_PAGES];

/** Recursos precacheados en install — offline fallback garantizado. */
const SHELL_URLS = [
  '/offline',
  '/manifest.json',
];

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function isCacheable(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

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

function fetchWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(request, { signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

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

/* ── Install: precache shell ────────────────────────────────────────────────── */

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

/* ── Activate: eliminar caches anteriores ───────────────────────────────────── */

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

/* ── Push notifications ─────────────────────────────────────────────────────── */
/**
 * FCM sends WebPush messages using standard WebPush protocol.
 * The payload is the JSON we defined in webpush.data in the Admin SDK call.
 * Structure: { data: { title, body, url, icon } }
 *
 * We parse it manually — no Firebase SDK needed.
 */
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    // text payload fallback
    payload = { data: { title: 'FincaOS', body: event.data.text() } };
  }

  // FCM Admin SDK sends: { data: { title, body, url, icon } }
  // Notification messages send: { notification: { title, body }, data: { url } }
  const data  = payload.data         ?? {};
  const notif = payload.notification ?? {};

  const title = data.title || notif.title || 'FincaOS';
  const body  = data.body  || notif.body  || '';
  const url   = data.url   || notif.click_action || '/inicio';
  const icon  = data.icon  || '/logo.png';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge:   '/logo.png',
      data:    { url },
      vibrate: [200, 100, 200],
    })
  );
});

/* ── Notification click ─────────────────────────────────────────────────────── */

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

/* ── Fetch ──────────────────────────────────────────────────────────────────── */

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;
  if (!isCacheable(request.url)) return;
  if (isNetworkOnly(request.url)) return;

  // A. Activos estáticos Next.js (/_next/static/) — cache-first (inmutables)
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

  // B. Fuentes web — cache-first
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

  // C. Imágenes — cache-first
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

  // D. Navegación HTML — network-first (3s timeout), fallback /offline
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
});
