/**
 * Default event handlers — registered once at module load time.
 *
 * What these handlers do:
 *  1. Structured logging (all events) — compatible with Vercel Logs / Datadog
 *  2. Analytics writes to Firestore `analytics_events` (server-side, via Admin SDK)
 *     Only non-sensitive data: IDs, contadores, booleans. NUNCA PII ni contenido.
 *  3. Individual notifications to `notificaciones` collection for in-app campanita
 *
 * Privacy guarantee: no email, no name, no message content stored in analytics.
 */

import { eventBus }      from './emitter';
import { sendSmartAlert } from '@/lib/email';
import { notifyEvent } from '@/lib/firebase/notifications';
import { getAdminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import type { AnalyticsEventName } from '@/types/database';

/* ── Analytics writer (server-side, Admin SDK) ──────────────────────────── */

/**
 * Escribe un evento en analytics_events usando Admin SDK (server-side).
 * Fire-and-forget: nunca bloquea ni lanza excepciones al caller.
 * Solo almacena metadatos no sensibles.
 */
async function analyticsWrite(
  event:       AnalyticsEventName,
  userId:      string | undefined,
  comunidadId: string | undefined,
  metadata:    Record<string, string | number | boolean> = {},
): Promise<void> {
  if (!userId) return;  // no registrar eventos sin actor
  try {
    const db = getAdminDb();
    await db.collection('analytics_events').add({
      user_id:      userId,
      comunidad_id: comunidadId ?? null,
      event,
      created_at:   new Date().toISOString(),
      metadata,
    });
  } catch {
    // Fallo silencioso — analytics no puede romper el flujo de negocio
  }
}

/* ── Individual notifications (in-app campanita) ────────────────────────── */

/**
 * Crea notificación individual en la colección `notificaciones` para un usuario.
 * Fire-and-forget: nunca bloquea.
 */
async function notificarUsuarioIndividual(
  usuarioId: string,
  titulo: string,
  mensaje: string,
  tipo: string,
  url: string,
): Promise<void> {
  try {
    const db = getAdminDb();
    await db.collection('notificaciones').add({
      usuario_id: usuarioId,
      titulo,
      mensaje,
      tipo,
      leida: false,
      created_at: FieldValue.serverTimestamp(),
      url,
    });
  } catch {
    // Fallo silencioso
  }
}

/**
 * Notifica a múltiples usuarios
 */
async function notificarUsuarios(
  usuarioIds: string[],
  titulo: string,
  mensaje: string,
  tipo: string,
  url: string,
): Promise<void> {
  if (usuarioIds.length === 0) return;
  try {
    const db = getAdminDb();
    const batch = db.batch();
    usuarioIds.forEach((uid) => {
      const ref = db.collection('notificaciones').doc();
      batch.set(ref, {
        usuario_id: uid,
        titulo,
        mensaje,
        tipo,
        leida: false,
        created_at: FieldValue.serverTimestamp(),
        url,
      });
    });
    await batch.commit();
  } catch {
    // Fallo silencioso
  }
}

let _registered = false;

/**
 * Register all default handlers exactly once.
 * Call from any server module — subsequent calls are no-ops.
 */
export function registerDefaultHandlers(): void {
  if (_registered) return;
  _registered = true;

  /* ── Structured log for every domain event ── */

  eventBus.on('incidencia.created', (e) => {
    console.log(JSON.stringify({
      level: 'info', action: 'incidencia.created',
      incidencia_id: e.payload.incidenciaId, titulo: e.payload.titulo,
      prioridad: e.payload.prioridad, zona: e.payload.zona,
      actor_id: e.actor_id, comunidad_id: e.comunidad_id,
      request_id: e.request_id, timestamp: e.timestamp,
    }));
    // Analytics: solo IDs y metadatos no sensibles — sin título ni contenido
    void analyticsWrite('crear_incidencia', e.actor_id, e.comunidad_id, {
      incidencia_id: e.payload.incidenciaId,
      prioridad:     e.payload.prioridad,
      zona:          e.payload.zona,
    });
  });

  eventBus.on('incidencia.affected', (e) => {
    console.log(JSON.stringify({
      level: 'info', action: 'incidencia.affected',
      incidencia_id: e.payload.incidenciaId, user_id: e.payload.userId,
      quitar: e.payload.quitar, new_count: e.payload.newCount,
      porcentaje: e.payload.porcentaje,
      request_id: e.request_id, timestamp: e.timestamp,
    }));
    // Analytics solo si el usuario está marcando (no quitando)
    if (!e.payload.quitar) {
      void analyticsWrite('marcar_afectado', e.actor_id, e.comunidad_id, {
        incidencia_id: e.payload.incidenciaId,
        new_count:     e.payload.newCount,
      });
    }
  });

  eventBus.on('incidencia.quorum_reached', (e) => {
    // Quorum is a business-critical event — use 'warn' so it surfaces in alerts
    console.warn(JSON.stringify({
      level: 'warn', action: 'incidencia.quorum_reached',
      incidencia_id: e.payload.incidenciaId, titulo: e.payload.titulo,
      afectados: e.payload.afectados, comunidad_id: e.payload.comunidadId,
      request_id: e.request_id, timestamp: e.timestamp,
    }));

    // Email alert — fire-and-forget; dedup built into sendSmartAlert
    void sendSmartAlert({
      type:         'quorum_reached',
      comunidad_id: e.payload.comunidadId,
      metadata: {
        titulo:     e.payload.titulo || e.payload.incidenciaId,
        afectados:  e.payload.afectados,
      },
    });

    // Community notification + push for quorum reached
    void notifyEvent(
      e.payload.comunidadId,
      'incidencia',
      '⚠️ Quórum alcanzado',
      `La incidencia "${e.payload.titulo}" ha alcanzado el quórum (${e.payload.afectados} afectados)`,
      e.payload.incidenciaId,
      `/incidencias/${e.payload.incidenciaId}`,
      'system',
      {
        pushNotify: true,
        pushTitle: '⚠️ Quórum alcanzado',
        pushBody: e.payload.titulo,
        sendEmail: true,
      },
    );
  });

  eventBus.on('incidencia.status_changed', (e) => {
    console.log(JSON.stringify({
      level: 'info', action: 'incidencia.status_changed',
      incidencia_id: e.payload.incidenciaId,
      from: e.payload.from, to: e.payload.to, changed_by: e.payload.changedBy,
      request_id: e.request_id, timestamp: e.timestamp,
    }));

    // Create community notification for status change
    if (e.payload.comunidadId && e.payload.titulo) {
      const stateLabel = {
        pendiente: 'Pendiente',
        en_revision: 'En revisión',
        presupuestada: 'Presupuestada',
        aprobada: 'Aprobada',
        en_ejecucion: 'En ejecución',
        resuelta: 'Resuelta',
        cerrada: 'Cerrada',
      }[e.payload.to] || e.payload.to;

      void notifyEvent(
        e.payload.comunidadId,
        'estado',
        `Estado actualizado: ${stateLabel}`,
        `${e.payload.titulo}`,
        e.payload.incidenciaId,
        `/incidencias/${e.payload.incidenciaId}`,
        e.payload.changedBy,
        {
          pushNotify: true,
          pushTitle: `🔄 ${stateLabel}`,
          pushBody: e.payload.titulo,
        },
      );

      // Individual notification in-app — notificar al autor de la incidencia
      if (e.payload.incidenciaAutorId && e.payload.incidenciaAutorId !== e.payload.changedBy) {
        const stateLabel = {
          pendiente: 'Pendiente',
          en_revision: 'En revisión',
          presupuestada: 'Presupuestada',
          aprobada: 'Aprobada',
          en_ejecucion: 'En ejecución',
          resuelta: 'Resuelta',
          cerrada: 'Cerrada',
        }[e.payload.to] || e.payload.to;

        void notificarUsuarioIndividual(
          e.payload.incidenciaAutorId,
          `🔄 Estado: ${stateLabel}`,
          `Tu incidencia "${e.payload.titulo}" cambió de estado a "${stateLabel}"`,
          'estado',
          `/incidencias/${e.payload.incidenciaId}`,
        );
      }
    }
  });

  eventBus.on('comment.created', (e) => {
    console.log(JSON.stringify({
      level: 'info', action: 'comment.created',
      comentario_id: e.payload.comentarioId, incidencia_id: e.payload.incidenciaId,
      actor_id: e.actor_id, request_id: e.request_id, timestamp: e.timestamp,
    }));

    // Sin contenido del comentario — solo el ID de la incidencia
    void analyticsWrite('crear_comentario', e.actor_id, e.comunidad_id, {
      incidencia_id: e.payload.incidenciaId,
    });

    // Community notification for new comment
    if (e.payload.comunidadId) {
      void notifyEvent(
        e.payload.comunidadId,
        'comentario',
        `Nuevo comentario en "${e.payload.incidenciaId}"`,
        `${e.payload.autorNombre} comentó en una incidencia`,
        e.payload.incidenciaId,
        `/incidencias/${e.payload.incidenciaId}`,
        e.actor_id,
        {
          pushNotify: true,
          pushTitle: `💬 ${e.payload.autorNombre}`,
          pushBody: 'Nuevo comentario en una incidencia',
          targetUserIds: e.payload.incidenciaAutorId ? [e.payload.incidenciaAutorId] : [],
        },
      );
    }

    // Individual notification in-app (campanita) — notificar al autor de la incidencia
    if (e.payload.incidenciaAutorId && e.payload.incidenciaAutorId !== e.actor_id) {
      void notificarUsuarioIndividual(
        e.payload.incidenciaAutorId,
        '💬 Nuevo comentario',
        `${e.payload.autorNombre} comentó en tu incidencia`,
        'comentario',
        `/incidencias/${e.payload.incidenciaId}`,
      );
    }
  });

  eventBus.on('payment.updated', (e) => {
    console.log(JSON.stringify({
      level: 'info', action: 'payment.updated',
      tipo: e.payload.tipo, referencia_id: e.payload.referenciaId,
      estado: e.payload.estado, monto: e.payload.monto,
      comunidad_id: e.comunidad_id,
      request_id: e.request_id, timestamp: e.timestamp,
    }));
  });

  eventBus.on('mediacion.created', (e) => {
    console.log(JSON.stringify({
      level: 'info', action: 'mediacion.created',
      mediacion_id: e.payload.mediacionId, tipo: e.payload.tipo,
      actor_id: e.actor_id, comunidad_id: e.payload.comunidadId,
      request_id: e.request_id, timestamp: e.timestamp,
    }));
  });

  eventBus.on('user.joined_community', (e) => {
    console.log(JSON.stringify({
      level: 'info', action: 'user.joined_community',
      user_id: e.payload.userId, comunidad_id: e.payload.comunidadId,
      rol: e.payload.rol, request_id: e.request_id, timestamp: e.timestamp,
    }));
    void analyticsWrite('join_community', e.actor_id, e.payload.comunidadId, {
      rol: e.payload.rol,
    });
  });

  eventBus.on('user.login', (e) => {
    console.log(JSON.stringify({
      level: 'info', action: 'user.login',
      user_id: e.payload.userId, comunidad_id: e.payload.comunidadId,
      timestamp: e.timestamp,
    }));
    // No escribimos analytics aquí: el login ya lo hace trackEvent() en useAuth
    // para evitar doble escritura (el event bus es server-only).
  });
}
