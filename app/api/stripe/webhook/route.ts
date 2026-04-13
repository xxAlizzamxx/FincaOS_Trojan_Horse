import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Missing signature or webhook secret' }, { status: 400 });
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Process events
  // Note: In production, use Firebase Admin SDK for server-side Firestore writes.
  // For now, we log and return success — the client will poll subscription status.
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      console.log('[Stripe] Checkout completed:', {
        userId: session.metadata?.userId,
        plan: session.metadata?.plan,
        customerId: session.customer,
      });
      break;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      console.log('[Stripe] Subscription cancelled:', subscription.id);
      break;
    }
  }

  return NextResponse.json({ received: true });
}
