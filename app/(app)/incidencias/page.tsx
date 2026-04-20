'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, CircleAlert as AlertCircle, LayoutGrid, Map } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/firebase/client';
import { collection, query, where, orderBy, getDocs, getDoc, doc } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { Incidencia } from '@/types/database';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { IncidenciaCard } from '@/components/incidencias/IncidenciaCard';
import { sortByPrioridad } from '@/lib/incidencias/workflow';
import { StaggerList } from '@/components/animation/StaggerList';

const filtros = ['Todas', 'Pendiente', 'En revisión', 'Resuelta'];
const filtroMap: Record<string, string[]> = {
  'Todas': [],
  'Pendiente': ['pendiente'],
  'En revisión': ['en_revision', 'presupuestada', 'aprobada', 'en_ejecucion'],
  'Resuelta': ['resuelta', 'cerrada'],
};

export default function IncidenciasPage() {
  const router = useRouter();
  const { perfil } = useAuth();
  const [incidencias, setIncidencias] = useState<Incidencia[]>([]);
  const [totalVecinos, setTotalVecinos] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [filtroActivo, setFiltroActivo] = useState('Todas');

  useEffect(() => {
    if (perfil?.comunidad_id) fetchIncidencias();
  }, [perfil?.comunidad_id]);

  async function fetchIncidencias() {
    const cid = perfil!.comunidad_id!;
    console.log('[Incidencias] fetchIncidencias — cid:', cid);
    try {
      // Fetch incidencias + total vecinos en paralelo
      const [snap, vecinosSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'incidencias'),
          where('comunidad_id', '==', cid),
          orderBy('created_at', 'desc'),
        )),
        getDocs(query(collection(db, 'perfiles'), where('comunidad_id', '==', cid))),
      ]);
      console.log('[Incidencias] encontradas:', snap.size, '| vecinos:', vecinosSnap.size);
      setTotalVecinos(vecinosSnap.size);

      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      const enriched = await Promise.all(
        items.map(async (inc: any) => {
          let autor = null;
          if (inc.autor_id) {
            try {
              const autorSnap = await getDoc(doc(db, 'perfiles', inc.autor_id));
              if (autorSnap.exists()) {
                const data = autorSnap.data();
                autor = {
                  nombre_completo: data.nombre_completo,
                  avatar_url:      data.avatar_url ?? null,
                  rol:             data.rol        ?? 'vecino',
                  numero_piso:     data.numero_piso ?? null,
                };
              }
            } catch (e) {
              console.warn('[Incidencias] autor ilegible', inc.autor_id, e);
            }
          }
          let categoria = null;
          if (inc.categoria_id) {
            try {
              const catSnap = await getDoc(doc(db, 'categorias_incidencia', inc.categoria_id));
              if (catSnap.exists()) {
                const data = catSnap.data();
                categoria = { nombre: data.nombre, icono: data.icono };
              }
            } catch (e) {
              console.warn('[Incidencias] categoria ilegible', inc.categoria_id, e);
            }
          }
          return { ...inc, autor, categoria } as Incidencia;
        })
      );
      setIncidencias(enriched);
    } catch (err) {
      console.error('[Incidencias] Error:', err);
      toast.error('Error al cargar las incidencias');
    } finally {
      setLoading(false);
    }
  }

  const incidenciasFiltradas = incidencias.filter((inc) => {
    const matchBusqueda = inc.titulo.toLowerCase().includes(busqueda.toLowerCase());
    const estadosFiltro = filtroMap[filtroActivo];
    const matchFiltro = estadosFiltro.length === 0 || estadosFiltro.includes(inc.estado);
    return matchBusqueda && matchFiltro;
  });

  return (
    <div className="px-4 py-5 space-y-4">
      {/* Header con vistas */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h1 className="text-2xl font-semibold text-finca-dark">Incidencias</h1>
          <p className="text-sm text-muted-foreground">Problemas reportados en tu comunidad</p>
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-xl p-1 shrink-0">
          <button
            onClick={() => router.push('/incidencias/tablero')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-finca-dark hover:bg-white transition-all"
            title="Vista tablero"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Tablero</span>
          </button>
          <button
            onClick={() => router.push('/incidencias/mapa')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-finca-dark hover:bg-white transition-all"
            title="Vista mapa"
          >
            <Map className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Mapa</span>
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar incidencias..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-none">
        {filtros.map((f) => (
          <button
            key={f}
            onClick={() => setFiltroActivo(f)}
            className={cn(
              'shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              filtroActivo === f
                ? 'bg-finca-coral text-white'
                : 'bg-muted text-muted-foreground hover:bg-finca-peach/50'
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="w-2 h-2 rounded-full" />
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : incidenciasFiltradas.length === 0 ? (
        <div className="py-12 text-center space-y-3">
          <AlertCircle className="w-12 h-12 text-muted-foreground/30 mx-auto" />
          <p className="font-medium text-finca-dark">
            {busqueda ? 'Sin resultados' : 'No hay incidencias'}
          </p>
          <p className="text-sm text-muted-foreground">
            {busqueda ? 'Prueba con otro término de búsqueda' : 'Tu comunidad está en orden por ahora'}
          </p>
        </div>
      ) : (
        <StaggerList className="flex flex-col gap-3" stagger={0.06}>
          {sortByPrioridad(incidenciasFiltradas).map((inc) => (
            <IncidenciaCard
              key={inc.id}
              incidencia={inc}
              totalVecinos={totalVecinos}
            />
          ))}
        </StaggerList>
      )}
    </div>
  );
}
