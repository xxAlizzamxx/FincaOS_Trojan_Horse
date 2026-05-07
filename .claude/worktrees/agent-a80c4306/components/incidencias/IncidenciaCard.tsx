'use client';

import Link from 'next/link';
import { Users, AlertTriangle, MessageSquare } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ESTADO_CONFIG } from '@/lib/incidencias/workflow';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Incidencia } from '@/types/database';

const PRIORIDAD_STRIPE: Record<string, string> = {
  baja:    'bg-green-400',
  normal:  'bg-blue-400',
  alta:    'bg-orange-400',
  urgente: 'bg-red-500',
};

const PRIORIDAD_BADGE: Record<string, string> = {
  baja:    'bg-green-100 text-green-700',
  normal:  'bg-blue-100 text-blue-700',
  alta:    'bg-orange-100 text-orange-700',
  urgente: 'bg-red-100 text-red-700',
};

interface Props {
  incidencia: Incidencia;
  totalVecinos: number;
  seleccionada?: boolean;
  modoSeleccion?: boolean;
  onToggle?: () => void;
}

export function IncidenciaCard({
  incidencia: inc,
  totalVecinos,
  seleccionada = false,
  modoSeleccion = false,
  onToggle,
}: Props) {
  const cfg         = ESTADO_CONFIG[inc.estado] ?? ESTADO_CONFIG.pendiente;
  const afectados   = inc.quorum?.afectados_count ?? 0;
  const umbral      = inc.quorum?.umbral ?? 30;
  const pct         = totalVecinos > 0 ? Math.round((afectados / totalVecinos) * 100) : 0;
  const qAlcanzado  = inc.quorum?.alcanzado ?? false;
  // Cuánto de la barra se rellena (normalizado al umbral para que llegue al 100% justo al alcanzar)
  const barWidth    = Math.min(100, umbral > 0 ? (pct / umbral) * 100 : 0);

  const cardContent = (
    <Card className={cn(
      'border-0 shadow-sm transition-all duration-200',
      seleccionada && 'ring-2 ring-finca-coral shadow-md',
      qAlcanzado && 'border-l-4 border-l-red-500',
    )}>
      {/* Barra de prioridad superior */}
      <div className={cn('h-0.5 w-full rounded-t-xl', PRIORIDAD_STRIPE[inc.prioridad])} />

      <CardContent className="p-4 space-y-3">
        {/* Fila 1: estado + quórum alert + fecha */}
        <div className="flex items-center gap-2">
          <Badge className={cn('text-[10px] border-0 shrink-0', cfg.badge)}>
            {cfg.label}
          </Badge>
          {qAlcanzado && (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full shrink-0">
              <AlertTriangle className="w-2.5 h-2.5" />
              Quórum
            </span>
          )}
          <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
            {formatDistanceToNow(new Date(inc.created_at), { addSuffix: true, locale: es })}
          </span>
        </div>

        {/* Fila 2: título */}
        <p className="font-semibold text-finca-dark leading-snug line-clamp-2">
          {inc.titulo}
        </p>

        {/* Fila 3: barra de quórum */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Users className="w-3 h-3" />
              <span>{afectados} afectado{afectados !== 1 ? 's' : ''}</span>
            </div>
            <span className={cn(
              'font-medium tabular-nums',
              qAlcanzado ? 'text-red-600' :
              pct > umbral * 0.7 ? 'text-orange-600' :
              'text-muted-foreground'
            )}>
              {pct}% / {umbral}%
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-700',
                qAlcanzado ? 'bg-red-500' :
                pct > umbral * 0.7 ? 'bg-orange-400' :
                'bg-finca-coral'
              )}
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>

        {/* Fila 4: acciones + prioridad */}
        <div className="flex items-center pt-0.5">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <MessageSquare className="w-3.5 h-3.5" />
            Comentar
          </span>
          <span className="flex-1" />
          <span className={cn(
            'text-[10px] px-2 py-0.5 rounded-full font-medium capitalize',
            PRIORIDAD_BADGE[inc.prioridad]
          )}>
            {inc.prioridad}
          </span>
        </div>
      </CardContent>
    </Card>
  );

  if (modoSeleccion) {
    return (
      <button className="w-full text-left" onClick={onToggle}>
        {cardContent}
      </button>
    );
  }

  return <Link href={`/incidencias/${inc.id}`}>{cardContent}</Link>;
}
