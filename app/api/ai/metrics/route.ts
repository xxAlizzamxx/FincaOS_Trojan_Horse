/**
 * /api/ai/metrics
 *
 * GET  ?comunidadId=XXX  — Returns precomputed ai_metrics doc (instant)
 * POST { comunidadId }   — Triggers recomputation (admin/presidente only)
 *
 * GET response shape:
 *   AIMetricsDoc | { empty: true, comunidad_id, message }
 *
 * POST response shape:
 *   AIMetricsDoc
 *
 * Security:
 *   - Both methods require Bearer Firebase ID token
 *   - POST additionally requires rol === 'admin' | 'presidente'
 *   - Rate limit: 20 req / 60 s per UID
 */

import { NextRequest, NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth }          from 'firebase-admin/auth';
import { getAdminDb }       from '@/lib/firebase/admin';
import { computeZonaMetrics } from '@/lib/ai/metricsEngine';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { createLogger }     from '@/lib/logger';

// ── Firebase Admin bootstrap ─────────────────────────────────────────────────
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

// ── Shared auth helper ────────────────────────────────────────────────────────

async function verifyToken(req: NextRequest): Promise<{ uid: string } | null> {
  const h = req.headers.get('Authorization') ?? '';
  if (!h.startsWith('Bearer ')) return null;
  try {
    const decoded = await getAuth().verifyIdToken(h.slice(7));
    return { uid: decoded.uid };
  } catch {
    return null;
  }
}

// ── GET — read precomputed metrics ────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const log = createLogger({ route: 'GET /api/ai/metrics' });

  const auth = await verifyToken(req);
  if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const comunidadId = req.nextUrl.searchParams.get('comunidadId')?.trim() ?? '';
  if (!comunidadId) {
    return NextResponse.json({ error: 'comunidadId es obligatorio' }, { status: 400 });
  }

  const rl = await checkRateLimit(`ai-metrics:${auth.uid}`, 20, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl);

  try {
    const snap = await getAdminDb().collection('ai_metrics').doc(comunidadId).get();
    if (!snap.exists) {
      return NextResponse.json({
        empty:        true,
        comunidad_id: comunidadId,
        message:      'Aún no hay métricas calculadas. Haz clic en "Actualizar" para generarlas.',
      });
    }
    return NextResponse.json(snap.data());
  } catch (err) {
    log.error('ai_metrics_get_failed', err, { comunidad_id: comunidadId });
    return NextResponse.json({ error: 'Error al leer métricas' }, { status: 500 });
  }
}

// ── POST — compute (admin / presidente only) ──────────────────────────────────

export async function POST(req: NextRequest) {
  const log = createLogger({ route: 'POST /api/ai/metrics' });

  const auth = await verifyToken(req);
  if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const rl = await checkRateLimit(`ai-metrics:${auth.uid}`, 20, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl);

  const db = getAdminDb();

  // Role check — only admin / presidente may trigger recomputation
  const perfilSnap = await db.collection('perfiles').doc(auth.uid).get();
  const rol = perfilSnap.data()?.rol as string;
  if (rol !== 'admin' && rol !== 'presidente') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  let comunidadId: string;
  try {
    const body = await req.json();
    comunidadId = String(body.comunidadId ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  if (!comunidadId) {
    return NextResponse.json({ error: 'comunidadId es obligatorio' }, { status: 400 });
  }

  log.info('ai_metrics_compute_start', { comunidad_id: comunidadId });

  try {
    const result = await computeZonaMetrics(comunidadId, db);
    log.info('ai_metrics_compute_done', {
      comunidad_id: comunidadId,
      zonas:        result.tiempo_resolucion_zonas.length,
    });
    return NextResponse.json(result);
  } catch (err) {
    log.error('ai_metrics_compute_failed', err, { comunidad_id: comunidadId });
    return NextResponse.json({ error: 'Error al calcular métricas' }, { status: 500 });
  }
}
