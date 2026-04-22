/**
 * POST /api/proveedor/presupuesto
 *
 * Proveedor submits a budget offer for an incidencia.
 *
 * Writes to TWO paths atomically (Admin SDK batch):
 *   1. incidencias/{incidenciaId}/presupuestos/{proveedorId}  — admin sees all bids
 *   2. proveedores/{proveedorId}/presupuestos/{incidenciaId}  — provider reads their own
 *      without needing a collectionGroup index
 */

import { NextRequest, NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getAdminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';

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
  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    let uid: string;
    try {
      const decoded = await getAuth().verifyIdToken(authHeader.slice(7));
      uid = decoded.uid;
    } catch {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }

    // ── Validate ──────────────────────────────────────────────────────────
    const body = await req.json().catch(() => null);
    if (!body?.incidencia_id || !body?.monto) {
      return NextResponse.json({ error: 'incidencia_id y monto son requeridos' }, { status: 400 });
    }

    const { incidencia_id, monto, mensaje = '' } = body as {
      incidencia_id: string;
      monto: number;
      mensaje: string;
    };

    const db = getAdminDb();

    // ── Verify proveedor exists ───────────────────────────────────────────
    const provSnap = await db.collection('proveedores').doc(uid).get();
    if (!provSnap.exists) {
      return NextResponse.json({ error: 'Proveedor no encontrado' }, { status: 404 });
    }
    const provData = provSnap.data()!;

    // ── Fetch incidencia title for denormalized copy ──────────────────────
    const incSnap = await db.collection('incidencias').doc(incidencia_id).get();
    const incTitulo: string = incSnap.exists
      ? (incSnap.data()?.titulo ?? 'Sin título')
      : 'Sin título';

    const now = FieldValue.serverTimestamp();
    const montoNum = Number(monto);
    const mensajeTrimmed = mensaje.trim();

    // ── Batch write to both paths ─────────────────────────────────────────
    const batch = db.batch();

    // 1. incidencias/{id}/presupuestos/{uid} — admin view
    batch.set(
      db.collection('incidencias').doc(incidencia_id).collection('presupuestos').doc(uid),
      {
        proveedor_id:     uid,
        proveedor_nombre: provData.nombre ?? '',
        monto:            montoNum,
        mensaje:          mensajeTrimmed,
        estado:           'pendiente',
        created_at:       now,
      }
    );

    // 2. proveedores/{uid}/presupuestos/{incidenciaId} — provider view (no index needed)
    batch.set(
      db.collection('proveedores').doc(uid).collection('presupuestos').doc(incidencia_id),
      {
        incidencia_id,
        incidencia_titulo: incTitulo,
        monto:             montoNum,
        mensaje:           mensajeTrimmed,
        estado:            'pendiente',
        created_at:        now,
      }
    );

    await batch.commit();

    return NextResponse.json({ ok: true });

  } catch (err: any) {
    console.error('[POST /api/proveedor/presupuesto]', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
