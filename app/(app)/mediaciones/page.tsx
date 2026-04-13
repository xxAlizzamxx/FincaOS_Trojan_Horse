'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Inbox, ArrowLeft, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/firebase/client';
import { collection, getDocs, query, where, QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

/* Estado visual — cubre TODOS los estados posibles incluyendo los del flujo IA */
const ESTADO_CFG: Record<string, { label: string; badge: string; dot: string }> = {
  ia_procesando:     { label: 'IA procesando',  badge: 'bg-blue-100 text-blue-700 border-blue-200',       dot: 'bg-blue-400'    },
  ia_propuesta:      { label: 'Propuesta IA',   badge: 'bg-indigo-100 text-indigo-700 border-indigo-200', dot: 'bg-indigo-400'  },
  mediador_requerido:{ label: 'Mediador req.',  badge: 'bg-orange-100 text-orange-700 border-orange-200', dot: 'bg-orange-400'  },
  solicitada:        { label: 'Solicitada',     badge: 'bg-yellow-100 text-yellow-700 border-yellow-200', dot: 'bg-yellow-500'  },
  asignada:          { label: 'Asignada',       badge: 'bg-blue-100 text-blue-700 border-blue-200',       dot: 'bg-blue-500'    },
  en_proceso:        { label: 'En proceso',     badge: 'bg-purple-100 text-purple-700 border-purple-200', dot: 'bg-purple-500'  },
  finalizada:        { label: 'Finalizada',     badge: 'bg-green-100 text-green-700 border-green-200',    dot: 'bg-green-500'   },
  resuelto:          { label: 'Resuelta',       badge: 'bg-green-100 text-green-700 border-green-200',    dot: 'bg-green-500'   },
};

export default function MediacionesPage() {
  const router = useRouter();
  const { perfil, user } = useAuth();

  const [mediaciones, setMediaciones] = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [fetchInfo, setFetchInfo]     = useState('');

  useEffect(() => {
    if (perfil && user) fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil?.id, user?.uid]);

  async function fetch() {
    setLoading(true);
    try {
      const cid = perfil!.comunidad_id;
      const uid = user!.uid;
      const rol = perfil!.rol;

      if (!cid) {
        setFetchInfo('Sin comunidad_id en el perfil');
        setLoading(false);
        return;
      }

      // Fetch TODAS las mediaciones de la comunidad sin filtros adicionales
      const snap = await getDocs(
        query(collection(db, 'mediaciones'), where('comunidad_id', '==', cid))
      );

      const todas = snap.docs.map((d: QueryDocumentSnapshot<DocumentData>) => ({ id: d.id, ...d.data() }));
      setFetchInfo(`cid=${cid} uid=${uid} rol=${rol} → ${todas.length} docs`);

      // Filtrado client-side según rol
      let resultado: any[];
      if (rol === 'admin' || rol === 'presidente') {
        resultado = todas;
      } else if (rol === 'mediador') {
        resultado = todas.filter(
          (m) => m.estado === 'solicitada' || m.mediador_id === uid
        );
      } else {
        // vecino: las que creó (denunciante_id O solicitado_por)
        resultado = todas.filter(
          (m) => m.denunciante_id === uid || m.solicitado_por === uid
        );
      }

      // Convertir Timestamp de Firestore a número para ordenar
      function toMs(val: any): number {
        if (!val) return 0;
        if (typeof val === 'string') return new Date(val).getTime();
        if (typeof val.toMillis === 'function') return val.toMillis(); // Firestore Timestamp
        if (typeof val.seconds === 'number') return val.seconds * 1000; // Timestamp plano
        return 0;
      }

      resultado.sort((a, b) =>
        toMs(b.updated_at ?? b.created_at) - toMs(a.updated_at ?? a.created_at)
      );

      setMediaciones(resultado);
    } catch (err: any) {
      console.error('Error mediaciones:', err);
      toast.error('Error al cargar: ' + (err?.message ?? err));
      setFetchInfo('ERROR: ' + (err?.message ?? String(err)));
    } finally {
      setLoading(false);
    }
  }

  const esAdmin    = perfil?.rol === 'admin' || perfil?.rol === 'presidente';
  const esMediador = perfil?.rol === 'mediador';

  return (
    <div className="px-4 py-5 space-y-4">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="w-9 h-9 rounded-full bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-finca-dark">Mediaciones</h1>
          <p className="text-sm text-muted-foreground">
            {loading
              ? 'Cargando…'
              : esAdmin
              ? `${mediaciones.length} mediación${mediaciones.length !== 1 ? 'es' : ''} en la comunidad`
              : esMediador
              ? 'Gestiona los conflictos vecinales'
              : 'Seguimiento de tus solicitudes'}
          </p>
        </div>
        <button
          onClick={fetch}
          disabled={loading}
          className="w-9 h-9 rounded-full bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors shrink-0"
        >
          <RefreshCw className={cn('w-4 h-4 text-muted-foreground', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Debug info — quitar en producción */}
      {fetchInfo && (
        <div className="text-[10px] text-muted-foreground bg-muted/40 rounded-lg px-3 py-1.5 font-mono break-all">
          {fetchInfo}
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
            {esAdmin
              ? 'No hay mediaciones registradas en la comunidad'
              : esMediador
              ? 'No hay solicitudes asignadas o disponibles'
              : 'No has realizado solicitudes de mediación'}
          </p>
          <Button variant="outline" size="sm" onClick={fetch} className="mt-2">
            <RefreshCw className="w-3.5 h-3.5 mr-2" />
            Reintentar
          </Button>
        </div>

      ) : (
        <div className="space-y-3">
          {mediaciones.map((m) => {
            const cfg = ESTADO_CFG[m.estado] ?? {
              label: m.estado ?? 'Desconocido',
              badge: 'bg-gray-100 text-gray-600 border-gray-200',
              dot: 'bg-gray-400',
            };
            const raw   = m.updated_at ?? m.created_at;
            const fecha = raw
              ? typeof raw === 'string'
                ? new Date(raw)
                : typeof raw.toDate === 'function'
                ? raw.toDate()
                : new Date(raw.seconds * 1000)
              : null;
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
                              ? m.descripcion.slice(0, 60) + (m.descripcion.length > 60 ? '…' : '')
                              : 'Sin descripción'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap mt-1">
                          <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                            {tipoLabel}
                          </span>
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
                            {formatDistanceToNow(fecha, { addSuffix: true, locale: es })}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <Badge className={cn('text-[10px] border', cfg.badge)}>
                          {cfg.label}
                        </Badge>
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
