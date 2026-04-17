'use client';

import { useRef, useEffect } from 'react';
import { gsap } from 'gsap';
import { cn } from '@/lib/utils';
import type { Incidencia } from '@/types/database';

/* ── Tipos públicos ───────────────────────────────────────────── */
export type ZonaEdificio =
  | 'zona_comun'
  | 'parking'
  | 'planta_baja'
  | `piso_${number}`;

/* ── Mapear ubicación libre → zona canónica ───────────────────── */
export function ubicacionAZona(ubicacion: string | null): ZonaEdificio {
  if (!ubicacion) return 'zona_comun';
  const u = ubicacion.toLowerCase();
  if (u.includes('parking') || u.includes('garaje')) return 'parking';
  if (u.includes('baja') || u.includes('portal') || u.includes('entrada')) return 'planta_baja';
  const m = u.match(/(\d+)[ºo°]?\s*(planta|piso)/);
  if (m) return `piso_${parseInt(m[1])}`;
  if (u.includes('comun') || u.includes('común') || u.includes('jardín') || u.includes('piscina')) return 'zona_comun';
  return 'zona_comun';
}

/* ── Niveles de impacto ────────────────────────────────────────── */
type NivelImpacto = 'bajo' | 'medio' | 'critico';

const IMPACTO: Record<NivelImpacto, {
  bg: string; border: string; text: string; dot: string;
  label: string; emoji: string;
}> = {
  bajo:    { bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-700',  dot: '#22c55e', label: 'Impacto bajo',  emoji: '🟢' },
  medio:   { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', dot: '#f97316', label: 'Impacto medio', emoji: '🟠' },
  critico: { bg: 'bg-red-50',    border: 'border-red-300',    text: 'text-red-700',    dot: '#ef4444', label: 'Crítico',       emoji: '🔴' },
};

const IMPACT_ORDER: Record<string, number> = { critico: 3, medio: 2, bajo: 1 };

function nivelImpacto(items: Incidencia[]): NivelImpacto {
  if (items.some((i) => i.prioridad === 'urgente' || (i as any).quorum?.alcanzado)) return 'critico';
  if (items.some((i) => i.prioridad === 'alta')) return 'medio';
  return 'bajo';
}

function labelZona(z: ZonaEdificio): string {
  if (z === 'zona_comun')  return 'Zonas comunes';
  if (z === 'parking')     return 'Parking';
  if (z === 'planta_baja') return 'Planta baja';
  return `Piso ${z.replace('piso_', '')}`;
}

/* ── Props ─────────────────────────────────────────────────────── */
interface Props {
  incidencias: Incidencia[];
  numPisos?:   number;          // mantenido por compatibilidad, ya no se usa para renderizar
  onZonaClick: (zona: ZonaEdificio, items: Incidencia[]) => void;
}

/* ── Componente ────────────────────────────────────────────────── */
export function BuildingMap({ incidencias, onZonaClick }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  /* Agrupar por zona */
  const porZona = new Map<ZonaEdificio, Incidencia[]>();
  incidencias.forEach((inc) => {
    const zona = ubicacionAZona(inc.ubicacion);
    porZona.set(zona, [...(porZona.get(zona) ?? []), inc]);
  });

  /* Solo zonas con datos, ordenadas por impacto (crítico primero) */
  const zonas = Array.from(porZona.entries())
    .filter(([, items]) => items.length > 0)
    .sort(([, a], [, b]) =>
      (IMPACT_ORDER[nivelImpacto(b)] ?? 0) - (IMPACT_ORDER[nivelImpacto(a)] ?? 0),
    );

  /* GSAP stagger: animar cuando llegan los datos */
  useEffect(() => {
    const el = listRef.current;
    if (!el || zonas.length === 0) return;
    const children = el.querySelectorAll(':scope > button');
    const ctx = gsap.context(() => {
      gsap.fromTo(
        children,
        { opacity: 0, y: 14 },
        {
          opacity:    1,
          y:          0,
          duration:   0.35,
          ease:       'power2.out',
          stagger:    0.07,
          clearProps: 'opacity,y',
        },
      );
    }, el);
    return () => ctx.revert();
  }, [zonas.length]);   // re-anima si cambia la cantidad de zonas (carga asíncrona)

  /* Estado vacío */
  if (zonas.length === 0) {
    return (
      <div className="text-center py-14 space-y-2">
        <p className="text-2xl">🏢</p>
        <p className="text-sm font-medium text-finca-dark">Sin incidencias registradas</p>
        <p className="text-xs text-muted-foreground">El edificio está en orden</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Bloques de zonas */}
      <div ref={listRef} className="grid gap-3">
        {zonas.map(([zona, items]) => {
          const nivel = nivelImpacto(items);
          const cfg   = IMPACTO[nivel];
          return (
            <button
              key={zona}
              onClick={() => onZonaClick(zona, items)}
              className={cn(
                'w-full text-left p-4 rounded-2xl border-2 transition-all duration-200',
                'hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.99]',
                cfg.bg, cfg.border,
              )}
            >
              <div className="flex items-center justify-between gap-3">
                {/* Izquierda: dot + nombre */}
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-lg shrink-0">{cfg.emoji}</span>
                  <div className="min-w-0">
                    <p className={cn('font-semibold text-base leading-tight', cfg.text)}>
                      {labelZona(zona)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{cfg.label}</p>
                  </div>
                </div>

                {/* Derecha: badge de count + pulso */}
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn(
                    'text-sm font-bold px-3 py-1 rounded-full border',
                    cfg.bg, cfg.text, cfg.border,
                  )}>
                    {items.length} {items.length === 1 ? 'incidencia' : 'incidencias'}
                  </span>
                  <div
                    className="w-2.5 h-2.5 rounded-full animate-pulse shrink-0"
                    style={{ backgroundColor: cfg.dot }}
                  />
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Leyenda */}
      <div className="flex items-center justify-center gap-5 pt-1 flex-wrap">
        {(Object.entries(IMPACTO) as [NivelImpacto, typeof IMPACTO[NivelImpacto]][]).map(([, v]) => (
          <div key={v.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: v.dot }} />
            {v.label}
          </div>
        ))}
      </div>
    </div>
  );
}
