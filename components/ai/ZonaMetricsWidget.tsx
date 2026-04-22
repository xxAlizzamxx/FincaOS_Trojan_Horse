'use client';

/**
 * ZonaMetricsWidget
 *
 * Admin dashboard widget showing AI-computed time-to-resolution stats
 * per community zone, read from ai_metrics/{comunidadId}.
 *
 * - Live via onSnapshot — updates when metrics are recomputed
 * - "Actualizar" button triggers POST /api/ai/metrics (admin only)
 * - Color-coded bars: green < 3 d, amber 3–10 d, red > 10 d
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { doc, onSnapshot }                  from 'firebase/firestore';
import { db }                               from '@/lib/firebase/client';
import { useAuth }                          from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button }   from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn }       from '@/lib/utils';
import {
  RefreshCw,
  Clock,
  TrendingDown,
  TrendingUp,
  Minus,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

// ── Types (mirrors metricsEngine.ts) ─────────────────────────────────────────

interface ZonaMetric {
  zona:            string;
  total_resueltas: number;
  promedio_dias:   number;
  min_dias:        number;
  max_dias:        number;
}

interface AIMetricsDoc {
  comunidad_id:            string;
  total_resueltas:         number;
  tiempo_resolucion_zonas: ZonaMetric[];
  actualizado_at:          string;
  empty?:                  boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function severityFor(days: number): 'good' | 'warn' | 'bad' {
  if (days <= 3)  return 'good';
  if (days <= 10) return 'warn';
  return 'bad';
}

const SEVERITY_COLORS = {
  good: { bar: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50' },
  warn: { bar: 'bg-amber-400',   text: 'text-amber-700',   bg: 'bg-amber-50'   },
  bad:  { bar: 'bg-red-500',     text: 'text-red-700',     bg: 'bg-red-50'     },
};

// ── Component ─────────────────────────────────────────────────────────────────

export function ZonaMetricsWidget() {
  const { user, perfil } = useAuth();
  const comunidadId = perfil?.comunidad_id;

  const [metrics,    setMetrics]    = useState<AIMetricsDoc | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [computing,  setComputing]  = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const didAutoCompute = useRef(false);

  // ── Real-time listener ────────────────────────────────────────────────────
  useEffect(() => {
    if (!comunidadId) { setLoading(false); return; }

    const ref = doc(db, 'ai_metrics', comunidadId);
    return onSnapshot(
      ref,
      (snap) => {
        setMetrics(snap.exists() ? (snap.data() as AIMetricsDoc) : null);
        setLoading(false);
      },
      (err) => {
        console.error('[ZonaMetricsWidget] snapshot error:', err);
        setLoading(false);
      },
    );
  }, [comunidadId]);

  // ── Auto-compute on mount if data is missing or stale (> 1 h) ───────────
  const AUTO_STALE_MS = 60 * 60 * 1_000; // 1 hour

  useEffect(() => {
    if (loading) return;
    if (!user || !comunidadId) return;
    if (didAutoCompute.current) return;
    didAutoCompute.current = true;

    const lastMs = metrics?.actualizado_at
      ? new Date(metrics.actualizado_at).getTime()
      : 0;
    const isStale = Date.now() - lastMs > AUTO_STALE_MS;

    if (isStale) {
      console.log('[ZonaMetricsWidget] auto-compute triggered');
      void handleCompute();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // ── Trigger recomputation ─────────────────────────────────────────────────
  const handleCompute = useCallback(async () => {
    if (!user || !comunidadId || computing) return;
    setComputing(true);
    setError(null);

    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/ai/metrics', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ comunidadId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // onSnapshot picks up the Firestore write automatically
    } catch (err) {
      console.error('[ZonaMetricsWidget] compute error:', err);
      setError('No se pudieron calcular las métricas. Inténtalo de nuevo.');
    } finally {
      setComputing(false);
    }
  }, [user, comunidadId, computing]);

  if (!comunidadId) return null;

  const zonas   = metrics?.tiempo_resolucion_zonas ?? [];
  const lastRun = metrics?.actualizado_at
    ? formatDistanceToNow(new Date(metrics.actualizado_at), { addSuffix: true, locale: es })
    : null;

  // Max days for relative bar width
  const maxDays = zonas.length > 0
    ? Math.max(...zonas.map(z => z.promedio_dias), 1)
    : 1;

  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      {/* ── Header ── */}
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
            <Clock className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold text-finca-dark">
              Tiempo de resolución por zona
            </CardTitle>
            {lastRun && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Actualizado {lastRun}
              </p>
            )}
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleCompute}
          disabled={computing}
          className="h-7 text-xs gap-1.5 border-finca-coral/40 text-finca-coral hover:bg-finca-peach/30"
        >
          <RefreshCw className={cn('w-3 h-3', computing && 'animate-spin')} />
          {computing ? 'Calculando…' : 'Actualizar'}
        </Button>
      </CardHeader>

      <CardContent className="pt-0 pb-4">
        {error && (
          <p className="text-xs text-red-600 mb-2 px-1">{error}</p>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="space-y-3 mt-1">
            {[1, 2, 3].map(i => (
              <div key={i} className="space-y-1.5">
                <div className="flex justify-between">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-12" />
                </div>
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            ))}
          </div>
        )}

        {/* ── Empty — no data yet ── */}
        {!loading && !metrics && (
          <div className="py-6 text-center space-y-2">
            <Clock className="w-10 h-10 text-muted-foreground/30 mx-auto" />
            <p className="text-sm font-medium text-finca-dark">Sin métricas calculadas</p>
            <p className="text-xs text-muted-foreground">
              Haz clic en "Actualizar" para calcular el tiempo promedio de resolución por zona.
            </p>
          </div>
        )}

        {/* ── Empty — data exists but no resolved incidencias ── */}
        {!loading && metrics && zonas.length === 0 && (
          <div className="py-4 text-center">
            <p className="text-sm text-muted-foreground">
              Aún no hay incidencias resueltas para calcular métricas.
            </p>
          </div>
        )}

        {/* ── Zone bars ── */}
        {!loading && zonas.length > 0 && (
          <div className="space-y-3 mt-1">
            {zonas.map((zona) => {
              const sev    = severityFor(zona.promedio_dias);
              const colors = SEVERITY_COLORS[sev];
              const pct    = Math.max(4, (zona.promedio_dias / maxDays) * 100);
              const Icon   = sev === 'good' ? TrendingDown : sev === 'bad' ? TrendingUp : Minus;

              return (
                <div key={zona.zona} className="space-y-1">
                  {/* Label row */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Icon className={cn('w-3.5 h-3.5 shrink-0', colors.text)} />
                      <span className="text-xs font-medium text-finca-dark capitalize truncate">
                        {zona.zona}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        ({zona.total_resueltas} resuelta{zona.total_resueltas !== 1 ? 's' : ''})
                      </span>
                    </div>
                    <span className={cn('text-xs font-bold shrink-0', colors.text)}>
                      {zona.promedio_dias} d
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all duration-500', colors.bar)}
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  {/* Min/max detail */}
                  <p className="text-[10px] text-muted-foreground">
                    Rango: {zona.min_dias}d – {zona.max_dias}d
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Summary footer ── */}
        {!loading && metrics && zonas.length > 0 && (
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50 text-[11px]">
            <span className="text-muted-foreground">
              {metrics.total_resueltas} incidencia{metrics.total_resueltas !== 1 ? 's' : ''} resueltas en total
            </span>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-0.5 text-emerald-600"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> ≤3d</span>
              <span className="flex items-center gap-0.5 text-amber-600"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> 4–10d</span>
              <span className="flex items-center gap-0.5 text-red-600"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> +10d</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
