import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  /* ── 1. Validate env ── */
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE ERROR: Missing STRIPE_SECRET_KEY');
    return NextResponse.json({ error: 'Missing STRIPE_SECRET_KEY' }, { status: 500 });
  }

  /* ── 2. Init Stripe ── */
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  /* ── 3. Parse & validate body ── */
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  console.log('BODY:', JSON.stringify(body));

  const { monto, tipo, referencia_id, usuario_id, comunidad_id, descripcion, email } = body;

  if (!monto)        return NextResponse.json({ error: 'Falta: monto'        }, { status: 400 });
  if (!tipo)         return NextResponse.json({ error: 'Falta: tipo'         }, { status: 400 });
  if (!referencia_id) return NextResponse.json({ error: 'Falta: referencia_id' }, { status: 400 });
  if (!usuario_id)   return NextResponse.json({ error: 'Falta: usuario_id'   }, { status: 400 });

  /* ── 4. Generate pago ID (no Firestore dependency) ── */
  const pagoId = crypto.randomUUID();

  /* ── 5. Persist pago in Firestore (non-fatal — requires Firebase Admin vars) ── */
  try {
    const { getAdminDb } = await import('@/lib/firebase/admin');
    const db = getAdminDb();
    await db.collection('pagos').doc(pagoId).set({
      id:           pagoId,
      usuario_id,
      comunidad_id: comunidad_id ?? null,
      tipo,
      referencia_id,
      monto,
      estado:       'pendiente',
      created_at:   new Date().toISOString(),
    });
    console.log('Firestore pago creado:', pagoId);
  } catch (fbErr: any) {
    // Log but do NOT abort — Stripe checkout still works without this write
    console.warn('Firestore write skipped (check FIREBASE_ADMIN_* vars):', fbErr.message);
  }

  /* ── 6. Create Stripe Checkout session ── */
  const origin = req.headers.get('origin') || 'https://finca-os-trojan-horse.vercel.app';

  const labelMap: Record<string, string> = {
    cuota:      'Cuota de comunidad',
    mediacion:  'Servicio de mediación',
    incidencia: 'Presupuesto de reparación',
  };

  try {
    const session = await stripe.checkout.sessions.create({
      mode:                 'payment',
      payment_method_types: ['card'],
      customer_email:       email ?? undefined,
      metadata: {
        pago_id:      pagoId,
        tipo,
        referencia_id,
        usuario_id,
        comunidad_id: comunidad_id ?? '',
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency:    'eur',
            unit_amount: Math.round(Number(monto) * 100),
            product_data: {
              name:        descripcion ?? labelMap[tipo] ?? 'Pago FincaOS',
              description: `Referencia: ${referencia_id}`,
            },
          },
        },
      ],
      success_url: `${origin}/pago/exito?tipo=${tipo}&ref=${referencia_id}&pago_id=${pagoId}`,
      cancel_url:  `${origin}/pago/cancelado?tipo=${tipo}&ref=${referencia_id}`,
    });

    console.log('Stripe session creada:', session.id, '→', session.url);
    return NextResponse.json({ url: session.url, pago_id: pagoId });

  } catch (error: any) {
    console.error('STRIPE ERROR:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
