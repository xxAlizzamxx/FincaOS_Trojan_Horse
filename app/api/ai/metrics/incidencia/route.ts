/**
 * POST /api/ai/metrics/incidencia
 *
 * Fire-and-forget endpoint that updates provider learning metrics when an
 * incidencia's state changes to or from `resuelta`.
 *
 * Called from:
 *   - app/admin/incidencias/page.tsx  (client, after cambiarEstado)
 *   - app/(app)/incidencias/[id]      (client, after workflow advance)
 *
 * The provider route (/api/proveedor/actualizar-estado) calls the metric
 * functions directly (server-to-server, no HTTP hop needed).
 *
 * Body:
 *   { incidenciaId: string, tipo: 'resuelta' | 'reopen' }
 *
 * Auth: Bearer Firebase ID token
 * Rate limit: 30 req / 60 s per IP
 */

import { NextRequest, NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth }    from 'firebase-admin/auth';
import { getAdminDb } from '@/lib/firebase/admin';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { updateMetricsOnResolucion, incrementReopenCount } from '@/lib/ai/proveedorMetrics';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

export async function POST(req: NextRequest) {
  // ── Rate limit ───────────────────────────────────────────────────────────
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = await checkRateLimit(`ai-metrics-incidencia:${ip}`, 30, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl);

  // ── Auth ─────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  try {
    await getAuth().verifyIdToken(authHeader.slice(7));
  } catch {
    return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let incidenciaId: string;
  let tipo: 'resuelta' | 'reopen';
  try {
    const body   = await req.json();
    incidenciaId = String(body.incidenciaId ?? '').trim();
    tipo         = body.tipo === 'reopen' ? 'reopen' : 'resuelta';
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  if (!incidenciaId) {
    return NextResponse.json({ error: 'incidenciaId es obligatorio' }, { status: 400 });
  }

  const db = getAdminDb();

  // ── Dispatch (both functions are fail-safe and never throw) ──────────────
  if (tipo === 'resuelta') {
    await updateMetricsOnResolucion(db, incidenciaId);
  } else {
    await incrementReopenCount(db, incidenciaId);
  }

  return NextResponse.json({ ok: true });
}
