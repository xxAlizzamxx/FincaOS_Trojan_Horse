'use client';

/**
 * SoundDemo — componente de prueba para verificar que el sistema funciona.
 * Colócalo temporalmente en cualquier página para probar.
 *
 * Uso:
 *   import { SoundDemo } from '@/components/ui/sound-demo';
 *   <SoundDemo />
 */

import { useRef } from 'react';
import { useSound } from '@/hooks/useSound';
import { SOUND_MAP, SoundEvent } from '@/lib/sound/sounds';

const EVENT_LABELS: Record<SoundEvent, string> = {
  incidencia_creada:   '🚨 Incidencia',
  mediacion_iniciada:  '🤝 Mediación',
  voto_emitido:        '✅ Voto',
  publicacion_tablon:  '📋 Tablón',
  pago_realizado:      '💳 Pago',
  documento_publicado: '📄 Documento',
};

const CSS_EFFECTS: Array<'sound-pop' | 'sound-shake' | 'sound-glow'> = [
  'sound-pop', 'sound-shake', 'sound-pop', 'sound-glow', 'sound-pop', 'sound-shake',
];

export function SoundDemo() {
  const { playWithCss, toggle, enabled } = useSound();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const events = Object.keys(SOUND_MAP) as SoundEvent[];

  return (
    <div className="p-4 border border-dashed border-finca-coral/40 rounded-2xl space-y-3 bg-finca-peach/10">
      <p className="text-xs font-semibold text-finca-coral uppercase tracking-wide">
        🔊 Sound System — Demo
      </p>

      <div className="grid grid-cols-2 gap-2">
        {events.map((event, i) => (
          <button
            key={event}
            ref={(el) => { refs.current[event] = el; }}
            onClick={() => playWithCss(event, refs.current[event], CSS_EFFECTS[i])}
            className="h-10 px-3 text-xs font-medium rounded-xl bg-white border border-finca-coral/20
                       hover:border-finca-coral/60 hover:bg-finca-peach/20 transition-colors
                       text-finca-dark active:scale-95"
          >
            {EVENT_LABELS[event]}
          </button>
        ))}
      </div>

      <button
        onClick={toggle}
        className="w-full h-8 text-xs rounded-xl border border-border hover:bg-muted/40
                   text-muted-foreground transition-colors"
      >
        Sonido: {enabled ? '🔊 ON' : '🔇 OFF'}
      </button>

      <p className="text-[10px] text-muted-foreground text-center">
        Abre DevTools → Console para ver logs del SoundManager
      </p>
    </div>
  );
}
