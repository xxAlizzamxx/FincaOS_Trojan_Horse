'use client';

import { WifiOff, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Página de fallback offline — servida por el service worker
 * cuando no hay red y no hay caché para la ruta solicitada.
 */
export default function OfflinePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center space-y-6 bg-background">

      {/* Ilustración */}
      <div className="w-24 h-24 rounded-full bg-finca-peach/30 flex items-center justify-center">
        <WifiOff className="w-10 h-10 text-finca-coral" />
      </div>

      {/* Texto */}
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-finca-dark">Sin conexión</h1>
        <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
          Parece que no tienes conexión a internet.
          Verifica tu red y vuelve a intentarlo.
        </p>
      </div>

      {/* Acciones */}
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Button
          onClick={() => window.location.reload()}
          className="bg-finca-coral hover:bg-finca-coral/90 text-white"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Reintentar
        </Button>
        <Button
          variant="outline"
          onClick={() => { window.location.href = '/inicio'; }}
        >
          <Home className="w-4 h-4 mr-2" />
          Ir al inicio
        </Button>
      </div>

    </div>
  );
}
