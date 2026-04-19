'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function ProveedorLandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="flex flex-col items-center justify-center px-6 py-20 text-center bg-gradient-to-br from-finca-peach/30 via-background to-background">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          ¿Eres proveedor de servicios?
          <br />
          <span className="text-finca-coral">Únete a FincaOS</span>
        </h1>
        <p className="mt-4 max-w-xl text-muted-foreground text-base sm:text-lg">
          Recibe solicitudes de comunidades en tu zona, envía presupuestos y acumula valoraciones.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3">
          <Button
            asChild
            className="bg-finca-coral hover:bg-finca-coral/90 text-white"
            size="lg"
          >
            <Link href="/proveedor/registro">Registrarme como proveedor</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/proveedor/login">Ya tengo cuenta → Entrar</Link>
          </Button>
        </div>
      </section>

      {/* Benefits */}
      <section className="px-6 py-16 max-w-4xl mx-auto">
        <h2 className="text-xl font-semibold text-center mb-10">¿Por qué unirte?</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <Card>
            <CardContent className="pt-6">
              <div className="text-3xl mb-3">📩</div>
              <h3 className="font-semibold text-base mb-1">Recibe solicitudes automáticas</h3>
              <p className="text-sm text-muted-foreground">
                Las comunidades publican incidencias y tú las recibes filtradas por especialidad y zona.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-3xl mb-3">💶</div>
              <h3 className="font-semibold text-base mb-1">Presupuesta en digital</h3>
              <p className="text-sm text-muted-foreground">
                Envía presupuestos directamente desde la plataforma, sin llamadas ni papeles.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-3xl mb-3">⭐</div>
              <h3 className="font-semibold text-base mb-1">Sube en el ranking</h3>
              <p className="text-sm text-muted-foreground">
                Acumula valoraciones de vecinos y destaca frente a otros proveedores de tu sector.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
