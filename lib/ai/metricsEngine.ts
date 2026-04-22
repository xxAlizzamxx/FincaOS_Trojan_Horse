/**
 * lib/ai/metricsEngine.ts
 *
 * Time-to-resolution analytics engine for FincaOS.
 *
 * Exported functions:
 *   computeZonaMetrics(comunidadId, db) → AIMetricsDoc  — reads + writes Firestore
 *
 * Output stored in: ai_metrics/{comunidadId}
 *
 * Design:
 *   - Admin SDK only — no client SDK
 *   - Fail-safe — never throws to caller
 *   - Backward-compatible — only reads existing fields (zona, created_at, resuelta_at)
 */

import type { Firestore } from 'firebase-admin/firestore';
import { getAdminDb }    from '@/lib/firebase/admin';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ZonaMetric {
  zona:             string;
  total_resueltas:  number;
  promedio_dias:    number;  // average days from created_at → resuelta_at
  min_dias:         number;
  max_dias:         number;
}

export interface AIMetricsDoc {
  comunidad_id:              string;
  total_resueltas:           number;
  tiempo_resolucion_zonas:   ZonaMetric[];
  actualizado_at:            string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MS_PER_DAY = 1_000 * 60 * 60 * 24;

// ── Core computation ─────────────────────────────────────────────────────────

/**
 * Reads all resolved incidencias for a community, computes per-zona
 * time-to-resolution statistics, persists to ai_metrics/{comunidadId},
 * and returns the result.
 *
 * Uses the existing `resuelta_at` + `created_at` fields.
 * Incidencias missing either timestamp are silently skipped.
 */
export async function computeZonaMetrics(
  comunidadId: string,
  db?: Firestore,
): Promise<AIMetricsDoc> {
  const adminDb = db ?? getAdminDb();

  // ── Fetch all resolved incidencias ────────────────────────────────────────
  const snap = await adminDb
    .collection('incidencias')
    .where('comunidad_id', '==', comunidadId)
    .where('estado',       '==', 'resuelta')
    .get();

  // ── Bucket resolution times by zona ──────────────────────────────────────
  const buckets: Record<string, number[]> = {};

  for (const docSnap of snap.docs) {
    const data = docSnap.data();

    const createdAt  = data.created_at  as string | undefined;
    const resueltaAt = data.resuelta_at as string | undefined;
    const zona       = data.zona        as string | undefined;

    if (!createdAt || !resueltaAt || !zona) continue;

    const ms = new Date(resueltaAt).getTime() - new Date(createdAt).getTime();
    if (ms < 0) continue; // skip bad/corrupted timestamps

    if (!buckets[zona]) buckets[zona] = [];
    buckets[zona].push(ms);
  }

  // ── Build per-zona metrics ────────────────────────────────────────────────
  const tiempo_resolucion_zonas: ZonaMetric[] = Object.entries(buckets)
    .map(([zona, tiempos]) => {
      const avg = tiempos.reduce((a, b) => a + b, 0) / tiempos.length;
      return {
        zona,
        total_resueltas: tiempos.length,
        promedio_dias:   +((avg)                        / MS_PER_DAY).toFixed(1),
        min_dias:        +(Math.min(...tiempos)          / MS_PER_DAY).toFixed(1),
        max_dias:        +(Math.max(...tiempos)          / MS_PER_DAY).toFixed(1),
      };
    })
    // Sort by worst (slowest) zone first so the admin sees the problem areas at top
    .sort((a, b) => b.promedio_dias - a.promedio_dias);

  const result: AIMetricsDoc = {
    comunidad_id:            comunidadId,
    total_resueltas:         snap.size,
    tiempo_resolucion_zonas,
    actualizado_at:          new Date().toISOString(),
  };

  // ── Persist to Firestore ──────────────────────────────────────────────────
  await adminDb
    .collection('ai_metrics')
    .doc(comunidadId)
    .set(result, { merge: true });

  return result;
}
