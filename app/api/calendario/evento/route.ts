/**
 * POST /api/calendario/evento
 *
 * Creates an evento_calendario document using Admin SDK (bypasses client security rules)
 * and optionally publishes an anuncio to the tablón.
 *
 * Body: {
 *   comunidad_id: string,
 *   titulo: string,
 *   tipo: 'reunion' | 'evento',
 *   fecha: string,        // ISO string
 *   descripcion?: string,
 * }
 *
 * Auth: Bearer token in Authorization header (Firebase ID token).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { getAdminDb } from '@/lib/firebase/admin';
import { getApps, initializeApp, cert } from 'firebase-admin/app';

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

    // ── 2. Parsear body ─────────────────────────────────────────────────────────
    const body = await req.json().catch(() => null);
    if (!body?.comunidad_id || !body?.titulo || !body?.fecha) {
      return NextResponse.json(
        { error: 'comunidad_id, titulo y fecha son requeridos' },
        { status: 400 }
      );
    }

    const { comunidad_id, titulo, tipo = 'evento', fecha, descripcion } = body as {
      comunidad_id: string;
      titulo: string;
      tipo: 'reunion' | 'evento';
      fecha: string;
      descripcion?: string;
    };

    const db = getAdminDb();
    const now = new Date().toISOString();

    // ── 3. Verificar que el usuario es admin/presidente de la comunidad ─────────
    const perfilDoc = await db.collection('perfiles').doc(uid).get();
    const perfil = perfilDoc.data();
    if (
      !perfil ||
      perfil.comunidad_id !== comunidad_id ||
      !['admin', 'presidente'].includes(perfil.rol)
    ) {
      return NextResponse.json({ error: 'Sin permisos para crear eventos' }, { status: 403 });
    }

    // ── 4. Crear el evento en eventos_calendario ────────────────────────────────
    const eventoRef = await db.collection('eventos_calendario').add({
      comunidad_id,
      titulo: titulo.trim(),
      descripcion: descripcion?.trim() || null,
      tipo,
      fecha,
      created_by: uid,
      created_at: now,
    });

    // ── 5. Publicar anuncio automático en el tablón ─────────────────────────────
    const { format } = await import('date-fns');
    const { es } = await import('date-fns/locale');
    const fechaFormateada = format(new Date(fecha), "d 'de' MMMM yyyy", { locale: es });

    await db.collection('anuncios').add({
      comunidad_id,
      autor_id:     uid,
      titulo:       tipo === 'reunion' ? `Reunion: ${titulo.trim()}` : titulo.trim(),
      contenido:    descripcion?.trim()
        ? `${descripcion.trim()}\n\nFecha: ${fechaFormateada}`
        : `Fecha: ${fechaFormateada}`,
      fijado:       false,
      publicado_at: now,
      created_at:   now,
      tipo_origen:  'evento_calendario',
      evento_id:    eventoRef.id,
    });

    return NextResponse.json({ ok: true, id: eventoRef.id });

  } catch (err: any) {
    console.error('[POST /api/calendario/evento]', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
