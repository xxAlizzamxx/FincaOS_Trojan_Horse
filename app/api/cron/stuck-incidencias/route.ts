/**
 * GET /api/cron/stuck-incidencias
 *
 * Vercel Cron Job — detects incidents that have been in "en_ejecucion" state
 * for more than dias_alerta_estancada days without any update, and notifies
 * the community admin.
 *
 * Schedule (vercel.json): daily at 08:10 — cron "10 8 * * *"
 * NOTE: Vercel Hobby plan only allows one execution per day per cron.
 *
 * Per-community config (comunidades/{id}.config):
 *   dias_alerta_estancada  — override the default 5-day threshold per community.
 *   Missing field → falls back to DEFAULT_STUCK_DAYS (5).
 *
 * Logic:
 *   1. Fetch ALL incidencias where estado == "en_ejecucion"
 *   2. Group by comunidad_id, load each community's config in parallel
 *   3. Filter per community: updated_at older than its configured threshold
 *   4. Skip incidencias that already have alerta_estancada_enviada == true
 *   5. For each genuinely stuck incidencia:
 *      a. Write notification to comunidades/{id}/notificaciones
 *      b. Set alerta_estancada_enviada: true (idempotency flag)
 *   6. Return full summary — always 200, never throws
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

// ── System-wide defaults ──────────────────────────────────────────────────────

/** Default days in en_ejecucion before a stuck alert fires (overridable per community) */
const DEFAULT_STUCK_DAYS = 5;

/** Safety cap — never process more than this per run to stay within Vercel timeout */
const MAX_INCIDENCIAS = 200;

// ── Types ─────────────────────────────────────────────────────────────────────

interface StuckResult {
  incidencia_id:  string;
  comunidad_id:   string;
  titulo:         string;
  days_stuck:     number;
  threshold_days: number;
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
  if (typeof (raw as any).toMillis === 'function') return (raw as any).toMillis() as number;
  if (typeof (raw as any)._seconds === 'number')   return (raw as any)._seconds * 1_000;
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

  log.info('stuck_incidencias_started', {
    default_stuck_days: DEFAULT_STUCK_DAYS,
    max:                MAX_INCIDENCIAS,
  });

  const db = getAdminDb();

  // ── 2. Fetch all "en_ejecucion" incidencias ───────────────────────────────
  let allDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  try {
    const snap = await db
      .collection('incidencias')
      .where('estado', '==', 'en_ejecucion')
      .limit(MAX_INCIDENCIAS)
      .get();
    allDocs = snap.docs;
  } catch (err) {
    log.error('stuck_incidencias_fetch_failed', err);
    return NextResponse.json({ ok: true, error: 'fetch failed', duration_ms: Date.now() - runStart });
  }

  log.info('stuck_incidencias_fetched', { total_en_ejecucion: allDocs.length });

  if (allDocs.length === 0) {
    log.finish(true, 200);
    return NextResponse.json({ ok: true, stuck_found: 0, notified: 0, skipped: 0, errors: 0, duration_ms: Date.now() - runStart });
  }

  // ── 3. Group by comunidad_id, load configs in parallel ───────────────────
  const comunidadIds = Array.from(
    new Set(allDocs.map(d => d.data().comunidad_id as string).filter(Boolean)),
  );

  // Load all community configs in a single parallel batch
  const configMap = new Map<string, number>(); // comunidad_id → stuckDays threshold
  try {
    const configSnaps = await Promise.all(
      comunidadIds.map(id => db.collection('comunidades').doc(id).get()),
    );
    configSnaps.forEach(snap => {
      if (!snap.exists) return;
      const cfg = (snap.data()?.config ?? {}) as Record<string, unknown>;
      const days = typeof cfg.dias_alerta_estancada === 'number'
        ? cfg.dias_alerta_estancada
        : DEFAULT_STUCK_DAYS;
      configMap.set(snap.id, days);
    });
  } catch (err) {
    // Non-fatal: fall back to default for all communities
    log.warn('stuck_incidencias_config_fetch_failed', { error: String(err) });
    comunidadIds.forEach(id => configMap.set(id, DEFAULT_STUCK_DAYS));
  }

  // ── 4. Filter per community using its own threshold ───────────────────────
  const now = Date.now();
  const stuck = allDocs.filter(doc => {
    const data        = doc.data();
    const comunidadId = data.comunidad_id as string | undefined;
    if (!comunidadId) return false;
    const stuckDays = configMap.get(comunidadId) ?? DEFAULT_STUCK_DAYS;
    const stuckMs   = stuckDays * 24 * 60 * 60 * 1_000;
    const updatedMs = resolveUpdatedAt(data.updated_at);
    return (now - updatedMs) > stuckMs;
  });

  log.info('stuck_incidencias_filtered', {
    total_en_ejecucion: allDocs.length,
    stuck_count:        stuck.length,
  });

  if (stuck.length === 0) {
    log.finish(true, 200);
    return NextResponse.json({ ok: true, stuck_found: 0, notified: 0, skipped: 0, errors: 0, duration_ms: Date.now() - runStart });
  }

  // ── 5. Process each stuck incidencia (isolated — one failure never aborts) ─
  const results: StuckResult[] = [];

  for (const incDoc of stuck) {
    const data        = incDoc.data();
    const incId       = incDoc.id;
    const comunidadId = data.comunidad_id as string;
    const titulo      = String(data.titulo ?? 'Incidencia sin título');
    const stuckDays   = configMap.get(comunidadId) ?? DEFAULT_STUCK_DAYS;
    const daysStuck   = Math.floor((now - resolveUpdatedAt(data.updated_at)) / 86_400_000);

    console.log(`[AI] Incidencia estancada: "${titulo}" | id: ${incId} | días sin avance: ${daysStuck}/${stuckDays}`);

    // ── 5a. Skip if already alerted (idempotency) ────────────────────────
    if (data.alerta_estancada_enviada === true) {
      console.log(`[AI] Incidencia ${incId} ya notificada — saltando`);
      results.push({
        incidencia_id:  incId,
        comunidad_id:   comunidadId,
        titulo,
        days_stuck:     daysStuck,
        threshold_days: stuckDays,
        action:         'skipped_already_alerted',
      });
      continue;
    }

    try {
      // ── 5b. Write community notification ─────────────────────────────────
      await db
        .collection('comunidades').doc(comunidadId)
        .collection('notificaciones').add({
          tipo:          'incidencia_estancada',
          titulo:        '🔧 Esta reparación lleva días sin avance',
          mensaje:       `"${titulo}" lleva ${daysStuck} día${daysStuck !== 1 ? 's' : ''} sin actualizaciones. Puede que el proveedor necesite un empujón o que haya surgido algún problema. Te recomiendo revisar el estado.`,
          incidencia_id: incId,
          created_at:    FieldValue.serverTimestamp(),
          created_by:    'sistema_ia',
          link:          `/incidencias/${incId}`,
        });

      // ── 5c. Set idempotency flag — never fires again for this incidencia ──
      // NOTE: updating updated_at here would reset the daysStuck counter.
      //       We use a dedicated flag field instead.
      await db.collection('incidencias').doc(incId).update({
        alerta_estancada_enviada: true,
      });

      results.push({
        incidencia_id:  incId,
        comunidad_id:   comunidadId,
        titulo,
        days_stuck:     daysStuck,
        threshold_days: stuckDays,
        action:         'notified',
      });

      log.info('stuck_incidencia_notified', {
        incidencia_id:  incId,
        comunidad_id:   comunidadId,
        days_stuck:     daysStuck,
        threshold_days: stuckDays,
        titulo,
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('stuck_incidencia_processing_failed', err, { incidencia_id: incId, comunidad_id: comunidadId });
      results.push({
        incidencia_id:  incId,
        comunidad_id:   comunidadId,
        titulo,
        days_stuck:     daysStuck,
        threshold_days: stuckDays,
        action:         'error',
        error:          msg,
      });
    }
  }

  // ── 6. Summary ────────────────────────────────────────────────────────────
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
