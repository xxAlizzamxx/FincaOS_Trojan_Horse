'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Scale, Clock, ChevronRight, Inbox } from 'lucide-react';
import { db } from '@/lib/firebase/client';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import type { Mediacion } from '@/types/database';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

/* ─── Estado config ─── */
const ESTADO_CFG: Record<string, { label: string; badge: string; dot: string }> = {
  solicitada:  { label: 'Solicitada',  badge: 'bg-yellow-100 text-yellow-700 border-yellow-200',  dot: 'bg-yellow-500'  },
  asignada:    { label: 'Asignada',    badge: 'bg-blue-100 text-blue-700 border-blue-200',         dot: 'bg-blue-500'    },
  en_proceso:  { label: 'En proceso',  badge: 'bg-purple-100 text-purple-700 border-purple-200',   dot: 'bg-purple-500'  },
  finalizada:  { label: 'Finalizada',  badge: 'bg-green-100 text-green-700 border-green-200',      dot: 'bg-green-500'   },
};

type Tab = 'disponibles' | 'asignadas' | 'mis';

export default function MediacionesPage() {
  const { perfil, user } = useAuth();
  const esMediador = perfil?.rol === 'mediador';
  const esAdmin    = perfil?.rol === 'admin' || perfil?.rol === 'presidente';

  const [tab, setTab] = useState<Tab>(esMediador ? 'disponibles' : 'mis');
  const [mediaciones, setMediaciones] = useState<Mediacion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (perfil?.comunidad_id && user?.uid) fetchMediaciones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil?.comunidad_id, user?.uid, tab]);

  async function fetchMediaciones() {
    setLoading(true);
    const cid = perfil!.comunidad_id!;
    const uid = user!.uid;

    try {
      let snap;

      if (esMediador && tab === 'disponibles') {
        // Solicitudes sin asignar en mi comunidad
        snap = await getDocs(
          query(
            collection(db, 'mediaciones'),
            where('comunidad_id', '==', cid),
            where('estado', '==', 'solicitada'),
          ),
        );
      } else if (esMediador && tab === 'asignadas') {
        // Las que yo estoy gestionando
        snap = await getDocs(
          query(
            collection(db, 'mediaciones'),
            where('mediador_id', '==', uid),
          ),
        );
      } else if (esAdmin) {
        // Admin ve todas las de la comunidad
        snap = await getDocs(
          query(
            collection(db, 'mediaciones'),
            where('comunidad_id', '==', cid),
          ),
        );
      } else {
        // Vecino ve las suyas
        snap = await getDocs(
          query(
            collection(db, 'mediaciones'),
            where('comunidad_id', '==', cid),
            where('solicitado_por', '==', uid),
          ),
        );
      }

      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Mediacion))
        .sort((a, b) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at));

      setMediaciones(items);
    } catch (err) {
      console.error('Error fetching mediaciones:', err);
    } finally {
      setLoading(false);
    }
  }

  const tabs: { key: Tab; label: string }[] = esMediador
    ? [
        { key: 'disponibles', label: '📋 Disponibles' },
        { key: 'asignadas',   label: '🤝 Asignadas'   },
      ]
    : esAdmin
    ? [{ key: 'mis', label: '📋 Todas' }]
    : [{ key: 'mis', label: '📋 Mis solicitudes' }];

  return (
    <div className="px-4 py-5 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-finca-dark">Mediaciones</h1>
        <p className="text-sm text-muted-foreground">
          {esMediador ? 'Gestiona los conflictos vecinales' : 'Seguimiento de tus solicitudes'}
        </p>
      </div>

      {/* Tabs */}
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
              : 'No has realizado solicitudes de mediación'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {mediaciones.map((m) => {
            const cfg = ESTADO_CFG[m.estado] ?? ESTADO_CFG.solicitada;
            const tipoLabel = m.tipo === 'profesional' ? '👔 Profesional' : '🤖 IA';
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
                              ? m.descripcion.slice(0, 50) + (m.descripcion.length > 50 ? '…' : '')
                              : 'Mediación profesional'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap mt-1">
                          <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                            {tipoLabel}
                          </span>
                          {m.precio_min != null && (
                            <span className="text-xs text-muted-foreground">
                              💰 {m.precio_min}€ – {m.precio_max}€
                            </span>
                          )}
                          {m.estado_pago === 'pagado' && (
                            <span className="text-xs text-green-600 font-medium">✓ Pagado</span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1.5">
                          {formatDistanceToNow(new Date(m.updated_at ?? m.created_at), {
                            addSuffix: true,
                            locale: es,
                          })}
                        </p>
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
