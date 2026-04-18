/**
 * POST /api/proveedores/review
 *
 * Crea una valoración de proveedor vinculada a una incidencia resuelta.
 *
 * Requisitos:
 *  - incidencia.estado === 'resuelta'
 *  - usuario pertenece a la misma comunidad que la incidencia
 *  - un user_id no puede valorar la misma incidencia dos veces
 *
 * Lógica de promedio incremental:
 *  nuevo_promedio = (prev_promedio * total_reviews + rating) / (total_reviews + 1)
 *
 * Logs: review_created, rating_updated
 */

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue }                from 'firebase-admin/firestore';
import { getAuth }                   from 'firebase-admin/auth';
import { getApps }                   from 'firebase-admin/app';
import { getAdminDb }                from '@/lib/firebase/admin';
import { createLogger }              from '@/lib/logger';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const log       = createLogger({ route: '/api/proveedores/review', requestId });

  /* ── 1. Auth ───────────────────────────────────────────────────────────── */
  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  let userId: string;
  try {
    getAdminDb();
    const decoded = await getAuth(getApps()[0]).verifyIdToken(authHeader.slice(7));
    userId = decoded.uid;
  } catch {
    return NextResponse.json({ ok: false, error: 'Token inválido o expirado' }, { status: 401 });
  }

  /* ── 2. Body ───────────────────────────────────────────────────────────── */
  let incidenciaId: string;
  let rating: number;
  let comentario: string;
  try {
    const body  = await req.json();
    incidenciaId = String(body?.incidencia_id ?? '').trim();
    rating       = Number(body?.rating);
    comentario   = String(body?.comentario ?? '').trim().slice(0, 500);
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 });
  }

  if (!incidenciaId) {
    return NextResponse.json({ ok: false, error: 'incidencia_id requerido' }, { status: 400 });
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ ok: false, error: 'rating debe ser un entero entre 1 y 5' }, { status: 400 });
  }

  const db = getAdminDb();

  /* ── 3. Verificar incidencia ───────────────────────────────────────────── */
  const incSnap = await db.collection('incidencias').doc(incidenciaId).get();
  if (!incSnap.exists) {
    return NextResponse.json({ ok: false, error: 'Incidencia no encontrada' }, { status: 404 });
  }
  const inc = incSnap.data()!;

  if (inc.estado !== 'resuelta') {
    return NextResponse.json(
      { ok: false, error: 'Solo se puede valorar una incidencia resuelta' },
      { status: 422 },
    );
  }

  const proveedorNombre = (inc.proveedor_nombre as string | undefined)?.trim();
  if (!proveedorNombre) {
    return NextResponse.json(
      { ok: false, error: 'Esta incidencia no tiene proveedor asignado' },
      { status: 422 },
    );
  }

  /* ── 4. Verificar que el usuario pertenece a la misma comunidad ────────── */
  const perfilSnap = await db.collection('perfiles').doc(userId).get();
  if (!perfilSnap.exists || perfilSnap.data()!.comunidad_id !== inc.comunidad_id) {
    return NextResponse.json(
      { ok: false, error: 'No perteneces a la comunidad de esta incidencia' },
      { status: 403 },
    );
  }

  /* ── 5. Encontrar o crear el documento de proveedor ───────────────────── */
  const provQuery = await db
    .collection('proveedores')
    .where('nombre', '==', proveedorNombre)
    .limit(1)
    .get();

  let proveedorId: string;

  if (provQuery.empty) {
    const newProv = await db.collection('proveedores').add({
      nombre:          proveedorNombre,
      promedio_rating: 0,
      total_reviews:   0,
      created_at:      new Date().toISOString(),
    });
    proveedorId = newProv.id;
  } else {
    proveedorId = provQuery.docs[0].id;
  }

  /* ── 6. Dedup: un usuario no puede valorar la misma incidencia dos veces ─ */
  const dupQuery = await db
    .collection('proveedores')
    .doc(proveedorId)
    .collection('reviews')
    .where('user_id',      '==', userId)
    .where('incidencia_id','==', incidenciaId)
    .limit(1)
    .get();

  if (!dupQuery.empty) {
    return NextResponse.json(
      { ok: false, error: 'Ya has valorado esta incidencia' },
      { status: 409 },
    );
  }

  /* ── 7. Transacción: añadir review + actualizar promedio ──────────────── */
  const provRef    = db.collection('proveedores').doc(proveedorId);
  const reviewsRef = provRef.collection('reviews');
  const newReviewRef = reviewsRef.doc();

  await db.runTransaction(async (tx) => {
    const provSnap  = await tx.get(provRef);
    const prevProm  = (provSnap.data()?.promedio_rating  as number) ?? 0;
    const prevTotal = (provSnap.data()?.total_reviews    as number) ?? 0;

    // Fórmula incremental del promedio
    const newTotal = prevTotal + 1;
    const newProm  = parseFloat(
      ((prevProm * prevTotal + rating) / newTotal).toFixed(2),
    );

    tx.set(newReviewRef, {
      user_id:       userId,
      incidencia_id: incidenciaId,
      rating,
      comentario,
      created_at:    new Date().toISOString(),
    });

    tx.update(provRef, {
      promedio_rating: newProm,
      total_reviews:   newTotal,
      updated_at:      new Date().toISOString(),
    });
  });

  log.info('review_created', {
    proveedor_id:  proveedorId,
    proveedor_nombre: proveedorNombre,
    incidencia_id: incidenciaId,
    user_id:       userId,
    rating,
    request_id:    requestId,
  });

  /* Re-leer para devolver el promedio actualizado */
  const updatedSnap = await provRef.get();
  const updated     = updatedSnap.data()!;

  log.info('rating_updated', {
    proveedor_id:    proveedorId,
    promedio_rating: updated.promedio_rating,
    total_reviews:   updated.total_reviews,
    request_id:      requestId,
  });

  return NextResponse.json({
    ok:              true,
    proveedor_id:    proveedorId,
    promedio_rating: updated.promedio_rating,
    total_reviews:   updated.total_reviews,
  });
}
