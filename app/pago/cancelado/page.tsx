'use client';

import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { XCircle, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const TIPO_REDIRECT: Record<string, string> = {
  cuota:      '/cuotas',
  cobro:      '/mensajes-admin',
  mediacion:  '/mediaciones',
  incidencia: '/incidencias',
};

function PagoCanceladoContent() {
  const params = useSearchParams();
  const router = useRouter();
  const tipo   = params.get('tipo') ?? 'cuota';

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-sm border-0 shadow-xl rounded-3xl overflow-hidden">
        <div className="bg-gradient-to-br from-gray-400 to-gray-500 p-8 text-center">
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
            <XCircle className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Pago cancelado</h1>
          <p className="text-gray-100 text-sm mt-1">El pago no se completó</p>
        </div>
        <CardContent className="p-6 space-y-4">
          <p className="text-sm text-center text-muted-foreground">
            El proceso de pago fue cancelado. No se ha realizado ningún cargo.
          </p>
          <Button
            className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white rounded-xl h-11"
            onClick={() => router.push(TIPO_REDIRECT[tipo] ?? '/inicio')}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Volver
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PagoCanceladoPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    }>
      <PagoCanceladoContent />
    </Suspense>
  );
}
