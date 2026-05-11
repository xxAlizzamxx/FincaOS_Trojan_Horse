/**
 * POST /api/cobros
 *
 * Admin creates a cobro (payment request) for a specific vecino.
 * This route:
 *   1. Verifies the caller is admin/presidente of the community
 *   2. Creates the cobro document in /cobros
 *   3. Ensures the admin-vecino chat exists and sends a 'cobro' message
 *   4. Sends a push notification to the vecino
 *
 * Body: {
 *   comunidad_id: string,
 *   vecino_id:    string,
 *   concepto:     string,
 *   monto:        number,
 *   descripcion?: string,
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { getAdminDb } from '@/lib/firebase/admin';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { checkRateLimit, maybeCleanBuckets } from '@/lib/rate-limit';
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

    // ── 1b. Rate limit — 20 cobros per admin per minute ────────────────────
    maybeCleanBuckets();
    const rl = checkRateLimit(`cobros:${uid}`, 20, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Espera un momento.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.resetIn / 1000)) } },
      );
    }

    // ── 2. Parsear body ─────────────────────────────────────────────────────
    const body = await req.json().catch(() => null);
    if (!body?.comunidad_id || !body?.vecino_id || !body?.concepto || !body?.monto) {
      return NextResponse.json({ error: 'comunidad_id, vecino_id, concepto y monto son requeridos' }, { status: 400 });
    }

    const { comunidad_id, vecino_id, concepto, monto, descripcion } = body as {
      comunidad_id: string;
      vecino_id:    string;
      concepto:     string;
      monto:        number;
      descripcion?: string;
    };

    const montoNum = Number(monto);
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      return NextResponse.json({ error: 'monto inválido' }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date().toISOString();

    // ── 3. Verificar que el caller es admin/presidente de la comunidad ────────
    const perfilSnap = await db.collection('perfiles').doc(uid).get();
    const perfil = perfilSnap.data();
    if (!perfil || perfil.comunidad_id !== comunidad_id || !['admin', 'presidente'].includes(perfil.rol)) {
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    }

    // ── 4. Crear cobro ──────────────────────────────────────────────────────
    const cobroRef = await db.collection('cobros').add({
      comunidad_id,
      vecino_id,
      concepto: concepto.trim(),
      descripcion: descripcion?.trim() || null,
      monto: montoNum,
      estado: 'pendiente',
      creado_por: uid,
      created_at: now,
    });

    // ── 5. Asegurar chat unificado admin ↔ vecino en chats_comunidad ─────────
    const { FieldValue } = await import('firebase-admin/firestore');
    const chatId = `${comunidad_id}_admin_${vecino_id}`;
    const chatRef = db.collection('chats_comunidad').doc(chatId);

    // set with merge creates the doc if it doesn't exist, preserves existing fields
    await chatRef.set({
      comunidad_id,
      tipo:             'admin',
      contraparte_id:   uid,
      contraparte_rol:  perfil.rol,
      vecino_id,
      updated_at:       now,
      created_at:       now,
    }, { merge: true });

    await chatRef.update({
      ultimo_mensaje:   `Solicitud de pago: ${concepto.trim()}`,
      no_leidos_vecino: FieldValue.increment(1),
      updated_at:       now,
    });

    // ── 6. Mensaje tipo 'payment_request' en el chat ────────────────────────
    await chatRef.collection('mensajes').add({
      sender_id:    uid,
      sender_rol:   perfil.rol,
      tipo:         'payment_request',
      cobro_id:     cobroRef.id,
      concepto:     concepto.trim(),
      descripcion:  descripcion?.trim() || null,
      monto:        montoNum,
      estado:       'pendiente',
      leido:        false,
      created_at:   now,
    });

    // ── 7. Push notification al vecino ──────────────────────────────────────
    try {
      const tokenSnap = await db.collection('usuarios').doc(vecino_id).collection('tokens').get();
      const tokens: string[] = tokenSnap.docs.map(d => d.data().token as string).filter(Boolean);

      if (tokens.length > 0) {
        const { getMessaging } = await import('firebase-admin/messaging');
        await getMessaging().sendEachForMulticast({
          tokens,
          webpush: {
            data: {
              title: `Cobro pendiente: ${concepto.trim()}`,
              body: `${montoNum.toFixed(2)}€ — Toca para pagar`,
              url: '/mensajes-admin',
              icon: '/logo_ok.png',
            },
          },
        });
      }
    } catch (e) {
      console.warn('[POST /api/cobros] push notification failed:', e);
    }

    // ── 8. Audit log ────────────────────────────────────────────────────────
    await logAudit({
      accion:       'crear_cobro',
      recurso_tipo: 'cobro',
      recurso_id:   cobroRef.id,
      admin_id:     uid,
      comunidad_id,
      detalles:     { vecino_id, concepto: concepto.trim(), monto: montoNum },
    });

    return NextResponse.json({ ok: true, id: cobroRef.id });

  } catch (err) {
    console.error('[POST /api/cobros]', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
