import { collection, addDoc, query, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { db } from './client';
import type { TipoNotificacion } from '@/types/database';

interface NotificationData {
  usuario_id: string;
  comunidad_id: string;
  tipo: 'incidencia' | 'estado' | 'comentario' | 'anuncio' | 'mediacion' | 'votacion';
  titulo: string;
  mensaje: string;
  link?: string;
}

export async function crearNotificacion(data: NotificationData) {
  await addDoc(collection(db, 'notificaciones'), {
    ...data,
    leida: false,
    created_at: new Date().toISOString(),
  });
}

export async function notificarAdmins(comunidadId: string, tipo: NotificationData['tipo'], titulo: string, mensaje: string, link?: string) {
  // limit(20): una comunidad nunca tendrá más de 20 presidentes/admins simultáneos
  const adminsSnap = await getDocs(
    query(collection(db, 'perfiles'), where('comunidad_id', '==', comunidadId), where('rol', 'in', ['admin', 'presidente']), limit(20))
  );
  const promises = adminsSnap.docs.map((d) =>
    crearNotificacion({ usuario_id: d.id, comunidad_id: comunidadId, tipo, titulo, mensaje, link })
  );
  await Promise.all(promises);
}

export async function notificarComunidad(comunidadId: string, tipo: NotificationData['tipo'], titulo: string, mensaje: string, link?: string, exceptUserId?: string) {
  // limit(500): techo razonable para una comunidad de propietarios.
  // Para comunidades más grandes migrar a crearNotificacionComunidad() (1 doc por evento).
  const vecinosSnap = await getDocs(
    query(collection(db, 'perfiles'), where('comunidad_id', '==', comunidadId), limit(500))
  );
  const promises = vecinosSnap.docs
    .filter((d) => d.id !== exceptUserId)
    .map((d) =>
      crearNotificacion({ usuario_id: d.id, comunidad_id: comunidadId, tipo, titulo, mensaje, link })
    );
  await Promise.all(promises);
}

export async function notificarUsuario(userId: string, comunidadId: string, tipo: NotificationData['tipo'], titulo: string, mensaje: string, link?: string) {
  await crearNotificacion({ usuario_id: userId, comunidad_id: comunidadId, tipo, titulo, mensaje, link });
}

/* ─────────────────────────────────────────────────────────────────────────────
   NUEVO MODELO — Notificaciones de comunidad (1 doc por evento, no por usuario)
   Colección: comunidades/{comunidadId}/notificaciones/{auto-id}
   "No leída" se determina en cliente comparando created_at con
   perfil.notificaciones_last_read. No hay campo "leida" por documento.
───────────────────────────────────────────────────────────────────────────── */

interface NotificacionComunidadData {
  tipo:       TipoNotificacion;
  titulo:     string;
  mensaje:    string;
  created_by: string;   // uid del autor (se excluye del badge de no leídas)
  related_id: string;   // id del objeto original
  link:       string;   // ruta de navegación
}

/**
 * Crea UNA notificación en la subcolección de la comunidad.
 * Todos los miembros la ven — la lectura se controla por timestamp en perfil.
 * Es fire-and-forget: llámala sin await para no bloquear la acción del usuario.
 */
export async function crearNotificacionComunidad(
  comunidadId: string,
  data: NotificacionComunidadData,
): Promise<void> {
  await addDoc(
    collection(db, 'comunidades', comunidadId, 'notificaciones'),
    { ...data, created_at: new Date().toISOString() },
  );
}

/** Notifica a todos los mediadores de la comunidad sobre una nueva solicitud */
export async function notificarMediadores(
  comunidadId: string,
  mediacionId: string,
  descripcion = 'Un vecino solicitó mediación profesional',
) {
  // limit(20): número máximo razonable de mediadores en una comunidad
  const snap = await getDocs(
    query(
      collection(db, 'perfiles'),
      where('comunidad_id', '==', comunidadId),
      where('rol', '==', 'mediador'),
      limit(20),
    ),
  );
  const promises = snap.docs.map((d) =>
    crearNotificacion({
      usuario_id:   d.id,
      comunidad_id: comunidadId,
      tipo:         'mediacion',
      titulo:       'Nueva mediación disponible',
      mensaje:      descripcion,
      link:         `/mediaciones/${mediacionId}`,
    }),
  );
  await Promise.all(promises);
}

// ── Rate limiting & deduplication ──────────────────────────────────────────
// In-memory cache for notification deduplication (30-second TTL)
const notificationDedup = new Map<string, number>();

/** Clear expired dedup entries (keep cache from growing indefinitely) */
function clearExpiredDedup(now: number = Date.now()) {
  for (const [key, timestamp] of Array.from(notificationDedup.entries())) {
    if (now - timestamp > 35_000) { // Clear after 35s (just past 30s TTL)
      notificationDedup.delete(key);
    }
  }
}

/** Check if notification can be sent (deduplication & rate limiting) */
function canNotify(key: string, windowMs: number = 30_000): boolean {
  const now = Date.now();
  clearExpiredDedup(now);

  const lastTime = notificationDedup.get(key);
  if (!lastTime) return true;
  return now - lastTime > windowMs;
}

/** Record that notification was sent (for deduplication) */
function recordNotification(key: string) {
  notificationDedup.set(key, Date.now());
}

/**
 * Unified notification function: creates community notification + optional email/push
 * Implements rate limiting (max 1 per event type/entity per 30s)
 */
export async function notifyEvent(
  comunidadId: string,
  type: TipoNotificacion,
  title: string,
  body: string,
  relatedId: string,
  link: string,
  createdBy: string = 'system',
  options?: {
    sendEmail?: boolean;
    emailSubject?: string;
    pushNotify?: boolean;
    pushTitle?: string;
    pushBody?: string;
    targetUserIds?: string[]; // for push only to specific users
  },
): Promise<void> {
  // Rate limiting key: {comunidad}:{type}:{relatedId}
  const dedupKey = `${comunidadId}:${type}:${relatedId}`;

  if (!canNotify(dedupKey)) {
    console.log('[notifyEvent] Rate limit hit:', dedupKey);
    return;
  }

  recordNotification(dedupKey);

  try {
    // Create community notification (fire-and-forget)
    crearNotificacionComunidad(comunidadId, {
      tipo: type,
      titulo: title,
      mensaje: body,
      created_by: createdBy,
      related_id: relatedId,
      link: link,
    }).catch((err) => {
      console.error('[notifyEvent] Error creating community notification:', err);
    });

    // Send push notifications if requested
    if (options?.pushNotify) {
      const pushPayload = {
        comunidadId,
        titulo: options.pushTitle || title,
        body: options.pushBody || body,
        targetUserIds: options.targetUserIds,
      };

      fetch('/api/notificaciones/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pushPayload),
      }).catch((err) => {
        console.error('[notifyEvent] Error sending push notification:', err);
      });
    }

    // Send email if requested
    if (options?.sendEmail) {
      // Email sending is handled by event handlers in /events/handlers.ts
      // This flag just indicates intention; actual email sent via API/cron
      console.log('[notifyEvent] Email notification requested for:', comunidadId);
    }
  } catch (err) {
    console.error('[notifyEvent] Error:', err);
    // Don't throw — notifications are fire-and-forget
  }
}
