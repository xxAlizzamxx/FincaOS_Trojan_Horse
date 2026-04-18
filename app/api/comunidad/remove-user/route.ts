/**
 * POST /api/comunidad/remove-user
 *
 * Elimina un usuario de la comunidad.
 * - Requiere: Authorization: Bearer <Firebase ID Token>
 * - El caller debe ser admin o presidente de la comunidad
 * - El target debe pertenecer a la misma comunidad
 * - No borra datos históricos — solo limpia comunidad_id y numero_piso
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { getAuth } from 'firebase-admin/auth';
import { getApps } from 'firebase-admin/app';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // ── 1. Verificar ID token ────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const idToken = authHeader.slice(7);

  let requesterId: string;
  try {
    // getAdminDb() ensures the admin app is initialized before getAuth()
    getAdminDb();
    const decoded = await getAuth(getApps()[0]).verifyIdToken(idToken);
    requesterId   = decoded.uid;
  } catch {
    return NextResponse.json({ ok: false, error: 'Token inválido o expirado' }, { status: 401 });
  }

  // ── 2. Parsear body ──────────────────────────────────────────────────────
  let userId: string;
  try {
    const body = await req.json();
    userId = body?.userId;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 });
  }

  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return NextResponse.json({ ok: false, error: 'userId requerido' }, { status: 400 });
  }

  if (userId === requesterId) {
    return NextResponse.json({ ok: false, error: 'No puedes eliminarte a ti mismo' }, { status: 400 });
  }

  // ── 3. Cargar perfiles ───────────────────────────────────────────────────
  const db = getAdminDb();

  const [requesterSnap, targetSnap] = await Promise.all([
    db.collection('perfiles').doc(requesterId).get(),
    db.collection('perfiles').doc(userId).get(),
  ]);

  if (!requesterSnap.exists) {
    return NextResponse.json({ ok: false, error: 'Perfil del caller no encontrado' }, { status: 403 });
  }
  if (!targetSnap.exists) {
    return NextResponse.json({ ok: false, error: 'Usuario no encontrado' }, { status: 404 });
  }

  const requesterData = requesterSnap.data()!;
  const targetData    = targetSnap.data()!;

  // ── 4. Validar que el caller es admin/presidente ─────────────────────────
  if (!['admin', 'presidente'].includes(requesterData.rol)) {
    return NextResponse.json({ ok: false, error: 'No tienes permisos para esta acción' }, { status: 403 });
  }

  // ── 5. Validar misma comunidad ───────────────────────────────────────────
  if (!requesterData.comunidad_id || targetData.comunidad_id !== requesterData.comunidad_id) {
    return NextResponse.json({ ok: false, error: 'El usuario no pertenece a tu comunidad' }, { status: 403 });
  }

  // ── 6. Ejecutar eliminación ──────────────────────────────────────────────
  // NO borramos el documento — solo limpiamos la asociación a la comunidad
  await db.collection('perfiles').doc(userId).update({
    comunidad_id:  null,
    numero_piso:   null,
    torre:         null,
    piso:          null,
    puerta:        null,
    rol:           'vecino',      // resetear a rol base
    expulsado_at:  new Date().toISOString(),
    expulsado_por: requesterId,
    updated_at:    new Date().toISOString(),
  });

  console.log(JSON.stringify({
    level:      'info',
    action:     'user_removed_from_community',
    removed_uid: userId,
    by_uid:      requesterId,
    comunidad_id: requesterData.comunidad_id,
    timestamp:  new Date().toISOString(),
  }));

  return NextResponse.json({ ok: true });
}
