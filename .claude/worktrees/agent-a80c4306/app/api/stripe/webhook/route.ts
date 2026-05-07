import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig  = req.headers.get('stripe-signature');

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Missing signature or webhook secret' }, { status: 400 });
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error('[Webhook] Signature verification failed:', err.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  switch (event.type) {

    /* ────────────────────────────────────────────────
       ONE-TIME PAYMENT COMPLETED (cuota / mediacion / incidencia)
    ─────────────────────────────────────────────────── */
    case 'checkout.session.completed': {
      const session = event.data.object as any;
      const meta    = session.metadata ?? {};

      /* Only handle one-time payments that have pago_id */
      if (!meta.pago_id) {
        console.log('[Webhook] Subscription checkout completed (no pago_id) — skipping Firestore write');
        break;
      }

      const { pago_id, tipo, referencia_id, usuario_id } = meta;
      const paidAt = new Date().toISOString();
      const db     = getAdminDb();

      /* 1. Mark pagos/{pago_id} as completed */
      try {
        await db.collection('pagos').doc(pago_id).update({
          estado:            'completado',
          stripe_session_id: session.id,
          paid_at:           paidAt,
        });
      } catch (err) {
        console.error('[Webhook] Error updating pagos doc:', err);
      }

      /* 2. Update the referenced entity */
      try {
        if (tipo === 'cuota') {
          /* cuotas/{cuotaId}/pagos/{userId} */
          await db
            .collection('cuotas')
            .doc(referencia_id)
            .collection('pagos')
            .doc(usuario_id)
            .set(
              { usuario_id, estado: 'pagado', fecha_pago: paidAt, metodo: 'stripe' },
              { merge: true },
            );
          console.log(`[Webhook] Cuota ${referencia_id} marcada pagada por ${usuario_id}`);

        } else if (tipo === 'mediacion') {
          /* mediaciones/{mediacionId} */
          await db.collection('mediaciones').doc(referencia_id).update({
            estado_pago:         'pagado',
            'pago.estado':       'pagado',
            'pago.paid_at':      paidAt,
            'pago.metodo':       'stripe',
            updated_at:          paidAt,
          });
          console.log(`[Webhook] Mediación ${referencia_id} marcada pagada`);

        } else if (tipo === 'incidencia') {
          /* incidencias/{incidenciaId} */
          await db.collection('incidencias').doc(referencia_id).update({
            estado_pago_proveedor: 'pagado',
            pago_proveedor_at:     paidAt,
            updated_at:            paidAt,
          });
          console.log(`[Webhook] Incidencia ${referencia_id} proveedor marcado pagado`);
        }
      } catch (err) {
        console.error(`[Webhook] Error updating ${tipo} entity:`, err);
      }

      break;
    }

    /* ────────────────────────────────────────────────
       SUBSCRIPTION CANCELLED
    ─────────────────────────────────────────────────── */
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as any;
      console.log('[Webhook] Subscription cancelled:', subscription.id);
      break;
    }
  }

  return NextResponse.json({ received: true });
}
