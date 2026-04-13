import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const {
      monto,        // euros (number, e.g. 50.00)
      tipo,         // 'cuota' | 'mediacion' | 'incidencia'
      referencia_id,// cuota_id / mediacion_id / incidencia_id
      usuario_id,
      comunidad_id,
      descripcion,  // optional label shown in Stripe
      email,        // optional — pre-fills Stripe form
    } = await req.json();

    if (!monto || !tipo || !referencia_id || !usuario_id) {
      return NextResponse.json({ error: 'Faltan parámetros obligatorios' }, { status: 400 });
    }

    const origin = req.headers.get('origin') || 'http://localhost:3000';

    /* ── 1. Persist pago document in Firestore ── */
    const db = getAdminDb();
    const pagoRef = db.collection('pagos').doc();
    const pagoId  = pagoRef.id;

    await pagoRef.set({
      id:           pagoId,
      usuario_id,
      comunidad_id: comunidad_id ?? null,
      tipo,
      referencia_id,
      monto,
      estado:       'pendiente',
      created_at:   new Date().toISOString(),
    });

    /* ── 2. Create Stripe Checkout session ── */
    const labelMap: Record<string, string> = {
      cuota:      'Cuota de comunidad',
      mediacion:  'Servicio de mediación',
      incidencia: 'Presupuesto de reparación',
    };

    const session = await getStripe().checkout.sessions.create({
      mode:                 'payment',
      payment_method_types: ['card'],
      customer_email:       email ?? undefined,
      metadata: {
        pago_id:       pagoId,
        tipo,
        referencia_id,
        usuario_id,
        comunidad_id:  comunidad_id ?? '',
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency:     'eur',
            unit_amount:  Math.round(monto * 100),  // cents
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

    return NextResponse.json({ url: session.url, pago_id: pagoId });
  } catch (error: any) {
    console.error('[create-checkout-session] Error:', error);
    return NextResponse.json({ error: 'Error al crear la sesión de pago' }, { status: 500 });
  }
}
