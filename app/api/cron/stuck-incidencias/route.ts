/**
 * GET /api/cron/stuck-incidencias
 *
 * Vercel Cron Job — detects incidents that have been in "en_ejecucion" state
 * for more than STUCK_DAYS without any update, and notifies the community admin.
 *
 * Schedule (vercel.json): daily at 08:10 — cron "10 8 * * *"
 * NOTE: Vercel Hobby plan only allows one execution per day per cron.
 *
 * Logic:
 *   1. Fetch ALL incidencias where estado == "en_ejecucion"
 *      (cross-community — admin query via Admin SDK)
 *   2. Filter in JS: updated_at older than STUCK_DAYS
 *   3. Skip any incidencia that already has alerta_estancada_enviada == true
 *   4. For each genuinely stuck incidencia:
 *      a. Write notification to comunidades/{id}/notificaciones
 *      b. Set alerta_estancada_enviada: true on the incidencia (idempotency flag)
 *   5. Return a full summary — always 200, never throws
 *
 * Safety contract:
 *   - One incidencia failure never aborts the rest (isolated try/catch per doc)
 *   - Always returns { ok: true }
 *   - Never modifies estado or any business field on incidencias
 *
 * Security: Authorization: Bearer <CRON_SECRET>
 *   Vercel injects this automatically for scheduled cron routes.
 *   For local dev: curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/stuck-incidencias
 */

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue }                from 'firebase-admin/firestore';
import { getAdminDb }                from '@/lib/firebase/admin';
import { createLogger }              from '@/lib/logger';

export const runtime     = 'nodejs';
export const maxDuration = 60; // upgrade to 300 on Vercel Pro for large fleets

// ── Configuration ─────────────────────────────────────────────────────────────

/** Incidencias stuck for this many days trigger an alert */
const STUCK_DAYS = 5;

/** Safety cap — never process more than this per run to stay within Vercel timeout */
const MAX_INCIDENCIAS = 200;

const STUCK_MS = STUCK_DAYS * 24 * 60 * 60 * 1_000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface StuckResult {
  incidencia_id:  string;
  comunidad_id:   string;
  titulo:         string;
  days_stuck:     number;
  action:         'notified' | 'skipped_already_alerted' | 'error';
  error?:         string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalises updated_at to a JS timestamp regardless of storage format:
 *   - Firestore Timestamp object  → .toMillis()
 *   - ISO string / numeric string → Date.parse()
 *   - Plain number (ms)           → as-is
 * Returns 0 (i.e. "very old") if the field is missing or unparseable.
 */
function resolveUpdatedAt(raw: unknown): number {
  if (!raw) return 0;

  // Firestore Admin Timestamp (has toMillis())
  if (typeof (raw as any).toMillis === 'function') {
    return (raw as any).toMillis() as number;
  }

  // Firestore Timestamp-like with _seconds (serialized form)
  if (typeof (raw as any)._seconds === 'number') {
    return (raw as any)._seconds * 1_000;
  }

  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const ms = Date.parse(raw);
    return isNaN(ms) ? 0 : ms;
  }

  return 0;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const log       = createLogger({ route: '/api/cron/stuck-incidencias', requestId });
  const runStart  = Date.now();

  // ── 1. Auth guard ────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error('cron_secret_missing', undefined, {
      hint: 'Add CRON_SECRET to Vercel Settings → Environment Variables',
    });
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization') ?? '';
  if (authHeader !== `Bearer ${secret}`) {
    log.warn('stuck_incidencias_unauthorized', {
      ip: req.headers.get('x-forwarded-for') ?? 'unknown',
    });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  log.info('stuck_incidencias_started', { stuck_days: STUCK_DAYS, max: MAX_INCIDENCIAS });

  // ── 2. Fetch all "en_ejecucion" incidencias ───────────────────────────────
  let incidencias: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  try {
    const db   = getAdminDb();
    const snap = await db
      .collection('incidencias')
      .where('estado', '==', 'en_ejecucion')
      .limit(MAX_INCIDENCIAS)
      .get();

    incidencias = snap.docs;
  } catch (err) {
    log.error('stuck_incidencias_fetch_failed', err);
    // Still return 200 — Vercel must not retry indefinitely
    return NextResponse.json({ ok: true, error: 'fetch failed', duration_ms: Date.now() - runStart });
  }

  log.info('stuck_incidencias_fetched', { total_en_ejecucion: incidencias.length });

  // ── 3. Filter in JS: older than STUCK_DAYS ───────────────────────────────
  const now     = Date.now();
  const stuck   = incidencias.filter(doc => {
    const data      = doc.data();
    const updatedMs = resolveUpdatedAt(data.updated_at);
    return (now - updatedMs) > STUCK_MS;
  });

  log.info('stuck_incidencias_filtered', {
    total_en_ejecucion: incidencias.length,
    stuck_count:        stuck.length,
    stuck_threshold_days: STUCK_DAYS,
  });

  if (stuck.length === 0) {
    log.finish(true, 200);
    return NextResponse.json({
      ok:          true,
      stuck_found: 0,
      notified:    0,
      skipped:     0,
      errors:      0,
      duration_ms: Date.now() - runStart,
    });
  }

  // ── 4. Process each stuck incidencia (isolated — one failure never aborts) ─
  const db      = getAdminDb();
  const results: StuckResult[] = [];

  for (const incDoc of stuck) {
    const data        = incDoc.data();
    const incId       = incDoc.id;
    const comunidadId = data.comunidad_id as string | undefined;
    const titulo      = String(data.titulo ?? 'Incidencia sin título');

    // ── 4a. Skip if already alerted (idempotency) ──────────────────────────
    if (data.alerta_estancada_enviada === true) {
      results.push({
        incidencia_id: incId,
        comunidad_id:  comunidadId ?? '',
        titulo,
        days_stuck:    Math.floor((now - resolveUpdatedAt(data.updated_at)) / 86_400_000),
        action:        'skipped_already_alerted',
      });
      continue;
    }

    if (!comunidadId) {
      log.warn('stuck_incidencia_missing_comunidad', { incidencia_id: incId });
      continue;
    }

    const daysStuck = Math.floor((now - resolveUpdatedAt(data.updated_at)) / 86_400_000);

    try {
      // ── 4b. Write community notification ─────────────────────────────────
      await db
        .collection('comunidades').doc(comunidadId)
        .collection('notificaciones').add({
          tipo:          'incidencia_estancada',
          titulo:        '⚠️ Incidencia sin avance',
          mensaje:       `"${titulo}" lleva ${daysStuck} días sin avance y requiere revisión.`,
          incidencia_id: incId,
          created_at:    FieldValue.serverTimestamp(),
          created_by:    'sistema_ia',
          link:          `/incidencias/${incId}`,
        });

      // ── 4c. Set idempotency flag on the incidencia ────────────────────────
      await db.collection('incidencias').doc(incId).update({
        alerta_estancada_enviada: true,
        updated_at:               FieldValue.serverTimestamp(),
      });

      results.push({
        incidencia_id: incId,
        comunidad_id:  comunidadId,
        titulo,
        days_stuck:    daysStuck,
        action:        'notified',
      });

      log.info('stuck_incidencia_notified', {
        incidencia_id: incId,
        comunidad_id:  comunidadId,
        days_stuck:    daysStuck,
        titulo,
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('stuck_incidencia_processing_failed', err, {
        incidencia_id: incId,
        comunidad_id:  comunidadId,
      });
      results.push({
        incidencia_id: incId,
        comunidad_id:  comunidadId,
        titulo,
        days_stuck:    daysStuck,
        action:        'error',
        error:         msg,
      });
    }
  }

  // ── 5. Summary ────────────────────────────────────────────────────────────
  const notified = results.filter(r => r.action === 'notified').length;
  const skipped  = results.filter(r => r.action === 'skipped_already_alerted').length;
  const errors   = results.filter(r => r.action === 'error').length;

  log.info('stuck_incidencias_summary', {
    stuck_found: stuck.length,
    notified,
    skipped,
    errors,
    duration_ms: Date.now() - runStart,
  });

  log.finish(true, 200);

  return NextResponse.json({
    ok:          true,
    stuck_found: stuck.length,
    notified,
    skipped,
    errors,
    duration_ms: Date.now() - runStart,
    results,
  });
}
