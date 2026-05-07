'use client';

import { cn } from '@/lib/utils';
import type { Incidencia } from '@/types/database';

export type ZonaEdificio =
  | 'zona_comun'
  | 'parking'
  | 'planta_baja'
  | `piso_${number}`;

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

type NivelImpacto = 'ninguno' | 'bajo' | 'medio' | 'critico';

const IMPACTO: Record<NivelImpacto, {
  bg: string; border: string; text: string; dot: string; label: string;
}> = {
  ninguno: { bg: 'bg-gray-50',    border: 'border-gray-200',  text: 'text-gray-400',   dot: '#d1d5db', label: 'Sin incidencias' },
  bajo:    { bg: 'bg-green-50',   border: 'border-green-200', text: 'text-green-700',  dot: '#22c55e', label: 'Impacto bajo'    },
  medio:   { bg: 'bg-orange-50',  border: 'border-orange-200',text: 'text-orange-700', dot: '#f97316', label: 'Impacto medio'   },
  critico: { bg: 'bg-red-50',     border: 'border-red-300',   text: 'text-red-700',    dot: '#ef4444', label: 'Crítico'         },
};

function nivelImpacto(items: Incidencia[]): NivelImpacto {
  if (!items.length) return 'ninguno';
  if (items.some((i) => i.prioridad === 'urgente' || (i as any).quorum?.alcanzado)) return 'critico';
  if (items.some((i) => i.prioridad === 'alta')) return 'medio';
  return 'bajo';
}

interface Props {
  incidencias: Incidencia[];
  numPisos: number;
  onZonaClick: (zona: ZonaEdificio, items: Incidencia[]) => void;
}

export function BuildingMap({ incidencias, numPisos, onZonaClick }: Props) {
  const porZona = new Map<ZonaEdificio, Incidencia[]>();
  incidencias.forEach((inc) => {
    const zona = ubicacionAZona(inc.ubicacion);
    porZona.set(zona, [...(porZona.get(zona) ?? []), inc]);
  });

  const pisos = Array.from({ length: Math.max(1, numPisos) }, (_, i) => `piso_${numPisos - i}` as ZonaEdificio);
  const zonas: ZonaEdificio[] = [...pisos, 'planta_baja', 'parking', 'zona_comun'];

  const labelZona = (z: ZonaEdificio) => {
    if (z === 'zona_comun') return '🌿 Zonas comunes';
    if (z === 'parking')    return '🅿️ Parking';
    if (z === 'planta_baja') return '🏢 Planta baja';
    return `${z.replace('piso_', '')}º Piso`;
  };

  return (
    <div className="w-full max-w-sm mx-auto">
      {/* Tejado */}
      <div className="h-7 mx-10 bg-gradient-to-b from-finca-coral to-finca-coral/70 rounded-t-full mb-1" />

      {/* Plantas */}
      <div className="space-y-1.5">
        {zonas.map((zona) => {
          const items   = porZona.get(zona) ?? [];
          const nivel   = nivelImpacto(items);
          const cfg     = IMPACTO[nivel];

          return (
            <button
              key={zona}
              onClick={() => onZonaClick(zona, items)}
              className={cn(
                'w-full flex items-center justify-between px-4 py-3',
                'border-2 rounded-xl transition-all',
                cfg.bg, cfg.border,
                'hover:shadow-md active:scale-[0.99]',
              )}
            >
              <div className="flex items-center gap-3">
                {/* Ventanas decorativas */}
                <div className="grid grid-cols-3 gap-0.5 shrink-0">
                  {[1, 2, 3].map((w) => (
                    <div
                      key={w}
                      className="w-3 h-3 rounded-sm border"
                      style={{
                        backgroundColor: nivel !== 'ninguno' ? `${cfg.dot}33` : '#f3f4f6',
                        borderColor: cfg.dot,
                      }}
                    />
                  ))}
                </div>
                <span className={cn('text-sm font-medium', cfg.text)}>
                  {labelZona(zona)}
                </span>
              </div>

              {items.length > 0 ? (
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'text-xs font-bold px-2 py-0.5 rounded-full border',
                    cfg.bg, cfg.text, cfg.border,
                  )}>
                    {items.length}
                  </span>
                  <div
                    className="w-2.5 h-2.5 rounded-full animate-pulse"
                    style={{ backgroundColor: cfg.dot }}
                  />
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Cimientos */}
      <div className="h-4 mx-4 mt-1 bg-gray-200 rounded-b-xl" />

      {/* Leyenda */}
      <div className="flex items-center justify-center gap-4 pt-4 flex-wrap">
        {(Object.entries(IMPACTO) as [NivelImpacto, typeof IMPACTO[NivelImpacto]][])
          .filter(([k]) => k !== 'ninguno')
          .map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: v.dot }} />
              {v.label}
            </div>
          ))}
      </div>
    </div>
  );
}
