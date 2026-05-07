import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAuth } from 'firebase-admin/auth';
import { getApps, initializeApp, cert } from 'firebase-admin/app';

export const runtime = 'nodejs';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

/** Allowed payment types — prevents injection of arbitrary tipo values into metadata */
const VALID_TIPOS = new Set(['cuota', 'mediacion', 'incidencia']);

export async function POST(req: NextRequest) {

  /* ── 0. Auth guard ── */
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

  const { monto, tipo, referencia_id, usuario_id, comunidad_id, descripcion, email } = body;

  if (!monto)         return NextResponse.json({ error: 'Falta: monto' },        { status: 400 });
  if (!tipo)          return NextResponse.json({ error: 'Falta: tipo' },         { status: 400 });
  if (!referencia_id) return NextResponse.json({ error: 'Falta: referencia_id' },{ status: 400 });
  if (!usuario_id)    return NextResponse.json({ error: 'Falta: usuario_id' },   { status: 400 });

  // ── Security validations ────────────────────────────────────────────────
  // Prevent users from creating payment records for other users
  if (usuario_id !== uid) {
    return NextResponse.json({ error: 'usuario_id no coincide con el token' }, { status: 403 });
  }
  // Whitelist tipo to prevent injection into Stripe metadata
  if (!VALID_TIPOS.has(tipo)) {
    return NextResponse.json({ error: 'tipo no válido' }, { status: 400 });
  }
  // Validate monto: must be a positive number, max 99 999 €
  const montoNum = Number(monto);
  if (!Number.isFinite(montoNum) || montoNum <= 0 || montoNum > 99_999) {
    return NextResponse.json({ error: 'monto no válido (debe ser entre 0.01 y 99999 €)' }, { status: 400 });
  }

  /* ── 4. Generate pago ID (independent of Firestore) ── */
  const pagoId = crypto.randomUUID();

  /* ── 5. Firebase Admin write — NON-FATAL ── */
  console.log('Intentando guardar en Firestore...');
  try {
    const { getAdminDb } = await import('@/lib/firebase/admin');
    const db = getAdminDb();
    await db.collection('pagos').doc(pagoId).set({
      id:           pagoId,
      usuario_id,
      comunidad_id: comunidad_id ?? null,
      tipo,
      referencia_id,
      monto:        Number(monto),
      estado:       'pendiente',
      created_at:   new Date().toISOString(),
    });
    console.log('Firestore pago guardado:', pagoId);
  } catch (e: any) {
    console.error('Error Firebase:', e.message);
    // NOT fatal — Stripe checkout continues regardless
  }

  /* ── 6. Create Stripe Checkout session — ALWAYS runs ── */
  console.log('Creando sesión Stripe...');

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

    console.log('Stripe session creada:', session.id);
    return NextResponse.json({ url: session.url, pago_id: pagoId });

  } catch (error: any) {
    console.error('STRIPE ERROR:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
