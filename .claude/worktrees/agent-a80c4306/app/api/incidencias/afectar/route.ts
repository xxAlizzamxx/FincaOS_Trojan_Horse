/**
 * POST /api/incidencias/afectar
 * Añade al vecino como afectado y recalcula quórum.
 * Si se alcanza el umbral: escala prioridad a 'urgente',
 * avanza estado a 'en_revision' y emite notificación de comunidad.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
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

export async function POST(req: NextRequest) {
  // 1. Auth
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

  const { incidenciaId, quitar } = await req.json() as {
    incidenciaId: string;
    quitar?: boolean;
  };

  const db = getAdminDb();

  // 2. Cargar perfil del vecino
  const perfilSnap = await db.collection('perfiles').doc(uid).get();
  if (!perfilSnap.exists) {
    return NextResponse.json({ error: 'Perfil no encontrado' }, { status: 403 });
  }
  const perfil     = perfilSnap.data()!;
  const coef       = (perfil.coeficiente as number) ?? 1;
  const comunidadId = perfil.comunidad_id as string;

  // 3. Referencia al documento de afectado
  const afectadoRef = db
    .collection('incidencias').doc(incidenciaId)
    .collection('afectados').doc(uid);

  // Quitar afectado
  if (quitar) {
    await afectadoRef.delete();
  } else {
    await afectadoRef.set({ coeficiente: coef, added_at: new Date().toISOString() });
  }

  // 4. Recalcular en transacción
  await db.runTransaction(async (tx) => {
    const incRef   = db.collection('incidencias').doc(incidenciaId);
    const incSnap  = await tx.get(incRef);
    if (!incSnap.exists) return;
    const inc      = incSnap.data()!;

    // Total vecinos de la comunidad
    const vecinosSnap = await db.collection('perfiles')
      .where('comunidad_id', '==', comunidadId).get();
    const totalVecinos = vecinosSnap.size;

    // Afectados actuales
    const afectadosSnap = await db
      .collection('incidencias').doc(incidenciaId)
      .collection('afectados').get();
    const afectadosCount = afectadosSnap.size;
    const pesoAfectados  = afectadosSnap.docs.reduce(
      (s, d) => s + ((d.data().coeficiente as number) ?? 1), 0
    );

    const umbral     = (inc.quorum as any)?.umbral ?? 30;
    const porcentaje = totalVecinos > 0 ? (afectadosCount / totalVecinos) * 100 : 0;
    const yaAlcanzado = (inc.quorum as any)?.alcanzado ?? false;
    const ahora       = new Date().toISOString();

    const updates: Record<string, any> = {
      'quorum.tipo':             'simple',
      'quorum.umbral':           umbral,
      'quorum.afectados_count':  afectadosCount,
      'quorum.peso_afectados':   pesoAfectados,
      'quorum.alcanzado':        porcentaje >= umbral,
    };

    // TRIGGER: primera vez que se supera el umbral
    if (!yaAlcanzado && porcentaje >= umbral) {
      updates['quorum.alcanzado_at']  = ahora;
      updates['escalada_por_quorum']  = true;

      if (inc.prioridad !== 'urgente') {
        updates['prioridad_original'] = inc.prioridad;
        updates['prioridad']          = 'urgente';
      }
      if (inc.estado === 'pendiente') {
        updates['estado']             = 'en_revision';
        updates['historial_estados']  = FieldValue.arrayUnion({
          estado:       'en_revision',
          fecha:        ahora,
          cambiado_por: 'sistema_quorum',
        });
      }

      // Notificación de comunidad
      await db.collection('comunidades').doc(comunidadId)
        .collection('notificaciones').add({
          tipo:       'incidencia',
          titulo:     '⚠️ Quórum alcanzado',
          mensaje:    `"${inc.titulo as string}" alcanzó quórum (${afectadosCount} vecinos afectados)`,
          created_at: ahora,
          created_by: 'sistema',
          related_id: incidenciaId,
          link:       `/incidencias/${incidenciaId}`,
        });
    }

    tx.update(incRef, updates);
  });

  return NextResponse.json({ ok: true });
}
