/**
 * GET /api/cron/votaciones
 * Closes expired votaciones automatically.
 * Runs daily via Vercel Cron.
 * A votación is expired when: activa === true AND fecha_fin < now
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getAdminDb();
  const now = new Date().toISOString();

  try {
    // Find all active votaciones with fecha_fin in the past
    const snap = await db
      .collection('votaciones')
      .where('activa', '==', true)
      .where('fecha_fin', '<', now)
      .limit(100)
      .get();

    if (snap.empty) {
      return NextResponse.json({ ok: true, closed: 0 });
    }

    const batch = db.batch();
    snap.docs.forEach((d) => {
      batch.update(d.ref, {
        activa: false,
        closed_at: now,
        cerrada_por: 'cron_auto',
      });
    });
    await batch.commit();

    console.log(`[cron/votaciones] Closed ${snap.size} expired votaciones`);
    return NextResponse.json({ ok: true, closed: snap.size });
  } catch (err: any) {
    console.error('[cron/votaciones]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
