'use client';

import { useEffect, useState } from 'react';
import { getToken } from 'firebase/messaging';
import { doc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { db, getFirebaseMessaging } from '@/lib/firebase/client';

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? '';

export function usePushNotifications(userId: string | undefined) {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported('Notification' in window && 'serviceWorker' in navigator);
    if ('Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  async function requestPermission() {
    if (!supported || !userId) return false;

    const result = await Notification.requestPermission();
    setPermission(result);

    if (result !== 'granted') return false;

    try {
      const messaging = await getFirebaseMessaging();
      if (!messaging) return true; // permission granted but FCM not supported

      const swReg = await navigator.serviceWorker.ready;
      const token = await getToken(messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: swReg,
      });

      if (token) {
        await setDoc(doc(db, 'usuarios', userId, 'tokens', token), {
          token,
          user_agent: navigator.userAgent,
          updated_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('[PushNotifications] Error getting FCM token:', err);
    }

    return true;
  }

  async function revokePermission() {
    if (!userId) return;
    try {
      const snap = await getDocs(collection(db, 'usuarios', userId, 'tokens'));
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    } catch {
      // ignore
    }
  }

  return { permission, supported, requestPermission, revokePermission };
}

/**
 * Send a browser notification (works when app is in foreground).
 * Falls back gracefully if permission not granted.
 */
export function sendLocalNotification(title: string, body: string, url?: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const notification = new Notification(title, {
    body,
    icon: '/navegador.png',
    badge: '/navegador.png',
  });

  if (url) {
    notification.onclick = () => {
      window.focus();
      window.location.href = url;
    };
  }
}
