'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  collection, query, orderBy, limit,
  onSnapshot, doc, updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import type { NotificacionComunidad } from '@/types/database';

/**
 * useNotifications
 *
 * Escucha la subcolección comunidades/{id}/notificaciones en tiempo real.
 * "No leída" = created_at > perfil.notificaciones_last_read AND created_by !== userId.
 * markAllRead() actualiza el timestamp en Firestore de forma optimista.
 */
export function useNotifications(maxItems = 20) {
  const { perfil, user } = useAuth();

  const [notifications, setNotifications] = useState<NotificacionComunidad[]>([]);
  const [loading, setLoading]             = useState(true);

  /* lastRead arranca desde el valor persistido en perfil (o epoch 0 si no existe) */
  const [lastRead, setLastRead] = useState<string>(
    () => perfil?.notificaciones_last_read ?? new Date(0).toISOString(),
  );

  /* Sincronizar lastRead cuando el perfil llega / cambia */
  useEffect(() => {
    if (perfil?.notificaciones_last_read) {
      setLastRead(perfil.notificaciones_last_read);
    }
  }, [perfil?.notificaciones_last_read]);

  /* Listener en tiempo real sobre la subcolección de la comunidad */
  useEffect(() => {
    const comunidadId = perfil?.comunidad_id;
    if (!comunidadId) { setLoading(false); return; }

    const q = query(
      collection(db, 'comunidades', comunidadId, 'notificaciones'),
      orderBy('created_at', 'desc'),
      limit(maxItems),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setNotifications(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as NotificacionComunidad)),
        );
        setLoading(false);
      },
      () => setLoading(false),
    );

    return () => unsub();
  }, [perfil?.comunidad_id, maxItems]);

  /* Contador de no leídas: creadas después de lastRead y no por el propio usuario */
  const unreadCount = useMemo(() => {
    if (!user?.uid) return 0;
    return notifications.filter(
      (n) => n.created_at > lastRead && n.created_by !== user.uid,
    ).length;
  }, [notifications, lastRead, user?.uid]);

  /** Actualiza el timestamp en perfil → badge desaparece al instante */
  async function markAllRead() {
    if (!perfil?.id) return;
    const now = new Date().toISOString();
    setLastRead(now); // actualización optimista — UI inmediata
    try {
      await updateDoc(doc(db, 'perfiles', perfil.id), {
        notificaciones_last_read: now,
      });
    } catch {
      /* silent — el badge ya se limpió en local */
    }
  }

  return { notifications, unreadCount, markAllRead, loading, lastRead };
}
