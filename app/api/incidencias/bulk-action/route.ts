/**
 * POST /api/incidencias/bulk-action
 * Ejecuta una acción masiva sobre múltiples incidencias.
 * Solo admin / presidente.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getAdminDb } from '@/lib/firebase/admin';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

export type AccionMasiva =
  | 'resolver'
  | 'marcar_en_revision'
  | 'cambiar_prioridad_urgente'
  | 'notificar_afectados'
  | 'eliminar';

export async function POST(req: NextRequest) {
  // Auth
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

  const db = getAdminDb();

  // Verificar rol admin
  const perfilSnap = await db.collection('perfiles').doc(uid).get();
  const rol = perfilSnap.data()?.rol as string;
  if (rol !== 'admin' && rol !== 'presidente') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  const { ids, accion } = await req.json() as { ids: string[]; accion: AccionMasiva };

  if (!ids?.length || !accion) {
    return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 });
  }

  const ahora = new Date().toISOString();
  const CHUNK = 450; // límite de Firestore batch

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));

  for (const chunk of chunks) {
    const batch = db.batch();
    for (const id of chunk) {
      const ref = db.collection('incidencias').doc(id);
      switch (accion) {
        case 'resolver':
          batch.update(ref, { estado: 'resuelta', resuelta_at: ahora, updated_at: ahora });
          break;
        case 'marcar_en_revision':
          batch.update(ref, { estado: 'en_revision', updated_at: ahora });
          break;
        case 'cambiar_prioridad_urgente':
          batch.update(ref, { prioridad: 'urgente', updated_at: ahora });
          break;
        case 'eliminar':
          batch.delete(ref);
          break;
        // notificar_afectados se hace fuera del batch (addDoc)
      }
    }
    await batch.commit();
  }

  return NextResponse.json({ ok: true, procesadas: ids.length });
}
