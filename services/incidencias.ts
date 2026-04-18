/**
 * Incidencias service — business logic layer.
 *
 * API routes call these functions; they never contain Firebase calls directly.
 * This separation allows:
 *  - Unit testing without HTTP overhead
 *  - Reuse across routes / cron jobs
 *  - Easy migration to other databases
 *
 * All functions throw typed AppErrors (from lib/errors.ts).
 */

import { FieldValue }  from 'firebase-admin/firestore';
import { getAdminDb }  from '@/lib/firebase/admin';
import { NotFoundError, ForbiddenError } from '@/lib/errors';
import { eventBus }    from '@/events/emitter';
import { registerDefaultHandlers } from '@/events/handlers';

// Ensure handlers are wired up whenever this service is imported
registerDefaultHandlers();

/* ── Types ──────────────────────────────────────────────────────────────── */

export interface ToggleAfectadoParams {
  incidenciaId: string;
  uid:          string;
  coef:         number;
  comunidadId:  string;
  quitar:       boolean;
  requestId?:   string;
}

export interface ToggleAfectadoResult {
  newCount:         number;
  newPeso:          number;
  porcentaje:       number;
  quorumAlcanzado:  boolean;
  wasNewQuorum:     boolean;
}

/* ── toggleAfectado ─────────────────────────────────────────────────────── */

/**
 * Atomically adds/removes a user from an incidencia's afectados subcollection
 * and recalculates the quorum. Triggers quorum escalation on first threshold cross.
 *
 * Extracted from /api/incidencias/afectar so the route becomes a thin controller.
 */
export async function toggleAfectado(
  params: ToggleAfectadoParams,
): Promise<ToggleAfectadoResult> {
  const { incidenciaId, uid, coef, comunidadId, quitar, requestId } = params;
  const db          = getAdminDb();
  const afectadoRef = db.collection('incidencias').doc(incidenciaId).collection('afectados').doc(uid);

  let result!: ToggleAfectadoResult;

  await db.runTransaction(async (tx) => {
    const incRef = db.collection('incidencias').doc(incidenciaId);

    const [incSnap, existingAfectadoSnap] = await Promise.all([
      tx.get(incRef),
      tx.get(afectadoRef),
    ]);

    if (!incSnap.exists) throw new NotFoundError('Incidencia');

    const inc           = incSnap.data()!;
    const yaEraAfectado = existingAfectadoSnap.exists;

    // Apply set/delete atomically inside the transaction
    if (quitar) {
      if (yaEraAfectado) tx.delete(afectadoRef);
    } else {
      tx.set(afectadoRef, { coeficiente: coef, added_at: new Date().toISOString() });
    }

    // Delta-based count (avoids scanning the whole subcollection)
    const prevCount = (inc.quorum as any)?.afectados_count ?? 0;
    const prevPeso  = (inc.quorum as any)?.peso_afectados  ?? 0;
    let newCount = prevCount;
    let newPeso  = prevPeso;

    if (quitar && yaEraAfectado) {
      newCount = Math.max(0, prevCount - 1);
      newPeso  = Math.max(0, prevPeso  - coef);
    } else if (!quitar && !yaEraAfectado) {
      newCount = prevCount + 1;
      newPeso  = prevPeso  + coef;
    }

    // Non-transactional read for total vecinos (eventually consistent — acceptable)
    const vecinosSnap = await db.collection('perfiles')
      .where('comunidad_id', '==', comunidadId).get();
    const totalVecinos = vecinosSnap.size;

    const umbral       = (inc.quorum as any)?.umbral ?? 30;
    const porcentaje   = totalVecinos > 0 ? (newCount / totalVecinos) * 100 : 0;
    const yaAlcanzado  = (inc.quorum as any)?.alcanzado ?? false;
    const wasNewQuorum = !yaAlcanzado && porcentaje >= umbral;
    const ahora        = new Date().toISOString();

    const updates: Record<string, unknown> = {
      'quorum.tipo':            'simple',
      'quorum.umbral':          umbral,
      'quorum.afectados_count': newCount,
      'quorum.peso_afectados':  newPeso,
      'quorum.alcanzado':       porcentaje >= umbral,
    };

    if (wasNewQuorum) {
      updates['quorum.alcanzado_at'] = ahora;
      updates['escalada_por_quorum'] = true;

      if (inc.prioridad !== 'urgente') {
        updates['prioridad_original'] = inc.prioridad;
        updates['prioridad']          = 'urgente';
      }
      if (inc.estado === 'pendiente') {
        updates['estado']            = 'en_revision';
        updates['historial_estados'] = FieldValue.arrayUnion({
          estado: 'en_revision', fecha: ahora, cambiado_por: 'sistema_quorum',
        });
      }

      // Community notification — fire-and-forget (outside transaction to avoid contention)
      db.collection('comunidades').doc(comunidadId)
        .collection('notificaciones').add({
          tipo: 'incidencia', titulo: '⚠️ Quórum alcanzado',
          mensaje: `"${inc.titulo as string}" alcanzó quórum (${newCount} vecinos afectados)`,
          created_at: ahora, created_by: 'sistema',
          related_id: incidenciaId, link: `/incidencias/${incidenciaId}`,
        }).catch((e: unknown) => console.error('[toggleAfectado] notificación error:', e));
    }

    tx.update(incRef, updates);

    result = { newCount, newPeso, porcentaje, quorumAlcanzado: porcentaje >= umbral, wasNewQuorum };
  });

  // Emit domain events (fire-and-forget, never throws)
  const iso = new Date().toISOString();

  eventBus.emit({
    type:        'incidencia.affected',
    timestamp:   iso,
    actor_id:    uid,
    comunidad_id: comunidadId,
    request_id:  requestId,
    payload: {
      incidenciaId, userId: uid, quitar,
      newCount:   result.newCount,
      porcentaje: result.porcentaje,
    },
  });

  if (result.wasNewQuorum) {
    eventBus.emit({
      type:        'incidencia.quorum_reached',
      timestamp:   iso,
      actor_id:    uid,
      comunidad_id: comunidadId,
      request_id:  requestId,
      payload: {
        incidenciaId,
        titulo:     '', // loaded lazily if needed by handlers
        afectados:  result.newCount,
        comunidadId,
      },
    });
  }

  return result;
}

/* ── getIncidenciaOrThrow ────────────────────────────────────────────────── */

/**
 * Fetches an incidencia document and throws NotFoundError if it doesn't exist.
 * Optionally verifies community membership (throws ForbiddenError).
 */
export async function getIncidenciaOrThrow(
  incidenciaId: string,
  opts?: { requireComunidadId?: string },
) {
  const db   = getAdminDb();
  const snap = await db.collection('incidencias').doc(incidenciaId).get();

  if (!snap.exists) throw new NotFoundError('Incidencia');

  const data = snap.data()!;

  if (opts?.requireComunidadId && data.comunidad_id !== opts.requireComunidadId) {
    throw new ForbiddenError('La incidencia no pertenece a tu comunidad');
  }

  return { id: snap.id, ...data };
}
