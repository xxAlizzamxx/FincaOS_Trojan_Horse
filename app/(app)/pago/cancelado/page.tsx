'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { XCircle, ArrowLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const TIPO_RUTA: Record<string, (ref: string) => string> = {
  cuota:      () => '/cuotas',
  mediacion:  (ref) => `/mediaciones/${ref}`,
  incidencia: (ref) => `/incidencias/${ref}`,
};

export default function PagoCanceladoPage() {
  const params = useSearchParams();
  const router = useRouter();
  const tipo   = params.get('tipo') ?? 'cuota';
  const ref    = params.get('ref')  ?? '';
  const ruta   = (TIPO_RUTA[tipo] ?? TIPO_RUTA.cuota)(ref);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-gradient-to-b from-red-50 to-white">
      <Card className="w-full max-w-sm border-0 shadow-lg">
        <CardContent className="p-8 flex flex-col items-center text-center space-y-4">

          <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center">
            <XCircle className="w-10 h-10 text-red-500" />
          </div>

          <div className="space-y-1">
            <h1 className="text-xl font-bold text-finca-dark">Pago cancelado</h1>
            <p className="text-sm text-muted-foreground">
              No se ha realizado ningún cargo. Puedes intentarlo de nuevo cuando quieras.
            </p>
          </div>

          <div className="w-full pt-2 space-y-2">
            <Button
              className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-11 rounded-xl"
              onClick={() => router.push(ruta)}
            >
              <RefreshCw className="w-4 h-4 mr-1.5" />
              Intentar de nuevo
            </Button>
            <Button
              variant="ghost"
              className="w-full text-muted-foreground h-10"
              onClick={() => router.push('/inicio')}
            >
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              Ir al inicio
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
