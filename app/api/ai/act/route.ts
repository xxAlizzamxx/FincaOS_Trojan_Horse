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
  let categoriaNombre: string;
  let categoriaId: string | null;

  try {
    const body    = await req.json();
    zona          = String(body.zona ?? '').trim();
    comunidadId   = String(body.comunidadId ?? '').trim();
    count         = Number(body.count ?? 0);
    severity      = String(body.severity ?? 'warning');
    categoriaId   = body.categoria_id ? String(body.categoria_id).trim() : null;
    categoriaNombre = body.categoria_nombre ? String(body.categoria_nombre).trim() : '';
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  if (!zona || !comunidadId) {
    return NextResponse.json({ error: 'zona y comunidadId son obligatorios' }, { status: 400 });
  }

  log.info('ai_act_start', { comunidad_id: comunidadId, zona, count, severity });

  const db  = getAdminDb();
  const now = new Date().toISOString();

  // ── 4. Idempotency: skip if an AI inspection already exists for this
  //      EXACT zone + categoria_id combination today.
  //
  //  IMPORTANT: the check must include categoria_id so that two different
  //  category alerts in the same zone (e.g. "jardin + filtraciones" and
  //  "jardin + electricidad") are allowed to coexist as separate inspections.
  //  Without this, the second inspection would falsely match the first one.
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const todayIso = todayMidnight.toISOString();

  try {
    // Build query scoped to zona + categoria_id.
    // Firestore supports `where('field', '==', null)` to match null / missing field.
    let dupQuery = db.collection('incidencias')
      .where('comunidad_id',  '==', comunidadId)
      .where('autor_id',      '==', 'sistema_ia')
      .where('zona',          '==', zona)
      .where('tipo_problema', '==', 'inspeccion_preventiva')
      .where('categoria_id',  '==', categoriaId); // null matches null/missing

    const existing  = await dupQuery.get();
    const todayDup  = existing.docs.find(d => (d.data().created_at as string) >= todayIso);

    if (todayDup) {
      log.info('ai_act_duplicate_skipped', {
        incidencia_id: todayDup.id,
        zona,
        categoria_id: categoriaId,
      });
      return NextResponse.json({ ok: true, incidencia_id: todayDup.id, duplicate: true });
    }
  } catch (err) {
    // Can't check — proceed anyway (better to duplicate than to block)
    log.error('ai_act_idempotency_check_failed', err, { zona, categoria_id: categoriaId });
  }

  // ── 5. Fetch open children to group under the parent ────────────────────
  // Only fetch incidencias that are: open (not resuelta/cerrada), in same zone,
  // not already AI-generated parents, and not already children of another parent.
  let hijosIds: string[] = [];
  try {
    const childrenQuery = await db.collection('incidencias')
      .where('comunidad_id', '==', comunidadId)
      .where('zona',         '==', zona)
      .get();

    hijosIds = childrenQuery.docs
      .filter(d => {
        const data  = d.data();
        const estado = data.estado as string;

        // Exclude resolved / closed
        if (['resuelta', 'cerrada'].includes(estado)) return false;
        // Exclude AI-generated docs (inspection parents, chat incidencias with sistema_ia)
        if (data.autor_id === 'sistema_ia') return false;
        // Exclude incidencias already grouped under another inspection
        if (data.parentId) return false;
        // Exclude other AI inspection parents
        if (data.tipo_problema === 'inspeccion_preventiva') return false;

        // Category matching:
        //   If this inspection has a category, only group incidencias of that
        //   same category (or those with no category at all — uncategorized ones
        //   are always relevant to the zone).
        //   If this inspection has NO category (zona_caliente, not categoria_caliente),
        //   group all open incidencias in the zone regardless of their category.
        if (categoriaId) {
          const childCat = data.categoria_id ? String(data.categoria_id) : null;
          // Include only: exact category match OR incidencia has no category
          if (childCat && childCat !== categoriaId) return false;
        }

        return true;
      })
      .map(d => d.id);
  } catch (err) {
    log.error('ai_act_fetch_children_failed', err, { comunidad_id: comunidadId, zona });
    // Non-fatal — proceed without children
  }

  // ── 6. Create parent inspection incidencia ──────────────────────────────
  const zonaLabel   = zona.charAt(0).toUpperCase() + zona.slice(1).replace('_', ' ');
  const catLabel    = categoriaNombre && categoriaNombre !== 'Sin categoría' ? ` · ${categoriaNombre}` : '';
  const titulo      = `🔍 Inspección preventiva — ${zonaLabel}${catLabel}`;
  const descripcion =
    `Inspección solicitada por el sistema IA tras detectar ${count} incidencia${count !== 1 ? 's' : ''} ` +
    `activa${count !== 1 ? 's' : ''}` +
    (categoriaNombre && categoriaNombre !== 'Sin categoría' ? ` de tipo "${categoriaNombre}"` : '') +
    ` en ${zona}. ` +
    (severity === 'danger'
      ? 'Situación crítica — se recomienda intervención inmediata.'
      : 'Inspección preventiva para evitar escalamiento.');

  let incidenciaId: string;
  try {
    const ref = await db.collection('incidencias').add({
      comunidad_id:          comunidadId,
      autor_id:              'sistema_ia',
      creado_por:            'sistema_ia',
      creado_por_avatar:     'ia',
      origen:                'pattern_engine',
      titulo,
      descripcion,
      categoria_id:          categoriaId,
      estado:                'pendiente',
      prioridad:             'urgente',
      ubicacion:             zona,
      zona,
      tipo_problema:         'inspeccion_preventiva',
      // ── Parent-child fields ──
      hijos:                 hijosIds,
      total_hijos:           hijosIds.length,
      // ────────────────────────
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

  // ── 7. Batch-update children with parentId ───────────────────────────────
  if (hijosIds.length > 0) {
    try {
      // Firestore batch limit is 500 writes
      const BATCH_SIZE = 400;
      for (let i = 0; i < hijosIds.length; i += BATCH_SIZE) {
        const batch = db.batch();
        hijosIds.slice(i, i + BATCH_SIZE).forEach(childId => {
          batch.update(db.collection('incidencias').doc(childId), {
            parentId:   incidenciaId,
            updated_at: now,
          });
        });
        await batch.commit();
      }
      log.info('ai_act_children_linked', { incidencia_id: incidenciaId, hijos: hijosIds.length });
    } catch (err) {
      // Non-fatal — parent created, children just don't have parentId yet
      log.error('ai_act_batch_update_failed', err, { incidencia_id: incidenciaId });
    }
  }

  // ── 8. Community notification ────────────────────────────────────────────
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
