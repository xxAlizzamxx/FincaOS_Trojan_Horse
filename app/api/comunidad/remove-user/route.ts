/**
 * POST /api/comunidad/remove-user
 *
 * Elimina un usuario de la comunidad.
 *  - Requiere: Authorization: Bearer <Firebase ID Token>
 *  - El caller debe ser admin o presidente de la comunidad
 *  - El target debe pertenecer a la misma comunidad
 *  - No borra datos históricos — solo limpia comunidad_id y campos de ubicación
 *  - Escribe en admin_logs para trazabilidad
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
  const log       = createLogger({ route: '/api/comunidad/remove-user', requestId });

  // ── 1. Verificar ID token ─────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const idToken = authHeader.slice(7);
  let requesterId: string;

  try {
    // getAdminDb() inicializa el app antes de llamar a getAuth()
    getAdminDb();
    const decoded = await getAuth(getApps()[0]).verifyIdToken(idToken);
    requesterId   = decoded.uid;
  } catch {
    return NextResponse.json({ ok: false, error: 'Token inválido o expirado' }, { status: 401 });
  }

  // ── 2. Parsear body ────────────────────────────────────────────────────────
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

  // ── 3. Hardening: no auto-expulsión ─────────────────────────────────────
  if (userId === requesterId) {
    return NextResponse.json({ ok: false, error: 'No puedes eliminarte a ti mismo' }, { status: 400 });
  }

  // ── 4. Cargar perfiles en paralelo ────────────────────────────────────────
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

  // ── 5. Validar rol: solo admin/presidente ─────────────────────────────────
  if (!['admin', 'presidente'].includes(requesterData.rol)) {
    return NextResponse.json({ ok: false, error: 'No tienes permisos para esta acción' }, { status: 403 });
  }

  // ── 6. Hardening: misma comunidad ────────────────────────────────────────
  if (!requesterData.comunidad_id || targetData.comunidad_id !== requesterData.comunidad_id) {
    log.warn('remove_user_cross_community', {
      requester: requesterId,
      target:    userId,
      requester_cid: requesterData.comunidad_id,
      target_cid:    targetData.comunidad_id,
    });
    return NextResponse.json({ ok: false, error: 'El usuario no pertenece a tu comunidad' }, { status: 403 });
  }

  const comunidadId = requesterData.comunidad_id as string;

  // ── 7. Ejecutar eliminación ───────────────────────────────────────────────
  // NO borramos el documento — solo limpiamos la asociación a la comunidad
  await db.collection('perfiles').doc(userId).update({
    comunidad_id:  null,
    numero_piso:   null,
    torre:         null,
    piso:          null,
    puerta:        null,
    rol:           'vecino',
    expulsado_at:  new Date().toISOString(),
    expulsado_por: requesterId,
    updated_at:    new Date().toISOString(),
  });

  // ── 8. Audit log en admin_logs ────────────────────────────────────────────
  // Fire-and-forget: si el log falla no revertimos la eliminación
  db.collection('admin_logs').add({
    admin_id:       requesterId,
    action:         'remove_user',
    target_user_id: userId,
    target_nombre:  targetData.nombre_completo ?? null,
    comunidad_id:   comunidadId,
    created_at:     FieldValue.serverTimestamp(),
  }).catch((auditErr: unknown) => {
    // No revertir la operación; solo loguear el fallo del audit
    log.error('audit_log_failed', auditErr, { action: 'remove_user', target: userId });
  });

  log.info('user_removed', {
    removed_uid: userId,
    by_uid:      requesterId,
    comunidad_id: comunidadId,
  });

  return NextResponse.json({ ok: true });
}
