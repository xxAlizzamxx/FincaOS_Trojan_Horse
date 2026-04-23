'use client';

import Link from 'next/link';
import { Users, AlertTriangle, MessageSquare, Bot } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ESTADO_CONFIG } from '@/lib/incidencias/workflow';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Incidencia } from '@/types/database';

const PRIORIDAD_DOT: Record<string, string> = {
  baja:    'bg-green-500',
  normal:  'bg-blue-500',
  alta:    'bg-orange-500',
  urgente: 'bg-red-500',
};

const PRIORIDAD_BADGE: Record<string, string> = {
  baja:    'bg-green-50  text-green-700  ring-1 ring-green-200',
  normal:  'bg-blue-50   text-blue-700   ring-1 ring-blue-200',
  alta:    'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
  urgente: 'bg-red-50    text-red-700    ring-1 ring-red-200',
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
  const isAI        = (inc as any).autor_id === 'sistema_ia' || (inc as any).origen === 'chat_ia';
  const cfg         = ESTADO_CONFIG[inc.estado] ?? ESTADO_CONFIG.pendiente;
  const afectados   = Math.max(1, inc.quorum?.afectados_count ?? 0);
  const umbral      = inc.quorum?.umbral ?? 30;
  const pct         = totalVecinos > 0 ? Math.round((afectados / totalVecinos) * 100) : 0;
  const qAlcanzado  = inc.quorum?.alcanzado ?? false;
  const barWidth    = Math.min(100, umbral > 0 ? (pct / umbral) * 100 : 0);

  const barColor =
    qAlcanzado                  ? 'bg-red-500'     :
    pct > umbral * 0.7          ? 'bg-orange-400'  :
                                  'bg-finca-coral';

  const pctColor =
    qAlcanzado                  ? 'text-red-600'    :
    pct > umbral * 0.7          ? 'text-orange-600' :
                                  'text-muted-foreground';

  const cardContent = (
    <Card
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm',
        'transition-all duration-200 hover:shadow-md hover:border-border',
        seleccionada && 'ring-2 ring-finca-coral border-transparent shadow-md',
        qAlcanzado   && 'border-red-200 bg-red-50/40',
        isAI         && 'border-violet-200 bg-violet-50/30 hover:border-violet-300',
      )}
    >
      {/* AI accent strip */}
      {isAI && (
        <div className="absolute inset-y-0 left-0 w-1 bg-violet-400 rounded-l-2xl" />
      )}
      <CardContent className="p-4 space-y-3">
        {/* Header — estado + quórum alert + AI badge + fecha */}
        <div className="flex items-center gap-2">
          <Badge className={cn('text-[10px] border-0 font-medium shrink-0', cfg.badge)}>
            {cfg.label}
          </Badge>
          {isAI && (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-violet-700 bg-violet-100 border border-violet-200 rounded-full px-1.5 py-0.5 shrink-0">
              <Bot className="w-2.5 h-2.5" />
              V. Virtual
            </span>
          )}
          {qAlcanzado && (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-red-600 shrink-0">
              <AlertTriangle className="w-3 h-3" />
              Quórum
            </span>
          )}
          <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
            {formatDistanceToNow(new Date(inc.created_at), { addSuffix: true, locale: es })}
          </span>
        </div>

        {/* Título */}
        <p className="text-[15px] font-semibold text-finca-dark leading-snug line-clamp-2 tracking-tight">
          {inc.titulo}
        </p>

        {/* Quórum */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Users className="w-3 h-3" />
              <span>{afectados} afectado{afectados !== 1 ? 's' : ''}</span>
            </div>
            <span className={cn('font-semibold tabular-nums', pctColor)}>
              {pct}%{' '}
              <span className="text-muted-foreground/60 font-normal">/ {umbral}%</span>
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-700', barColor)}
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>

        {/* Footer — acción + prioridad */}
        <div className="flex items-center justify-between pt-2 border-t border-border/40">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MessageSquare className="w-3.5 h-3.5" />
            Comentar
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full font-medium capitalize',
              PRIORIDAD_BADGE[inc.prioridad],
            )}
          >
            <span className={cn('w-1.5 h-1.5 rounded-full', PRIORIDAD_DOT[inc.prioridad])} />
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
