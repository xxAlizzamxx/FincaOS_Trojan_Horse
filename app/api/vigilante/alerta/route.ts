/**
 * POST /api/vigilante/alerta
 *
 * Crea una alerta comunitaria y:
 *   1. Guarda el doc en alertas_comunidad
 *   2. Publica un anuncio automático en el tablón (anuncios)
 *   3. Crea notificación in-app para toda la comunidad
 *   4. Envía push FCM a todos los miembros
 *
 * Requiere: rol vigilante | admin | presidente
 */

import { NextRequest, NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';
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

const EMOJI_MAP: Record<string, string> = {
  emergencia:    '🚨',
  mantenimiento: '🔧',
  agua:          '💧',
  gas:           '⚠️',
  ruido:         '🔊',
  vehiculo:      '🚗',
  informativa:   'ℹ️',
};

export async function POST(req: NextRequest) {
  // ── 1. Verificar token ──────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const idToken = authHeader.replace('Bearer ', '').trim();
  if (!idToken) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  let uid: string;
  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
  }

  // ── 2. Validar body ─────────────────────────────────────────────────────────
  const body = await req.json().catch(() => null);
  if (!body?.comunidad_id || !body?.titulo || !body?.descripcion) {
    return NextResponse.json(
      { error: 'comunidad_id, titulo y descripcion son requeridos' },
      { status: 400 },
    );
  }

  const {
    comunidad_id,
    titulo,
    descripcion,
    tipo      = 'informativa',
    prioridad = 'media',
  } = body as {
    comunidad_id: string;
    titulo:       string;
    descripcion:  string;
    tipo?:        string;
    prioridad?:   string;
  };

  const db = getAdminDb();

  // ── 3. Verificar que el usuario pertenece a la comunidad y tiene rol válido ─
  const perfilDoc = await db.collection('perfiles').doc(uid).get();
  if (!perfilDoc.exists) {
    return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 403 });
  }
  const perfil = perfilDoc.data()!;

  if (perfil.comunidad_id !== comunidad_id) {
    return NextResponse.json({ error: 'No perteneces a esta comunidad' }, { status: 403 });
  }
  if (!['vigilante', 'admin', 'presidente'].includes(perfil.rol as string)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  const now            = new Date().toISOString();
  const nombre         = (perfil.nombre_completo as string) || 'Vigilante';
  const emoji          = EMOJI_MAP[tipo] ?? 'ℹ️';
  const tituloConEmoji = `${emoji} ${titulo}`;

  // ── 4. Crear doc de alerta ──────────────────────────────────────────────────
  const alertaRef = await db.collection('alertas_comunidad').add({
    comunidad_id,
    creado_por:        uid,
    creado_por_nombre: nombre,
    titulo,
    descripcion,
    tipo,
    prioridad,
    activa:     true,
    created_at: now,
  });

  // ── 5. Publicar anuncio automático en el tablón ─────────────────────────────
  await db.collection('anuncios').add({
    comunidad_id,
    autor_id:     uid,
    titulo:       tituloConEmoji,
    contenido:    `${descripcion}\n\n— ${nombre} (Vigilancia)`,
    fijado:       prioridad === 'urgente',
    publicado_at: now,
    created_at:   now,
    tipo_origen:  'alerta_vigilante',
    alerta_id:    alertaRef.id,
  });

  // ── 6. Notificación in-app para toda la comunidad ───────────────────────────
  await db
    .collection('comunidades')
    .doc(comunidad_id)
    .collection('notificaciones')
    .add({
      tipo:       'alerta',
      titulo:     tituloConEmoji,
      mensaje:    descripcion,
      created_by: uid,
      related_id: alertaRef.id,
      link:       '/alertas',
      created_at: now,
    });

  // ── 7. Push FCM a todos los miembros ────────────────────────────────────────
  const perfilesSnap = await db
    .collection('perfiles')
    .where('comunidad_id', '==', comunidad_id)
    .get();

  const tokens: string[] = [];
  await Promise.all(
    perfilesSnap.docs.map(async (d) => {
      try {
        const tSnap = await db
          .collection('usuarios')
          .doc(d.id)
          .collection('tokens')
          .get();
        tSnap.docs.forEach((t) => {
          const tok = t.data().token as string | undefined;
          if (tok) tokens.push(tok);
        });
      } catch { /* sin tokens — omitir */ }
    }),
  );

  let pushSent = 0;
  if (tokens.length > 0) {
    try {
      const pushRes = await getMessaging().sendEachForMulticast({
        tokens,
        notification: { title: tituloConEmoji, body: descripcion },
        webpush: {
          notification: {
            icon: '/navegador.png',
            badge: '/navegador.png',
          },
          fcmOptions: { link: '/alertas' },
        },
      });
      pushSent = pushRes.successCount;
    } catch (err) {
      console.error('[POST /api/vigilante/alerta] push error:', err);
    }
  }

  return NextResponse.json({
    ok:        true,
    alerta_id: alertaRef.id,
    push_sent: pushSent,
  });
}
