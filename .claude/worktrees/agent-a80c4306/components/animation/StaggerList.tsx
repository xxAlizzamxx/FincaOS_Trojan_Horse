'use client';

/**
 * StaggerList — aplica animación de stagger a sus hijos directos.
 *
 * Uso:
 *   <StaggerList className="space-y-3">
 *     <Card>Vecino 1</Card>
 *     <Card>Vecino 2</Card>
 *     <Card>Vecino 3</Card>
 *   </StaggerList>
 *
 * Cada hijo recibe data-animate automáticamente → PageTransition los
 * recoge en el stagger global. StaggerList también anima independientemente
 * cuando se monta (útil en subpáginas sin cambio de pathname).
 *
 * Props:
 *   - as         → etiqueta HTML del wrapper ('div' | 'ul' | 'ol' | 'section')
 *   - stagger    → segundos entre items (default 0.07)
 *   - delay      → segundos antes de iniciar (default 0)
 *   - from       → variables GSAP de origen (override del preset)
 *   - className  → clases del wrapper
 */

import { useRef, useEffect, Children, cloneElement, isValidElement } from 'react';
import { gsap } from 'gsap';

interface StaggerListProps {
  children    : React.ReactNode;
  className?  : string;
  as?         : 'div' | 'ul' | 'ol' | 'section';
  stagger?    : number;
  delay?      : number;
  from?       : gsap.TweenVars;
}

export function StaggerList({
  children,
  className,
  as: Tag    = 'div',
  stagger    = 0.07,
  delay      = 0,
  from       = { opacity: 0, y: 18 },
}: StaggerListProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const items = el.querySelectorAll(':scope > *'); // solo hijos directos
    if (items.length === 0) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        items,
        from,
        {
          opacity    : 1,
          y          : 0,
          duration   : 0.32,
          ease       : 'power2.out',
          stagger,
          delay,
          clearProps : 'opacity,y',
        },
      );
    }, ref);

    return () => ctx.revert();
  }, []); // solo en mount — PageTransition maneja re-entradas por pathname

  /* Clonar hijos para agregar data-animate automáticamente */
  const taggedChildren = Children.map(children, (child) =>
    isValidElement(child)
      ? cloneElement(child as React.ReactElement<Record<string, unknown>>, { 'data-animate': '' })
      : child,
  );

  return (
    // @ts-expect-error — ref genérico para cualquier etiqueta HTML
    <Tag ref={ref} className={className}>
      {taggedChildren}
    </Tag>
  );
}
