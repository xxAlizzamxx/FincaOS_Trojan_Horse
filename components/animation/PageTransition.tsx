'use client';

/**
 * PageTransition — animación de entrada en cada cambio de ruta.
 *
 * Patrón:
 *   - useEffect + gsap.fromTo: simple, sin conflictos con SSR.
 *   - Cleanup explícito con gsap.killTweensOf + clearProps:'all'
 *     → garantiza que el elemento SIEMPRE quede visible si la navegación
 *       interrumpe la animación a medias.
 *   - Sin gsap.context() para evitar el edge case de ctx.revert()
 *     interfiriendo con clearProps cuando el tween no completó.
 *   - Sin scale → evita problemas de stacking context con overflow:auto.
 */

import { useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { gsap } from 'gsap';

interface PageTransitionProps {
  children         : React.ReactNode;
  className?       : string;
  /** Selector CSS para stagger de hijos. Default: '[data-animate]' */
  staggerSelector? : string;
  /** Duración de la entrada de página en segundos. Default: 0.3 */
  duration?        : number;
}

export function PageTransition({
  children,
  className,
  staggerSelector = '[data-animate]',
  duration        = 0.3,
}: PageTransitionProps) {
  const ref      = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    /* ── Cancelar tweens anteriores y forzar visibilidad ── */
    gsap.killTweensOf(el);
    gsap.set(el, { clearProps: 'all' }); // elemento siempre visible antes de animar

    /* ── 1. Animación de entrada de página ── */
    const t1 = gsap.fromTo(
      el,
      { opacity: 0, y: 8 },
      {
        opacity    : 1,
        y          : 0,
        duration,
        ease       : 'power2.out',
        onComplete : () => gsap.set(el, { clearProps: 'y,opacity' }),
      },
    );

    /* ── 2. Stagger de elementos [data-animate] ── */
    const items = el.querySelectorAll(staggerSelector);
    let t2: gsap.core.Tween | null = null;

    if (items.length > 0) {
      gsap.killTweensOf(items);
      t2 = gsap.fromTo(
        items,
        { opacity: 0, y: 12 },
        {
          opacity    : 1,
          y          : 0,
          duration   : 0.25,
          ease       : 'power2.out',
          stagger    : 0.05,
          delay      : duration * 0.4,
          onComplete : () => gsap.set(items, { clearProps: 'y,opacity' }),
        },
      );
    }

    /* ── Cleanup: matar tweens y garantizar visibilidad ── */
    return () => {
      t1.kill();
      t2?.kill();
      gsap.killTweensOf(el);
      if (items.length > 0) gsap.killTweensOf(items);
      /* clearProps:'all' garantiza que el contenedor nunca quede atascado
         con opacity:0 si el usuario navega mientras animaba */
      gsap.set(el, { clearProps: 'all' });
    };
  }, [pathname, staggerSelector, duration]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
