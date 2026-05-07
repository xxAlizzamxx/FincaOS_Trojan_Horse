/**
 * GET /api/cron/cleanup
 *
 * Vercel Cron Job — limpieza automática de colecciones Firestore.
 *
 * Colecciones limpiadas:
 *  1. _rate_limits    → docs con expires_at < ahora  (TTL manual)
 *  2. notificaciones  → docs con created_at < hace 90 días
 *
 * Seguridad:
 *  - Requiere header: Authorization: Bearer <CRON_SECRET>
 *  - CRON_SECRET debe configurarse en Vercel dashboard → Settings → Environment Variables
 *  - Vercel pasa este header automáticamente a los cron jobs en producción.
 *
 * Límites por ejecución:
 *  - Máximo MAX_DOCS_PER_COLLECTION docs por colección (evita timeout).
 *  - Si hay más docs expirados de los que caben, el siguiente ciclo del cron
 *    los elimina (convergencia garantizada en pocos ciclos).
 *
 * Idempotente: ejecutar dos veces el mismo instante es seguro.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp }                 from 'firebase-admin/firestore';
import { cleanupCollection }         from '@/lib/cleanup';
import { createLogger }              from '@/lib/logger';

export const runtime    = 'nodejs';
export const maxDuration = 60; // segundos — ajusta a 300 en Vercel Pro si es necesario

/** Máximo de docs a eliminar por colección en cada ejecución del cron. */
const MAX_DOCS_PER_COLLECTION = 500;

/** 90 días en milisegundos */
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1_000;

/* ── Handler ──────────────────────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const log = createLogger({ route: '/api/cron/cleanup', requestId });

  /* ── 1. Auth guard ──────────────────────────────────────────────────────
     CRON_SECRET: debe configurarse en Vercel dashboard.
     Vercel lo inyecta automáticamente como Bearer token en producción.
  ──────────────────────────────────────────────────────────────────────── */
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error('cron_secret_missing', undefined, {
      hint: 'Añade CRON_SECRET en Vercel → Settings → Environment Variables',
    });
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization') ?? '';
  if (authHeader !== `Bearer ${secret}`) {
    log.warn('cron_unauthorized', {
      ip: req.headers.get('x-forwarded-for') ?? 'unknown',
    });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  log.info('cron_cleanup_started', { max_per_collection: MAX_DOCS_PER_COLLECTION });
  const runStart = Date.now();

  /* ── 2. Cleanup _rate_limits ──────────────────────────────────────────
     Campo expires_at = Firestore Timestamp.
     Borra docs cuyo expires_at ya pasó (ventana expirada).
  ──────────────────────────────────────────────────────────────────────── */
  let rateLimitsDeleted = 0;
  try {
    const result = await cleanupCollection({
      collectionPath: '_rate_limits',
      field:          'expires_at',
      operator:       '<',
      value:          Timestamp.now(),
      maxDocs:        MAX_DOCS_PER_COLLECTION,
    });
    rateLimitsDeleted = result.deleted;
    log.info('cron_cleanup_rate_limits_done', {
      deleted:     result.deleted,
      duration_ms: result.durationMs,
    });
  } catch (err) {
    // No abortar — continuar con la siguiente colección
    log.error('cron_cleanup_rate_limits_failed', err);
  }

  /* ── 3. Cleanup notificaciones ────────────────────────────────────────
     Campo created_at = ISO string (e.g. "2024-01-15T10:30:00.000Z").
     Borra docs con más de 90 días de antigüedad.
     La comparación lexicográfica de ISO strings es correcta si el formato
     es consistente, lo cual es el caso ya que siempre usamos toISOString().
  ──────────────────────────────────────────────────────────────────────── */
  const ninetyDaysAgo = new Date(Date.now() - NINETY_DAYS_MS).toISOString();
  let notifDeleted = 0;
  try {
    const result = await cleanupCollection({
      collectionPath: 'notificaciones',
      field:          'created_at',
      operator:       '<',
      value:          ninetyDaysAgo,
      maxDocs:        MAX_DOCS_PER_COLLECTION,
    });
    notifDeleted = result.deleted;
    log.info('cron_cleanup_notificaciones_done', {
      deleted:          result.deleted,
      duration_ms:      result.durationMs,
      threshold_cutoff: ninetyDaysAgo,
    });
  } catch (err) {
    log.error('cron_cleanup_notificaciones_failed', err);
  }

  /* ── 4. Respuesta final ───────────────────────────────────────────────── */
  const totalDeleted = rateLimitsDeleted + notifDeleted;
  const totalMs      = Date.now() - runStart;

  log.finish(true, 200);

  return NextResponse.json({
    ok: true,
    deleted: {
      rate_limits:    rateLimitsDeleted,
      notificaciones: notifDeleted,
      total:          totalDeleted,
    },
    duration_ms: totalMs,
  });
}
