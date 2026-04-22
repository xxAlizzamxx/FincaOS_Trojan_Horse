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
 *   - Backward-compatible:
 *       • Reads existing `resuelta_at` + `created_at` fields
 *       • Handles both ISO string AND Firestore Timestamp formats
 *       • Falls back to `ubicacion → normalizeZona()` for legacy docs
 *         that predate the `zona` enum field (mirrors patternEngine.ts)
 */

import type { Firestore } from 'firebase-admin/firestore';
import { getAdminDb }     from '@/lib/firebase/admin';
import { normalizeZona }  from '@/lib/incidencias/mapZona';

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

// ── Timestamp helpers ─────────────────────────────────────────────────────────

/**
 * Converts a Firestore field value to a JS Date, handling:
 *   - ISO string              "2025-04-22T12:00:00.000Z"
 *   - Firestore Timestamp     { toDate(): Date, seconds: number, nanoseconds: number }
 *   - null / undefined        → returns null
 */
function toDate(value: unknown): Date | null {
  if (!value) return null;

  // Firestore Timestamp object (Admin SDK)
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).toDate === 'function'
  ) {
    return (value as { toDate(): Date }).toDate();
  }

  // ISO string or any string parseable by Date
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  // Epoch millis stored as number
  if (typeof value === 'number') {
    return new Date(value);
  }

  return null;
}

// ── Core computation ─────────────────────────────────────────────────────────

/**
 * Reads all resolved incidencias for a community, computes per-zona
 * time-to-resolution statistics, persists to ai_metrics/{comunidadId},
 * and returns the result.
 *
 * Both `zona` (canonical enum) and legacy `ubicacion` (free text) are
 * supported. Timestamps can be ISO strings or Firestore Timestamp objects.
 * Incidencias with missing/invalid timestamps are silently skipped.
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
  let skipped = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();

    // ── Resolve zona (canonical field first, then legacy ubicacion fallback) ─
    let zona: string | null = null;
    if (data.zona != null && String(data.zona).trim()) {
      zona = String(data.zona).trim();
    } else if (data.ubicacion != null) {
      zona = normalizeZona(String(data.ubicacion));
    }

    if (!zona) { skipped++; continue; }

    // ── Parse timestamps (string or Firestore Timestamp) ─────────────────
    const createdDate  = toDate(data.created_at);
    const resueltaDate = toDate(data.resuelta_at);

    if (!createdDate || !resueltaDate) { skipped++; continue; }

    const ms = resueltaDate.getTime() - createdDate.getTime();
    if (ms < 0) { skipped++; continue; }  // corrupt/future data — skip

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
    // Sort by worst (slowest) zone first
    .sort((a, b) => b.promedio_dias - a.promedio_dias);

  const result: AIMetricsDoc = {
    comunidad_id:            comunidadId,
    total_resueltas:         snap.size - skipped,
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
