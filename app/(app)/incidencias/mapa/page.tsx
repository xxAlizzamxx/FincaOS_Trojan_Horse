'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Map } from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { StaggerList } from '@/components/animation/StaggerList';
import { BuildingMap, type ZonaEdificio } from '@/components/incidencias/BuildingMap';
import { ZONA_META } from '@/lib/incidencias/mapZona';
import { ESTADO_CONFIG } from '@/lib/incidencias/workflow';
import { cn } from '@/lib/utils';
import type { Incidencia } from '@/types/database';

function labelZona(z: ZonaEdificio): string {
  const meta = ZONA_META[z as keyof typeof ZONA_META];
  return meta ? `${meta.emoji} ${meta.label}` : z;
}

const SEMAFORO: Record<string, string> = {
  urgente: 'bg-red-500',
  alta:    'bg-orange-400',
  normal:  'bg-blue-400',
  baja:    'bg-green-400',
};

export default function MapaPage() {
  const router = useRouter();
  const { perfil } = useAuth();
  const [incidencias, setIncidencias] = useState<Incidencia[]>([]);
  const [loading, setLoading]         = useState(true);
  const [zonaActiva, setZonaActiva]   = useState<ZonaEdificio | null>(null);
  const [zonaItems, setZonaItems]     = useState<Incidencia[]>([]);

  useEffect(() => {
    if (perfil?.comunidad_id) fetchData();
  }, [perfil?.comunidad_id]);

  async function fetchData() {
    const cid = perfil!.comunidad_id!;
    const snap = await getDocs(
      query(collection(db, 'incidencias'), where('comunidad_id', '==', cid)),
    );
    setIncidencias(snap.docs.map(d => ({ id: d.id, ...d.data() } as Incidencia)));
    setLoading(false);
  }

  function handleZonaClick(zona: ZonaEdificio, items: Incidencia[]) {
    setZonaActiva(zona);
    setZonaItems(items);
  }

  if (loading) {
    return (
      <div className="px-4 py-5 space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-16 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="px-4 py-5 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="w-8 h-8 -ml-1" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold text-finca-dark flex items-center gap-2">
            <Map className="w-5 h-5 text-finca-coral" />
            Mapa del edificio
          </h1>
          <p className="text-xs text-muted-foreground">
            {incidencias.length} incidencia{incidencias.length !== 1 ? 's' : ''} activa{incidencias.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Mapa */}
      <BuildingMap
        incidencias={incidencias}
        onZonaClick={handleZonaClick}
      />

      {/* Panel de zona seleccionada */}
      {zonaActiva && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-finca-dark">{labelZona(zonaActiva)}</h2>
            <span className="text-xs text-muted-foreground">
              ({zonaItems.length} incidencia{zonaItems.length !== 1 ? 's' : ''})
            </span>
          </div>

          {zonaItems.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6 bg-muted rounded-xl">
              Sin incidencias en esta zona
            </p>
          ) : (
            <StaggerList className="space-y-2" stagger={0.06}>
              {zonaItems.map((inc) => {
                const cfg = ESTADO_CONFIG[inc.estado] ?? ESTADO_CONFIG.pendiente;
                return (
                  <Card
                    key={inc.id}
                    className="border-0 shadow-sm cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
                    onClick={() => router.push(`/incidencias/${inc.id}`)}
                  >
                    <CardContent className="p-3 flex items-center gap-3">
                      {/* Semáforo */}
                      <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', SEMAFORO[inc.prioridad] ?? 'bg-gray-300')} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-finca-dark truncate">{inc.titulo}</p>
                        <p className="text-xs text-muted-foreground capitalize">{inc.prioridad}</p>
                      </div>
                      <Badge className={cn('text-[10px] border-0 shrink-0', cfg.badge)}>
                        {cfg.label}
                      </Badge>
                    </CardContent>
                  </Card>
                );
              })}
            </StaggerList>
          )}
        </div>
      )}
    </div>
  );
}
