'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle2, Download, Loader2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { generarReciboPDF } from '@/lib/recibo';
import { toast } from 'sonner';

const TIPO_LABELS: Record<string, string> = {
  cuota:      'Cuota de comunidad',
  cobro:      'Cobro',
  mediacion:  'Mediación',
  incidencia: 'Reparación',
};

const TIPO_REDIRECT: Record<string, string> = {
  cuota:      '/cuotas',
  cobro:      '/mensajes-admin',
  mediacion:  '/mediaciones',
  incidencia: '/incidencias',
};

function PagoExitoContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { perfil } = useAuth();

  const tipo     = params.get('tipo') ?? 'cuota';
  const pagoId   = params.get('pago_id') ?? '';
  const concepto = params.get('concepto') ?? TIPO_LABELS[tipo] ?? 'Pago';

  const [descargando, setDescargando] = useState(false);

  async function descargarRecibo() {
    if (!perfil) { toast.error('Cargando datos del perfil...'); return; }
    setDescargando(true);
    try {
      await generarReciboPDF({
        tipo:      tipo as any,
        concepto,
        monto:     parseFloat(params.get('monto') ?? '0') || 0,
        fecha:     new Date().toISOString(),
        nombre:    perfil.nombre_completo,
        comunidad: perfil.comunidad?.nombre ?? perfil.comunidad_id ?? '',
        pagoId,
      });
    } catch {
      toast.error('Error al generar el recibo');
    } finally {
      setDescargando(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-sm border-0 shadow-xl rounded-3xl overflow-hidden">
        {/* Green header */}
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 p-8 text-center">
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">¡Pago exitoso!</h1>
          <p className="text-green-100 text-sm mt-1">{TIPO_LABELS[tipo] ?? tipo}</p>
        </div>

        <CardContent className="p-6 space-y-4">
          {pagoId && (
            <p className="text-xs text-center text-muted-foreground">
              ID: <span className="font-mono font-medium">{pagoId.slice(0, 12).toUpperCase()}</span>
            </p>
          )}

          <p className="text-sm text-center text-muted-foreground">
            Tu pago ha sido procesado correctamente. Puedes descargar el comprobante en PDF.
          </p>

          <Button
            onClick={descargarRecibo}
            disabled={descargando || !perfil}
            className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white rounded-xl h-11"
          >
            {descargando ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            Descargar comprobante PDF
          </Button>

          <Button
            variant="outline"
            className="w-full rounded-xl h-11"
            onClick={() => router.push(TIPO_REDIRECT[tipo] ?? '/inicio')}
          >
            Volver
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PagoExitoPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    }>
      <PagoExitoContent />
    </Suspense>
  );
}
