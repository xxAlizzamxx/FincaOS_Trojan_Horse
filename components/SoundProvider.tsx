'use client';

/**
 * SoundProvider — inicializa el soundManager singleton una sola vez
 * al montar el árbol de la app.
 *
 * Colócalo dentro de <Providers> (ya está hecho en Providers.tsx).
 * No expone contexto propio — useSound() accede al singleton directamente.
 */

import { useEffect } from 'react';
import { soundManager } from '@/lib/sound/soundManager';

export function SoundProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    soundManager.init();

    /* Precargar los sonidos más frecuentes para evitar latencia en el primer uso */
    soundManager.preload('pago_realizado', 'voto_emitido', 'incidencia_creada');
  }, []);

  return <>{children}</>;
}
