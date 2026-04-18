'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Crown, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const plans = [
  {
    id: 'basico',
    name: 'Básico',
    price: '79',
    icon: Zap,
    color: 'border-blue-200 bg-blue-50/30',
    buttonColor: 'bg-blue-600 hover:bg-blue-700',
    features: [
      'Hasta 3 comunidades',
      'Gestión de incidencias',
      'Votaciones con coeficientes',
      'Cotizador IA',
      'Reportes básicos',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '149',
    icon: Crown,
    color: 'border-finca-coral bg-finca-peach/20',
    buttonColor: 'bg-finca-coral hover:bg-finca-coral/90',
    popular: true,
    features: [
      'Comunidades ilimitadas',
      'Todo lo de Básico',
      'Actas digitales con IA',
      'Alertas inteligentes',
      'Reportes avanzados',
      'Soporte prioritario',
    ],
  },
];

export default function PricingPage() {
  const router = useRouter();
  const { user, perfil } = useAuth();
  const [loading, setLoading] = useState<string | null>(null);

  async function handleSubscribe(planId: string) {
    if (!user || !perfil) return;
    setLoading(planId);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          plan: planId,
          userId: perfil.id,
          email: user.email,
          comunidadId: perfil.comunidad_id,
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error(data.error || 'Error al iniciar el pago');
      }
    } catch {
      toast.error('Error de conexión');
    }
    setLoading(null);
  }

  return (
    <div className="pb-8">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-border px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()} className="w-8 h-8 -ml-1">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="font-semibold text-finca-dark">Planes de administrador</h1>
      </div>

      <div className="px-4 py-6 space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-finca-dark">Gestiona tu comunidad como un pro</h2>
          <p className="text-sm text-muted-foreground">Los vecinos usan FincaOS gratis. El panel de administrador tiene coste mensual.</p>
        </div>

        <div className="grid gap-4 max-w-sm mx-auto">
          {plans.map((plan) => {
            const Icon = plan.icon;
            return (
              <Card key={plan.id} className={cn('border-2 relative', plan.color)}>
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-finca-coral text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase">Popular</span>
                  </div>
                )}
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center">
                      <Icon className="w-5 h-5 text-finca-coral" />
                    </div>
                    <div>
                      <p className="font-bold text-finca-dark">{plan.name}</p>
                      <p className="text-2xl font-bold text-finca-dark">{plan.price}€<span className="text-sm font-normal text-muted-foreground">/mes</span></p>
                    </div>
                  </div>

                  <ul className="space-y-2">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm text-finca-dark">
                        <Check className="w-4 h-4 text-green-500 shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  <Button
                    className={cn('w-full text-white h-11', plan.buttonColor)}
                    onClick={() => handleSubscribe(plan.id)}
                    disabled={loading !== null}
                  >
                    {loading === plan.id
                      ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : 'Suscribirse'}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
