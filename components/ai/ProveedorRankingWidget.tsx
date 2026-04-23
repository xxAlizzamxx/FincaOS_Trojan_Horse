'use client';

/**
 * ProveedorRankingWidget
 *
 * Admin dashboard widget that displays the AI-learned provider ranking.
 * Reads from `proveedor_metricas` (written by the metrics engine after each
 * resolved incidencia).
 *
 * Columns:
 *   Proveedor · Trabajos · Tiempo prom. · Coste prom. · Reaperturas · Puntuación IA
 *
 * The "Puntuación IA" column mirrors the scoring formula used in
 * selectBestProveedor so admins see exactly why the AI prefers certain providers.
 *
 * Live via onSnapshot — updates as soon as a new incidencia is resolved.
 */

import { useEffect, useState }           from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db }                            from '@/lib/firebase/client';
import { useAuth }                       from '@/hooks/useAuth';
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Skeleton }  from '@/components/ui/skeleton';
import { Badge }     from '@/components/ui/badge';
import { cn }        from '@/lib/utils';
import { BrainCircuit, TrendingUp, TrendingDown, Minus, RefreshCw } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProveedorMetrica {
  proveedor_id:               string;
  proveedor_nombre:           string;
  total_trabajos:             number;
  total_reaperturas:          number;
  tiempo_promedio_resolucion: number;
  coste_promedio:             number;
  tasa_reapertura:            number;
  ultima_actualizacion:       string;
}

// ── Scoring (mirrors selectBestProveedor, metrics part only) ──────────────────

function computeAIScore(m: ProveedorMetrica): number {
  if (!m.total_trabajos) return 0;
  // Guard against undefined/null Firestore fields — coerce to safe numbers
  const tiempo  = Number(m.tiempo_promedio_resolucion) || 0;
  const coste   = Number(m.coste_promedio)             || 0;
  const reopen  = Number(m.tasa_reapertura)            || 0;
  const speed   = Math.max(0, 30 - tiempo);
  const cost    = Math.max(0, 20 - coste / 10);
  const penalty = reopen * 40;
  return Math.round((speed + cost - penalty) * 10) / 10;
}

function scoreBadge(score: number) {
  if (score >= 35) return { label: 'Excelente', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
  if (score >= 20) return { label: 'Bueno',     cls: 'bg-blue-100 text-blue-700 border-blue-200' };
  if (score >= 5)  return { label: 'Normal',    cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' };
  return              { label: 'Bajo',          cls: 'bg-red-100 text-red-700 border-red-200' };
}

function TrendIcon({ score }: { score: number }) {
  if (score >= 20) return <TrendingUp  className="w-3.5 h-3.5 text-emerald-500" />;
  if (score >= 5)  return <Minus       className="w-3.5 h-3.5 text-yellow-500" />;
  return                  <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProveedorRankingWidget() {
  const { perfil } = useAuth();

  const [metricas, setMetricas] = useState<ProveedorMetrica[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!perfil?.comunidad_id) { setLoading(false); return; }

    // Admin sees all providers (proveedor_metricas is not community-scoped)
    const q = query(
      collection(db, 'proveedor_metricas'),
      orderBy('total_trabajos', 'desc'),
    );

    return onSnapshot(
      q,
      snap => {
        const list = snap.docs
          .map(d => d.data() as ProveedorMetrica)
          .filter(m => m.total_trabajos > 0);

        // Sort by AI score descending
        list.sort((a, b) => computeAIScore(b) - computeAIScore(a));
        setMetricas(list);
        setLoading(false);
      },
      err => {
        console.error('[ProveedorRankingWidget]', err);
        setLoading(false);
      },
    );
  }, [perfil?.comunidad_id]);

  // Only render for admin / presidente
  const rol = (perfil as any)?.rol ?? '';
  if (!['admin', 'presidente'].includes(rol)) return null;

  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      {/* Header */}
      <CardHeader className="pb-2 flex flex-row items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
          <BrainCircuit className="w-4 h-4 text-violet-600" />
        </div>
        <div>
          <CardTitle className="text-sm font-semibold text-finca-dark">
            Ranking de proveedores IA
          </CardTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Aprendido de incidencias reales · se actualiza automáticamente
          </p>
        </div>
      </CardHeader>

      <CardContent className="pt-0 pb-4">
        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-2 mt-1">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-4 w-4 rounded-full shrink-0" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && metricas.length === 0 && (
          <div className="py-6 text-center space-y-2">
            <RefreshCw className="w-8 h-8 text-muted-foreground/30 mx-auto" />
            <p className="text-sm font-medium text-finca-dark">Sin datos de aprendizaje</p>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-xs mx-auto">
              El sistema aprende una vez que los proveedores resuelven sus primeras incidencias.
              Los datos aparecen automáticamente.
            </p>
          </div>
        )}

        {/* Ranking table */}
        {!loading && metricas.length > 0 && (
          <div className="mt-1">
            {/* Column headers */}
            <div className="grid grid-cols-[1.5rem_1fr_3rem_3.5rem_3.5rem_4rem] gap-x-2 px-2 pb-1 border-b border-border/50">
              {['#', 'Proveedor', 'Trab.', 'Tiempo', 'Coste', 'Score'].map(h => (
                <span key={h} className="text-[10px] text-muted-foreground font-medium">{h}</span>
              ))}
            </div>

            {/* Rows */}
            <div className="space-y-0.5 mt-1">
              {metricas.slice(0, 8).map((m, idx) => {
                const score   = computeAIScore(m);
                const { label, cls } = scoreBadge(score);

                return (
                  <div
                    key={m.proveedor_id}
                    className={cn(
                      'grid grid-cols-[1.5rem_1fr_3rem_3.5rem_3.5rem_4rem] gap-x-2 items-center px-2 py-1.5 rounded-lg',
                      idx === 0
                        ? 'bg-gradient-to-r from-violet-50 to-white'
                        : 'hover:bg-muted/30 transition-colors',
                    )}
                  >
                    {/* Rank */}
                    <span className={cn(
                      'text-xs font-bold text-center',
                      idx === 0 ? 'text-violet-600' : 'text-muted-foreground',
                    )}>
                      {idx + 1}
                    </span>

                    {/* Name + trend */}
                    <div className="flex items-center gap-1 min-w-0">
                      <TrendIcon score={score} />
                      <span className="text-xs font-medium text-finca-dark truncate">
                        {m.proveedor_nombre}
                      </span>
                    </div>

                    {/* Total jobs */}
                    <span className="text-xs text-center text-muted-foreground">
                      {m.total_trabajos}
                    </span>

                    {/* Avg resolution time */}
                    {(() => {
                      const t = Number(m.tiempo_promedio_resolucion) || 0;
                      const color = t === 0 ? 'text-muted-foreground' : t <= 24 ? 'text-emerald-600' : t <= 72 ? 'text-yellow-600' : 'text-red-600';
                      const label = t === 0 ? '—' : t < 1 ? `${Math.round(t * 60)}m` : `${Math.round(t)}h`;
                      return <span className={cn('text-xs text-center font-medium', color)}>{label}</span>;
                    })()}

                    {/* Avg cost */}
                    {(() => {
                      const c = Number(m.coste_promedio) || 0;
                      const color = c === 0 ? 'text-muted-foreground' : c <= 100 ? 'text-emerald-600' : c <= 300 ? 'text-yellow-600' : 'text-red-600';
                      return (
                        <span className={cn('text-xs text-center font-medium', color)}>
                          {c > 0 ? `${Math.round(c)}€` : '—'}
                        </span>
                      );
                    })()}

                    {/* AI Score badge */}
                    <Badge className={cn('text-[10px] border justify-center', cls)}>
                      {isNaN(score) ? '—' : score > 0 ? `+${score}` : score}
                    </Badge>
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-3 mt-3 pt-2 border-t border-border/40">
              <p className="text-[10px] text-muted-foreground">Puntuación IA:</p>
              {[
                { label: 'Excelente', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
                { label: 'Bueno',     cls: 'bg-blue-100 text-blue-700 border-blue-200' },
                { label: 'Normal',    cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
                { label: 'Bajo',      cls: 'bg-red-100 text-red-700 border-red-200' },
              ].map(b => (
                <span key={b.label} className={cn('text-[10px] px-1.5 py-0.5 rounded-full border', b.cls)}>
                  {b.label}
                </span>
              ))}
            </div>

            {/* Score formula hint */}
            <p className="text-[10px] text-muted-foreground/70 mt-1.5 leading-relaxed">
              Score = velocidad (máx. +30) + coste (máx. +20) − penalización reaperturas (máx. −40)
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
