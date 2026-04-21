/**
 * GET /api/cron/pattern-scan
 *
 * Vercel Cron Job — proactive AI pattern detection across ALL communities.
 *
 * Schedule (vercel.json): daily at midnight — cron "0 0 * * *"
 * NOTE: Vercel Hobby plan only allows daily cron jobs (once per day max).
 * For higher frequency (e.g. every 6 hours), upgrade to Vercel Pro.
 *
 * Per community:
 *   1. Read open incidencias from the last 60 days
 *   2. Detect zone hotspot patterns (>= 3 incidencias in same zone)
 *   3. Persist results to ai_insights/{comunidadId} (merge: true)
 *   4. Send in-app + FCM push for NEW detections (anti-spam: 24h cooldown per zone)
 *
 * Safety contract:
 *   - One community failure never aborts the rest (isolated try/catch per community)
 *   - Returns 200 even if all communities fail (logs explain what happened)
 *   - Read-only on incidencias; only writes to ai_insights + notificaciones collections
 *
 * Limits:
 *   - MAX_COMUNIDADES: processes at most N communities per run (avoid Vercel timeout)
 *   - Vercel Pro maxDuration: 300s; Free: 60s (set accordingly)
 *
 * Security: Authorization: Bearer <CRON_SECRET>
 *   - In production Vercel injects this automatically for cron routes
 *   - In local dev: curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/pattern-scan
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb }                from '@/lib/firebase/admin';
import {
  detectPatterns,
  saveInsights,
  autoEscalarZonaCaliente,
  sendZonaCalienteNotifications,
} from '@/lib/ai/patternEngine';
import { createLogger } from '@/lib/logger';

export const runtime     = 'nodejs';
export const maxDuration = 60; // seconds — upgrade to 300 on Vercel Pro for large fleets

/** Max communities to process per cron execution */
const MAX_COMUNIDADES = 50;

// ── Types ────────────────────────────────────────────────────────────────────

interface ComunidadResult {
  comunidad_id:        string;
  patrones:            number;
  zonas_calientes:     string[];
  score_riesgo_global: number;
  escalated_total:     number;
  notif_sent:          string[];
  notif_skipped:       string[];
  duration_ms:         number;
  error?:              string;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const log = createLogger({ route: '/api/cron/pattern-scan', requestId });
  const runStart = Date.now();

  // ── 1. Auth guard ─────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error('cron_secret_missing', undefined, {
      hint: 'Add CRON_SECRET to Vercel Settings → Environment Variables',
    });
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization') ?? '';
  if (authHeader !== `Bearer ${secret}`) {
    log.warn('cron_pattern_scan_unauthorized', {
      ip: req.headers.get('x-forwarded-for') ?? 'unknown',
    });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  log.info('cron_pattern_scan_started', { max_comunidades: MAX_COMUNIDADES });

  // ── 2. Fetch all active communities ──────────────────────────────────────
  let comunidadIds: string[];
  try {
    const db   = getAdminDb();
    const snap = await db.collection('comunidades').limit(MAX_COMUNIDADES).get();
    comunidadIds = snap.docs.map(d => d.id);
  } catch (err) {
    log.error('cron_pattern_scan_fetch_comunidades_failed', err);
    return NextResponse.json({ error: 'Error fetching communities' }, { status: 200 });
  }

  log.info('cron_pattern_scan_comunidades_loaded', { count: comunidadIds.length });

  // ── 3. Process each community (isolated — one failure never stops others) ─
  const results: ComunidadResult[] = [];

  for (const comunidadId of comunidadIds) {
    const t0 = Date.now();

    try {
      // 3a. Detect patterns (never throws)
      const patternResult = await detectPatterns(comunidadId);

      // 3b. Persist insights (never throws)
      await saveInsights(comunidadId, patternResult);

      // 3c. Auto-escalate every zona_caliente to urgente (never throws)
      const escalationResults = await Promise.all(
        patternResult.patrones
          .filter(p => p.type === 'zona_caliente')
          .map(p => autoEscalarZonaCaliente(comunidadId, p.zona)),
      );
      const escalatedTotal = escalationResults.reduce((n, r) => n + r.escalated, 0);

      // 3d. Notify for newly detected zona_caliente (anti-spam built-in, never throws)
      const notifResult = await sendZonaCalienteNotifications(
        comunidadId,
        patternResult.patrones,
      );

      const result: ComunidadResult = {
        comunidad_id:        comunidadId,
        patrones:            patternResult.patrones.length,
        zonas_calientes:     patternResult.zonas_calientes,
        score_riesgo_global: patternResult.score_riesgo_global,
        escalated_total:     escalatedTotal,
        notif_sent:          notifResult.sent,
        notif_skipped:       notifResult.skipped,
        duration_ms:         Date.now() - t0,
      };

      results.push(result);

      // Structured log per community (one line each, parseable by Vercel Logs)
      if (patternResult.patrones.length > 0 || notifResult.sent.length > 0) {
        log.warn('pattern_detected', {
          comunidad_id:        comunidadId,
          patrones:            patternResult.patrones.length,
          zonas_calientes:     patternResult.zonas_calientes,
          score_riesgo_global: patternResult.score_riesgo_global,
          escalated_total:     escalatedTotal,
          notif_sent:          notifResult.sent,
          notif_skipped:       notifResult.skipped,
          duration_ms:         result.duration_ms,
        });
      } else {
        log.info('pattern_scan_ok', {
          comunidad_id: comunidadId,
          duration_ms:  result.duration_ms,
        });
      }
    } catch (err) {
      // Should never happen (all functions are fail-safe), but belt-and-suspenders
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error('pattern_scan_community_failed', err, { comunidad_id: comunidadId });
      results.push({
        comunidad_id:        comunidadId,
        patrones:            0,
        zonas_calientes:     [],
        score_riesgo_global: 0,
        escalated_total:     0,
        notif_sent:          [],
        notif_skipped:       [],
        duration_ms:         Date.now() - t0,
        error:               errorMsg,
      });
    }
  }

  // ── 4. Summary ────────────────────────────────────────────────────────────
  const totalPatrones   = results.reduce((n, r) => n + r.patrones, 0);
  const totalEscalated  = results.reduce((n, r) => n + r.escalated_total, 0);
  const totalNotifSent  = results.reduce((n, r) => n + r.notif_sent.length, 0);
  const totalErrors     = results.filter(r => r.error).length;
  const totalDuration   = Date.now() - runStart;

  log.finish(true, 200);

  return NextResponse.json({
    ok:              true,
    processed:       comunidadIds.length,
    patrones:        totalPatrones,
    escalated_total: totalEscalated,
    notif_sent:      totalNotifSent,
    errors:          totalErrors,
    duration_ms:     totalDuration,
    results,
  });
}
