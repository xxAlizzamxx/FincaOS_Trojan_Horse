'use client';

/**
 * SoundDemo — componente de prueba para verificar sonido + animaciones GSAP.
 * Colócalo temporalmente en cualquier página para probar.
 *
 * Uso:
 *   import { SoundDemo } from '@/components/ui/sound-demo';
 *   <SoundDemo />
 */

import { useRef } from 'react';
import { useSound } from '@/hooks/useSound';
import { FX, safeGsap } from '@/lib/sound/gsapEffects';
import { SOUND_MAP, SoundEvent } from '@/lib/sound/sounds';

const EVENT_LABELS: Record<SoundEvent, string> = {
  incidencia_creada:   '🚨 Incidencia',
  mediacion_iniciada:  '🤝 Mediación',
  voto_emitido:        '✅ Voto',
  publicacion_tablon:  '📋 Tablón',
  pago_realizado:      '💳 Pago',
  documento_publicado: '📄 Documento',
};

// Mapa de efectos GSAP para cada evento
const GSAP_FX: Record<SoundEvent, (el?: Element | null) => void> = {
  incidencia_creada:   FX.incidencia,
  mediacion_iniciada:  FX.mediacion,
  voto_emitido:        FX.voto,
  publicacion_tablon:  FX.tablon,
  pago_realizado:      FX.pago,
  documento_publicado: FX.documento,
};

export function SoundDemo() {
  const { playWithEffect, toggle, enabled } = useSound();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Ref para el botón de test GSAP directo
  const testBtnRef = useRef<HTMLButtonElement>(null);

  const events = Object.keys(SOUND_MAP) as SoundEvent[];

  /** Test GSAP puro — sin sonido, confirma que GSAP funciona en el DOM */
  function testGsapDirect() {
    safeGsap(
      testBtnRef.current,
      { scale: 0.6, rotate: -15, opacity: 0.4 },
      { scale: 1, rotate: 0, opacity: 1, duration: 0.7, ease: 'elastic.out(1, 0.3)' },
    );
  }

  return (
    <div className="p-4 border border-dashed border-finca-coral/40 rounded-2xl space-y-3 bg-finca-peach/10">
      <p className="text-xs font-semibold text-finca-coral uppercase tracking-wide">
        🔊 Sound + GSAP — Demo
      </p>

      {/* Test GSAP directo — confirma que GSAP funciona antes de probar el sistema */}
      <div className="p-3 rounded-xl bg-yellow-50 border border-yellow-200 space-y-2">
        <p className="text-[10px] font-semibold text-yellow-700 uppercase tracking-wide">
          1️⃣ Test GSAP directo (sin sonido)
        </p>
        <button
          ref={testBtnRef}
          onClick={testGsapDirect}
          className="w-full h-10 px-3 text-xs font-semibold rounded-xl bg-yellow-400
                     hover:bg-yellow-500 text-yellow-900 transition-colors active:scale-95"
        >
          ⚡ Probar animación GSAP
        </button>
        <p className="text-[10px] text-yellow-600">
          Si este botón NO rebota → GSAP no está funcionando en este entorno
        </p>
      </div>

      {/* Botones de sonido + GSAP por evento */}
      <div className="space-y-1">
        <p className="text-[10px] font-semibold text-finca-coral uppercase tracking-wide">
          2️⃣ Sonido + animación GSAP por evento
        </p>
        <div className="grid grid-cols-2 gap-2">
          {events.map((event) => (
            <button
              key={event}
              ref={(el) => { refs.current[event] = el; }}
              onClick={() => playWithEffect(event, GSAP_FX[event], refs.current[event])}
              className="h-10 px-3 text-xs font-medium rounded-xl bg-white border border-finca-coral/20
                         hover:border-finca-coral/60 hover:bg-finca-peach/20 transition-colors
                         text-finca-dark active:scale-95"
            >
              {EVENT_LABELS[event]}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={toggle}
        className="w-full h-8 text-xs rounded-xl border border-border hover:bg-muted/40
                   text-muted-foreground transition-colors"
      >
        Sonido: {enabled ? '🔊 ON' : '🔇 OFF'}
      </button>

      <p className="text-[10px] text-muted-foreground text-center">
        Abre DevTools → Console para ver logs. Si ves [safeGsap] el es null, el ref no está asignado.
      </p>
    </div>
  );
}
