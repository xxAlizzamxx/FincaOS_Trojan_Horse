/**
 * GET /api/cron/cuotas
 *
 * Vercel Cron Job — gestión automática de estados de pago.
 *
 * Lógica por ejecución:
 *  1. Busca cuotas con fecha_limite < ahora → marca pagos 'pendiente' como 'overdue'
 *  2. Busca cuotas con fecha_limite en [ahora, ahora+3d] → envía recordatorio por email
 *  3. Por cada comunidad con pagos overdue → sendSmartAlert('pending_payments')
 *
 * Logs emitidos: cuota_checked, reminder_sent, overdue_marked
 *
 * Seguridad: Authorization: Bearer <CRON_SECRET>
 * Límites: MAX_CUOTAS cuotas por ejecución (anti-timeout)
 * Idempotente: re-ejecutar es seguro (las transiciones solo van hacia adelante)
 */

import { NextRequest, NextResponse } from 'next/server';
import { WriteBatch }                from 'firebase-admin/firestore';
import { getAdminDb }               from '@/lib/firebase/admin';
import { sendPaymentReminder }       from '@/lib/email';
import { sendSmartAlert }            from '@/lib/email';
import { createLogger }              from '@/lib/logger';

export const runtime     = 'nodejs';
export const maxDuration = 60;

const MAX_CUOTAS            = 200;
const REMINDER_DAYS         = 3;
const REMINDER_WINDOW_MS    = REMINDER_DAYS * 24 * 60 * 60 * 1_000;

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const log       = createLogger({ route: '/api/cron/cuotas', requestId });

  /* ── 1. Auth ────────────────────────────────────────────────────────────── */
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error('cron_secret_missing', undefined, {});
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const authHeader = req.headers.get('authorization') ?? '';
  if (authHeader !== `Bearer ${secret}`) {
    log.warn('cron_cuotas_unauthorized', { ip: req.headers.get('x-forwarded-for') ?? 'unknown' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db       = getAdminDb();
  const now      = new Date();
  const nowIso   = now.toISOString();
  const in3Days  = new Date(now.getTime() + REMINDER_WINDOW_MS).toISOString();
  const runStart = Date.now();

  log.info('cron_cuotas_started', { now: nowIso, reminder_until: in3Days });

  let overdueMarked   = 0;
  let remindersQueued = 0;
  let cuotasChecked   = 0;

  // comunidad_id → count of overdue pagos (for aggregate alert)
  const overduePerComunidad = new Map<string, number>();

  /* ── 2. Cuotas ya vencidas → marcar pagos 'pendiente' como 'overdue' ───── */
  try {
    const vencidasSnap = await db
      .collection('cuotas')
      .where('fecha_limite', '<', nowIso)
      .limit(MAX_CUOTAS)
      .get();

    for (const cuotaDoc of vencidasSnap.docs) {
      const cuota       = cuotaDoc.data();
      const comunidadId = cuota.comunidad_id as string;

      const pendientesSnap = await db
        .collection('cuotas')
        .doc(cuotaDoc.id)
        .collection('pagos')
        .where('estado', '==', 'pendiente')
        .get();

      if (!pendientesSnap.empty) {
        // Batch update en grupos de 500 (límite Firestore)
        const chunks: typeof pendientesSnap.docs[] = [];
        for (let i = 0; i < pendientesSnap.docs.length; i += 500) {
          chunks.push(pendientesSnap.docs.slice(i, i + 500));
        }
        for (const chunk of chunks) {
          const batch: WriteBatch = db.batch();
          chunk.forEach((pagoDoc) =>
            batch.update(pagoDoc.ref, { estado: 'overdue', overdue_at: nowIso }),
          );
          await batch.commit();
        }

        const count = pendientesSnap.size;
        overdueMarked += count;
        overduePerComunidad.set(
          comunidadId,
          (overduePerComunidad.get(comunidadId) ?? 0) + count,
        );

        log.info('overdue_marked', {
          cuota_id:     cuotaDoc.id,
          cuota_nombre: cuota.nombre as string,
          comunidad_id: comunidadId,
          count,
          request_id:   requestId,
        });
      }

      log.info('cuota_checked', {
        cuota_id:     cuotaDoc.id,
        tipo:         'vencida',
        comunidad_id: comunidadId,
        request_id:   requestId,
      });
      cuotasChecked++;
    }
  } catch (err) {
    log.error('cron_cuotas_overdue_failed', err, { request_id: requestId });
  }

  /* ── 3. Cuotas que vencen en ≤3 días → enviar recordatorio ─────────────── */
  try {
    const proximasSnap = await db
      .collection('cuotas')
      .where('fecha_limite', '>=', nowIso)
      .where('fecha_limite', '<=', in3Days)
      .limit(MAX_CUOTAS)
      .get();

    for (const cuotaDoc of proximasSnap.docs) {
      const cuota       = cuotaDoc.data();
      const comunidadId = cuota.comunidad_id as string;

      // Contar pagos pendientes para saber si hay alguien que no pagó
      const pendientesSnap = await db
        .collection('cuotas')
        .doc(cuotaDoc.id)
        .collection('pagos')
        .where('estado', '==', 'pendiente')
        .get();

      const pendingCount = pendientesSnap.size;

      log.info('cuota_checked', {
        cuota_id:     cuotaDoc.id,
        tipo:         'proxima',
        comunidad_id: comunidadId,
        pending_count: pendingCount,
        request_id:   requestId,
      });
      cuotasChecked++;

      if (pendingCount === 0) continue; // todos ya pagaron

      // Recordatorio — fire-and-forget; dedup evita spam si el cron se ejecuta dos veces el mismo día
      void sendPaymentReminder({
        comunidad_id: comunidadId,
        cuota_nombre: cuota.nombre as string,
        monto:        cuota.monto as number,
        fecha_limite: cuota.fecha_limite as string,
        pending_count: pendingCount,
      });

      log.info('reminder_sent', {
        cuota_id:     cuotaDoc.id,
        cuota_nombre: cuota.nombre as string,
        comunidad_id: comunidadId,
        pending_count: pendingCount,
        request_id:   requestId,
      });
      remindersQueued++;
    }
  } catch (err) {
    log.error('cron_cuotas_reminder_failed', err, { request_id: requestId });
  }

  /* ── 4. Alerta agregada por comunidad con pagos overdue ─────────────────── */
  for (const [comunidadId, count] of Array.from(overduePerComunidad.entries())) {
    void sendSmartAlert({
      type:         'pending_payments',
      comunidad_id: comunidadId,
      metadata:     { count },
    });
  }

  /* ── 5. Respuesta ────────────────────────────────────────────────────────── */
  log.finish(true, 200);

  return NextResponse.json({
    ok: true,
    cuotas_checked:   cuotasChecked,
    overdue_marked:   overdueMarked,
    reminders_queued: remindersQueued,
    duration_ms:      Date.now() - runStart,
  });
}
