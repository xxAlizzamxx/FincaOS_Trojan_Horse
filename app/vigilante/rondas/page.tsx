'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection, query, where, orderBy, onSnapshot, limit,
  doc, updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  MapPin, Play, CheckCircle2, Clock, AlertCircle,
  ChevronRight, Navigation, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';

interface Ronda {
  id: string;
  vigilante_id: string;
  vigilante_nombre: string;
  estado: 'activa' | 'completada' | 'cancelada';
  iniciada_at: string;
  completada_at: string | null;
  total_checkpoints: number;
  duracion_min?: number;
}

const estadoConfig = {
  activa:     { label: 'En curso',   color: 'bg-blue-100 text-blue-700 border-blue-200',   icon: Navigation  },
  completada: { label: 'Completada', color: 'bg-green-100 text-green-700 border-green-200', icon: CheckCircle2 },
  cancelada:  { label: 'Cancelada',  color: 'bg-red-100 text-red-700 border-red-200',       icon: XCircle     },
};

export default function RondasPage() {
  const { perfil, user } = useAuth();
  const router = useRouter();
  const comunidadId = perfil?.comunidad_id;

  const [rondas, setRondas]   = useState<Ronda[]>([]);
  const [loading, setLoading] = useState(true);

  // Ronda activa del vigilante actual (si existe)
  const rondaActiva = rondas.find(r => r.estado === 'activa' && r.vigilante_id === user?.uid);

  useEffect(() => {
    if (!comunidadId) return;

    const q = query(
      collection(db, 'rondas_vigilancia'),
      where('comunidad_id', '==', comunidadId),
      orderBy('iniciada_at', 'desc'),
      limit(30),
    );

    const unsub = onSnapshot(q, (snap) => {
      setRondas(snap.docs.map(d => ({ id: d.id, ...d.data() } as Ronda)));
      setLoading(false);
    }, () => setLoading(false));

    return () => unsub();
  }, [comunidadId]);

  async function cancelarRonda(rondaId: string) {
    try {
      await updateDoc(doc(db, 'rondas_vigilancia', rondaId), {
        estado:        'cancelada',
        completada_at: new Date().toISOString(),
      });
      toast.success('Ronda cancelada');
    } catch {
      toast.error('No se pudo cancelar la ronda');
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 max-w-2xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-20 rounded-2xl" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-4"><Skeleton className="h-14" /></CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-2xl">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-finca-dark">Rondas de seguridad</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Registra tus recorridos con GPS y checkpoints
        </p>
      </div>

      {/* Ronda activa propia — banner prominente */}
      {rondaActiva ? (
        <div
          className="rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 p-4 text-white shadow-lg shadow-blue-500/30 cursor-pointer active:scale-[0.98] transition-transform"
          onClick={() => router.push('/vigilante/rondas/activa')}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                <Navigation className="w-5 h-5 text-white animate-pulse" />
              </div>
              <div>
                <p className="font-semibold text-sm">Ronda en curso</p>
                <p className="text-xs text-white/80">
                  Iniciada {formatDistanceToNow(new Date(rondaActiva.iniciada_at), { locale: es, addSuffix: true })}
                  {' · '}{rondaActiva.total_checkpoints} checkpoint{rondaActiva.total_checkpoints !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-white/80" />
          </div>
        </div>
      ) : (
        /* CTA Nueva ronda */
        <Button
          className="w-full h-14 bg-finca-coral hover:bg-finca-salmon text-white text-base font-bold shadow-md shadow-finca-coral/30 rounded-2xl"
          onClick={() => router.push('/vigilante/rondas/activa')}
        >
          <Play className="w-5 h-5 mr-2" />
          Iniciar nueva ronda
        </Button>
      )}

      {/* Alerta si hay ronda activa de otro vigilante */}
      {rondas.some(r => r.estado === 'activa' && r.vigilante_id !== user?.uid) && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700">
            Otro vigilante tiene una ronda activa en este momento.
          </p>
        </div>
      )}

      {/* Historial */}
      <section>
        <h2 className="font-semibold text-finca-dark mb-3 text-sm">Historial reciente</h2>

        {rondas.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-8 flex flex-col items-center gap-3 text-center">
              <MapPin className="w-10 h-10 text-muted-foreground opacity-30" />
              <p className="text-sm text-muted-foreground">No hay rondas registradas aún.</p>
              <p className="text-xs text-muted-foreground">Inicia tu primera ronda para que quede en el historial.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {rondas.map((ronda) => {
              const cfg = estadoConfig[ronda.estado];
              const Icon = cfg.icon;
              const esPropia = ronda.vigilante_id === user?.uid;

              return (
                <Card
                  key={ronda.id}
                  className={cn(
                    'border-0 shadow-sm transition-all',
                    ronda.estado === 'activa' && esPropia
                      ? 'ring-2 ring-blue-400/60 cursor-pointer hover:shadow-md active:scale-[0.98]'
                      : '',
                  )}
                  onClick={() => ronda.estado === 'activa' && esPropia && router.push('/vigilante/rondas/activa')}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">

                      {/* Icon */}
                      <div className={cn(
                        'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
                        ronda.estado === 'activa'     ? 'bg-blue-50'  :
                        ronda.estado === 'completada' ? 'bg-green-50' : 'bg-red-50',
                      )}>
                        <Icon className={cn(
                          'w-4 h-4',
                          ronda.estado === 'activa'     ? 'text-blue-500'  :
                          ronda.estado === 'completada' ? 'text-green-600' : 'text-red-500',
                        )} />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-finca-dark truncate">
                            {ronda.vigilante_nombre ?? 'Vigilante'}
                          </p>
                          <Badge variant="outline" className={cn('text-[10px] py-0 h-4 border', cfg.color)}>
                            {cfg.label}
                          </Badge>
                        </div>

                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {format(new Date(ronda.iniciada_at), "d MMM, HH:mm", { locale: es })}
                          </span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {ronda.total_checkpoints} checkpoint{ronda.total_checkpoints !== 1 ? 's' : ''}
                          </span>
                          {ronda.duracion_min != null && ronda.duracion_min > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {ronda.duracion_min} min
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Acciones ronda activa propia */}
                      {ronda.estado === 'activa' && esPropia && (
                        <button
                          onClick={(e) => { e.stopPropagation(); void cancelarRonda(ronda.id); }}
                          className="text-[10px] text-red-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors shrink-0"
                        >
                          Cancelar
                        </button>
                      )}

                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

    </div>
  );
}
