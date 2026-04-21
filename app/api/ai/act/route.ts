/**
 * POST /api/ai/act
 *
 * "Actuar ahora" — triggered from the PatternAlertWidget when an admin
 * decides to take immediate action on a zona_caliente pattern.
 *
 * What it does:
 *   1. Creates a "Inspección preventiva" incidencia for the zone
 *   2. Writes a community notification so all members are informed
 *   3. Returns { ok, incidencia_id }
 *
 * Idempotency guard: if an AI-generated inspection for the same zone
 * already exists today (created_at >= today midnight), it returns
 * the existing incidencia instead of creating a duplicate.
 *
 * Auth: Bearer Firebase ID token
 * Rate limit: 5 req / 60 s per IP
 */

import { NextRequest, NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth }    from 'firebase-admin/auth';
import { getAdminDb } from '@/lib/firebase/admin';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { createLogger } from '@/lib/logger';

// ── Firebase Admin bootstrap ─────────────────────────────────────────────────
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
  const requestId = crypto.randomUUID().slice(0, 8);
  const log = createLogger({ route: '/api/ai/act', requestId });

  // ── 1. Rate limit ────────────────────────────────────────────────────────
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = await checkRateLimit(`ai-act:${ip}`, 5, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl);

  // ── 2. Auth ──────────────────────────────────────────────────────────────
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

  // ── 3. Validate body ─────────────────────────────────────────────────────
  let zona: string;
  let comunidadId: string;
  let count: number;
  let severity: string;

  try {
    const body = await req.json();
    zona        = String(body.zona ?? '').trim();
    comunidadId = String(body.comunidadId ?? '').trim();
    count       = Number(body.count ?? 0);
    severity    = String(body.severity ?? 'warning');
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  if (!zona || !comunidadId) {
    return NextResponse.json({ error: 'zona y comunidadId son obligatorios' }, { status: 400 });
  }

  log.info('ai_act_start', { comunidad_id: comunidadId, zona, count, severity });

  const db  = getAdminDb();
  const now = new Date().toISOString();

  // ── 4. Idempotency: skip if an AI inspection exists for this zone today ───
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const todayIso = todayMidnight.toISOString();

  try {
    const existing = await db.collection('incidencias')
      .where('comunidad_id',  '==', comunidadId)
      .where('autor_id',      '==', 'sistema_ia')
      .where('zona',          '==', zona)
      .where('tipo_problema', '==', 'inspeccion_preventiva')
      .get();

    const todayDup = existing.docs.find(d => (d.data().created_at as string) >= todayIso);
    if (todayDup) {
      log.info('ai_act_duplicate_skipped', { incidencia_id: todayDup.id });
      return NextResponse.json({ ok: true, incidencia_id: todayDup.id, duplicate: true });
    }
  } catch {
    // Can't check — proceed anyway (better to duplicate than to block)
  }

  // ── 5. Create inspection incidencia ─────────────────────────────────────
  const titulo      = `🔍 Inspección preventiva — ${zona.charAt(0).toUpperCase() + zona.slice(1).replace('_', ' ')}`;
  const descripcion =
    `Inspección solicitada por el sistema IA tras detectar ${count} incidencia${count !== 1 ? 's' : ''} ` +
    `activa${count !== 1 ? 's' : ''} en ${zona}. ` +
    (severity === 'danger'
      ? 'Situación crítica — se recomienda intervención inmediata.'
      : 'Inspección preventiva para evitar escalamiento.');

  let incidenciaId: string;
  try {
    const ref = await db.collection('incidencias').add({
      comunidad_id:          comunidadId,
      autor_id:              'sistema_ia',
      titulo,
      descripcion,
      categoria_id:          null,
      estado:                'pendiente',
      prioridad:             'urgente',
      ubicacion:             zona,
      zona,
      tipo_problema:         'inspeccion_preventiva',
      estimacion_min:        null,
      estimacion_max:        null,
      presupuesto_proveedor: null,
      proveedor_nombre:      null,
      escalado_por:          'sistema_ia',
      escalado_at:           now,
      accionado_por_uid:     uid,
      created_at:            now,
      updated_at:            now,
      resuelta_at:           null,
    });
    incidenciaId = ref.id;
  } catch (err) {
    log.error('ai_act_create_incidencia_failed', err, { comunidad_id: comunidadId, zona });
    return NextResponse.json({ error: 'Error al crear la incidencia' }, { status: 500 });
  }

  // ── 6. Community notification ────────────────────────────────────────────
  try {
    await db
      .collection('comunidades').doc(comunidadId)
      .collection('notificaciones').add({
        tipo:       'incidencia',
        titulo:     `🔍 Inspección iniciada en ${zona}`,
        mensaje:    `El administrador ha ordenado una inspección preventiva en ${zona} tras detectar ${count} incidencias activas.`,
        created_at: now,
        created_by: 'sistema_ia',
        related_id: incidenciaId,
        link:       `/incidencias/${incidenciaId}`,
      });
  } catch (err) {
    // Non-fatal — incidencia already created
    log.error('ai_act_notification_failed', err, { incidencia_id: incidenciaId });
  }

  log.info('ai_act_done', { comunidad_id: comunidadId, zona, incidencia_id: incidenciaId });
  return NextResponse.json({ ok: true, incidencia_id: incidenciaId });
}
