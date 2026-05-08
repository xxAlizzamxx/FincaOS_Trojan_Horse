'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ShieldAlert, ShieldCheck, Info, Wrench, Droplets, Flame, Volume2, Car,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface AlertaComunidad {
  id: string;
  titulo: string;
  descripcion: string;
  tipo: string;
  prioridad: string;
  activa: boolean;
  created_at: string;
  creado_por_nombre?: string;
}

const TIPO_CONFIG: Record<string, { icon: React.ElementType; bg: string; color: string }> = {
  emergencia:    { icon: ShieldAlert, bg: 'bg-red-50',    color: 'text-red-600'    },
  mantenimiento: { icon: Wrench,      bg: 'bg-orange-50', color: 'text-orange-600' },
  agua:          { icon: Droplets,    bg: 'bg-blue-50',   color: 'text-blue-600'   },
  gas:           { icon: Flame,       bg: 'bg-amber-50',  color: 'text-amber-600'  },
  ruido:         { icon: Volume2,     bg: 'bg-purple-50', color: 'text-purple-600' },
  vehiculo:      { icon: Car,         bg: 'bg-cyan-50',   color: 'text-cyan-600'   },
  informativa:   { icon: Info,        bg: 'bg-green-50',  color: 'text-green-600'  },
};

const PRIORIDAD_CONFIG: Record<string, string> = {
  baja:    'bg-green-100 text-green-700 border-green-200',
  media:   'bg-yellow-100 text-yellow-700 border-yellow-200',
  alta:    'bg-orange-100 text-orange-700 border-orange-200',
  urgente: 'bg-red-100 text-red-700 border-red-200',
};

export default function AlertasVecinoPage() {
  const { perfil } = useAuth();
  const [alertas, setAlertas] = useState<AlertaComunidad[]>([]);
  const [loading, setLoading] = useState(true);

  const comunidadId = perfil?.comunidad_id;

  useEffect(() => {
    if (!comunidadId) return;

    const q = query(
      collection(db, 'alertas_comunidad'),
      where('comunidad_id', '==', comunidadId),
    );

    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as AlertaComunidad))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setAlertas(items);
      setLoading(false);
    }, () => setLoading(false));

    return () => unsub();
  }, [comunidadId]);

  const activas   = alertas.filter(a => a.activa);
  const historial = alertas.filter(a => !a.activa);

  return (
    <div className="px-4 py-5 max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold text-finca-dark">Alertas de la comunidad</h1>
        <p className="text-sm text-muted-foreground">Avisos emitidos por portería y administración</p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-3"><Skeleton className="h-16 w-full" /></CardContent>
            </Card>
          ))}
        </div>
      ) : alertas.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="py-10 text-center">
            <ShieldCheck className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No hay alertas para tu comunidad</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {activas.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-finca-dark mb-2">
                Activas ({activas.length})
              </h2>
              <div className="space-y-2">
                {activas.map(a => {
                  const cfg = TIPO_CONFIG[a.tipo] ?? TIPO_CONFIG.informativa;
                  const Icon = cfg.icon;
                  return (
                    <Card key={a.id} className={cn(
                      'border-0 shadow-sm',
                      a.prioridad === 'urgente' && 'border-l-4 border-l-red-500',
                      a.prioridad === 'alta'    && 'border-l-4 border-l-orange-500',
                    )}>
                      <CardContent className="p-3 flex items-start gap-3">
                        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', cfg.bg)}>
                          <Icon className={cn('w-5 h-5', cfg.color)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-sm font-semibold text-finca-dark truncate">{a.titulo}</p>
                            <Badge className={cn('text-[10px] border shrink-0', PRIORIDAD_CONFIG[a.prioridad] ?? PRIORIDAD_CONFIG.media)}>
                              {a.prioridad}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{a.descripcion}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            Portería · {format(new Date(a.created_at), "dd MMM yyyy 'a las' HH:mm", { locale: es })}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}

          {historial.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground mb-2">
                Historial ({historial.length})
              </h2>
              <div className="space-y-1.5">
                {historial.slice(0, 15).map(a => {
                  const cfg = TIPO_CONFIG[a.tipo] ?? TIPO_CONFIG.informativa;
                  const Icon = cfg.icon;
                  return (
                    <Card key={a.id} className="border-0 shadow-sm opacity-60">
                      <CardContent className="p-3 flex items-center gap-3">
                        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', cfg.bg)}>
                          <Icon className={cn('w-4 h-4', cfg.color)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-finca-dark truncate">{a.titulo}</p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(a.created_at), "dd MMM yyyy", { locale: es })}
                          </p>
                        </div>
                        <Badge className="text-[10px] border bg-gray-100 text-gray-500 border-gray-200 shrink-0">Inactiva</Badge>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
