/**
 * lib/ai/providerAssignment.ts
 *
 * Two exported functions:
 *
 *  selectBestProveedor()   — pure selector; scores all active providers
 *                            in-memory and returns the best match (or null).
 *                            No Firestore writes; safe to call anywhere.
 *
 *  assignBestProvider()    — orchestrator; calls selectBestProveedor, then:
 *                              1. Updates the incidencia with assignment fields
 *                              2. Creates a presupuesto request in the
 *                                 provider's subcollection
 *                              3. Notifies the provider via notificaciones
 *                              4. Sends a community-level notification
 *                            Idempotent — skips if already assigned.
 *                            Always fail-safe — never throws.
 *
 * Matching priority:
 *   +50  tipo_problema matches provider's servicios
 *   +50  tipo_problema matches provider's especialidad
 *   +30  categoria_nombre matches servicios (fuzzy)
 *   +30  categoria_nombre matches especialidad (fuzzy)
 *   +20  incidencia zona is in provider's zonas[]
 *   +0–25  rating (0–5) × 5
 *
 * Only activo === true providers are considered.
 * Providers with score === 0 are excluded (no relevant skill match).
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { Logger }    from '@/lib/logger';
import type { MetricaCache } from '@/lib/ai/proveedorMetrics';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProveedorResult {
  id:    string;
  data:  FirebaseFirestore.DocumentData;
  score: number;
}

interface SelectParams {
  db:               Firestore;
  /** incidencia.tipo_problema (technical routing key) */
  tipoProblema:     string;
  /** Human-readable category name for fuzzy matching */
  categoriaNombre:  string;
  /** Optional zona for geo-preference bonus */
  zona?:            string;
}

interface AssignParams {
  db:                    Firestore;
  comunidadId:           string;
  incidenciaId:          string;
  zona:                  string;
  categoriaId:           string | null;
  categoriaNombre:       string;
  /** Frequency map from child incidencias { [categoria_id]: count } */
  childrenCategoryFreq:  Record<string, number>;
  now:                   string;  // ISO timestamp
  log:                   Logger;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Lowercase + strip diacritics for fuzzy field matching */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// ── selectBestProveedor ───────────────────────────────────────────────────────

/**
 * Fetches all active providers and returns the highest-scoring match,
 * or null if no provider has a relevant skill for this incidencia.
 *
 * Pure selector — no side effects.
 */
export async function selectBestProveedor({
  db,
  tipoProblema,
  categoriaNombre,
  zona,
}: SelectParams): Promise<ProveedorResult | null> {

  const snap = await db.collection('proveedores')
    .where('activo', '==', true)
    .get();

  if (snap.empty) return null;

  const normTipo      = tipoProblema    ? normalise(tipoProblema)    : '';
  const normCategoria = categoriaNombre ? normalise(categoriaNombre) : '';

  const scored: ProveedorResult[] = snap.docs.map(d => {
    const data   = d.data();
    let score    = 0;

    const svcs  = (data.servicios   as string[] | undefined) ?? [];
    const zonas = (data.zonas       as string[] | undefined) ?? [];
    const espec = normalise(String(data.especialidad ?? ''));

    const normSvcs = svcs.map(normalise);

    // Primary signal: tipo_problema match (+50)
    if (normTipo) {
      if (normSvcs.includes(normTipo)) score += 50;
      if (espec === normTipo)          score += 50;
    }

    // Secondary signal: categoria_nombre match (+30)
    if (normCategoria) {
      if (normSvcs.includes(normCategoria)) score += 30;
      if (espec === normCategoria)           score += 30;
    }

    // Zona preference (+20)
    if (zona && zonas.includes(zona)) score += 20;

    // Rating bonus: 0–5 → 0–25
    score += (Number(data.rating) || Number(data.promedio_rating) || 0) * 5;

    // ── Learning score (Task 6) ─────────────────────────────────────────────
    // Uses the compact `metricas` cache stored directly on the provider doc.
    // Zero extra Firestore reads — data is already present in this snapshot.
    // Fallback safe: if no metricas yet, these lines have no effect.
    const metricas = data.metricas as MetricaCache | undefined;
    if (metricas && metricas.total_trabajos > 0) {
      // Faster resolution = better. Baseline: 30 h → 0 pts; 0 h → +30 pts.
      score += Math.max(0, 30 - (metricas.tiempo_promedio_resolucion ?? 999));
      // Cheaper = better. Baseline: 200 € → 0 pts; 0 € → +20 pts.
      score += Math.max(0, 20 - (metricas.coste_promedio ?? 0) / 10);
      // Reopen rate penalty: 100 % reopen → −40 pts.
      score -= (metricas.tasa_reapertura ?? 0) * 40;
    }

    return { id: d.id, data, score };
  });

  const best = scored
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)[0];

  return best ?? null;
}

// ── assignBestProvider ────────────────────────────────────────────────────────

/**
 * Orchestrator: selects the best provider and writes all side-effects.
 * Auto-assignment rules:
 *   - Skips if incidencia already has proveedor_asignado set (idempotent)
 *   - Skips if no matching active provider found
 *   - Never changes the incidencia's estado — state machine stays clean
 *   - Never throws — logs all failures and returns
 */
export async function assignBestProvider(params: AssignParams): Promise<void> {
  const {
    db, comunidadId, incidenciaId, zona,
    categoriaId, categoriaNombre, childrenCategoryFreq, now, log,
  } = params;

  try {
    // ── Step 0: Idempotency guard ──────────────────────────────────────────
    const incSnap = await db.collection('incidencias').doc(incidenciaId).get();
    if (!incSnap.exists) {
      log.info('ai_assign_skip_missing', { incidencia_id: incidenciaId });
      return;
    }
    const incData = incSnap.data()!;

    if (incData.proveedor_asignado) {
      log.info('ai_assign_skip_already_assigned', {
        incidencia_id: incidenciaId,
        proveedor_id:  incData.proveedor_asignado,
      });
      return;
    }

    // ── Step 1: Resolve dominant category from children ────────────────────
    let resolvedCategoryId   = categoriaId;
    let resolvedCategoryName = categoriaNombre;

    const freqKeys = Object.keys(childrenCategoryFreq);
    if (freqKeys.length > 0) {
      const dominant = freqKeys.sort(
        (a, b) => (childrenCategoryFreq[b] ?? 0) - (childrenCategoryFreq[a] ?? 0),
      )[0];
      resolvedCategoryId = dominant;

      if (dominant !== categoriaId) {
        try {
          const catSnap = await db.collection('categorias_incidencia').doc(dominant).get();
          if (catSnap.exists) {
            resolvedCategoryName = String(catSnap.data()?.nombre ?? resolvedCategoryName);
          }
        } catch {
          // Keep original name as fallback
        }
      }
    }

    // Use incidencia's tipo_problema if present (more specific than categoria)
    const tipoProblema = String(incData.tipo_problema ?? resolvedCategoryId ?? '');

    // ── Step 2: Select best provider ───────────────────────────────────────
    const result = await selectBestProveedor({
      db,
      tipoProblema,
      categoriaNombre: resolvedCategoryName,
      zona,
    });

    if (!result) {
      log.info('ai_assign_no_provider_found', {
        incidencia_id:    incidenciaId,
        tipo_problema:    tipoProblema,
        categoria_nombre: resolvedCategoryName,
        categoria_id:     resolvedCategoryId,
      });
      return;
    }

    const provId     = result.id;
    const provNombre = String(result.data.nombre ?? 'Proveedor');

    // ── Step 3: Assign provider to the incidencia ──────────────────────────
    // NOTE: We do NOT change `estado` here — the state machine must progress
    // through the normal presupuesto → acceptance flow.
    await db.collection('incidencias').doc(incidenciaId).update({
      proveedor_asignado: provId,
      proveedor_nombre:   provNombre,
      asignado_por:       'sistema_ia',
      asignado_at:        now,
      updated_at:         now,
    });

    log.info('ai_assign_provider_assigned', {
      incidencia_id:    incidenciaId,
      proveedor_id:     provId,
      proveedor_nombre: provNombre,
      tipo_problema:    tipoProblema,
      score:            result.score,
    });

    // ── Step 4: Create presupuesto request in provider's subcollection ─────
    // The provider sees this in their dashboard and fills in an amount.
    // Written to the denormalized path so no collectionGroup query needed.
    try {
      const incTitulo = String(incData.titulo ?? 'Incidencia sin título');
      await db
        .collection('proveedores').doc(provId)
        .collection('presupuestos').doc(incidenciaId)
        .set({
          incidencia_id:        incidenciaId,
          incidencia_titulo:    incTitulo,
          monto:                null,         // provider fills this in
          mensaje:              '',
          estado:               'pendiente',
          solicitud_automatica: true,         // badge hint for the provider UI
          asignado_por:         'sistema_ia',
          created_at:           now,
        });
    } catch (err) {
      // Non-fatal — assignment already written to incidencia
      log.error('ai_assign_presupuesto_request_failed', err, { proveedor_id: provId });
    }

    // ── Step 5: Notify the provider (user-level) ───────────────────────────
    // Providers share the same UID as their auth account.
    // The notificaciones collection is keyed by usuario_id.
    try {
      await db.collection('notificaciones').add({
        usuario_id: provId,
        tipo:       'nuevo_trabajo',
        titulo:     '🔧 Nuevo trabajo asignado',
        mensaje:    `Se te ha asignado automáticamente una incidencia en ${zona}: "${incData.titulo}"`,
        link:       `/proveedor/dashboard`,
        leida:      false,
        created_at: now,
      });
    } catch (err) {
      log.error('ai_assign_provider_notification_failed', err, { proveedor_id: provId });
    }

    // ── Step 6: Community-level notification ───────────────────────────────
    try {
      const catLabel = resolvedCategoryName && resolvedCategoryName !== 'Sin categoría'
        ? ` de tipo "${resolvedCategoryName}"`
        : '';
      await db
        .collection('comunidades').doc(comunidadId)
        .collection('notificaciones').add({
          tipo:          'proveedor_asignado',
          titulo:        `🤖 Proveedor asignado automáticamente`,
          mensaje:       `${provNombre} ha sido asignado${catLabel} en ${zona}.`,
          proveedor_id:  provId,
          incidencia_id: incidenciaId,
          created_at:    now,
          created_by:    'sistema_ia',
          link:          `/incidencias/${incidenciaId}`,
        });
    } catch (err) {
      log.error('ai_assign_community_notification_failed', err, { proveedor_id: provId });
    }

  } catch (err) {
    // Top-level catch — never propagate; parent incidencia already exists
    log.error('ai_assign_failed', err, {
      incidencia_id: incidenciaId,
      zona,
      categoria_id:  categoriaId,
    });
  }
}
