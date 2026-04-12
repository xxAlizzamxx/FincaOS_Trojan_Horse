'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Inbox, ArrowLeft } from 'lucide-react';
import { db } from '@/lib/firebase/client';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import type { Mediacion } from '@/types/database';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

/* ─── Estado display config — incluye todos los estados posibles ─── */
const ESTADO_CFG: Record<string, { label: string; badge: string; dot: string }> = {
  ia_procesando:    { label: 'Procesando IA',  badge: 'bg-blue-100 text-blue-700 border-blue-200',       dot: 'bg-blue-400'    },
  ia_propuesta:     { label: 'Propuesta IA',   badge: 'bg-indigo-100 text-indigo-700 border-indigo-200', dot: 'bg-indigo-400'  },
  mediador_requerido:{ label: 'Mediador req.', badge: 'bg-orange-100 text-orange-700 border-orange-200', dot: 'bg-orange-400'  },
  solicitada:       { label: 'Solicitada',     badge: 'bg-yellow-100 text-yellow-700 border-yellow-200', dot: 'bg-yellow-500'  },
  asignada:         { label: 'Asignada',       badge: 'bg-blue-100 text-blue-700 border-blue-200',       dot: 'bg-blue-500'    },
  en_proceso:       { label: 'En proceso',     badge: 'bg-purple-100 text-purple-700 border-purple-200', dot: 'bg-purple-500'  },
  finalizada:       { label: 'Finalizada',     badge: 'bg-green-100 text-green-700 border-green-200',    dot: 'bg-green-500'   },
  resuelto:         { label: 'Resuelta',       badge: 'bg-green-100 text-green-700 border-green-200',    dot: 'bg-green-500'   },
};

type Tab = 'todas' | 'disponibles' | 'asignadas' | 'mis';

export default function MediacionesPage() {
  const router = useRouter();
  const { perfil, user } = useAuth();

  const rol        = perfil?.rol ?? '';
  const esMediador = rol === 'mediador';
  const esAdmin    = rol === 'admin' || rol === 'presidente';

  const defaultTab: Tab = esMediador ? 'disponibles' : esAdmin ? 'todas' : 'mis';
  const [tab, setTab]           = useState<Tab>(defaultTab);
  const [todas, setTodas]       = useState<Mediacion[]>([]);   // caché completo de la comunidad
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  /* ── Fetch único: trae TODOS los de la comunidad, filtra en cliente ── */
  useEffect(() => {
    if (perfil?.comunidad_id && user?.uid) fetchTodas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil?.comunidad_id, user?.uid]);

  async function fetchTodas() {
    setLoading(true);
    setError(null);
    const cid = perfil!.comunidad_id!;

    try {
      const snap = await getDocs(
        query(collection(db, 'mediaciones'), where('comunidad_id', '==', cid)),
      );
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Mediacion))
        .sort((a, b) =>
          (b.updated_at ?? b.created_at ?? '').localeCompare(
            a.updated_at ?? a.created_at ?? '',
          ),
        );
      setTodas(items);
    } catch (err: any) {
      console.error('Error fetching mediaciones:', err);
      setError(err?.message ?? 'Error al cargar las mediaciones');
    } finally {
      setLoading(false);
    }
  }

  /* ── Filtro client-side según tab + rol ── */
  const uid = user?.uid ?? '';
  const mediaciones: Mediacion[] = (() => {
    if (esMediador) {
      if (tab === 'disponibles') return todas.filter((m) => m.estado === 'solicitada' && !m.mediador_id);
      if (tab === 'asignadas')   return todas.filter((m) => m.mediador_id === uid);
    }
    if (esAdmin) return todas;   // admin / presidente ve todo
    // vecino: sus propias mediaciones
    return todas.filter((m) => m.solicitado_por === uid || m.denunciante_id === uid);
  })();

  /* ── Tabs ── */
  const tabs: { key: Tab; label: string }[] = esMediador
    ? [
        { key: 'disponibles', label: '📋 Disponibles' },
        { key: 'asignadas',   label: '🤝 Asignadas'   },
      ]
    : esAdmin
    ? [{ key: 'todas', label: `📋 Todas (${todas.length})` }]
    : [{ key: 'mis',   label: '📋 Mis solicitudes' }];

  return (
    <div className="px-4 py-5 space-y-4">

      {/* Header con flecha de retorno */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="w-9 h-9 rounded-full bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </button>
        <div>
          <h1 className="text-2xl font-semibold text-finca-dark">Mediaciones</h1>
          <p className="text-sm text-muted-foreground">
            {esMediador
              ? 'Gestiona los conflictos vecinales'
              : esAdmin
              ? `${todas.length} mediación${todas.length !== 1 ? 'es' : ''} en la comunidad`
              : 'Seguimiento de tus solicitudes'}
          </p>
        </div>
      </div>

      {/* Tabs — solo si hay más de una */}
      {tabs.length > 1 && (
        <div className="flex gap-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                tab === t.key
                  ? 'bg-finca-coral text-white'
                  : 'bg-muted text-muted-foreground hover:bg-finca-peach/50',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-50 rounded-xl text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>

      ) : mediaciones.length === 0 ? (
        <div className="py-16 text-center space-y-3">
          <Inbox className="w-12 h-12 text-muted-foreground/20 mx-auto" />
          <p className="font-medium text-finca-dark">No hay mediaciones</p>
          <p className="text-sm text-muted-foreground">
            {esMediador && tab === 'disponibles'
              ? 'No hay solicitudes disponibles en tu comunidad'
              : esMediador
              ? 'Aún no has aceptado ninguna mediación'
              : esAdmin
              ? 'No hay mediaciones registradas en la comunidad'
              : 'No has realizado solicitudes de mediación'}
          </p>
        </div>

      ) : (
        <div className="space-y-3">
          {mediaciones.map((m) => {
            const cfg       = ESTADO_CFG[m.estado] ?? { label: m.estado, badge: 'bg-gray-100 text-gray-600 border-gray-200', dot: 'bg-gray-400' };
            const tipoLabel = m.tipo === 'profesional' ? '👔 Profesional' : '🤖 IA';
            const fecha     = m.updated_at ?? m.created_at;

            return (
              <Link key={m.id} href={`/mediaciones/${m.id}`}>
                <Card className="border-0 shadow-sm hover:shadow-md transition-all active:scale-[0.99] cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <div className={cn('w-2 h-2 rounded-full shrink-0', cfg.dot)} />
                          <p className="font-medium text-sm text-finca-dark truncate">
                            {m.descripcion
                              ? m.descripcion.slice(0, 60) + (m.descripcion.length > 60 ? '…' : '')
                              : 'Mediación sin descripción'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap mt-1">
                          <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                            {tipoLabel}
                          </span>
                          {m.tipo && m.tipo !== 'profesional' && (
                            <span className="text-xs text-muted-foreground capitalize">
                              {m.tipo}
                            </span>
                          )}
                          {m.precio_min != null && (
                            <span className="text-xs text-muted-foreground">
                              💰 {m.precio_min}€–{m.precio_max}€
                            </span>
                          )}
                          {m.estado_pago === 'pagado' && (
                            <span className="text-xs text-green-600 font-medium">✓ Pagado</span>
                          )}
                        </div>
                        {fecha && (
                          <p className="text-[11px] text-muted-foreground mt-1.5">
                            {formatDistanceToNow(new Date(fecha), { addSuffix: true, locale: es })}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <Badge className={cn('text-[10px] border', cfg.badge)}>{cfg.label}</Badge>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
