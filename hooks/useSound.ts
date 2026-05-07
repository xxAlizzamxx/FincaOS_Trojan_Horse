'use client';

import { useCallback, useEffect, useState } from 'react';
import { soundManager, AnimationEffect } from '@/lib/sound/soundManager';
import { SoundEvent } from '@/lib/sound/sounds';

export function useSound() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return soundManager.enabled;
  });

  useEffect(() => {
    const handleToggle = (e: Event) => {
      setEnabled((e as CustomEvent<{ enabled: boolean }>).detail.enabled);
    };
    window.addEventListener('sound:toggle', handleToggle);
    return () => window.removeEventListener('sound:toggle', handleToggle);
  }, []);

  /** Reproduce un sonido por nombre de evento */
  const play = useCallback((event: SoundEvent) => {
    soundManager.play(event);
  }, []);

  /**
   * Reproduce sonido + ejecuta callback de animación.
   * Si el callback usa GSAP y no está instalado, cae en .sound-pop automáticamente.
   */
  const playWithEffect = useCallback(
    (event: SoundEvent, effect: AnimationEffect, el?: Element | null) => {
      soundManager.playWithEffect(event, effect, el);
    },
    [],
  );

  /**
   * Reproduce sonido + aplica clase CSS animation directamente (sin GSAP).
   * La clase se elimina sola al terminar la animación.
   * Clases disponibles: 'sound-pop' | 'sound-shake' | 'sound-glow'
   */
  const playWithCss = useCallback(
    (event: SoundEvent, el: Element | null | undefined, cls: 'sound-pop' | 'sound-shake' | 'sound-glow' = 'sound-pop') => {
      soundManager.playWithCss(event, el, cls);
    },
    [],
  );

  const toggle = useCallback(() => {
    const next = soundManager.toggle();
    setEnabled(next);
    return next;
  }, []);

  return { play, playWithEffect, playWithCss, toggle, enabled } as const;
}
