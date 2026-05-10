/**
 * POST /api/cobros/cancelar
 *
 * Cancels a cobro. Only the admin/presidente of the community may cancel.
 * Writes an audit log entry.
 *
 * Body: { cobro_id: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { getAdminDb } from '@/lib/firebase/admin';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { logAudit } from '@/lib/audit-server';

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
    // ── 1. Verificar token ──────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const idToken = authHeader.replace('Bearer ', '').trim();
    if (!idToken) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    let uid: string;
    try {
      const decoded = await getAuth().verifyIdToken(idToken);
      uid = decoded.uid;
    } catch {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }

    // ── 2. Parsear body ─────────────────────────────────────────────────────
    const body = await req.json().catch(() => null);
    if (!body?.cobro_id) {
      return NextResponse.json({ error: 'cobro_id es requerido' }, { status: 400 });
    }
    const { cobro_id } = body as { cobro_id: string };

    const db = getAdminDb();

    // ── 3. Obtener cobro y verificar permisos ───────────────────────────────
    const cobroSnap = await db.collection('cobros').doc(cobro_id).get();
    if (!cobroSnap.exists) {
      return NextResponse.json({ error: 'Cobro no encontrado' }, { status: 404 });
    }
    const cobro = cobroSnap.data()!;

    const perfilSnap = await db.collection('perfiles').doc(uid).get();
    const perfil = perfilSnap.data();
    if (
      !perfil ||
      perfil.comunidad_id !== cobro.comunidad_id ||
      !['admin', 'presidente'].includes(perfil.rol)
    ) {
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    }

    if (cobro.estado !== 'pendiente') {
      return NextResponse.json({ error: `No se puede cancelar un cobro en estado '${cobro.estado}'` }, { status: 409 });
    }

    // ── 4. Cancelar cobro ───────────────────────────────────────────────────
    const now = new Date().toISOString();
    await db.collection('cobros').doc(cobro_id).update({
      estado:      'cancelado',
      cancelado_at: now,
      cancelado_por: uid,
    });

    // ── 5. Audit log ────────────────────────────────────────────────────────
    await logAudit({
      accion:       'cancelar_cobro',
      recurso_tipo: 'cobro',
      recurso_id:   cobro_id,
      admin_id:     uid,
      comunidad_id: cobro.comunidad_id,
      detalles:     { vecino_id: cobro.vecino_id, concepto: cobro.concepto, monto: cobro.monto },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/cobros/cancelar]', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
