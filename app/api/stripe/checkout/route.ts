import { NextRequest, NextResponse } from 'next/server';
import { getStripe, PLANS } from '@/lib/stripe';
import { getAuth } from 'firebase-admin/auth';
import { getApps, initializeApp, cert } from 'firebase-admin/app';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

/** Allowed plan keys — explicit whitelist prevents prototype-pollution attacks */
const VALID_PLANS = new Set(Object.keys(PLANS));

export async function POST(req: NextRequest) {
  // ── Auth guard ─────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  let uid: string;
  try {
    const decoded = await getAuth().verifyIdToken(authHeader.slice(7));
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
  }

  try {
    const { plan, userId, email, comunidadId } = await req.json();

    // ── Input validation ──────────────────────────────────────────────────
    if (!plan || !VALID_PLANS.has(plan)) {
      return NextResponse.json({ error: 'Plan no válido' }, { status: 400 });
    }
    // Caller must supply their own uid — prevent creating sessions for other users
    if (userId && userId !== uid) {
      return NextResponse.json({ error: 'userId no coincide con el token' }, { status: 403 });
    }

    const planData = PLANS[plan as keyof typeof PLANS];

    const origin = req.headers.get('origin') || 'http://localhost:3000';

    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      metadata: { userId, comunidadId, plan },
      line_items: [
        {
          price_data: {
            currency: 'eur',
            unit_amount: planData.price,
            recurring: { interval: 'month' },
            product_data: {
              name: `FincaOS ${planData.name}`,
              description: planData.features.join(', '),
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/admin?subscription=success`,
      cancel_url: `${origin}/admin?subscription=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error('Stripe checkout error:', error);
    return NextResponse.json({ error: 'Error al crear la sesión de pago' }, { status: 500 });
  }
}
