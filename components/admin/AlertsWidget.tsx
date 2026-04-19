'use client';

/**
 * AlertsWidget
 *
 * Drop-in component for any admin page. Fetches smart alerts from
 * /api/ai/alerts and renders them as non-intrusive cards above existing content.
 *
 * Usage:
 *   <AlertsWidget comunidadId={perfil.comunidad_id} />
 *
 * Safety:
 *   - Shows nothing while loading (never displaces existing UI)
 *   - Shows nothing on error (fail-silent)
 *   - Shows nothing when there are no alerts
 */

import { useEffect, useState } from 'react';

interface SmartAlert {
  type: 'pattern' | 'expiration';
  severity: 'warning' | 'danger';
  message: string;
  data: Record<string, unknown>;
}

interface AlertsWidgetProps {
  comunidadId: string | null | undefined;
}

export default function AlertsWidget({ comunidadId }: AlertsWidgetProps) {
  const [alerts, setAlerts]   = useState<SmartAlert[]>([]);
  const [loaded, setLoaded]   = useState(false);

  useEffect(() => {
    if (!comunidadId) return;

    let cancelled = false;

    fetch(`/api/ai/alerts?comunidadId=${encodeURIComponent(comunidadId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data?.alerts)) {
          setAlerts(data.alerts);
        }
      })
      .catch(() => { /* fail silently */ })
      .finally(() => { if (!cancelled) setLoaded(true); });

    return () => { cancelled = true; };
  }, [comunidadId]);

  // Show nothing while loading or on error or when empty
  if (!loaded || alerts.length === 0) return null;

  return (
    <div className="space-y-2 mb-4">
      {alerts.map((alert, i) => (
        <div
          key={i}
          className={[
            'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm',
            alert.severity === 'danger'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-amber-50 border-amber-200 text-amber-800',
          ].join(' ')}
        >
          <span className="mt-0.5 shrink-0" aria-hidden>
            {alert.severity === 'danger' ? '🔴' : '⚠️'}
          </span>
          <span>{alert.message}</span>
        </div>
      ))}
    </div>
  );
}
