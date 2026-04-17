'use client';

import { useRouter } from 'next/navigation';
import { Users, AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ESTADO_CONFIG } from '@/lib/incidencias/workflow';
import type { Incidencia } from '@/types/database';

const PRIORIDAD_BADGE: Record<string, string> = {
  baja:    'bg-green-100 text-green-700',
  normal:  'bg-blue-100 text-blue-700',
  alta:    'bg-orange-100 text-orange-700',
  urgente: 'bg-red-100 text-red-700',
};

interface Props {
  label: string;
  colorTop: string;      // border-t-* class
  bgColor: string;       // bg-* class
  incidencias: Incidencia[];
  totalVecinos: number;
}

const PRIORIDAD_ORDEN: Record<string, number> = { urgente: 3, alta: 2, normal: 1, baja: 0 };
const SEMAFORO: Record<string, string> = {
  urgente: 'bg-red-500',
  alta:    'bg-orange-400',
  normal:  'bg-blue-400',
  baja:    'bg-green-400',
};

export function KanbanColumna({ label, colorTop, bgColor, incidencias, totalVecinos }: Props) {
  const router = useRouter();

  const sorted = [...incidencias].sort(
    (a, b) => (PRIORIDAD_ORDEN[b.prioridad] ?? 0) - (PRIORIDAD_ORDEN[a.prioridad] ?? 0),
  );

  return (
    <div className={cn(
      'flex-none w-72 snap-start rounded-2xl border-t-4 p-3 min-h-48',
      colorTop, bgColor,
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="text-sm font-semibold text-finca-dark">{label}</span>
        <span className="text-xs bg-white/80 rounded-full px-2 py-0.5 font-medium text-muted-foreground shadow-sm">
          {incidencias.length}
        </span>
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {sorted.map((inc) => {
          const cfg        = ESTADO_CONFIG[inc.estado] ?? ESTADO_CONFIG.pendiente;
          const afectados  = Math.max(1, inc.quorum?.afectados_count ?? 0);
          const umbral     = inc.quorum?.umbral ?? 30;
          const pct        = totalVecinos > 0 ? Math.round((afectados / totalVecinos) * 100) : 0;
          const qAlcanzado = inc.quorum?.alcanzado ?? false;

          return (
            <Card
              key={inc.id}
              className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow bg-white"
              onClick={() => router.push(`/incidencias/${inc.id}`)}
            >
              <CardContent className="p-3 space-y-2">
                {/* Prioridad semáforo + alert */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={cn('w-2 h-2 rounded-full shrink-0', SEMAFORO[inc.prioridad] ?? 'bg-gray-300')} />
                  <span className={cn('text-[10px] font-medium capitalize', PRIORIDAD_BADGE[inc.prioridad])}>
                    {inc.prioridad}
                  </span>
                  {qAlcanzado && <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />}
                </div>

                {/* Título */}
                <p className="text-sm font-medium text-finca-dark leading-snug line-clamp-2">
                  {inc.titulo}
                </p>

                {/* Barra quórum */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Users className="w-3 h-3" />
                      <span>{afectados}/{totalVecinos}</span>
                    </div>
                    <span className={cn('font-medium', qAlcanzado ? 'text-red-600' : 'text-muted-foreground')}>
                      {pct}%/{umbral}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-500',
                        qAlcanzado ? 'bg-red-500' : pct > umbral * 0.7 ? 'bg-orange-400' : 'bg-finca-coral',
                      )}
                      style={{ width: `${Math.min(100, umbral > 0 ? (pct / umbral) * 100 : 0)}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {incidencias.length === 0 && (
          <p className="text-center text-xs text-muted-foreground py-8 bg-white/40 rounded-xl">
            Sin incidencias
          </p>
        )}
      </div>
    </div>
  );
}
