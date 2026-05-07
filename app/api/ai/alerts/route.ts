/**
 * GET /api/ai/alerts?comunidadId=XXX
 *
 * Returns smart alerts for an admin panel:
 *   1. Pattern detection — 5+ open incidents of same category in last 30 days
 *   2. Expiration alerts — vencimientos within the next 15 days
 *
 * Safety contract:
 *   - ALWAYS returns { alerts: [] } on any failure — never throws or returns 5xx
 *   - Each alert type is computed independently; one failure never cancels the other
 *   - Read-only (Admin SDK) — never mutates Firestore data
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';

export interface SmartAlert {
  type: 'pattern' | 'expiration';
  severity: 'warning' | 'danger';
  message: string;
  data: Record<string, unknown>;
}

const PATTERN_THRESHOLD = 5;
const EXPIRATION_DAYS   = 15;
const PATTERN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const RESOLVED_STATES = new Set(['resuelta', 'cerrada']);

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const comunidadId = searchParams.get('comunidadId');

  if (!comunidadId || typeof comunidadId !== 'string' || comunidadId.trim() === '') {
    return NextResponse.json({ alerts: [] });
  }

  const alerts: SmartAlert[] = [];

  // ── 1. Pattern detection ──────────────────────────────────────────────────
  // Isolated try/catch — expiration alerts still run if this fails.
  //
  // NOTE: Firestore does not allow combining `not-in` with `>=` on different
  // fields in the same query. We fetch by comunidad_id only and filter
  // estado + created_at client-side to avoid index errors.
  try {
    const db     = getAdminDb();
    const cutoff = new Date(Date.now() - PATTERN_WINDOW_MS).toISOString();

    const incSnap = await db
      .collection('incidencias')
      .where('comunidad_id', '==', comunidadId)
      .get();

    const byCategory: Record<string, number> = {};

    for (const docSnap of incSnap.docs) {
      const data = docSnap.data();
      // Client-side filters (avoid compound index requirements)
      if (RESOLVED_STATES.has(data.estado ?? '')) continue;
      if ((data.created_at ?? '') < cutoff) continue;

      const cat: string = data.categoria ?? 'sin_categoria';
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }

    for (const [categoria, count] of Object.entries(byCategory)) {
      if (count >= PATTERN_THRESHOLD) {
        alerts.push({
          type:     'pattern',
          severity: 'warning',
          message:  `Se detectaron ${count} incidencias de "${categoria}" en los últimos 30 días. Posible problema estructural o recurrente.`,
          data:     { categoria, count },
        });
      }
    }
  } catch (patternErr) {
    // Log but never propagate — expiration alerts below will still run
    console.error('[/api/ai/alerts] Pattern detection failed:', patternErr);
  }

  // ── 2. Expiration alerts ──────────────────────────────────────────────────
  // Isolated try/catch — pattern alerts above are already in the array.
  try {
    const db       = getAdminDb();
    const now      = new Date();
    const deadline = new Date(now.getTime() + EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

    const vencSnap = await db
      .collection('vencimientos')
      .where('comunidadId', '==', comunidadId)
      .get();

    for (const docSnap of vencSnap.docs) {
      const { tipo, fecha } = docSnap.data() as { tipo?: string; fecha?: string };
      if (!tipo || !fecha) continue;

      let fechaDate: Date;
      try {
        fechaDate = new Date(fecha);
        if (isNaN(fechaDate.getTime())) continue; // invalid date string
      } catch {
        continue;
      }

      if (fechaDate > deadline) continue; // too far in the future

      const isPast   = fechaDate < now;
      const daysLeft = Math.ceil((fechaDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const fechaLabel = fechaDate.toLocaleDateString('es-ES', {
        day: '2-digit', month: 'long', year: 'numeric',
      });

      alerts.push({
        type:     'expiration',
        severity: isPast ? 'danger' : 'warning',
        message:  isPast
          ? `Vencimiento vencido: ${tipo} — venció el ${fechaLabel}.`
          : `Vencimiento próximo: ${tipo} — ${fechaLabel} (en ${daysLeft} días).`,
        data: { tipo, fecha, daysLeft },
      });
    }
  } catch (expirationErr) {
    console.error('[/api/ai/alerts] Expiration check failed:', expirationErr);
  }

  // Sort: danger first, then by message alphabetically for stable ordering
  alerts.sort((a, b) => {
    if (a.severity === 'danger' && b.severity !== 'danger') return -1;
    if (b.severity === 'danger' && a.severity !== 'danger') return  1;
    return a.message.localeCompare(b.message);
  });

  return NextResponse.json({ alerts });
}
