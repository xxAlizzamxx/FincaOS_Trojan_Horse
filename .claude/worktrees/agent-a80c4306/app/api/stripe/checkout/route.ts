import { NextRequest, NextResponse } from 'next/server';
import { getStripe, PLANS } from '@/lib/stripe';

export async function POST(req: NextRequest) {
  try {
    const { plan, userId, email, comunidadId } = await req.json();

    const planData = PLANS[plan as keyof typeof PLANS];
    if (!planData) {
      return NextResponse.json({ error: 'Plan no válido' }, { status: 400 });
    }

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
