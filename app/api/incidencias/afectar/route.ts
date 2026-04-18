/**
 * POST /api/incidencias/afectar
 *
 * Thin controller — auth + validation only.
 * Business logic lives in services/incidencias.ts (toggleAfectado).
 *
 * Guarantees:
 *  - set/delete inside Firestore transaction (atomic, no race condition)
 *  - delta-based quorum counter (no full subcollection scan)
 *  - quorum escalation on first threshold crossing
 *  - community notification on quorum reached
 *  - domain event emitted (incidencia.affected / incidencia.quorum_reached)
 *  - structured log per request
 */

import { NextRequest, NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getAdminDb } from '@/lib/firebase/admin';
import { createLogger } from '@/lib/logger';
import { handleApiError, AuthError, TokenError, NotFoundError, ValidationError } from '@/lib/errors';
import { toggleAfectado } from '@/services/incidencias';

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
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID().slice(0, 8);
  const log = createLogger({ route: '/api/incidencias/afectar', requestId });

  try {
    // ── 1. Auth ──────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) throw new AuthError();

    let uid: string;
    try {
      const decoded = await getAuth().verifyIdToken(authHeader.slice(7));
      uid = decoded.uid;
    } catch {
      throw new TokenError();
    }

    // ── 2. Input validation ──────────────────────────────────────────────
    const body = await req.json().catch(() => null);
    if (!body?.incidenciaId || typeof body.incidenciaId !== 'string') {
      throw new ValidationError('incidenciaId es requerido');
    }
    const { incidenciaId, quitar = false } = body as { incidenciaId: string; quitar?: boolean };

    log.info('afectar_start', { uid, incidenciaId, quitar });

    // ── 3. Load caller profile ───────────────────────────────────────────
    const db         = getAdminDb();
    const perfilSnap = await db.collection('perfiles').doc(uid).get();
    if (!perfilSnap.exists) throw new NotFoundError('Perfil');

    const perfil      = perfilSnap.data()!;
    const coef        = (perfil.coeficiente as number) ?? 1;
    const comunidadId = perfil.comunidad_id as string;

    // ── 4. Delegate to service ───────────────────────────────────────────
    const result = await toggleAfectado({
      incidenciaId, uid, coef, comunidadId, quitar, requestId,
    });

    log.info('afectar_complete', {
      uid, incidenciaId, quitar,
      new_count:       result.newCount,
      porcentaje:      result.porcentaje,
      quorum_alcanzado: result.quorumAlcanzado,
      was_new_quorum:  result.wasNewQuorum,
    });
    log.finish(true, 200);

    return NextResponse.json({ ok: true, quorum: result });

  } catch (err) {
    log.finish(false);
    return handleApiError(err, log);
  }
}
