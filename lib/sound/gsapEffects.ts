/**
 * gsapEffects.ts — Helper GSAP seguro + presets de animación por evento.
 *
 * ¿Por qué este archivo existe?
 *   GSAP debe importarse explícitamente en cada módulo que lo use.
 *   soundManager.playWithEffect() espera un callback (el) => void
 *   que el caller define. Este archivo provee efectos listos para usar.
 *
 * Uso:
 *   import { FX } from '@/lib/sound/gsapEffects';
 *   const { playWithEffect } = useSound();
 *
 *   playWithEffect('voto_emitido', FX.voto, btnRef.current);
 */

import { gsap } from 'gsap';

/**
 * safeGsap — wrapper seguro sobre gsap.fromTo
 *
 * - Valida que el elemento no sea null antes de animar
 * - Cancela tweens previos sobre el mismo elemento (evita superposición)
 * - Loguea en dev si el elemento es null (ayuda a debuggear refs)
 */
export function safeGsap(
  el: Element | null | undefined,
  fromVars: gsap.TweenVars,
  toVars: gsap.TweenVars,
): void {
  if (!el) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[safeGsap] el es null — ¿ref no asignado todavía?');
    }
    return;
  }
  gsap.killTweensOf(el);
  gsap.fromTo(el, fromVars, toVars);
}

/**
 * FX — efectos GSAP predefinidos, uno por evento de sonido.
 * Cada función es un AnimationEffect: (el?: Element | null) => void
 * Compatible directamente con playWithEffect(event, FX.xxx, ref.current).
 */
export const FX = {
  /** Voto emitido — bounce elástico hacia arriba */
  voto: (el?: Element | null) =>
    safeGsap(
      el,
      { scale: 0.78, opacity: 0.55 },
      { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(2.8)' },
    ),

  /** Pago realizado — salto elástico con leve desplazamiento */
  pago: (el?: Element | null) =>
    safeGsap(
      el,
      { scale: 0.82, y: 6 },
      { scale: 1, y: 0, duration: 0.6, ease: 'elastic.out(1, 0.4)' },
    ),

  /** Incidencia creada — deslizamiento desde la izquierda */
  incidencia: (el?: Element | null) =>
    safeGsap(
      el,
      { x: -10, opacity: 0.6 },
      { x: 0, opacity: 1, duration: 0.4, ease: 'power3.out' },
    ),

  /** Publicación tablón — pop suave con ligero fade */
  tablon: (el?: Element | null) =>
    safeGsap(
      el,
      { scale: 0.90, opacity: 0.7 },
      { scale: 1, opacity: 1, duration: 0.45, ease: 'back.out(1.7)' },
    ),

  /** Documento publicado — aparición desde arriba */
  documento: (el?: Element | null) =>
    safeGsap(
      el,
      { y: -8, opacity: 0.5 },
      { y: 0, opacity: 1, duration: 0.45, ease: 'power2.out' },
    ),

  /** Mediación iniciada — pulso de escala */
  mediacion: (el?: Element | null) =>
    safeGsap(
      el,
      { scale: 1.15, opacity: 0.8 },
      { scale: 1, opacity: 1, duration: 0.4, ease: 'power2.inOut' },
    ),
} as const;
