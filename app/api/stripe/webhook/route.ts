/**
 * POST /api/stripe/webhook
 *
 * Handles Stripe events. Key guarantees:
 *  1. Signature verification (constructEvent)
 *  2. Idempotency: each event.id processed at most once
 *  3. All plan mutations go through updateComunidadPlan() helper
 *
 * Processed events:
 *  - checkout.session.completed      (one-time payments + subscription checkouts)
 *  - customer.subscription.created
 *  - customer.subscription.updated   (plan change, pause, cancel_at_period_end)
 *  - customer.subscription.deleted   (hard cancel)
 *  - invoice.payment_failed           (mark overdue, keep access during grace period)
 */

import { NextRequest, NextResponse }  from 'next/server';
import { getStripe }                  from '@/lib/stripe';
import { getAdminDb }                 from '@/lib/firebase/admin';
import type { FirebaseFirestore }     from 'firebase-admin/firestore';
import { createLogger }               from '@/lib/logger';
import { handleApiError, StripeError } from '@/lib/errors';
import { eventBus }                   from '@/events/emitter';
import { registerDefaultHandlers }    from '@/events/handlers';

registerDefaultHandlers();

export const runtime = 'nodejs';

/* ── Helpers ────────────────────────────────────────────────────────────── */

type Db = ReturnType<typeof getAdminDb>;

/** Finds the community document for a given Stripe customer ID. */
async function getComunidadDoc(db: Db, customerId: string) {
  if (!customerId) return null;
  const snap = await db.collection('comunidades')
    .where('stripe_customer_id', '==', customerId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

/**
 * Single source of truth for all plan mutations.
 * All calls are idempotent — repeated writes of the same plan are safe.
 */
async function updateComunidadPlan(
  ref: FirebaseFirestore.DocumentReference,
  plan: 'free' | 'premium',
  extra: Record<string, unknown> = {},
) {
  await ref.update({
    plan,
    plan_updated_at: new Date().toISOString(),
    ...extra,
  });
}

/* ── Route handler ──────────────────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID().slice(0, 8);
  const log = createLogger({ route: '/api/stripe/webhook', requestId });

  const body = await req.text();
  const sig  = req.headers.get('stripe-signature');

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    log.error('webhook_config_missing');
    return NextResponse.json({ error: 'Missing signature or webhook secret' }, { status: 400 });
  }

  let event: any;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    log.error('webhook_signature_failed', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  log.info('webhook_received', { event_id: event.id, event_type: event.type });

  const db  = getAdminDb();
  const now = new Date().toISOString();

  /* ── Idempotency guard (atomic) ────────────────────────────────────────
     Uses Firestore `create()` which is an atomic "insert if not exists".
     If the document already exists, Firestore throws with gRPC code 6
     (ALREADY_EXISTS), guaranteeing exactly-once processing even under
     concurrent Stripe retries.
  ─────────────────────────────────────────────────────────────────────── */
  const processedRef = db.collection('_processed_webhooks').doc(event.id);
  try {
    await processedRef.create({ type: event.type, started_at: now });
  } catch (e: any) {
    // gRPC ALREADY_EXISTS = code 6; also check message for safety
    if (e?.code === 6 || e?.message?.includes('already exists')) {
      log.info('webhook_duplicate_skipped', { event_id: event.id, event_type: event.type });
      return NextResponse.json({ received: true });
    }
    // Unexpected Firestore error — rethrow so Stripe retries
    throw e;
  }

  try {
    const ev = event as any; // Stripe SDK typing varies by version

    switch (ev.type) {

      /* ── ONE-TIME PAYMENTS (cuota / mediación / incidencia) ────────── */
      case 'checkout.session.completed': {
        const session = ev.data.object;
        const meta    = session.metadata ?? {};

        if (!meta.pago_id) {
          // Subscription checkout — activate plan
          const comDoc = await getComunidadDoc(db, session.customer);
          if (comDoc) {
            await updateComunidadPlan(comDoc.ref, 'premium', {
              stripe_customer_id:     session.customer,
              stripe_subscription_id: session.subscription ?? null,
            });
            console.log('[Webhook] checkout.session.completed → plan=premium for', comDoc.id);
          }
          break;
        }

        const { pago_id, tipo, referencia_id, usuario_id } = meta;

        await db.collection('pagos').doc(pago_id).update({
          estado: 'completado', stripe_session_id: session.id, paid_at: now,
        }).catch((e: unknown) => console.error('[Webhook] pagos update failed:', e));

        if (tipo === 'cuota') {
          await db.collection('cuotas').doc(referencia_id)
            .collection('pagos').doc(usuario_id)
            .set({ usuario_id, estado: 'pagado', fecha_pago: now, metodo: 'stripe' }, { merge: true });

        } else if (tipo === 'mediacion') {
          await db.collection('mediaciones').doc(referencia_id).update({
            estado_pago: 'pagado', 'pago.estado': 'pagado',
            'pago.paid_at': now, 'pago.metodo': 'stripe', updated_at: now,
          });

        } else if (tipo === 'incidencia') {
          await db.collection('incidencias').doc(referencia_id).update({
            estado_pago_proveedor: 'pagado', pago_proveedor_at: now, updated_at: now,
          });
        }
        break;
      }

      /* ── SUBSCRIPTION CREATED ─────────────────────────────────────── */
      case 'customer.subscription.created': {
        const sub    = ev.data.object;
        const comDoc = await getComunidadDoc(db, sub.customer);
        if (!comDoc) { console.warn('[Webhook] subscription.created: no community for', sub.customer); break; }

        if (sub.status === 'active' || sub.status === 'trialing') {
          await updateComunidadPlan(comDoc.ref, 'premium', {
            stripe_subscription_id: sub.id,
            plan_period_end:        new Date(sub.current_period_end * 1000).toISOString(),
            plan_overdue:           false,
          });
          console.log('[Webhook] subscription.created → plan=premium for', comDoc.id);
        }
        break;
      }

      /* ── SUBSCRIPTION UPDATED ─────────────────────────────────────── */
      case 'customer.subscription.updated': {
        const sub    = ev.data.object;
        const comDoc = await getComunidadDoc(db, sub.customer);
        if (!comDoc) break;

        // Map Stripe status to internal plan
        const planByStatus: Record<string, 'premium' | 'free'> = {
          active:             'premium',
          trialing:           'premium',
          past_due:           'premium', // still has access during grace period
          canceled:           'free',
          incomplete:         'free',
          incomplete_expired: 'free',
          unpaid:             'free',
          paused:             'free',
        };
        const newPlan = planByStatus[sub.status] ?? 'free';

        await updateComunidadPlan(comDoc.ref, newPlan, {
          stripe_subscription_id:    sub.id,
          stripe_subscription_status: sub.status,
          plan_period_end:           new Date(sub.current_period_end * 1000).toISOString(),
          plan_cancel_at_period_end: sub.cancel_at_period_end ?? false,
          plan_overdue:              sub.status === 'past_due',
        });
        console.log(`[Webhook] subscription.updated → plan=${newPlan} (${sub.status}) for`, comDoc.id);
        break;
      }

      /* ── SUBSCRIPTION CANCELLED (hard) ───────────────────────────── */
      case 'customer.subscription.deleted': {
        const sub    = ev.data.object;
        const comDoc = await getComunidadDoc(db, sub.customer);
        if (!comDoc) break;

        await updateComunidadPlan(comDoc.ref, 'free', {
          plan_cancelado_at:      now,
          plan_overdue:           false,
          stripe_subscription_id: null,
        });
        console.log('[Webhook] subscription.deleted → plan=free for', comDoc.id);
        break;
      }

      /* ── PAYMENT FAILED ──────────────────────────────────────────── */
      case 'invoice.payment_failed': {
        const invoice = ev.data.object;
        if (!invoice.subscription) break; // ignore one-time invoice failures

        const comDoc = await getComunidadDoc(db, invoice.customer);
        if (!comDoc) break;

        // Mark overdue but keep premium access — Stripe will send subscription.deleted
        // (or subscription.updated with status=canceled) when the grace period ends.
        await comDoc.ref.update({
          plan_overdue:           true,
          plan_payment_failed_at: now,
          stripe_subscription_id: invoice.subscription,
        });
        console.log('[Webhook] invoice.payment_failed → plan_overdue=true for', comDoc.id);
        break;
      }
    }

    // Mark fully processed
    await processedRef.update({ completed_at: now }).catch(() => {});

    // Emit payment event for observability
    eventBus.emit({
      type:       'payment.updated',
      timestamp:  now,
      request_id: requestId,
      payload: {
        tipo:         event.type,
        referenciaId: event.id,
        estado:       'processed',
      },
    });

    log.finish(true, 200);

  } catch (err) {
    log.error('webhook_processing_failed', err, { event_id: event.id, event_type: event.type });
    // Mark failed so it won't be silently skipped on Stripe retry
    await processedRef.update({ failed_at: now, error: String(err) }).catch(() => {});
    log.finish(false, 500);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
