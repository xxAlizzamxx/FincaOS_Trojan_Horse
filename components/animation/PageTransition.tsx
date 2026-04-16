'use client';

/**
 * PageTransition — sistema global de animaciones de página con GSAP.
 *
 * Cómo funciona:
 *   1. Envuelve el contenido de cualquier layout con este componente.
 *   2. Escucha usePathname(): en cada cambio de ruta crea una timeline GSAP.
 *   3. La timeline hace:
 *        a) Entrada de página: opacity 0→1 + y 12→0 + scale 0.985→1 (0.35s)
 *        b) Stagger de [data-animate]: los hijos directamente marcados aparecen
 *           de forma escalonada, solapándose con la animación de página.
 *   4. gsap.context() asegura limpieza automática de todos los tweens al
 *      desmontarse o al cambiar de ruta (evita memory leaks).
 *   5. useLayoutEffect (isomorphic) se ejecuta ANTES de que el navegador pinte,
 *      eliminando el flash de contenido sin estilos.
 *
 * Uso básico en un layout:
 *   <PageTransition>
 *     {children}
 *   </PageTransition>
 *
 * Uso con clase extra:
 *   <PageTransition className="flex-1 overflow-y-auto">
 *     {children}
 *   </PageTransition>
 *
 * Agregar animación a cualquier elemento:
 *   <Card data-animate>...</Card>          ← ya incluido en Card por defecto
 *   <div data-animate>...</div>            ← manual en cualquier elemento
 */

import { useRef, useLayoutEffect, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { gsap } from 'gsap';

/* ── useLayoutEffect isomorphic ──────────────────────────────────────────────
   useLayoutEffect lanza un warning en SSR. Este alias usa useEffect en servidor
   y useLayoutEffect en cliente, manteniendo la API idéntica.
   Resultado: no hay flash de contenido en cliente sin sacrificar SSR.
────────────────────────────────────────────────────────────────────────────── */
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

interface PageTransitionProps {
  children: React.ReactNode;
  /** Clase CSS aplicada al div contenedor (útil para flex, overflow, etc.) */
  className?: string;
  /**
   * Selector CSS de los elementos a animar con stagger.
   * Por defecto [data-animate] — todos los <Card> ya tienen este atributo.
   */
  staggerSelector?: string;
  /** Duración de la entrada de página en segundos. Default: 0.35 */
  duration?: number;
}

export function PageTransition({
  children,
  className,
  staggerSelector = '[data-animate]',
  duration = 0.35,
}: PageTransitionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pathname     = usePathname();

  useIsomorphicLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    /* gsap.context() limita el scope de los selectores al contenedor
       y hace .revert() en el cleanup (deshace todos los tweens/sets) */
    const ctx = gsap.context(() => {

      /* ── 1. Estado inicial inmediato (antes de pintar) ── */
      gsap.set(el, { opacity: 0, y: 12, scale: 0.985 });

      /* ── 2. Timeline de entrada ── */
      const tl = gsap.timeline();

      tl.to(el, {
        opacity : 1,
        y       : 0,
        scale   : 1,
        duration,
        ease        : 'power2.out',
        clearProps  : 'scale,y', // libera las propiedades al terminar
      });

      /* ── 3. Stagger de elementos hijos marcados ── */
      const items = el.querySelectorAll(staggerSelector);
      if (items.length > 0) {
        tl.fromTo(
          items,
          { opacity: 0, y: 16 },
          {
            opacity    : 1,
            y          : 0,
            duration   : 0.28,
            ease       : 'power2.out',
            stagger    : 0.055,       // 55ms entre cada elemento
            clearProps : 'opacity,y',
          },
          `-=${duration * 0.45}`, // solapamiento: empieza cuando la página
                                  // lleva el 55% de su animación
        );
      }

    }, containerRef); // scope del context = el contenedor

    /* cleanup: cancela todos los tweens y deshace los gsap.set() */
    return () => ctx.revert();

  }, [pathname, staggerSelector, duration]); // re-lanza en cada cambio de ruta

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
}
