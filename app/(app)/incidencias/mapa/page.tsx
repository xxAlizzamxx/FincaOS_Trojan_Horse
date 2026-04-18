'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Map, X, ChevronRight } from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
    setIncidencias(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Incidencia)));
    setLoading(false);
  }

  function handleZonaClick(zona: ZonaEdificio, items: Incidencia[]) {
    setZonaItems(items);
    setZonaActiva(zona);   // abre el drawer
  }

  function cerrarDrawer() {
    setZonaActiva(null);
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

      {/* Mapa interactivo — toca una zona para ver sus incidencias */}
      <BuildingMap
        incidencias={incidencias}
        onZonaClick={handleZonaClick}
      />

      {/* ── Bottom sheet: incidencias de la zona seleccionada ── */}
      <Sheet open={!!zonaActiva} onOpenChange={(open) => { if (!open) cerrarDrawer(); }}>
        <SheetContent
          side="bottom"
          className="rounded-t-3xl px-0 pb-0 max-h-[72vh] flex flex-col focus:outline-none"
        >
          {/* Drag handle visual */}
          <div className="flex justify-center pt-1 pb-2 shrink-0">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
          </div>

          <SheetHeader className="px-5 pb-3 shrink-0 text-left">
            <div className="flex items-center justify-between">
              <div>
                <SheetTitle className="text-base font-semibold text-finca-dark">
                  {zonaActiva ? labelZona(zonaActiva) : ''}
                </SheetTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {zonaItems.length} incidencia{zonaItems.length !== 1 ? 's' : ''} en esta zona
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 shrink-0"
                onClick={cerrarDrawer}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </SheetHeader>

          {/* Lista scrollable */}
          <div className="overflow-y-auto flex-1 px-4 pb-8 space-y-2">
            {zonaItems.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-muted-foreground">Sin incidencias en esta zona</p>
              </div>
            ) : (
              <>
                {zonaItems.map((inc) => {
                  const cfg = ESTADO_CONFIG[inc.estado] ?? ESTADO_CONFIG.pendiente;
                  return (
                    <Card
                      key={inc.id}
                      className="border-0 shadow-sm cursor-pointer hover:shadow-md active:scale-[0.99] transition-all duration-150"
                      onClick={() => {
                        cerrarDrawer();
                        router.push(`/incidencias/${inc.id}`);
                      }}
                    >
                      <CardContent className="p-3 flex items-center gap-3">
                        <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', SEMAFORO[inc.prioridad] ?? 'bg-gray-300')} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-finca-dark truncate">{inc.titulo}</p>
                          <p className="text-xs text-muted-foreground capitalize">{inc.prioridad}</p>
                        </div>
                        <Badge className={cn('text-[10px] border-0 shrink-0', cfg.badge)}>
                          {cfg.label}
                        </Badge>
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      </CardContent>
                    </Card>
                  );
                })}

                {/* Botón "Ver todas" */}
                <Button
                  variant="outline"
                  className="w-full mt-2"
                  onClick={() => {
                    cerrarDrawer();
                    router.push(`/incidencias?zona=${zonaActiva}`);
                  }}
                >
                  Ver todas las incidencias de esta zona
                </Button>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

    </div>
  );
}
