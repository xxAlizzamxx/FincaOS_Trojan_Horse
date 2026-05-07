/**
 * GET /api/cron/cuotas
 *
 * Vercel Cron Job — smart multi-stage payment reminders + overdue marking.
 *
 * Schedule (vercel.json): daily at 08:00 — cron "0 8 * * *"
 *
 * ── Reminder stages ──────────────────────────────────────────────────────────
 *
 *  Stage       | Window            | Tone
 *  ------------|-------------------|-------------------------------------------
 *  t7          | T-7 days  (±1 d)  | Friendly heads-up, 7 days to go
 *  t3          | T-3 days  (±1 d)  | Warning, 3 days to go
 *  t0          | T day     (±1 d)  | Urgent notice, due today
 *  t7_overdue  | T+7 days  (±1 d)  | Admin mora alert, 7 days past due
 *
 * ── Idempotency ──────────────────────────────────────────────────────────────
 *
 * Each stage writes `reminders_sent.{stage}: ISO timestamp` on the cuota doc.
 * If the field is already set, the stage is silently skipped — re-running the
 * cron on the same day (Vercel retry / manual trigger) is always safe.
 *
 * ── Overdue marking ──────────────────────────────────────────────────────────
 *
 * Unchanged from v1: any pago with estado == 'pendiente' whose cuota has
 * fecha_limite < now is batch-updated to estado == 'overdue'.
 *
 * ── Notifications ────────────────────────────────────────────────────────────
 *
 * Each stage fires two side-effects (both fire-and-forget, non-fatal):
 *   1. Email to all admins/presidentes via sendStagedPaymentReminder
 *   2. Firestore notification in comunidades/{id}/notificaciones
 *
 * ── Safety contract ──────────────────────────────────────────────────────────
 * - Never throws — all errors are caught and logged
 * - Always returns { ok: true }
 * - One cuota failure never aborts the rest
 * - Does NOT modify estado or other business fields on cuotas
 *
 * Security: Authorization: Bearer <CRON_SECRET>
 * Vercel injects this automatically for scheduled cron routes.
 * For local dev: curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/cuotas
 */

import { NextRequest, NextResponse } from 'next/server';
import { WriteBatch }                from 'firebase-admin/firestore';
import { getAdminDb }               from '@/lib/firebase/admin';
import { sendStagedPaymentReminder } from '@/lib/email';
import { sendSmartAlert }            from '@/lib/email';
import { createLogger }              from '@/lib/logger';
import type { ReminderStage }        from '@/types/database';

export const runtime     = 'nodejs';
export const maxDuration = 60;

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_CUOTAS = 200;
const DAY_MS     = 24 * 60 * 60 * 1_000;

/**
 * Stage windows: each stage fires when fecha_limite falls within ±1 day of
 * the target offset.  The ±1 day buffer absorbs cron timing drift and ensures
 * a cuota is never silently skipped if the job runs a few hours late.
 *
 * Non-overlapping:  T+6..T+8  |  T+2..T+4  |  T-1..T+1  |  (past, via overdue query)
 */
const STAGE_WINDOWS: Array<{ stage: ReminderStage; minDays: number; maxDays: number }> = [
  { stage: 't7', minDays: 6, maxDays: 8 },   // fecha_limite ∈ [now+6d, now+8d]
  { stage: 't3', minDays: 2, maxDays: 4 },   // fecha_limite ∈ [now+2d, now+4d]
  { stage: 't0', minDays: -1, maxDays: 1 },  // fecha_limite ∈ [now-1d, now+1d]
];

// T+7 overdue alert fires for cuotas that expired 6–8 days ago
const T7_OVERDUE_MIN_DAYS_AGO = 6;
const T7_OVERDUE_MAX_DAYS_AGO = 8;

// ── Types ─────────────────────────────────────────────────────────────────────

interface StageResult {
  cuota_id:     string;
  cuota_nombre: string;
  comunidad_id: string;
  stage:        ReminderStage;
  action:       'sent' | 'skipped_already_sent' | 'skipped_no_pending' | 'error';
  error?:       string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns which stage (if any) applies to a cuota given its fecha_limite.
 * Returns null if the cuota does not fall into any active window.
 */
function resolveStage(fechaLimite: string, now: Date): ReminderStage | null {
  const limitMs   = Date.parse(fechaLimite);
  if (isNaN(limitMs)) return null;
  const daysUntil = (limitMs - now.getTime()) / DAY_MS; // positive = future, negative = past

  for (const { stage, minDays, maxDays } of STAGE_WINDOWS) {
    if (daysUntil >= minDays && daysUntil <= maxDays) return stage;
  }

  // T+7 overdue: limit is 6–8 days in the past
  const daysAgo = -daysUntil;
  if (daysAgo >= T7_OVERDUE_MIN_DAYS_AGO && daysAgo <= T7_OVERDUE_MAX_DAYS_AGO) {
    return 't7_overdue';
  }

  return null;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const log       = createLogger({ route: '/api/cron/cuotas', requestId });
  const runStart  = Date.now();

  // ── 1. Auth ──────────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error('cron_secret_missing', undefined, {});
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const authHeader = req.headers.get('authorization') ?? '';
  if (authHeader !== `Bearer ${secret}`) {
    log.warn('cron_cuotas_unauthorized', {
      ip: req.headers.get('x-forwarded-for') ?? 'unknown',
    });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db  = getAdminDb();
  const now = new Date();
  const nowIso = now.toISOString();

  // Query boundaries (generous ±1 day buffer on each side of our widest window)
  const inMaxDays  = new Date(now.getTime() + (STAGE_WINDOWS[0].maxDays + 1) * DAY_MS).toISOString(); // now+9d
  const pastMaxDays = new Date(now.getTime() - (T7_OVERDUE_MAX_DAYS_AGO + 1) * DAY_MS).toISOString(); // now-9d

  log.info('cron_cuotas_started', { now: nowIso, query_from: pastMaxDays, query_to: inMaxDays });

  let overdueMarked   = 0;
  let cuotasChecked   = 0;
  const stageResults: StageResult[] = [];

  // comunidad_id → count of newly-overdue pagos (for aggregate email alert)
  const overduePerComunidad = new Map<string, number>();

  // ── 2. Overdue marking: fecha_limite < now → pendiente pagos → overdue ────
  //    Also checks the T+7 overdue stage inside the same loop.
  try {
    const vencidasSnap = await db
      .collection('cuotas')
      .where('fecha_limite', '<', nowIso)
      .limit(MAX_CUOTAS)
      .get();

    for (const cuotaDoc of vencidasSnap.docs) {
      const cuota       = cuotaDoc.data();
      const comunidadId = cuota.comunidad_id as string;
      const cuotaNombre = cuota.nombre as string;

      // ── 2a. Batch-update 'pendiente' pagos → 'overdue' ───────────────────
      try {
        const pendientesSnap = await db
          .collection('cuotas').doc(cuotaDoc.id)
          .collection('pagos')
          .where('estado', '==', 'pendiente')
          .get();

        if (!pendientesSnap.empty) {
          const chunks: typeof pendientesSnap.docs[] = [];
          for (let i = 0; i < pendientesSnap.docs.length; i += 500) {
            chunks.push(pendientesSnap.docs.slice(i, i + 500));
          }
          for (const chunk of chunks) {
            const batch: WriteBatch = db.batch();
            chunk.forEach(pagoDoc =>
              batch.update(pagoDoc.ref, { estado: 'overdue', overdue_at: nowIso }),
            );
            await batch.commit();
          }

          const count = pendientesSnap.size;
          overdueMarked += count;
          overduePerComunidad.set(comunidadId, (overduePerComunidad.get(comunidadId) ?? 0) + count);
          log.info('overdue_marked', {
            cuota_id: cuotaDoc.id, cuota_nombre: cuotaNombre, comunidad_id: comunidadId, count,
          });
        }
      } catch (err) {
        log.error('cron_cuotas_overdue_pagos_failed', err, {
          cuota_id: cuotaDoc.id, comunidad_id: comunidadId,
        });
      }

      // ── 2b. T+7 overdue stage — one-time admin alert 7 days after due ────
      const stage = resolveStage(cuota.fecha_limite as string, now);
      if (stage === 't7_overdue') {
        const result = await processStage({
          db, cuotaDoc, cuota, comunidadId, cuotaNombre, stage, now: nowIso, log,
        });
        stageResults.push(result);
      }

      log.info('cuota_checked', {
        cuota_id: cuotaDoc.id, tipo: 'vencida', comunidad_id: comunidadId,
      });
      cuotasChecked++;
    }
  } catch (err) {
    log.error('cron_cuotas_overdue_query_failed', err, {});
  }

  // ── 3. Aggregate overdue email alert per community ────────────────────────
  for (const [comunidadId, count] of Array.from(overduePerComunidad.entries())) {
    void sendSmartAlert({
      type:         'pending_payments',
      comunidad_id: comunidadId,
      metadata:     { count },
    });
  }

  // ── 4. Upcoming reminders: covers T-7, T-3 and T-0 stages ────────────────
  //    Single query spanning the full window (now-1d → now+9d) so we catch all
  //    stages in one round-trip.  Stage determination happens per-cuota via
  //    resolveStage().
  try {
    const upcomingSnap = await db
      .collection('cuotas')
      .where('fecha_limite', '>=', new Date(now.getTime() - DAY_MS).toISOString()) // now-1d
      .where('fecha_limite', '<=', inMaxDays)                                       // now+9d
      .limit(MAX_CUOTAS)
      .get();

    for (const cuotaDoc of upcomingSnap.docs) {
      const cuota       = cuotaDoc.data();
      const comunidadId = cuota.comunidad_id as string;
      const cuotaNombre = cuota.nombre as string;
      const stage       = resolveStage(cuota.fecha_limite as string, now);

      log.info('cuota_checked', {
        cuota_id: cuotaDoc.id, tipo: 'proxima', comunidad_id: comunidadId, stage: stage ?? 'none',
      });
      cuotasChecked++;

      if (!stage || stage === 't7_overdue') continue; // not in a reminder window

      const result = await processStage({
        db, cuotaDoc, cuota, comunidadId, cuotaNombre, stage, now: nowIso, log,
      });
      stageResults.push(result);
    }
  } catch (err) {
    log.error('cron_cuotas_upcoming_query_failed', err, {});
  }

  // ── 5. Summary ────────────────────────────────────────────────────────────
  const stageSummary = stageResults.reduce(
    (acc, r) => {
      acc[r.action] = (acc[r.action] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  log.info('cron_cuotas_summary', {
    cuotas_checked:  cuotasChecked,
    overdue_marked:  overdueMarked,
    reminders_total: stageResults.length,
    ...stageSummary,
    duration_ms: Date.now() - runStart,
  });

  log.finish(true, 200);

  return NextResponse.json({
    ok:              true,
    cuotas_checked:  cuotasChecked,
    overdue_marked:  overdueMarked,
    reminders_sent:  stageResults.filter(r => r.action === 'sent').length,
    reminders_skipped: stageResults.filter(r => r.action.startsWith('skipped')).length,
    errors:          stageResults.filter(r => r.action === 'error').length,
    duration_ms:     Date.now() - runStart,
  });
}

// ── processStage — isolated helper (one failure never aborts the loop) ────────

async function processStage({
  db,
  cuotaDoc,
  cuota,
  comunidadId,
  cuotaNombre,
  stage,
  now,
  log,
}: {
  db:           FirebaseFirestore.Firestore;
  cuotaDoc:     FirebaseFirestore.QueryDocumentSnapshot;
  cuota:        FirebaseFirestore.DocumentData;
  comunidadId:  string;
  cuotaNombre:  string;
  stage:        ReminderStage;
  now:          string;           // ISO string of run time
  log:          ReturnType<typeof import('@/lib/logger').createLogger>;
}): Promise<StageResult> {
  try {
    // ── Idempotency: skip if this stage was already sent ─────────────────
    const remindersSent = (cuota.reminders_sent ?? {}) as Record<string, string>;
    if (remindersSent[stage]) {
      log.info('reminder_stage_skipped', {
        cuota_id: cuotaDoc.id, cuota_nombre: cuotaNombre, comunidad_id: comunidadId,
        stage, sent_at: remindersSent[stage],
      });
      return {
        cuota_id: cuotaDoc.id, cuota_nombre: cuotaNombre,
        comunidad_id: comunidadId, stage, action: 'skipped_already_sent',
      };
    }

    // ── Count pending pagos — skip if everyone already paid ──────────────
    const pendientesSnap = await db
      .collection('cuotas').doc(cuotaDoc.id)
      .collection('pagos')
      .where('estado', 'in', ['pendiente', 'overdue'])
      .get();

    const pendingCount = pendientesSnap.size;

    if (pendingCount === 0) {
      log.info('reminder_stage_no_pending', {
        cuota_id: cuotaDoc.id, cuota_nombre: cuotaNombre, comunidad_id: comunidadId, stage,
      });
      return {
        cuota_id: cuotaDoc.id, cuota_nombre: cuotaNombre,
        comunidad_id: comunidadId, stage, action: 'skipped_no_pending',
      };
    }

    // ── 1. Send email (fire-and-forget) ───────────────────────────────────
    void sendStagedPaymentReminder({
      comunidad_id: comunidadId,
      cuota_nombre: cuotaNombre,
      monto:        cuota.monto as number,
      fecha_limite: cuota.fecha_limite as string,
      pending_count: pendingCount,
      stage,
    });

    // ── 2. Write Firestore notification ───────────────────────────────────
    const { titulo, mensaje } = buildNotificationText(stage, cuotaNombre, pendingCount);
    try {
      await db
        .collection('comunidades').doc(comunidadId)
        .collection('notificaciones').add({
          tipo:         'cuota_recordatorio',
          stage,
          titulo,
          mensaje,
          cuota_id:     cuotaDoc.id,
          created_at:   now,
          created_by:   'sistema',
          link:         '/cuotas',
        });
    } catch (notifErr) {
      // Non-fatal — email was already dispatched
      log.error('reminder_notification_write_failed', notifErr, {
        cuota_id: cuotaDoc.id, comunidad_id: comunidadId, stage,
      });
    }

    // ── 3. Mark stage as sent (idempotency flag) ───────────────────────────
    try {
      await cuotaDoc.ref.update({
        [`reminders_sent.${stage}`]: now,
      });
    } catch (flagErr) {
      // Non-fatal — worst case we send a duplicate on next run
      log.error('reminder_flag_write_failed', flagErr, {
        cuota_id: cuotaDoc.id, comunidad_id: comunidadId, stage,
      });
    }

    log.info('reminder_stage_sent', {
      cuota_id:     cuotaDoc.id,
      cuota_nombre: cuotaNombre,
      comunidad_id: comunidadId,
      stage,
      pending_count: pendingCount,
    });

    return {
      cuota_id: cuotaDoc.id, cuota_nombre: cuotaNombre,
      comunidad_id: comunidadId, stage, action: 'sent',
    };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('reminder_stage_failed', err, {
      cuota_id: cuotaDoc.id, cuota_nombre: cuotaNombre, comunidad_id: comunidadId, stage,
    });
    return {
      cuota_id: cuotaDoc.id, cuota_nombre: cuotaNombre,
      comunidad_id: comunidadId, stage, action: 'error', error: msg,
    };
  }
}

// ── Notification text per stage ───────────────────────────────────────────────

function buildNotificationText(
  stage:        ReminderStage,
  cuotaNombre:  string,
  pendingCount: number,
): { titulo: string; mensaje: string } {
  const plural = pendingCount !== 1;
  switch (stage) {
    case 't7':
      return {
        titulo:  `📅 Cuota "${cuotaNombre}" vence en 7 días`,
        mensaje: `${pendingCount} vecino${plural ? 's' : ''} todavía ${plural ? 'tienen' : 'tiene'} el pago pendiente. Aún hay tiempo — avísales para que no se les pase.`,
      };
    case 't3':
      return {
        titulo:  `⚠️ Cuota "${cuotaNombre}" — quedan 3 días`,
        mensaje: `${pendingCount} vecino${plural ? 's' : ''} aún no ha${plural ? 'n' : ''} pagado y el plazo se acerca. Un recordatorio directo ahora suele funcionar bien.`,
      };
    case 't0':
      return {
        titulo:  `🚨 Cuota "${cuotaNombre}" vence HOY`,
        mensaje: `Hoy es el último día para pagar "${cuotaNombre}". ${pendingCount} pago${plural ? 's' : ''} siguen pendientes — los que no paguen pasarán a mora esta noche.`,
      };
    case 't7_overdue':
      return {
        titulo:  `💰 "${cuotaNombre}" — 7 días sin pago`,
        mensaje: `${pendingCount} vecino${plural ? 's' : ''} lleva${plural ? 'n' : ''} una semana en mora. Es un buen momento para ponerse en contacto directamente antes de que se complique más.`,
      };
  }
}
