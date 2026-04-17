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
import { BuildingMap, type ZonaEdificio } from '@/components/incidencias/BuildingMap';
import { ESTADO_CONFIG } from '@/lib/incidencias/workflow';
import { cn } from '@/lib/utils';
import type { Incidencia } from '@/types/database';

export default function MapaPage() {
  const router = useRouter();
  const { perfil } = useAuth();
  const [incidencias, setIncidencias]   = useState<Incidencia[]>([]);
  const [numPisos, setNumPisos]         = useState(4);
  const [loading, setLoading]           = useState(true);
  const [zonaActiva, setZonaActiva]     = useState<ZonaEdificio | null>(null);
  const [zonaItems, setZonaItems]       = useState<Incidencia[]>([]);

  useEffect(() => {
    if (perfil?.comunidad_id) fetchData();
  }, [perfil?.comunidad_id]);

  async function fetchData() {
    const cid = perfil!.comunidad_id!;
    const [incSnap, comSnap] = await Promise.all([
      getDocs(query(collection(db, 'incidencias'), where('comunidad_id', '==', cid))),
      getDocs(query(collection(db, 'comunidades'), where('__name__', '==', cid))),
    ]);
    setIncidencias(incSnap.docs.map(d => ({ id: d.id, ...d.data() } as Incidencia)));
    const numViv = comSnap.docs[0]?.data()?.num_viviendas ?? 8;
    setNumPisos(Math.max(1, Math.round(numViv / 4)));
    setLoading(false);
  }

  function handleZonaClick(zona: ZonaEdificio, items: Incidencia[]) {
    setZonaActiva(zona);
    setZonaItems(items);
  }

  const labelZona = (z: ZonaEdificio) => {
    if (z === 'zona_comun')  return 'Zonas comunes';
    if (z === 'parking')     return 'Parking';
    if (z === 'planta_baja') return 'Planta baja';
    return `${z.replace('piso_', '')}º Piso`;
  };

  if (loading) {
    return (
      <div className="px-4 py-5 space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-96 w-full rounded-2xl" />
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
          <p className="text-xs text-muted-foreground">{incidencias.length} incidencias activas</p>
        </div>
      </div>

      {/* Mapa */}
      <BuildingMap
        incidencias={incidencias}
        numPisos={numPisos}
        onZonaClick={handleZonaClick}
      />

      {/* Panel de zona seleccionada */}
      {zonaActiva && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-finca-dark">
            {labelZona(zonaActiva)}
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              ({zonaItems.length} incidencia{zonaItems.length !== 1 ? 's' : ''})
            </span>
          </h2>

          {zonaItems.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6 bg-muted rounded-xl">
              Sin incidencias en esta zona
            </p>
          ) : (
            <div className="space-y-2">
              {zonaItems.map((inc) => {
                const cfg = ESTADO_CONFIG[inc.estado] ?? ESTADO_CONFIG.pendiente;
                return (
                  <Card
                    key={inc.id}
                    className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => router.push(`/incidencias/${inc.id}`)}
                  >
                    <CardContent className="p-3 flex items-center gap-3">
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}
