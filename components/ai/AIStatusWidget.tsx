'use client';

/**
 * AIStatusWidget
 *
 * Mini AI dashboard for the /admin page — the "wow factor" block.
 * Shows at a glance:
 *   🔴/🟡/🟢  Global risk score (from ai_insights)
 *   📍         Problematic zones
 *   ⚠️         Stuck incidencias count (en_ejecucion, stale for > STUCK_THRESHOLD_DAYS)
 *   🤖         Top 3 suggested actions derived from live data
 *
 * Data sources (client SDK only, no new API routes):
 *   - ai_insights/{comunidadId}           → onSnapshot (real-time)
 *   - incidencias (en_ejecucion)          → one-time getDocs on mount
 *
 * Pure UI — no writes, no side effects.
 */

import { useEffect, useState, useCallback } from 'react';
import { doc, onSnapshot, getDocs, query, collection, where } from 'firebase/firestore';
import { db }              from '@/lib/firebase/client';
import { useAuth }         from '@/hooks/useAuth';
import { cn }              from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton }        from '@/components/ui/skeleton';
import { Button }          from '@/components/ui/button';
import {
  BrainCircuit,
  ShieldAlert,
  MapPin,
  Clock,
  Lightbulb,
  ChevronRight,
  TrendingUp,
  Zap,
} from 'lucide-react';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PatronLight {
  zona:             string;
  categoria_nombre: string;
  count:            number;
  severity:         'warning' | 'danger';
}

interface AIInsightLight {
  patrones:            PatronLight[];
  zonas_calientes:     string[];
  score_riesgo_global: number;
  generado_at:         string;
}

interface SuggestedAction {
  emoji:    string;
  text:     string;
  href:     string;
  priority: 'high' | 'medium' | 'low';
}

const STUCK_THRESHOLD_DAYS = 5;

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSuggestions(
  patrones:     PatronLight[],
  stuckCount:   number,
): SuggestedAction[] {
  const actions: SuggestedAction[] = [];

  // Danger zones first
  const dangerZones = patrones.filter(p => p.severity === 'danger');
  dangerZones.slice(0, 2).forEach(p => {
    actions.push({
      emoji:    '🔴',
      text:     `Actuar en zona ${p.zona.replace(/_/g, ' ')} — ${p.count} incidencias críticas`,
      href:     `/incidencias?zona=${encodeURIComponent(p.zona)}`,
      priority: 'high',
    });
  });

  // Warning zones
  const warnZones = patrones.filter(p => p.severity === 'warning');
  if (warnZones.length > 0) {
    actions.push({
      emoji:    '🟡',
      text:     `Revisar zona ${warnZones[0].zona.replace(/_/g, ' ')} antes de que escale`,
      href:     `/incidencias?zona=${encodeURIComponent(warnZones[0].zona)}`,
      priority: 'medium',
    });
  }

  // Stuck incidencias
  if (stuckCount > 0) {
    actions.push({
      emoji:    '⏱️',
      text:     `${stuckCount} reparación${stuckCount > 1 ? 'es llevan' : ' lleva'} días sin avance — revisar`,
      href:     '/incidencias?estado=en_ejecucion',
      priority: stuckCount > 2 ? 'high' : 'medium',
    });
  }

  // No patterns but some incidencias open
  if (actions.length === 0) {
    actions.push({
      emoji:    '✅',
      text:     'La comunidad está bajo control. Sin alertas activas.',
      href:     '/incidencias',
      priority: 'low',
    });
  }

  return actions.slice(0, 3);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AIStatusWidget() {
  const { perfil } = useAuth();
  const comunidadId = perfil?.comunidad_id;

  const [insights,   setInsights]   = useState<AIInsightLight | null>(null);
  const [stuckCount, setStuckCount] = useState<number | null>(null);
  const [loading,    setLoading]    = useState(true);

  // ── Real-time ai_insights listener ───────────────────────────────────────
  useEffect(() => {
    if (!comunidadId) { setLoading(false); return; }

    const ref = doc(db, 'ai_insights', comunidadId);
    const unsub = onSnapshot(ref, (snap) => {
      setInsights(snap.exists() ? (snap.data() as AIInsightLight) : null);
      setLoading(false);
    }, () => setLoading(false));

    return () => unsub();
  }, [comunidadId]);

  // ── Fetch stuck incidencias count on mount ────────────────────────────────
  const fetchStuck = useCallback(async () => {
    if (!comunidadId) return;
    try {
      const snap = await getDocs(query(
        collection(db, 'incidencias'),
        where('comunidad_id', '==', comunidadId),
        where('estado', '==', 'en_ejecucion'),
      ));
      const cutoff = Date.now() - STUCK_THRESHOLD_DAYS * 24 * 60 * 60 * 1_000;
      const stuck = snap.docs.filter(d => {
        const upd = d.data().updated_at as string | undefined;
        if (!upd) return true; // very old doc with no updated_at
        return new Date(upd).getTime() < cutoff;
      });
      setStuckCount(stuck.length);
    } catch {
      setStuckCount(0);
    }
  }, [comunidadId]);

  useEffect(() => { fetchStuck(); }, [fetchStuck]);

  if (!comunidadId) return null;

  // ── Derived state ─────────────────────────────────────────────────────────
  const score    = insights?.score_riesgo_global ?? 0;
  const patrones = insights?.patrones ?? [];

  const riskLevel =
    score > 70 ? 'high' :
    score > 30 ? 'medium' :
                 'low';

  const riskConfig = {
    high:   { label: '🔴 Riesgo alto',  bar: 'bg-red-500',    bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-700',    icon: 'text-red-600' },
    medium: { label: '🟡 Atención',     bar: 'bg-amber-400',  bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-700',  icon: 'text-amber-600' },
    low:    { label: '🟢 Todo estable', bar: 'bg-emerald-500',bg: 'bg-emerald-50',border: 'border-emerald-200',text: 'text-emerald-700',icon: 'text-emerald-600' },
  }[riskLevel];

  const dangerZones  = patrones.filter(p => p.severity === 'danger');
  const warningZones = patrones.filter(p => p.severity === 'warning');
  const suggestions  = buildSuggestions(patrones, stuckCount ?? 0);

  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      {/* ── Top accent + score bar ── */}
      <div className="relative h-1.5 bg-gray-100">
        <div
          className={cn('absolute inset-y-0 left-0 transition-all duration-700', riskConfig.bar)}
          style={{ width: `${Math.max(4, score)}%` }}
        />
      </div>

      <CardContent className="pt-4 pb-4">

        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', riskConfig.bg)}>
              <BrainCircuit className={cn('w-4 h-4', riskConfig.icon)} />
            </div>
            <div>
              <p className="text-sm font-semibold text-finca-dark">Estado de la comunidad</p>
              <p className="text-[11px] text-muted-foreground">Análisis IA en tiempo real</p>
            </div>
          </div>

          {/* Risk pill */}
          {loading ? (
            <Skeleton className="h-6 w-24 rounded-full" />
          ) : (
            <span className={cn(
              'text-[11px] font-bold px-2.5 py-1 rounded-full border',
              riskConfig.bg, riskConfig.border, riskConfig.text,
            )}>
              {riskConfig.label}
            </span>
          )}
        </div>

        {/* ── 3 metric tiles ── */}
        {loading ? (
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-gray-50 rounded-xl p-3 space-y-1.5">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-5 w-8" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 mb-4">
            {/* Score */}
            <div className={cn('rounded-xl p-3 border text-center', riskConfig.bg, riskConfig.border)}>
              <div className="flex items-center justify-center gap-1 mb-0.5">
                <TrendingUp className={cn('w-3 h-3', riskConfig.icon)} />
                <p className="text-[10px] text-muted-foreground font-medium">Riesgo</p>
              </div>
              <p className={cn('text-lg font-black', riskConfig.text)}>{score}</p>
              <p className="text-[9px] text-muted-foreground">/100</p>
            </div>

            {/* Problematic zones */}
            <div className={cn(
              'rounded-xl p-3 border text-center',
              patrones.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-100',
            )}>
              <div className="flex items-center justify-center gap-1 mb-0.5">
                <MapPin className={cn('w-3 h-3', patrones.length > 0 ? 'text-amber-600' : 'text-muted-foreground')} />
                <p className="text-[10px] text-muted-foreground font-medium">Zonas</p>
              </div>
              <p className={cn('text-lg font-black', patrones.length > 0 ? 'text-amber-700' : 'text-gray-400')}>
                {dangerZones.length > 0 ? dangerZones.length : patrones.length}
              </p>
              <p className="text-[9px] text-muted-foreground">
                {dangerZones.length > 0 ? 'críticas' : patrones.length > 0 ? 'alertas' : 'estables'}
              </p>
            </div>

            {/* Stuck incidencias */}
            <div className={cn(
              'rounded-xl p-3 border text-center',
              (stuckCount ?? 0) > 0 ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-gray-100',
            )}>
              <div className="flex items-center justify-center gap-1 mb-0.5">
                <Clock className={cn('w-3 h-3', (stuckCount ?? 0) > 0 ? 'text-orange-600' : 'text-muted-foreground')} />
                <p className="text-[10px] text-muted-foreground font-medium">Estancadas</p>
              </div>
              {stuckCount === null ? (
                <Skeleton className="h-5 w-5 mx-auto" />
              ) : (
                <>
                  <p className={cn('text-lg font-black', stuckCount > 0 ? 'text-orange-700' : 'text-gray-400')}>
                    {stuckCount}
                  </p>
                  <p className="text-[9px] text-muted-foreground">
                    {stuckCount > 0 ? `+${STUCK_THRESHOLD_DAYS}d sin avance` : 'al día'}
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Suggested actions ── */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 mb-2">
            <Lightbulb className="w-3.5 h-3.5 text-finca-coral" />
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Acciones sugeridas
            </p>
          </div>

          {loading ? (
            <div className="space-y-1.5">
              {[1, 2].map(i => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50">
                  <Skeleton className="w-4 h-4 rounded shrink-0" />
                  <Skeleton className="h-3 flex-1" />
                </div>
              ))}
            </div>
          ) : (
            suggestions.map((action, i) => (
              <Link key={i} href={action.href} className="block group">
                <div className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-colors',
                  'hover:bg-gray-50 active:scale-[0.99]',
                  action.priority === 'high'
                    ? 'bg-red-50/60 border-red-100'
                    : action.priority === 'medium'
                    ? 'bg-amber-50/60 border-amber-100'
                    : 'bg-emerald-50/60 border-emerald-100',
                )}>
                  <span className="text-base shrink-0">{action.emoji}</span>
                  <p className="text-xs text-finca-dark leading-snug flex-1">{action.text}</p>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform shrink-0" />
                </div>
              </Link>
            ))
          )}
        </div>

        {/* ── Zone breakdown (if any alerts) ── */}
        {!loading && (dangerZones.length > 0 || warningZones.length > 0) && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <div className="flex items-center gap-1.5 mb-2">
              <ShieldAlert className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Zonas problemáticas
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {patrones.slice(0, 5).map((p, i) => (
                <Link
                  key={i}
                  href={`/incidencias?zona=${encodeURIComponent(p.zona)}`}
                  className={cn(
                    'inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 border transition-opacity hover:opacity-80',
                    p.severity === 'danger'
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200',
                  )}
                >
                  <MapPin className="w-2.5 h-2.5" />
                  {p.zona.replace(/_/g, ' ')}
                  <span className="opacity-60">·</span>
                  <Zap className="w-2.5 h-2.5" />
                  {p.count}
                </Link>
              ))}
            </div>
          </div>
        )}

      </CardContent>
    </Card>
  );
}
