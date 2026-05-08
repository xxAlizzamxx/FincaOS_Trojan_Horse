/**
 * firebase-messaging-sw.js
 *
 * Service Worker dedicado a Firebase Cloud Messaging (FCM).
 * FCM busca este archivo en /firebase-messaging-sw.js para gestionar
 * mensajes push en segundo plano (cuando la app está cerrada o en otra pestaña).
 *
 * Nota: este SW coexiste con sw.js (que maneja caché offline).
 * Firebase registra ambos en scopes distintos internamente.
 */

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// Configuración duplicada (no hay acceso a process.env en SW)
// Actualiza estos valores si cambias el proyecto de Firebase
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
 * Background message handler.
 * Se ejecuta cuando llega un mensaje FCM de tipo data-only
 * (sin el campo `notification`) mientras la app está en segundo plano.
 *
 * Los mensajes que SÍ incluyen `notification` son manejados automáticamente
 * por FCM y no llegan aquí — ya se muestran sin código adicional.
 */
messaging.onBackgroundMessage((payload) => {
  const { title, body, image } = payload.notification ?? {};
  const data = payload.data ?? {};

  const notifTitle   = title || data.title   || 'FincaOS';
  const notifBody    = body  || data.body    || '';
  const notifUrl     = data.url              || '/inicio';

  self.registration.showNotification(notifTitle, {
    body:    notifBody,
    icon:    '/navegador.png',
    badge:   '/navegador.png',
    image,
    data:    { url: notifUrl },
    vibrate: [200, 100, 200],
  });
});

/** Abre / enfoca la app al pulsar la notificación */
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
      }),
  );
});
