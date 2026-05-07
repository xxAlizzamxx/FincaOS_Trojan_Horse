/**
 * lib/ai/proveedorMetrics.ts
 *
 * Learning metrics engine for provider ranking.
 *
 * Writes to TWO places to balance read cost vs. write cost:
 *
 *   proveedor_metricas/{proveedorId}
 *     Full historical record — used by the admin ranking dashboard.
 *     Admin SDK only (never client-readable in real time).
 *
 *   proveedores/{proveedorId}.metricas  (denormalised cache)
 *     Compact snapshot — included in the already-fetched provider doc
 *     so selectBestProveedor pays ZERO extra reads for scoring.
 *
 * Both are updated atomically inside the same Firestore transaction so
 * they are always consistent.
 *
 * Exported functions:
 *   updateMetricsOnResolucion()  — call when incidencia → resuelta
 *   incrementReopenCount()       — call when incidencia ← resuelta (reopen)
 */

import type { Firestore } from 'firebase-admin/firestore';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProveedorMetrica {
  proveedor_id:               string;
  proveedor_nombre:           string;
  total_trabajos:             number;
  total_reaperturas:          number;
  /** Rolling average — hours from created_at to resuelta_at */
  tiempo_promedio_resolucion: number;
  /** Rolling average — presupuesto_proveedor from each resolved incidencia */
  coste_promedio:             number;
  /** total_reaperturas / total_trabajos (0–1) */
  tasa_reapertura:            number;
  ultima_actualizacion:       string;
}

/**
 * Compact version stored directly on proveedores/{id}.metricas.
 * Keeps the scoring field set small and always in sync.
 */
export interface MetricaCache {
  total_trabajos:             number;
  tiempo_promedio_resolucion: number;
  coste_promedio:             number;
  tasa_reapertura:            number;
  actualizado_at:             string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Rolling average: (oldAvg × oldN + newValue) / newN */
function rollingAvg(oldAvg: number, oldN: number, newValue: number): number {
  return (oldAvg * oldN + newValue) / (oldN + 1);
}

// ── updateMetricsOnResolucion ─────────────────────────────────────────────────

/**
 * Called every time an incidencia reaches the `resuelta` state.
 *
 * 1. Reads the incidencia to extract proveedor_asignado, timing, and cost.
 * 2. Runs a Firestore transaction that atomically:
 *    a. Updates / creates proveedor_metricas/{proveedorId}
 *    b. Writes the compact cache to proveedores/{proveedorId}.metricas
 *    c. Writes rendimiento_proveedor back onto the incidencia (Task 8)
 *
 * Always fail-safe — logs errors but never throws.
 */
export async function updateMetricsOnResolucion(
  db:           Firestore,
  incidenciaId: string,
): Promise<void> {
  try {
    // ── 1. Fetch the incidencia ──────────────────────────────────────────────
    const incSnap = await db.collection('incidencias').doc(incidenciaId).get();
    if (!incSnap.exists) {
      console.warn('[metrics] incidencia not found:', incidenciaId);
      return;
    }
    const inc = incSnap.data()!;

    const proveedorId = inc.proveedor_asignado as string | undefined;
    if (!proveedorId) {
      // No provider assigned — nothing to learn from
      return;
    }

    // ── 2. Compute resolution time ──────────────────────────────────────────
    const createdMs  = Date.parse(inc.created_at as string);
    const resolvedMs = inc.resuelta_at
      ? Date.parse(inc.resuelta_at as string)
      : Date.now();

    const tiempoHoras = isNaN(createdMs)
      ? 0
      : Math.max(0, (resolvedMs - createdMs) / (1000 * 60 * 60));

    const coste       = Number(inc.presupuesto_proveedor ?? 0);
    const now         = new Date().toISOString();

    // ── 3. Fetch provider name (for the metrics doc display) ─────────────────
    let provNombre = 'Proveedor';
    try {
      const provSnap = await db.collection('proveedores').doc(proveedorId).get();
      if (provSnap.exists) {
        provNombre = String(provSnap.data()?.nombre ?? 'Proveedor');
      }
    } catch { /* non-fatal */ }

    // ── 4. Transaction: update metrics + cache ────────────────────────────────
    const metricRef   = db.collection('proveedor_metricas').doc(proveedorId);
    const provRef     = db.collection('proveedores').doc(proveedorId);
    const incidenciaRef = db.collection('incidencias').doc(incidenciaId);

    await db.runTransaction(async tx => {
      const metricSnap = await tx.get(metricRef);

      let newMetric: ProveedorMetrica;

      if (!metricSnap.exists) {
        newMetric = {
          proveedor_id:               proveedorId,
          proveedor_nombre:           provNombre,
          total_trabajos:             1,
          total_reaperturas:          0,
          tiempo_promedio_resolucion: tiempoHoras,
          coste_promedio:             coste,
          tasa_reapertura:            0,
          ultima_actualizacion:       now,
        };
        tx.set(metricRef, newMetric);
      } else {
        const prev   = metricSnap.data() as ProveedorMetrica;
        const total  = prev.total_trabajos + 1;
        const reabs  = prev.total_reaperturas;

        newMetric = {
          proveedor_id:               proveedorId,
          proveedor_nombre:           provNombre,
          total_trabajos:             total,
          total_reaperturas:          reabs,
          tiempo_promedio_resolucion: rollingAvg(prev.tiempo_promedio_resolucion, prev.total_trabajos, tiempoHoras),
          coste_promedio:             rollingAvg(prev.coste_promedio, prev.total_trabajos, coste),
          tasa_reapertura:            total > 0 ? reabs / total : 0,
          ultima_actualizacion:       now,
        };
        tx.set(metricRef, newMetric);
      }

      // Compact cache on proveedores doc — zero extra read in selectBestProveedor
      const cache: MetricaCache = {
        total_trabajos:             newMetric.total_trabajos,
        tiempo_promedio_resolucion: newMetric.tiempo_promedio_resolucion,
        coste_promedio:             newMetric.coste_promedio,
        tasa_reapertura:            newMetric.tasa_reapertura,
        actualizado_at:             now,
      };
      tx.update(provRef, { metricas: cache });

      // Task 8: store resolved performance on the incidencia itself
      tx.update(incidenciaRef, {
        rendimiento_proveedor: {
          tiempo_resolucion_horas: Math.round(tiempoHoras * 10) / 10,
          coste,
          evaluado_por_ia: true,
          evaluado_at:     now,
        },
      });
    });

    console.info('[metrics] updated for proveedor:', proveedorId, {
      tiempoHoras: Math.round(tiempoHoras * 10) / 10,
      coste,
    });

  } catch (err) {
    // Never throw — metrics are a non-critical enhancement
    console.error('[metrics] updateMetricsOnResolucion failed:', err);
  }
}

// ── incrementReopenCount ──────────────────────────────────────────────────────

/**
 * Called when an incidencia is moved FROM `resuelta` back to any earlier state.
 * Increments the reopen counter and recalculates tasa_reapertura.
 * Also updates the compact cache on the proveedores doc.
 *
 * Always fail-safe — logs errors but never throws.
 */
export async function incrementReopenCount(
  db:          Firestore,
  incidenciaId: string,
): Promise<void> {
  try {
    const incSnap = await db.collection('incidencias').doc(incidenciaId).get();
    if (!incSnap.exists) return;

    const proveedorId = incSnap.data()?.proveedor_asignado as string | undefined;
    if (!proveedorId) return;

    const now       = new Date().toISOString();
    const metricRef = db.collection('proveedor_metricas').doc(proveedorId);
    const provRef   = db.collection('proveedores').doc(proveedorId);

    await db.runTransaction(async tx => {
      const snap = await tx.get(metricRef);
      if (!snap.exists) return; // no metrics yet — nothing to update

      const prev      = snap.data() as ProveedorMetrica;
      const newReabs  = prev.total_reaperturas + 1;
      const total     = prev.total_trabajos;
      const newRate   = total > 0 ? newReabs / total : 0;

      tx.update(metricRef, {
        total_reaperturas:    newReabs,
        tasa_reapertura:      newRate,
        ultima_actualizacion: now,
      });

      tx.update(provRef, {
        'metricas.tasa_reapertura':    newRate,
        'metricas.actualizado_at':     now,
      });
    });

    console.info('[metrics] reopen counted for proveedor:', proveedorId);

  } catch (err) {
    console.error('[metrics] incrementReopenCount failed:', err);
  }
}
