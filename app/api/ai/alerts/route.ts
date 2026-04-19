/**
 * GET /api/ai/alerts?comunidadId=XXX
 *
 * Returns smart alerts for an admin panel:
 *   1. Pattern detection — 5+ open incidents of same category → structural warning
 *   2. Expiration alerts  — vencimientos within the next 15 days
 *
 * Uses Firebase Admin SDK so it bypasses client Firestore rules safely.
 * Never modifies data — read-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';

export interface SmartAlert {
  type: 'pattern' | 'expiration';
  severity: 'warning' | 'danger';
  message: string;
  data: Record<string, unknown>;
}

const PATTERN_THRESHOLD = 5;    // incidents of the same category to trigger alert
const EXPIRATION_DAYS   = 15;   // days ahead to look for vencimientos
const PATTERN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const comunidadId = searchParams.get('comunidadId');

  if (!comunidadId) {
    return NextResponse.json({ alerts: [] });
  }

  try {
    const db     = getAdminDb();
    const alerts: SmartAlert[] = [];
    const now    = new Date();
    const cutoff = new Date(now.getTime() - PATTERN_WINDOW_MS).toISOString();

    // ── 1. Pattern detection ────────────────────────────────────────────────
    // Fetch all non-resolved incidents for this community in the last 30 days
    const incSnap = await db
      .collection('incidencias')
      .where('comunidad_id', '==', comunidadId)
      .where('estado', 'not-in', ['resuelta', 'cerrada'])
      .where('created_at', '>=', cutoff)
      .get();

    // Group by categoria
    const byCategory: Record<string, number> = {};
    for (const doc of incSnap.docs) {
      const cat: string = doc.data().categoria ?? 'sin_categoria';
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

    // ── 2. Expiration alerts ────────────────────────────────────────────────
    const deadline = new Date(now.getTime() + EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

    const vencSnap = await db
      .collection('vencimientos')
      .where('comunidadId', '==', comunidadId)
      .get();

    for (const doc of vencSnap.docs) {
      const { tipo, fecha } = doc.data() as { tipo: string; fecha: string };
      if (!fecha) continue;

      const fechaDate = new Date(fecha);
      if (fechaDate <= deadline) {
        const isPast     = fechaDate < now;
        const daysLeft   = Math.ceil((fechaDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const fechaLabel = fechaDate.toLocaleDateString('es-ES', {
          day: '2-digit', month: 'long', year: 'numeric',
        });

        alerts.push({
          type:     'expiration',
          severity: isPast ? 'danger' : 'warning',
          message:  isPast
            ? `⚠ Vencimiento vencido: ${tipo} — venció el ${fechaLabel}.`
            : `Vencimiento próximo: ${tipo} — ${fechaLabel} (${daysLeft} días).`,
          data: { tipo, fecha, daysLeft },
        });
      }
    }

    // Sort: danger first, then warnings
    alerts.sort((a, b) => {
      if (a.severity === 'danger' && b.severity !== 'danger') return -1;
      if (b.severity === 'danger' && a.severity !== 'danger') return  1;
      return 0;
    });

    return NextResponse.json({ alerts });
  } catch (err) {
    // Fail silently — alerts are non-critical; never break the admin UI
    console.error('[/api/ai/alerts] Error:', err);
    return NextResponse.json({ alerts: [] });
  }
}
