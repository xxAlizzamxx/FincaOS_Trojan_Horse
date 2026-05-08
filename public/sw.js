/**
 * FincaOS Service Worker — v5
 *
 * Handles:
 *  1. FCM background push notifications (Firebase Messaging compat SDK)
 *  2. Cache strategies for offline / PWA support
 *
 * Cache versioning: bump CACHE_STATIC / CACHE_PAGES on every deploy.
 */

// ── Firebase Messaging (background push) ────────────────────────────────────
// MUST be at the very top so Firebase SDK intercepts the `push` event
// before any other listener. Without this the raw push event fires but
// FCM tokens generated with getToken() won't trigger showNotification.
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            'AIzaSyDXEHnQ5reKyOe1yVAJG3fgLQZHecRBjls',
  authDomain:        'fincaostrojanhorse.firebaseapp.com',
  projectId:         'fincaostrojanhorse',
  storageBucket:     'fincaostrojanhorse.firebasestorage.app',
  messagingSenderId: '870092780057',
  appId:             '1:870092780057:web:f1d34431391d86d638f088',
});

const messaging = firebase.messaging();

/**
 * onBackgroundMessage — fires for data-only FCM messages (no `notification`
 * field in the webpush payload). Notification messages without this handler
 * would be displayed automatically by FCM but without custom icon/badge.
 * We always send data-only from the Admin SDK so we always end up here.
 */
messaging.onBackgroundMessage((payload) => {
  const notif = payload.notification ?? {};
  const data  = payload.data        ?? {};

  const title = notif.title || data.title || 'FincaOS';
  const body  = notif.body  || data.body  || '';
  const url   = data.url    || notif.click_action || '/inicio';

  self.registration.showNotification(title, {
    body,
    icon:    '/logo-app.png',
    badge:   '/logo-app.png',
    data:    { url },
    vibrate: [200, 100, 200],
  });
});

// ── Cache constants ──────────────────────────────────────────────────────────

const CACHE_STATIC = 'fincaos-static-v5';
const CACHE_PAGES  = 'fincaos-pages-v5';
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
    url.includes('cloudinary.com')                   ||
    url.includes('gstatic.com')
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
