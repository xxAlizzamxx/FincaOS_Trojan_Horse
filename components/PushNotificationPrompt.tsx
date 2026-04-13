'use client';

import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePushNotifications, sendLocalNotification } from '@/hooks/usePushNotifications';
import { Button } from '@/components/ui/button';

export function PushNotificationPrompt() {
  const { user } = useAuth();
  const { permission, supported, requestPermission } = usePushNotifications(user?.uid);
  const [dismissed, setDismissed] = useState(false);

  // Check if user already dismissed before
  useEffect(() => {
    const d = localStorage.getItem('push_prompt_dismissed');
    if (d) setDismissed(true);
  }, []);

  // Listen for new notifications and show browser notification
  useEffect(() => {
    if (!user || permission !== 'granted') return;

    const q = query(
      collection(db, 'notificaciones'),
      where('usuario_id', '==', user.uid),
      where('leida', '==', false),
      orderBy('created_at', 'desc'),
      limit(1),
    );

    let isFirst = true;
    const unsub = onSnapshot(q, (snapshot) => {
      if (isFirst) { isFirst = false; return; }

      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          sendLocalNotification(data.titulo, data.mensaje || '', data.link);
        }
      });
    });

    return () => unsub();
  }, [user, permission]);

  // Don't render prompt if not applicable
  if (!supported || !user || permission !== 'default' || dismissed) return null;

  return (
    <div className="mx-4 mb-3 p-3 bg-finca-peach/20 border border-finca-peach/40 rounded-xl flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-finca-coral/10 flex items-center justify-center shrink-0">
        <Bell className="w-4 h-4 text-finca-coral" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-finca-dark">Activa las notificaciones</p>
        <p className="text-xs text-muted-foreground">Recibe alertas de tu comunidad al instante</p>
      </div>
      <div className="flex gap-1.5 shrink-0">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-xs text-muted-foreground"
          onClick={() => { setDismissed(true); localStorage.setItem('push_prompt_dismissed', '1'); }}
        >
          Luego
        </Button>
        <Button
          size="sm"
          className="h-8 text-xs bg-finca-coral hover:bg-finca-coral/90 text-white"
          onClick={requestPermission}
        >
          Activar
        </Button>
      </div>
    </div>
  );
}
