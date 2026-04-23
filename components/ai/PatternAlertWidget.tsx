'use client';

/**
 * PatternAlertWidget
 *
 * Real-time widget for the admin dashboard that shows AI-detected zone patterns
 * (zona_caliente) from the ai_insights/{comunidadId} Firestore document.
 *
 * - Listens with onSnapshot → updates automatically when the cron runs
 * - "Analizar ahora" button triggers an on-demand scan via /api/ai/pattern-engine
 * - Severity: danger (>=5 incidencias) shown in red, warning (>=3) in amber
 * - Clicking a zone row navigates to /incidencias filtered by that zone
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { doc, onSnapshot, updateDoc }       from 'firebase/firestore';
import { db }                               from '@/lib/firebase/client';
import { useAuth }                          from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge }   from '@/components/ui/badge';
import { Button }  from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  BrainCircuit,
  RefreshCw,
  AlertTriangle,
  Flame,
  MapPin,
  ChevronRight,
  CheckCircle2,
  Zap,
  X,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import Link from 'next/link';

// ── Types (mirrors lib/ai/patternEngine.ts exports) ──────────────────────────

interface PatronDetectado {
  type:             'zona_caliente' | 'categoria_caliente';
  zona:             string;
  categoria_id:     string | null;
  categoria_nombre: string;
  count:            number;
  severity:         'warning' | 'danger';
  message:          string;
}

interface AIInsightDoc {
  patrones:            PatronDetectado[];
  zonas_calientes:     string[];
  generado_at:         string;
  score_riesgo_global: number;
  version?:            string;
  /**
   * dismissed_alerts — persisted in Firestore so dismissals survive page reloads.
   * Key: `${zona}||${categoria_id ?? '__none__'}` (same bucket key as patternEngine)
   * Value: ISO timestamp of when the alert was dismissed.
   */
  dismissed_alerts?:   Record<string, string>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PatternAlertWidget() {
  const { user, perfil } = useAuth();
  const comunidadId = perfil?.comunidad_id;

  const [insights,   setInsights]   = useState<AIInsightDoc | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [scanning,   setScanning]   = useState(false);
  const [scanError,  setScanError]  = useState<string | null>(null);
  // Per-pattern acting state — keyed by `${zona}||${categoria_id ?? '__none__'}`
  // (same bucket key as patternEngine) so two alerts in the same zone but
  // different categories have independent "Actuar" buttons.
  const [actStates,  setActStates]  = useState<Record<string, 'idle'|'acting'|'done'|'error'>>({});
  // Local optimistic dismiss state (mirrors what's in Firestore) so UI is instant
  const [localDismissed, setLocalDismissed] = useState<Record<string, boolean>>({});
  // Guard: auto-scan fires at most once per component mount
  const didAutoScan = useRef(false);

  // ── Real-time listener on ai_insights/{comunidadId} ──────────────────────
  useEffect(() => {
    if (!comunidadId) { setLoading(false); return; }

    const ref = doc(db, 'ai_insights', comunidadId);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setInsights(snap.data() as AIInsightDoc);
        } else {
          setInsights(null);
        }
        setLoading(false);
      },
      (err) => {
        console.error('[PatternAlertWidget] snapshot error:', err);
        setLoading(false);
      },
    );

    return () => unsub();
  }, [comunidadId]);

  // ── On-demand scan (calls /api/ai/pattern-engine) ────────────────────────
  const handleScan = useCallback(async () => {
    if (!user || !comunidadId || scanning) return;
    setScanning(true);
    setScanError(null);

    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/ai/pattern-engine?comunidadId=${encodeURIComponent(comunidadId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // onSnapshot will pick up the Firestore write automatically — no setState needed
    } catch (err) {
      console.error('[PatternAlertWidget] scan error:', err);
      setScanError('No se pudo completar el análisis. Intenta de nuevo.');
    } finally {
      setScanning(false);
    }
  }, [user, comunidadId, scanning]);

  // ── Auto-scan on mount ───────────────────────────────────────────────────
  //
  // Fires once when the initial Firestore load completes (loading → false).
  // Triggers a fresh scan if:
  //   a) ai_insights doesn't exist yet (no previous scan), OR
  //   b) the last scan is more than AUTO_SCAN_STALE_MS old
  //
  // This means creating incidencias and opening the dashboard is enough to
  // see alerts — the user never has to click "Analizar ahora" manually.
  const AUTO_SCAN_STALE_MS = 5 * 60 * 1_000; // 5 minutes

  useEffect(() => {
    if (loading) return;                     // wait for Firestore to load
    if (!user || !comunidadId) return;
    if (didAutoScan.current) return;         // run at most once per mount
    didAutoScan.current = true;

    const lastScanMs = insights?.generado_at
      ? new Date(insights.generado_at).getTime()
      : 0;
    const isStale = Date.now() - lastScanMs > AUTO_SCAN_STALE_MS;

    if (isStale) {
      console.log('[PatternAlertWidget] auto-scan triggered (stale data)');
      void handleScan();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]); // intentionally narrow: fires once when loading finishes

  // ── "Actuar ahora" — creates a preventive inspection incidencia ──────────
  const handleActuar = useCallback(async (
    e: React.MouseEvent,
    patron: PatronDetectado,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user || !comunidadId) return;
    // Unique key per pattern — same bucket key used by patternEngine.ts so that
    // two alerts in the same zone but different categories have independent states.
    const patronKey = `${patron.zona}||${patron.categoria_id ?? '__none__'}`;
    if (actStates[patronKey] === 'acting' || actStates[patronKey] === 'done') return;

    setActStates(prev => ({ ...prev, [patronKey]: 'acting' }));

    try {
      const token = await user.getIdToken();
      const res   = await fetch('/api/ai/act', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          zona:            patron.zona,
          categoria_id:    patron.categoria_id,
          categoria_nombre: patron.categoria_nombre,
          comunidadId,
          count:           patron.count,
          severity:        patron.severity,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setActStates(prev => ({ ...prev, [patronKey]: 'done' }));
    } catch (err) {
      console.error('[PatternAlertWidget] actuar error:', err);
      setActStates(prev => ({ ...prev, [patronKey]: 'error' }));
      // Reset after 3s so user can retry
      setTimeout(() => setActStates(prev => ({ ...prev, [patronKey]: 'idle' })), 3_000);
    }
  }, [user, comunidadId, actStates]);

  // ── "Dismiss" — persists dismissal in Firestore so it survives page reloads ─
  const handleDismiss = useCallback(async (
    e:      React.MouseEvent,
    patron: PatronDetectado,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!comunidadId) return;

    // Deterministic key — same bucket key used by patternEngine.ts
    const key = `${patron.zona}||${patron.categoria_id ?? '__none__'}`;

    // Optimistic local update — instant visual feedback
    setLocalDismissed(prev => ({ ...prev, [key]: true }));

    try {
      const insightRef = doc(db, 'ai_insights', comunidadId);
      // Use dot-notation field path so merge: true is implicit for updateDoc
      await updateDoc(insightRef, {
        [`dismissed_alerts.${key}`]: new Date().toISOString(),
      });
      console.log('[PatternAlertWidget] dismissed alert:', key);
    } catch (err) {
      console.error('[PatternAlertWidget] failed to persist dismissal:', err);
      // Don't revert — user clearly wants it gone; Firestore will sync on next load
    }
  }, [comunidadId]);

  // ── Render helpers ────────────────────────────────────────────────────────

  if (!comunidadId) return null;

  const allPatrones  = insights?.patrones ?? [];
  const score        = insights?.score_riesgo_global ?? 0;
  // Merge Firestore-persisted dismissals with optimistic local ones
  const firestoreDismissed = insights?.dismissed_alerts ?? {};
  const isDismissed  = (p: PatronDetectado) => {
    const key = `${p.zona}||${p.categoria_id ?? '__none__'}`;
    return !!firestoreDismissed[key] || !!localDismissed[key];
  };

  // Only show alerts the user has NOT dismissed
  const patrones     = allPatrones.filter(p => !isDismissed(p));
  const dangerCount  = patrones.filter(p => p.severity === 'danger').length;
  const warningCount = patrones.filter(p => p.severity === 'warning').length;

  const scoreColor =
    score > 70 ? 'text-red-600'    :
    score > 30 ? 'text-amber-600'  :
                 'text-emerald-600';
  const scoreLabel =
    score > 70 ? '🔴 Crítico'  :
    score > 30 ? '🟡 Atención' :
                 '🟢 Estable';

  const lastScan = insights?.generado_at
    ? formatDistanceToNow(new Date(insights.generado_at), { addSuffix: true, locale: es })
    : null;

  // Sort: danger first
  const sorted = [...patrones].sort((a, b) => {
    if (a.severity === 'danger' && b.severity !== 'danger') return -1;
    if (b.severity === 'danger' && a.severity !== 'danger') return  1;
    return b.count - a.count;
  });

  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      {/* ── Header ── */}
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
            dangerCount > 0 ? 'bg-red-100' : warningCount > 0 ? 'bg-amber-100' : 'bg-emerald-50',
          )}>
            <BrainCircuit className={cn(
              'w-4 h-4',
              dangerCount > 0 ? 'text-red-600' : warningCount > 0 ? 'text-amber-600' : 'text-emerald-600',
            )} />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold text-finca-dark">
              Análisis IA — Zonas activas
            </CardTitle>
            {lastScan && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Último análisis {lastScan}
              </p>
            )}
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleScan}
          disabled={scanning}
          className="h-7 text-xs gap-1.5 border-finca-coral/40 text-finca-coral hover:bg-finca-peach/30"
        >
          <RefreshCw className={cn('w-3 h-3', scanning && 'animate-spin')} />
          {scanning ? 'Analizando…' : 'Analizar ahora'}
        </Button>
      </CardHeader>

      <CardContent className="pt-0 pb-3">
        {/* ── Error ── */}
        {scanError && (
          <p className="text-xs text-red-600 mb-2 px-1">{scanError}</p>
        )}

        {/* ── Loading skeleton ── */}
        {loading && (
          <div className="space-y-2 mt-1">
            {[1, 2].map(i => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50">
                <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        )}

        {/* ── Empty state — no patterns detected ── */}
        {!loading && sorted.length === 0 && (
          <div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-emerald-50 mt-1">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            <div>
              <p className="text-sm font-medium text-emerald-800">
                Sin patrones detectados
              </p>
              <p className="text-xs text-emerald-600 mt-0.5">
                Todas las zonas están dentro del rango normal.
              </p>
            </div>
          </div>
        )}

        {/* ── Pattern list ── */}
        {!loading && sorted.length > 0 && (
          <div className="space-y-1.5 mt-1">
            {sorted.map((patron) => {
              const isDanger   = patron.severity === 'danger';
              const patronKey  = `${patron.zona}||${patron.categoria_id ?? '__none__'}`;
              return (
                <Link
                  key={patronKey}
                  href={`/incidencias?zona=${encodeURIComponent(patron.zona)}`}
                  className="group block"
                >
                  <div className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg border-l-4 transition-colors',
                    'hover:bg-gray-50 active:scale-[0.99]',
                    isDanger
                      ? 'bg-red-50/60 border-l-red-500'
                      : 'bg-amber-50/60 border-l-amber-400',
                  )}>
                    {/* Icon */}
                    <div className={cn(
                      'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                      isDanger ? 'bg-red-100' : 'bg-amber-100',
                    )}>
                      {isDanger
                        ? <Flame       className="w-4 h-4 text-red-600" />
                        : <AlertTriangle className="w-4 h-4 text-amber-600" />
                      }
                    </div>

                    {/* Text */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <MapPin className="w-3 h-3 text-muted-foreground shrink-0" />
                        <p className={cn(
                          'text-sm font-semibold truncate',
                          isDanger ? 'text-red-800' : 'text-amber-900',
                        )}>
                          Zona {patron.zona}
                        </p>
                        {patron.categoria_nombre && patron.categoria_nombre !== 'Sin categoría' && (
                          <span className={cn(
                            'text-[10px] font-medium px-1.5 py-0.5 rounded-full border',
                            isDanger
                              ? 'bg-red-50 text-red-700 border-red-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200',
                          )}>
                            {patron.categoria_nombre}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-snug line-clamp-1">
                        {patron.message}
                      </p>
                    </div>

                    {/* Badge + "Actuar" button + dismiss + arrow */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge className={cn(
                        'text-[11px] font-bold border-0',
                        isDanger
                          ? 'bg-red-600 text-white'
                          : 'bg-amber-400 text-amber-950',
                      )}>
                        {patron.count} inc.
                      </Badge>

                      {/* ── Actuar ahora ── */}
                      {(() => {
                        const st = actStates[patronKey] ?? 'idle';
                        if (st === 'done') return (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                            ✅ Creada
                          </span>
                        );
                        return (
                          <button
                            onClick={(e) => handleActuar(e, patron)}
                            disabled={st === 'acting'}
                            className={cn(
                              'inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2 py-0.5 border transition-colors',
                              st === 'error'
                                ? 'bg-red-50 text-red-700 border-red-300'
                                : isDanger
                                ? 'bg-red-600 text-white border-red-600 hover:bg-red-700 active:scale-95'
                                : 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600 active:scale-95',
                              st === 'acting' && 'opacity-70 cursor-wait',
                            )}
                          >
                            <Zap className={cn('w-2.5 h-2.5', st === 'acting' && 'animate-pulse')} />
                            {st === 'acting' ? 'Actuando…' : st === 'error' ? 'Error' : 'Actuar'}
                          </button>
                        );
                      })()}

                      {/* ── Dismiss (X) — persists to Firestore ── */}
                      <button
                        onClick={(e) => handleDismiss(e, patron)}
                        title="Descartar alerta"
                        className={cn(
                          'w-5 h-5 rounded-full flex items-center justify-center transition-colors shrink-0',
                          'text-muted-foreground/50 hover:text-muted-foreground hover:bg-gray-100',
                        )}
                      >
                        <X className="w-3 h-3" />
                      </button>

                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* ── Summary badges + risk score ── */}
        {!loading && (
          <div className="flex flex-wrap items-center gap-2 mt-3 pt-2 border-t border-border/50">
            {dangerCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                <Flame className="w-3 h-3" />
                {dangerCount} zona{dangerCount > 1 ? 's' : ''} crítica{dangerCount > 1 ? 's' : ''}
              </span>
            )}
            {warningCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                <AlertTriangle className="w-3 h-3" />
                {warningCount} zona{warningCount > 1 ? 's' : ''} en alerta
              </span>
            )}
            {/* Risk score — always visible once data loaded */}
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium">
              <span className="text-muted-foreground">Riesgo</span>
              <span className={cn('font-bold', scoreColor)}>{score}/100</span>
              <span className={cn('text-[10px]', scoreColor)}>{scoreLabel}</span>
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
