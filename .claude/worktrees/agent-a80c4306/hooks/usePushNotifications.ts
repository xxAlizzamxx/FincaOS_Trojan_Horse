'use client';

import { useEffect, useState } from 'react';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';

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

    if (result === 'granted') {
      // Store that this user has granted push permission
      await setDoc(doc(db, 'push_subscriptions', userId), {
        granted: true,
        user_agent: navigator.userAgent,
        updated_at: new Date().toISOString(),
      }, { merge: true });
      return true;
    }
    return false;
  }

  async function revokePermission() {
    if (!userId) return;
    await deleteDoc(doc(db, 'push_subscriptions', userId));
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
