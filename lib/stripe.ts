import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2026-03-25.dahlia',
    });
  }
  return _stripe;
}

export const PLANS = {
  basico: {
    name: 'Admin Básico',
    price: 7900, // cents
    priceDisplay: '79€/mes',
    features: ['Hasta 3 comunidades', 'Gestión de incidencias', 'Votaciones', 'Reportes básicos'],
  },
  pro: {
    name: 'Admin Pro',
    price: 14900,
    priceDisplay: '149€/mes',
    features: ['Comunidades ilimitadas', 'Todo lo de Básico', 'Actas digitales con IA', 'Reportes avanzados', 'Soporte prioritario'],
  },
} as const;
