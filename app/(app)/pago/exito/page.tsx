'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const TIPO_LABEL: Record<string, { titulo: string; ruta: (ref: string) => string }> = {
  cuota:      { titulo: 'Cuota pagada',         ruta: () => '/cuotas'          },
  mediacion:  { titulo: 'Mediación pagada',      ruta: (ref) => `/mediaciones/${ref}` },
  incidencia: { titulo: 'Pago registrado',       ruta: (ref) => `/incidencias/${ref}` },
};

export default function PagoExitoPage() {
  const params  = useSearchParams();
  const router  = useRouter();
  const tipo    = params.get('tipo') ?? 'cuota';
  const ref     = params.get('ref')  ?? '';
  const cfg     = TIPO_LABEL[tipo] ?? TIPO_LABEL.cuota;

  function volverAlDetalle() {
    router.push(cfg.ruta(ref));
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-gradient-to-b from-green-50 to-white">
      <Card className="w-full max-w-sm border-0 shadow-lg">
        <CardContent className="p-8 flex flex-col items-center text-center space-y-4">

          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>

          <div className="space-y-1">
            <h1 className="text-xl font-bold text-finca-dark">{cfg.titulo}</h1>
            <p className="text-sm text-muted-foreground">
              Tu pago se ha procesado correctamente. En breve recibirás la confirmación.
            </p>
          </div>

          <div className="w-full pt-2 space-y-2">
            <Button
              className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-11 rounded-xl"
              onClick={volverAlDetalle}
            >
              Ver detalle
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
