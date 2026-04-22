/**
 * lib/ai/providerAssignment.ts
 *
 * Auto-assigns the best available provider to an AI-generated inspection
 * incidencia based on the dominant category of the grouped children.
 *
 * Matching strategy (in order of priority):
 *   1. Provider.especialidad === normalised categoria_nombre
 *   2. Provider.servicios array-contains normalised categoria_nombre
 *   3. Provider.especialidad === raw categoria_nombre (case-sensitive fallback)
 *
 * Within each match group, the highest-rated provider is selected.
 *
 * Always fail-safe — never throws.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { Logger }    from '@/lib/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AssignParams {
  db:                    Firestore;
  comunidadId:           string;
  incidenciaId:          string;
  zona:                  string;
  categoriaId:           string | null;
  categoriaNombre:       string;
  /** Frequency map built from children { [categoria_id]: count } */
  childrenCategoryFreq:  Record<string, number>;
  now:                   string;  // ISO timestamp
  /** Logger from createLogger() */
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

// ── Main function ─────────────────────────────────────────────────────────────

export async function assignBestProvider(params: AssignParams): Promise<void> {
  const {
    db, comunidadId, incidenciaId, zona,
    categoriaId, categoriaNombre, childrenCategoryFreq, now, log,
  } = params;

  try {
    // ── Step 1: resolve dominant category ─────────────────────────────────
    //
    // Prefer the most-frequent category found among children.
    // Fall back to the category that triggered the pattern (passed in body).

    let resolvedCategoryId   = categoriaId;
    let resolvedCategoryName = categoriaNombre;

    const freqKeys = Object.keys(childrenCategoryFreq);
    if (freqKeys.length > 0) {
      const dominant = freqKeys.sort(
        (a, b) => (childrenCategoryFreq[b] ?? 0) - (childrenCategoryFreq[a] ?? 0),
      )[0];
      resolvedCategoryId = dominant;

      // Fetch category name from Firestore if we changed the ID
      if (dominant !== categoriaId) {
        try {
          const catSnap = await db.collection('categorias_incidencia').doc(dominant).get();
          if (catSnap.exists) resolvedCategoryName = String(catSnap.data()?.nombre ?? resolvedCategoryName);
        } catch {
          // Keep original name as fallback
        }
      }
    }

    if (!resolvedCategoryName) {
      log.info('ai_assign_skip_no_category', { incidencia_id: incidenciaId });
      return;
    }

    const normName = normalise(resolvedCategoryName);

    // ── Step 2: find best provider ─────────────────────────────────────────
    //
    // Try three query strategies, stop at first match.

    let proveedorDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

    // Strategy A: especialidad == normalised name
    if (!proveedorDoc) {
      const snap = await db.collection('proveedores')
        .where('especialidad', '==', normName)
        .orderBy('rating', 'desc')
        .limit(1)
        .get();
      if (!snap.empty) proveedorDoc = snap.docs[0];
    }

    // Strategy B: especialidad == raw name (handles mixed-case data)
    if (!proveedorDoc && normName !== resolvedCategoryName.toLowerCase()) {
      const snap = await db.collection('proveedores')
        .where('especialidad', '==', resolvedCategoryName)
        .orderBy('rating', 'desc')
        .limit(1)
        .get();
      if (!snap.empty) proveedorDoc = snap.docs[0];
    }

    // Strategy C: servicios array-contains normalised name
    if (!proveedorDoc) {
      const snap = await db.collection('proveedores')
        .where('servicios', 'array-contains', normName)
        .orderBy('rating', 'desc')
        .limit(1)
        .get();
      if (!snap.empty) proveedorDoc = snap.docs[0];
    }

    // Strategy D: servicios array-contains raw name
    if (!proveedorDoc) {
      const snap = await db.collection('proveedores')
        .where('servicios', 'array-contains', resolvedCategoryName)
        .orderBy('rating', 'desc')
        .limit(1)
        .get();
      if (!snap.empty) proveedorDoc = snap.docs[0];
    }

    if (!proveedorDoc) {
      log.info('ai_assign_no_provider_found', {
        incidencia_id:   incidenciaId,
        categoria_nombre: resolvedCategoryName,
        categoria_id:    resolvedCategoryId,
      });
      return;
    }

    // ── Step 3: assign provider to the parent incidencia ──────────────────
    const provData   = proveedorDoc.data();
    const provId     = proveedorDoc.id;
    const provNombre = String(provData.nombre ?? 'Proveedor');

    await db.collection('incidencias').doc(incidenciaId).update({
      proveedor_asignado: provId,
      proveedor_nombre:   provNombre,
      estado:             'asignado',
      updated_at:         now,
    });

    log.info('ai_assign_provider_assigned', {
      incidencia_id:    incidenciaId,
      proveedor_id:     provId,
      proveedor_nombre: provNombre,
      categoria_nombre: resolvedCategoryName,
    });

    // ── Step 4: notify provider via community notifications ───────────────
    // (Optional — non-fatal if it fails)
    try {
      await db
        .collection('comunidades').doc(comunidadId)
        .collection('notificaciones').add({
          tipo:          'nuevo_trabajo',
          titulo:        `🔧 Trabajo asignado: ${resolvedCategoryName} en ${zona}`,
          mensaje:       `Se ha asignado automáticamente una inspección preventiva de "${resolvedCategoryName}" en la zona "${zona}" al proveedor ${provNombre}.`,
          proveedor_id:  provId,
          incidencia_id: incidenciaId,
          created_at:    now,
          created_by:    'sistema_ia',
          link:          `/incidencias/${incidenciaId}`,
        });
    } catch (err) {
      log.error('ai_assign_notification_failed', err, { proveedor_id: provId });
    }

  } catch (err) {
    // Fail-safe: log but never propagate — parent incidencia is already created
    log.error('ai_assign_failed', err, {
      incidencia_id: incidenciaId,
      zona,
      categoria_id:  categoriaId,
    });
  }
}
