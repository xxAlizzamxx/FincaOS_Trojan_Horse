/**
 * GET /api/ai/pattern-engine?comunidadId=XXX
 *
 * On-demand pattern analysis for a single community.
 *
 * What it does:
 *   1. Authenticates the caller via Firebase ID token
 *   2. Runs the pattern detection engine (zone + category hotspot detection)
 *   3. Persists results to ai_insights/{comunidadId} (merge: true)
 *   4. Sends community notifications + email if new patterns are found
 *      (1-hour cooldown per pattern — shorter than the 24h cron cooldown)
 *   5. Returns the analysis result
 *
 * Response shape:
 *   {
 *     patrones: PatronDetectado[],
 *     zonas_calientes: string[],
 *     generado_at: ISO string
 *   }
 *
 * Safety contract:
 *   - ALWAYS returns { patrones: [], zonas_calientes: [], generado_at } on any failure
 *   - Never returns 5xx from the AI layer itself
 *   - Rate-limited: 10 req / 60 s per IP
 */

import { NextRequest, NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { detectPatterns, saveInsights, sendZonaCalienteNotifications } from '@/lib/ai/patternEngine';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { createLogger } from '@/lib/logger';

/** Cooldown for on-demand manual scans (1 h) — shorter than the cron's 24 h */
const MANUAL_NOTIF_COOLDOWN_MS = 60 * 60 * 1_000;

// ── Firebase Admin bootstrap (idempotent guard) ──────────────────────────────
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const log = createLogger({ route: '/api/ai/pattern-engine', requestId });
  const generado_at = new Date().toISOString();

  // ── 1. Rate limit: 10 req / 60 s per IP ──────────────────────────────────
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = await checkRateLimit(`ai-pattern:${ip}`, 10, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl);

  // ── 2. Auth ───────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  try {
    await getAuth().verifyIdToken(authHeader.slice(7));
  } catch {
    return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
  }

  // ── 3. Validate comunidadId ───────────────────────────────────────────────
  const comunidadId = req.nextUrl.searchParams.get('comunidadId')?.trim() ?? '';
  if (!comunidadId) {
    return NextResponse.json(
      { patrones: [], zonas_calientes: [], generado_at },
      { status: 200 },
    );
  }

  // ── 4. Detect patterns ────────────────────────────────────────────────────
  log.info('pattern_engine_start', { comunidad_id: comunidadId });

  const result = await detectPatterns(comunidadId);

  log.info('pattern_engine_done', {
    comunidad_id:    comunidadId,
    total_patrones:  result.patrones.length,
    zonas_calientes: result.zonas_calientes,
  });

  // ── 5. Persist (fire-and-forget — result already computed) ────────────────
  void saveInsights(comunidadId, result);

  // ── 6. Send notifications for new patterns (fire-and-forget) ─────────────
  // Uses a 1-hour cooldown (vs 24 h for the cron) so on-demand scans
  // reliably notify all users and send email without hourly spam.
  if (result.patrones.length > 0) {
    void sendZonaCalienteNotifications(comunidadId, result.patrones, MANUAL_NOTIF_COOLDOWN_MS);
  }

  // ── 7. Return ─────────────────────────────────────────────────────────────
  return NextResponse.json(result);
}
