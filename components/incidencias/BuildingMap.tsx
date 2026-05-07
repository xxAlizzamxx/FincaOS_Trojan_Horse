'use client';

import { useRef, useEffect } from 'react';
import { gsap } from 'gsap';
import { cn } from '@/lib/utils';
import {
  normalizeZona,
  ZONAS_ORDENADAS,
  ZONA_META,
  type Zona,
} from '@/lib/incidencias/mapZona';
import type { Incidencia } from '@/types/database';

/* ── Exportamos Zona como ZonaEdificio para no romper el import en mapa/page ── */
export type { Zona as ZonaEdificio } from '@/lib/incidencias/mapZona';
export { normalizeZona as ubicacionAZona };    // alias legacy — no eliminar todavía

/* ── Niveles de impacto ────────────────────────────────────────── */
type NivelImpacto = 'bajo' | 'medio' | 'critico';

const IMPACTO: Record<NivelImpacto, {
  bg: string; border: string; text: string; dot: string; emoji: string;
}> = {
  bajo:    { bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-700',  dot: '#22c55e', emoji: '🟢' },
  medio:   { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', dot: '#f97316', emoji: '🟠' },
  critico: { bg: 'bg-red-50',    border: 'border-red-300',    text: 'text-red-700',    dot: '#ef4444', emoji: '🔴' },
};
const IMPACT_ORDER: Record<string, number> = { critico: 3, medio: 2, bajo: 1 };

function nivelImpacto(items: Incidencia[]): NivelImpacto {
  if (items.some((i) => i.prioridad === 'urgente' || (i as any).quorum?.alcanzado)) return 'critico';
  if (items.some((i) => i.prioridad === 'alta')) return 'medio';
  return 'bajo';
}

/* ── Props ─────────────────────────────────────────────────────── */
interface Props {
  incidencias: Incidencia[];
  numPisos?:   number;   // mantenido para compatibilidad — no se usa
  onZonaClick: (zona: Zona, items: Incidencia[]) => void;
}

/* ── Componente ────────────────────────────────────────────────── */
export function BuildingMap({ incidencias, onZonaClick }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  /* ── Grouping estricto por campo zona (enum) ──────────────────
     Fallback: si inc.zona no existe o es texto libre legacy,
     se normaliza con normalizeZona() que convierte "Jardín" → 'jardin', etc.
  ──────────────────────────────────────────────────────────────── */
  const grouped = Object.fromEntries(
    ZONAS_ORDENADAS.map((z) => [z, [] as Incidencia[]]),
  ) as Record<Zona, Incidencia[]>;

  incidencias.forEach((inc) => {
    // 1. campo zona es el enum canónico (nuevas incidencias)
    // 2. si no existe, normalizar ubicacion legacy
    const rawZona = (inc as any).zona ?? inc.ubicacion ?? '';
    const zona: Zona = ZONAS_ORDENADAS.includes(rawZona as Zona)
      ? (rawZona as Zona)
      : normalizeZona(rawZona);

    console.log('[MAP ZONA]', inc.id, '→', zona, '(raw:', rawZona, ')');
    grouped[zona].push(inc);
  });

  /* Solo zonas con datos, ordenadas por impacto */
  const zonas = ZONAS_ORDENADAS
    .filter((z) => grouped[z].length > 0)
    .sort((a, b) =>
      (IMPACT_ORDER[nivelImpacto(grouped[b])] ?? 0) -
      (IMPACT_ORDER[nivelImpacto(grouped[a])] ?? 0),
    );

  /* GSAP stagger — anima cuando llegan los datos */
  useEffect(() => {
    const el = listRef.current;
    if (!el || zonas.length === 0) return;
    const children = el.querySelectorAll(':scope > button');
    const ctx = gsap.context(() => {
      gsap.fromTo(
        children,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out', stagger: 0.07, clearProps: 'opacity,y' },
      );
    }, el);
    return () => ctx.revert();
  }, [zonas.length]);

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
      {/* Bloques de zonas — solo las que tienen incidencias */}
      <div ref={listRef} className="grid gap-3">
        {zonas.map((zona) => {
          const items = grouped[zona];
          const nivel = nivelImpacto(items);
          const cfg   = IMPACTO[nivel];
          const meta  = ZONA_META[zona];
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
                {/* Izquierda: emoji zona + nombre */}
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xl shrink-0">{meta.emoji}</span>
                  <div className="min-w-0">
                    <p className={cn('font-semibold text-base leading-tight', cfg.text)}>
                      {meta.label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {cfg.emoji} {nivel === 'critico' ? 'Crítico' : nivel === 'medio' ? 'Impacto medio' : 'Impacto bajo'}
                    </p>
                  </div>
                </div>

                {/* Derecha: count + pulso */}
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
          <div key={v.dot} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: v.dot }} />
            {v.emoji === '🟢' ? 'Impacto bajo' : v.emoji === '🟠' ? 'Impacto medio' : 'Crítico'}
          </div>
        ))}
      </div>
    </div>
  );
}
