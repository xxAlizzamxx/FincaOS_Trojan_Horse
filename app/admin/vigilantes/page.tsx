'use client';

import { useEffect, useState } from 'react';
import {
  collection, query, where, orderBy, getDocs, onSnapshot, limit,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AvatarVecino } from '@/components/ui/avatar-vecino';
import {
  ShieldCheck, Navigation, CheckCircle2, XCircle,
  Clock, MapPin, Moon, Sun,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow, format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Perfil } from '@/types/database';

interface RondaResumen {
  id: string;
  estado: 'activa' | 'completada' | 'cancelada';
  iniciada_at: string;
  total_checkpoints: number;
  duracion_min?: number;
}

interface VigilanteRow {
  perfil: Perfil & { en_turno?: boolean };
  rondaActiva: RondaResumen | null;
  ultimaRonda: RondaResumen | null;
  totalRondasHoy: number;
}

export default function AdminVigilantesPage() {
  const { perfil: adminPerfil } = useAuth();
  const comunidadId = adminPerfil?.comunidad_id;

  const [rows, setRows]     = useState<VigilanteRow[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Escucha perfiles con rol vigilante ──────────────────────────────────
  useEffect(() => {
    if (!comunidadId) return;

    const q = query(
      collection(db, 'perfiles'),
      where('comunidad_id', '==', comunidadId),
      where('rol', '==', 'vigilante'),
      orderBy('nombre_completo'),
    );

    const unsub = onSnapshot(q, async (snap) => {
      const vigilantes = snap.docs.map(d => ({
        ...(d.data() as Perfil & { en_turno?: boolean }),
        id: d.id,
      }));

      // Para cada vigilante, obtener sus rondas de hoy + activa
      const hoyInicio = new Date();
      hoyInicio.setHours(0, 0, 0, 0);

      const rowsData: VigilanteRow[] = await Promise.all(
        vigilantes.map(async (v) => {
          try {
            // Note: orderBy removed — uses existing comunidad+vigilante+estado index.
            // Results are sorted client-side to avoid requiring the new compound index
            // until Firestore finishes building it.
            const rondasSnap = await getDocs(
              query(
                collection(db, 'rondas_vigilancia'),
                where('comunidad_id', '==', comunidadId),
                where('vigilante_id', '==', v.id),
                limit(20),
              ),
            );

            const rondas = rondasSnap.docs
              .map(d => ({ id: d.id, ...(d.data() as Omit<RondaResumen, 'id'>) }))
              .sort((a, b) =>
                new Date(b.iniciada_at).getTime() - new Date(a.iniciada_at).getTime()
              );

            const rondaActiva  = rondas.find(r => r.estado === 'activa') ?? null;
            const ultimaRonda  = rondas.find(r => r.estado !== 'activa') ?? null;
            const totalRondasHoy = rondas.filter(r =>
              new Date(r.iniciada_at) >= hoyInicio,
            ).length;

            return { perfil: v, rondaActiva, ultimaRonda, totalRondasHoy };
          } catch (err) {
            console.error('[AdminVigilantes] rondas query error for', v.id, err);
            return { perfil: v, rondaActiva: null, ultimaRonda: null, totalRondasHoy: 0 };
          }
        }),
      );

      setRows(rowsData);
      setLoading(false);
    }, () => setLoading(false));

    return () => unsub();
  }, [comunidadId]);

  // ── KPIs ────────────────────────────────────────────────────────────────
  const enTurno    = rows.filter(r => r.perfil.en_turno).length;
  const enDescanso = rows.length - enTurno;
  const conRondaActiva = rows.filter(r => r.rondaActiva).length;

  if (loading) {
    return (
      <div className="space-y-5 max-w-3xl">
        <Skeleton className="h-8 w-56" />
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <Skeleton className="w-10 h-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-finca-dark">Gestión de vigilantes</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Estado en tiempo real · rondas y turnos
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: Sun,       label: 'En turno',    value: enTurno,        bg: 'bg-green-50',  color: 'text-green-600' },
          { icon: Moon,      label: 'En descanso', value: enDescanso,     bg: 'bg-gray-50',   color: 'text-gray-500' },
          { icon: Navigation,label: 'Con ronda',   value: conRondaActiva, bg: 'bg-blue-50',   color: 'text-blue-600' },
        ].map(k => (
          <Card key={k.label} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center mb-2', k.bg)}>
                <k.icon className={cn('w-4 h-4', k.color)} />
              </div>
              <p className="text-2xl font-bold text-finca-dark">{k.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{k.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Lista de vigilantes */}
      {rows.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-10 flex flex-col items-center gap-3 text-center">
            <ShieldCheck className="w-12 h-12 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground">No hay vigilantes registrados.</p>
            <p className="text-xs text-muted-foreground">
              Asigna el rol &quot;vigilante&quot; a un miembro desde Vecinos.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map(({ perfil: v, rondaActiva, ultimaRonda, totalRondasHoy }) => (
            <Card key={v.id} className="border-0 shadow-sm overflow-hidden">
              {/* Side stripe */}
              <div className={cn(
                'absolute left-0 top-0 bottom-0 w-1 rounded-l-xl',
                v.en_turno ? 'bg-green-400' : 'bg-gray-200',
              )} />

              <CardContent className="p-4 pl-5">
                <div className="flex items-start gap-3">

                  {/* Avatar */}
                  <AvatarVecino perfil={v} size="sm" />

                  {/* Info */}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm text-finca-dark">{v.nombre_completo}</p>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px] h-4 py-0 border font-medium',
                          v.en_turno
                            ? 'bg-green-50 text-green-700 border-green-200'
                            : 'bg-gray-50 text-gray-500 border-gray-200',
                        )}
                      >
                        {v.en_turno ? '● En turno' : '○ Descanso'}
                      </Badge>
                    </div>

                    {/* Ronda activa */}
                    {rondaActiva ? (
                      <div className="flex items-center gap-1.5 text-xs text-blue-600 font-medium">
                        <Navigation className="w-3 h-3 animate-pulse" />
                        Ronda en curso —{' '}
                        {formatDistanceToNow(new Date(rondaActiva.iniciada_at), { locale: es, addSuffix: true })}
                        {' · '}{rondaActiva.total_checkpoints} checkpoint{rondaActiva.total_checkpoints !== 1 ? 's' : ''}
                      </div>
                    ) : ultimaRonda ? (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {ultimaRonda.estado === 'completada'
                          ? <CheckCircle2 className="w-3 h-3 text-green-500" />
                          : <XCircle className="w-3 h-3 text-red-400" />
                        }
                        Última ronda {ultimaRonda.estado === 'completada' ? 'completada' : 'cancelada'}{' '}
                        {formatDistanceToNow(new Date(ultimaRonda.iniciada_at), { locale: es, addSuffix: true })}
                        {ultimaRonda.duracion_min ? ` · ${ultimaRonda.duracion_min} min` : ''}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Sin rondas registradas</p>
                    )}

                    {/* Stats del día */}
                    <div className="flex items-center gap-3 pt-0.5">
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <MapPin className="w-2.5 h-2.5" />
                        {totalRondasHoy} ronda{totalRondasHoy !== 1 ? 's' : ''} hoy
                      </span>
                      {v.numero_piso && (
                        <span className="text-[11px] text-muted-foreground">
                          Piso {v.numero_piso}
                        </span>
                      )}
                    </div>
                  </div>

                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
