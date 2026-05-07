'use client';

/**
 * AlertaGlobalBanner
 *
 * Persistent top-of-screen banner visible to ALL community users when the
 * AI pattern engine detects zone/category hotspots.
 *
 * Design:
 *  - Reads real-time from ai_insights/{comunidadId} via onSnapshot
 *  - One banner row per active pattern (danger = red, warning = amber)
 *  - Each user dismisses individually via the X button
 *  - Dismissal is SESSION-ONLY (in-memory React state) — reloading the page
 *    brings the banner back automatically if the pattern still exists.
 *  - In-flow (sticky top-0) so it pushes AppHeader + content down naturally
 *  - Also renders legacy admin-created alertas_globales (shared dismiss)
 */

import { useEffect, useState, useCallback } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { db }       from '@/lib/firebase/client';
import { useAuth }  from '@/hooks/useAuth';
import { cn }       from '@/lib/utils';
import { AlertTriangle, Flame, MapPin, X } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

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
  patrones:    PatronDetectado[];
  generado_at: string;
}

interface AlertaAdmin {
  id:          string;
  zona:        string;
  mensaje:     string;
  nivel?:      'medium' | 'high';
  created_at?: unknown;
}

// ── patternKey ────────────────────────────────────────────────────────────────

/** patternKey mirrors the bucket key used by patternEngine.ts */
function patternKey(p: PatronDetectado) {
  return `${p.zona}||${p.categoria_id ?? '__none__'}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AlertaGlobalBanner() {
  const { perfil } = useAuth();
  const comunidadId = perfil?.comunidad_id;

  const [insights,     setInsights]     = useState<AIInsightDoc | null>(null);
  const [dismissed,    setDismissed]    = useState<Set<string>>(new Set());
  const [adminAlertas, setAdminAlertas] = useState<AlertaAdmin[]>([]);

  // ── Subscribe: ai_insights/{comunidadId} ─────────────────────────────────
  useEffect(() => {
    if (!comunidadId) return;
    const ref = doc(db, 'ai_insights', comunidadId);
    return onSnapshot(
      ref,
      (snap) => setInsights(snap.exists() ? (snap.data() as AIInsightDoc) : null),
      (err)  => console.error('[AlertaGlobalBanner] ai_insights error:', err),
    );
  }, [comunidadId]);

  // ── Subscribe: alertas_globales (legacy admin alerts) ────────────────────
  useEffect(() => {
    if (!comunidadId) return;
    const q = query(
      collection(db, 'alertas_globales'),
      where('activa',       '==', true),
      where('comunidad_id', '==', comunidadId),
    );
    return onSnapshot(
      q,
      (snap) => setAdminAlertas(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AlertaAdmin))),
      (err)  => console.error('[AlertaGlobalBanner] alertas_globales error:', err),
    );
  }, [comunidadId]);

  // ── Dismiss AI pattern (session-only — in-memory, no localStorage) ──────
  // Cerrando el banner lo oculta hasta que se recargue la página.
  // Al recargar reaparece automáticamente si el patrón sigue activo.
  const dismissPattern = useCallback((patron: PatronDetectado) => {
    const pk = patternKey(patron);
    setDismissed(prev => new Set(Array.from(prev).concat(pk)));
  }, []);

  // ── Dismiss legacy admin alert (shared — marks activa: false for all) ─────
  const dismissAdmin = useCallback((id: string) => {
    updateDoc(doc(db, 'alertas_globales', id), { activa: false }).catch(console.error);
  }, []);

  if (!comunidadId) return null;

  const visiblePatterns = (insights?.patrones ?? []).filter(
    (p) => !dismissed.has(patternKey(p)),
  );

  if (visiblePatterns.length === 0 && adminAlertas.length === 0) return null;

  return (
    <div className="sticky top-0 z-[9990] flex flex-col">
      {/* ── AI pattern banners ── */}
      {visiblePatterns.map((patron) => {
        const isDanger = patron.severity === 'danger';
        return (
          <div
            key={patternKey(patron)}
            className={cn(
              'flex items-center gap-3 px-4 py-2.5 border-b shadow-sm',
              isDanger
                ? 'bg-red-600 border-red-700 text-white'
                : 'bg-amber-500 border-amber-600 text-white',
            )}
          >
            {/* Severity icon */}
            {isDanger
              ? <Flame         className="w-4 h-4 shrink-0" />
              : <AlertTriangle className="w-4 h-4 shrink-0" />
            }

            {/* Message */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-snug">
                <MapPin className="inline w-3 h-3 mr-1 opacity-80" />
                Zona {patron.zona}
                {patron.categoria_nombre && patron.categoria_nombre !== 'Sin categoría' && (
                  <span className="font-normal opacity-90"> · {patron.categoria_nombre}</span>
                )}
                <span className="ml-2 text-[11px] font-bold bg-white/20 rounded-full px-1.5 py-0.5">
                  {patron.count} incidencias
                </span>
              </p>
              <p className="text-xs opacity-85 mt-0.5 leading-snug truncate">
                {patron.message}
              </p>
            </div>

            {/* Per-user dismiss */}
            <button
              onClick={() => dismissPattern(patron)}
              className="shrink-0 p-1.5 rounded-full hover:bg-white/20 active:scale-95 transition-all"
              aria-label="Cerrar alerta"
              title="Solo tú verás esto cerrado. Si se detectan nuevos patrones reaparecerá para todos."
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}

      {/* ── Legacy admin alerts ── */}
      {adminAlertas.map((a) => (
        <div
          key={a.id}
          className="flex items-start gap-3 bg-amber-50 border-b border-amber-300 px-4 py-3 shadow-sm"
        >
          <span className="text-amber-600 text-lg shrink-0">⚠️</span>
          <p className="flex-1 text-sm text-amber-900 leading-snug">{a.mensaje}</p>
          <button
            onClick={() => dismissAdmin(a.id)}
            className="shrink-0 p-1 rounded hover:bg-amber-100 transition-colors"
            aria-label="Cerrar alerta"
          >
            <X className="w-4 h-4 text-amber-700" />
          </button>
        </div>
      ))}
    </div>
  );
}
