'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle2, ArrowLeft, Download, Loader2 } from 'lucide-react';
import { useSound } from '@/hooks/useSound';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { generarReciboPDF } from '@/lib/recibo';
import { toast } from 'sonner';

const TIPO_LABEL: Record<string, { titulo: string; ruta: (ref: string) => string }> = {
  cuota:      { titulo: 'Cuota pagada',         ruta: () => '/cuotas'                  },
  cobro:      { titulo: 'Cobro pagado',          ruta: () => '/mensajes-admin'          },
  mediacion:  { titulo: 'Mediación pagada',      ruta: (ref) => `/mediaciones/${ref}`   },
  incidencia: { titulo: 'Pago registrado',       ruta: (ref) => `/incidencias/${ref}`   },
};

export default function PagoExitoPage() {
  const params  = useSearchParams();
  const router  = useRouter();
  const { perfil } = useAuth();
  const tipo    = params.get('tipo') ?? 'cuota';
  const ref     = params.get('ref')  ?? '';
  const pagoId  = params.get('pago_id') ?? '';
  const monto   = parseFloat(params.get('monto') ?? '0') || 0;
  const concepto = decodeURIComponent(params.get('concepto') ?? '') || (TIPO_LABEL[tipo]?.titulo ?? 'Pago');
  const cfg     = TIPO_LABEL[tipo] ?? TIPO_LABEL.cuota;
  const { play } = useSound();
  const [descargando, setDescargando] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => play('pago_realizado'), 400);
    return () => clearTimeout(t);
  }, [play]);

  async function descargarRecibo() {
    if (!perfil) { toast.error('Cargando datos del perfil...'); return; }
    setDescargando(true);
    try {
      await generarReciboPDF({
        tipo:      tipo as any,
        concepto,
        monto,
        fecha:     new Date().toISOString(),
        nombre:    perfil.nombre_completo,
        comunidad: (perfil as any).comunidad?.nombre ?? perfil.comunidad_id ?? '',
        pagoId,
      });
    } catch {
      toast.error('Error al generar el recibo');
    } finally {
      setDescargando(false);
    }
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
              onClick={() => router.push(cfg.ruta(ref))}
            >
              Ver detalle
            </Button>
            <Button
              variant="outline"
              className="w-full h-10 border-green-200 text-green-700 hover:bg-green-50"
              onClick={descargarRecibo}
              disabled={descargando || !perfil}
            >
              {descargando
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Download className="w-4 h-4 mr-2" />}
              Descargar comprobante PDF
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
