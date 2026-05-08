'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Cache + offline SW
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('[SW] sw.js registration failed:', err);
    });

    // Firebase Messaging SW - required for FCM background push notifications
    navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' }).catch((err) => {
      console.error('[SW] firebase-messaging-sw.js registration failed:', err);
    });
  }, []);

  return null;
}
