/**
 * POST /api/proveedor/actualizar-estado
 *
 * Allows a provider to update the status of an assigned work item.
 *
 * Permitted transitions (provider-only):
 *   asignado       → en_ejecucion
 *   en_ejecucion   → resuelta
 *
 * Sets resuelta_at when moving to "resuelta".
 * Uses Admin SDK to bypass Firestore rules (providers are not community members).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getAdminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { updateMetricsOnResolucion } from '@/lib/ai/proveedorMetrics';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

// After aceptarPresupuesto() the incidencia lands on 'presupuestada' (not 'asignado').
// The provider then drives it through: presupuestada → en_ejecucion → resuelta.
const ALLOWED_TRANSITIONS: Record<string, string> = {
  presupuestada: 'en_ejecucion',
  en_ejecucion:  'resuelta',
};

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

    // ── Validate body ─────────────────────────────────────────────────────
    const body = await req.json().catch(() => null);
    if (!body?.incidencia_id || !body?.nuevo_estado) {
      return NextResponse.json(
        { error: 'incidencia_id y nuevo_estado son requeridos' },
        { status: 400 },
      );
    }

    const { incidencia_id, nuevo_estado } = body as {
      incidencia_id: string;
      nuevo_estado: string;
    };

    const db = getAdminDb();

    // ── Verify proveedor exists ───────────────────────────────────────────
    const provSnap = await db.collection('proveedores').doc(uid).get();
    if (!provSnap.exists) {
      return NextResponse.json({ error: 'Proveedor no encontrado' }, { status: 404 });
    }

    // ── Load incidencia ───────────────────────────────────────────────────
    const incRef  = db.collection('incidencias').doc(incidencia_id);
    const incSnap = await incRef.get();

    if (!incSnap.exists) {
      return NextResponse.json({ error: 'Incidencia no encontrada' }, { status: 404 });
    }

    const incData = incSnap.data()!;

    // ── Authorization: must be the assigned provider ──────────────────────
    if (incData.proveedor_asignado !== uid) {
      return NextResponse.json(
        { error: 'No tienes permiso para actualizar esta incidencia' },
        { status: 403 },
      );
    }

    // ── Validate transition ───────────────────────────────────────────────
    const estadoActual     = incData.estado as string;
    const expectedEstado   = ALLOWED_TRANSITIONS[estadoActual];

    if (!expectedEstado) {
      return NextResponse.json(
        { error: `El estado "${estadoActual}" no permite transición por el proveedor` },
        { status: 400 },
      );
    }

    if (nuevo_estado !== expectedEstado) {
      return NextResponse.json(
        { error: `Transición inválida: ${estadoActual} → ${nuevo_estado}. Esperado: ${expectedEstado}` },
        { status: 400 },
      );
    }

    // ── Build update payload ──────────────────────────────────────────────
    const update: Record<string, unknown> = {
      estado:     nuevo_estado,
      updated_at: FieldValue.serverTimestamp(),
    };

    if (nuevo_estado === 'resuelta') {
      update.resuelta_at = FieldValue.serverTimestamp();
    }

    await incRef.update(update);

    // ── Trigger learning metrics on resolution ────────────────────────────
    // Fire-and-forget: updateMetricsOnResolucion is fail-safe and never throws.
    // We call it directly (server-to-server) to avoid an extra HTTP hop.
    if (nuevo_estado === 'resuelta') {
      void updateMetricsOnResolucion(db, incidencia_id);
    }

    // ── Notify community admin about progress ─────────────────────────────
    // (fire-and-forget — don't fail the request if notification fails)
    try {
      const comunidadId = incData.comunidad_id as string | undefined;
      if (comunidadId) {
        const provData = provSnap.data()!;
        const mensaje = nuevo_estado === 'en_ejecucion'
          ? `${provData.nombre ?? 'El proveedor'} ha iniciado el trabajo en "${incData.titulo}".`
          : `${provData.nombre ?? 'El proveedor'} ha marcado como completado "${incData.titulo}".`;

        await db.collection('notificaciones').add({
          comunidad_id: comunidadId,
          usuario_id:   null, // broadcast to admins (can be filtered client-side)
          tipo:         'trabajo_actualizado',
          titulo:       nuevo_estado === 'en_ejecucion' ? 'Trabajo iniciado' : 'Trabajo completado',
          mensaje,
          incidencia_id,
          leida:        false,
          created_at:   FieldValue.serverTimestamp(),
        });
      }
    } catch (notifErr) {
      console.warn('[actualizar-estado] Could not send notification:', notifErr);
    }

    return NextResponse.json({ ok: true, nuevo_estado });

  } catch (err: any) {
    console.error('[POST /api/proveedor/actualizar-estado]', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
