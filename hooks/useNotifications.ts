'use client';

/**
 * useNotifications — hook central de notificaciones en tiempo real.
 *
 * Arquitectura:
 *   - Escucha onSnapshot sobre comunidades/{id}/notificaciones (subcolección)
 *   - 1 documento por evento → no se duplica por usuario
 *   - "No leída" = created_at > perfil.notificaciones_last_read
 *   - markAllRead() → actualiza perfil.notificaciones_last_read = ahora
 *
 * Uso:
 *   const { notifications, unreadCount, markAllRead, loading } = useNotifications();
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  collection, query, orderBy, limit,
  onSnapshot, doc, updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import type { NotificacionComunidad } from '@/types/database';

export function useNotifications(maxItems = 20) {
  const { perfil } = useAuth();

  const [notifications, setNotifications] = useState<NotificacionComunidad[]>([]);
  const [loading, setLoading]             = useState(true);

  /* ── Timestamp de última lectura (local state para actualización optimista) ── */
  const [lastRead, setLastRead] = useState<string>(
    perfil?.notificaciones_last_read ?? '1970-01-01T00:00:00.000Z',
  );

  /* Sincronizar si el perfil llega con un valor más reciente */
  useEffect(() => {
    if (perfil?.notificaciones_last_read) {
      setLastRead(perfil.notificaciones_last_read);
    }
  }, [perfil?.notificaciones_last_read]);

  /* ── Listener en tiempo real ── */
  useEffect(() => {
    if (!perfil?.comunidad_id) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'comunidades', perfil.comunidad_id, 'notificaciones'),
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
      (err) => {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[useNotifications] onSnapshot error:', err.message);
        }
        setLoading(false);
      },
    );

    return () => unsub();
  }, [perfil?.comunidad_id, maxItems]);

  /* ── Contador de no leídas (reactivo a notifications + lastRead) ── */
  const unreadCount = useMemo(() => {
    if (!perfil?.id) return 0;
    return notifications.filter(
      (n) => n.created_at > lastRead && n.created_by !== perfil.id,
    ).length;
  }, [notifications, lastRead, perfil?.id]);

  /* ── Marcar todas como leídas ── */
  const markAllRead = useCallback(async () => {
    if (!perfil?.id) return;
    const now = new Date().toISOString();
    setLastRead(now); // actualización optimista inmediata (badge desaparece al instante)
    try {
      await updateDoc(doc(db, 'perfiles', perfil.id), {
        notificaciones_last_read: now,
      });
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[useNotifications] markAllRead error:', err);
      }
    }
  }, [perfil?.id]);

  return { notifications, unreadCount, markAllRead, loading } as const;
}
