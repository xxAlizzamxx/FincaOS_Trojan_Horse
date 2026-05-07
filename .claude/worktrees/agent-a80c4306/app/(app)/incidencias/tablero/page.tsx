'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, LayoutGrid } from 'lucide-react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { KanbanColumna } from '@/components/incidencias/KanbanColumna';
import type { Incidencia } from '@/types/database';

const COLUMNAS = [
  {
    id: 'nuevas',
    label: 'Nuevas',
    colorTop: 'border-t-yellow-400',
    bgColor: 'bg-yellow-50/70',
    filtro: (inc: Incidencia) => inc.estado === 'pendiente' && !(inc as any).escalada_por_quorum,
  },
  {
    id: 'en_progreso',
    label: 'En progreso',
    colorTop: 'border-t-blue-400',
    bgColor: 'bg-blue-50/70',
    filtro: (inc: Incidencia) =>
      ['en_revision', 'presupuestada'].includes(inc.estado) && !(inc as any).escalada_por_quorum,
  },
  {
    id: 'criticas',
    label: '🚨 Críticas',
    colorTop: 'border-t-red-500',
    bgColor: 'bg-red-50/70',
    filtro: (inc: Incidencia) =>
      !!(inc as any).escalada_por_quorum ||
      (inc.estado === 'en_ejecucion') ||
      inc.prioridad === 'urgente',
  },
  {
    id: 'resueltas',
    label: 'Resueltas',
    colorTop: 'border-t-green-500',
    bgColor: 'bg-green-50/70',
    filtro: (inc: Incidencia) => ['resuelta', 'cerrada'].includes(inc.estado),
  },
] as const;

export default function TableroPage() {
  const router = useRouter();
  const { perfil } = useAuth();
  const [incidencias, setIncidencias] = useState<Incidencia[]>([]);
  const [totalVecinos, setTotalVecinos] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (perfil?.comunidad_id) fetchData();
  }, [perfil?.comunidad_id]);

  async function fetchData() {
    const cid = perfil!.comunidad_id!;
    const [incSnap, vecinosSnap] = await Promise.all([
      getDocs(query(
        collection(db, 'incidencias'),
        where('comunidad_id', '==', cid),
        orderBy('created_at', 'desc'),
      )),
      getDocs(query(collection(db, 'perfiles'), where('comunidad_id', '==', cid))),
    ]);
    setIncidencias(incSnap.docs.map(d => ({ id: d.id, ...d.data() } as Incidencia)));
    setTotalVecinos(vecinosSnap.size);
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="px-4 py-5 space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="flex gap-4 overflow-x-auto pb-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex-none w-72 space-y-2">
              <Skeleton className="h-8 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-5">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <Button variant="ghost" size="icon" className="w-8 h-8 -ml-1" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-finca-dark flex items-center gap-2">
            <LayoutGrid className="w-5 h-5 text-finca-coral" />
            Tablero
          </h1>
          <p className="text-xs text-muted-foreground">{incidencias.length} incidencias totales</p>
        </div>
      </div>

      {/* Columnas — scroll horizontal en móvil */}
      <div className="flex gap-4 overflow-x-auto pb-6 snap-x snap-mandatory -mx-4 px-4">
        {COLUMNAS.map((col) => {
          const items = incidencias.filter(col.filtro);
          return (
            <KanbanColumna
              key={col.id}
              label={col.label}
              colorTop={col.colorTop}
              bgColor={col.bgColor}
              incidencias={items}
              totalVecinos={totalVecinos}
            />
          );
        })}
      </div>
    </div>
  );
}
