'use client';

import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle2, ArrowLeft, Download } from 'lucide-react';
import { useSound } from '@/hooks/useSound';
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
  const { play } = useSound();

  useEffect(() => {
    // Breve delay para que el AudioContext esté listo tras la navegación
    const t = setTimeout(() => play('pago_realizado'), 400);
    return () => clearTimeout(t);
  }, [play]);

  function volverAlDetalle() {
    router.push(cfg.ruta(ref));
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-gradient-to-b from-green-50 to-white">
      {/* Print receipt — only visible when printing */}
      <div id="receipt-print" className="hidden print:block print:p-8 print:max-w-md print:mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold">FincaOS</h1>
          <p className="text-sm text-gray-500">Recibo de pago</p>
        </div>
        <div className="border-t border-b border-gray-200 py-4 space-y-2 my-4">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Concepto</span>
            <span className="font-medium">{cfg.titulo}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Referencia</span>
            <span className="font-medium font-mono text-xs">{ref || 'N/A'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Estado</span>
            <span className="font-medium text-green-600">✓ Pagado</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Fecha</span>
            <span className="font-medium">{new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
          </div>
        </div>
        <p className="text-xs text-gray-400 text-center">Este documento es un comprobante de pago generado por FincaOS.</p>
      </div>

      <Card className="w-full max-w-sm border-0 shadow-lg print:hidden">
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
              variant="outline"
              className="w-full h-10 border-green-200 text-green-700 hover:bg-green-50"
              onClick={() => window.print()}
            >
              <Download className="w-4 h-4 mr-2" />
              Descargar recibo
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
