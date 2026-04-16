/**
 * DELETE /api/eliminar/:tipo/:id
 *
 * Endpoint genérico y seguro para eliminar cualquier entidad de Firestore.
 * Arquitectura:
 *   1. Valida el tipo contra una whitelist → previene inyección de colección
 *   2. Verifica el ID token de Firebase → autenticación server-side
 *   3. Carga el perfil del usuario → comprueba rol
 *   4. Carga el documento → comprueba propiedad y comunidad
 *   5. Elimina
 *
 * Seguridad por capas:
 *   - Whitelist de colecciones (no se acepta ningún nombre arbitrario)
 *   - Verificación de token con Firebase Admin (no se confía en el cliente)
 *   - Comprobación de comunidad (un vecino de otra comunidad no puede borrar)
 *   - Comprobación de rol O propiedad (admin O creador del recurso)
 */

import { NextRequest, NextResponse }  from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth }                      from 'firebase-admin/auth';
import { getAdminDb }                   from '@/lib/firebase/admin';

/* ─── Bootstrap Firebase Admin (idempotente) ─── */
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

/* ─── Mapeo seguro: tipo (param público) → colección Firestore ─── */
const COLECCION: Record<string, string> = {
  incidencia : 'incidencias',
  cuota      : 'cuotas',
  documento  : 'documentos',
  anuncio    : 'anuncios',
  votacion   : 'votaciones',
};

/**
 * Campo que almacena el UID del creador en cada colección.
 * null = solo administradores pueden eliminar (sin campo de creador).
 */
const CAMPO_AUTOR: Record<string, string | null> = {
  incidencias : 'autor_id',
  anuncios    : 'autor_id',
  votaciones  : 'created_by',
  documentos  : 'subido_por',
  cuotas      : null,           // las cuotas las crea el admin, solo él las borra
};

const ROLES_ADMIN = new Set(['admin', 'presidente']);

/* ─── Handler ─── */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { tipo: string; id: string } },
) {
  const { tipo, id } = params;

  /* 1 — Validar tipo contra whitelist */
  const coleccion = COLECCION[tipo];
  if (!coleccion) {
    return NextResponse.json(
      { error: `Tipo "${tipo}" no válido. Valores permitidos: ${Object.keys(COLECCION).join(', ')}` },
      { status: 400 },
    );
  }

  /* 2 — Verificar token Firebase */
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Cabecera Authorization requerida' }, { status: 401 });
  }
  const token = authHeader.slice(7);

  let uid: string;
  try {
    const decoded = await getAuth().verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: 'Token inválido o expirado' }, { status: 401 });
  }

  const db = getAdminDb();

  /* 3 — Cargar perfil del solicitante */
  const perfilSnap = await db.collection('perfiles').doc(uid).get();
  if (!perfilSnap.exists) {
    return NextResponse.json({ error: 'Perfil no encontrado' }, { status: 403 });
  }
  const perfil     = perfilSnap.data()!;
  const esAdmin    = ROLES_ADMIN.has(perfil.rol as string);
  const comunidadUsuario = perfil.comunidad_id as string | null;

  /* 4 — Cargar el documento objetivo */
  const docRef  = db.collection(coleccion).doc(id);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
  }
  const data = docSnap.data()!;

  /* 5 — Verificar que pertenece a la misma comunidad */
  const comunidadRecurso = data.comunidad_id as string | undefined;
  if (comunidadRecurso && comunidadRecurso !== comunidadUsuario) {
    return NextResponse.json({ error: 'No puedes modificar recursos de otra comunidad' }, { status: 403 });
  }

  /* 6 — Verificar permisos: admin/presidente OR creador */
  if (!esAdmin) {
    const campoAutor = CAMPO_AUTOR[coleccion];

    if (!campoAutor) {
      return NextResponse.json(
        { error: 'Solo administradores pueden eliminar este tipo de recurso' },
        { status: 403 },
      );
    }

    const autorId = data[campoAutor] as string | undefined;
    if (autorId !== uid) {
      return NextResponse.json(
        { error: 'Solo puedes eliminar recursos que tú hayas creado' },
        { status: 403 },
      );
    }
  }

  /* 7 — Eliminar */
  try {
    await docRef.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[DELETE /api/eliminar/${tipo}/${id}]`, err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
