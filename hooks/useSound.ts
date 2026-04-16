'use client';

/**
 * useSound — hook React para el sistema de sonido.
 *
 * Devuelve:
 *  · play(event)            → reproduce un evento de sonido
 *  · playWithEffect(...)    → reproduce + ejecuta animación GSAP/CSS
 *  · toggle()               → activa/desactiva sonido
 *  · enabled                → estado actual (sincronizado entre tabs vía storage event)
 *
 * Uso básico:
 *   const { play, enabled, toggle } = useSound();
 *   play('pago_realizado');
 *
 * Con GSAP:
 *   playWithEffect('voto_emitido', (el) => {
 *     gsap.from(el, { scale: 1.2, duration: 0.3 });
 *   }, buttonRef.current);
 */

import { useCallback, useEffect, useState } from 'react';
import { soundManager, AnimationEffect } from '@/lib/sound/soundManager';
import { SoundEvent } from '@/lib/sound/sounds';

export function useSound() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return soundManager.enabled;
  });

  /* Sincronizar con cambios externos (otros tabs, toggle desde otro componente) */
  useEffect(() => {
    const handleToggle = (e: Event) => {
      setEnabled((e as CustomEvent<{ enabled: boolean }>).detail.enabled);
    };

    window.addEventListener('sound:toggle', handleToggle);
    return () => window.removeEventListener('sound:toggle', handleToggle);
  }, []);

  const play = useCallback((event: SoundEvent) => {
    soundManager.play(event);
  }, []);

  const playWithEffect = useCallback(
    (event: SoundEvent, effect: AnimationEffect, el?: Element | null) => {
      soundManager.playWithEffect(event, effect, el);
    },
    [],
  );

  const toggle = useCallback(() => {
    const next = soundManager.toggle();
    setEnabled(next);
    return next;
  }, []);

  return { play, playWithEffect, toggle, enabled } as const;
}
