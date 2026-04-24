'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, CircleAlert as AlertCircle, LayoutGrid, Map, Bot, ChevronDown, ChevronRight } from 'lucide-react';
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
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

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

      const items = snap.docs.map(d => {
        const data = d.data();
        // Normalize Firestore Timestamps to ISO strings
        if (data.created_at?.toDate) data.created_at = data.created_at.toDate().toISOString();
        if (data.updated_at?.toDate) data.updated_at = data.updated_at.toDate().toISOString();
        return { id: d.id, ...data };
      });

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

  // ── Inspection grouping ────────────────────────────────────────────────────
  //
  // Two sources of truth for parent→child relationships:
  //   1. inc.hijos[]  — stored on the parent (set when the inspection is created)
  //   2. child.parentId — set on each child via batch update (may lag or fail)
  //
  // We use BOTH to be resilient. A child is hidden from top-level if:
  //   • it has a parentId pointing to a known inspection, OR
  //   • its ID appears in the `hijos` array of any inspection incidencia.

  // Build the set of hijos IDs declared by AI parent inspections (source 1)
  const hijosFromParent = new Set<string>();
  incidenciasFiltradas.forEach((inc: any) => {
    if ((inc as any).tipo_problema === 'inspeccion_preventiva') {
      const hijos: string[] = (inc as any).hijos ?? [];
      hijos.forEach((id: string) => hijosFromParent.add(id));
    }
  });

  // Build lookup parentId → children, combining both sources (source 2)
  const childrenByParent: Record<string, Incidencia[]> = {};
  incidenciasFiltradas.forEach((inc: any) => {
    const pid = (inc as any).parentId as string | undefined;
    if (pid) {
      if (!childrenByParent[pid]) childrenByParent[pid] = [];
      childrenByParent[pid].push(inc);
    }
  });

  // For each inspection, also add children found via hijos[] (in case parentId not yet set)
  incidenciasFiltradas.forEach((inc: any) => {
    if ((inc as any).tipo_problema === 'inspeccion_preventiva') {
      const hijos: string[] = (inc as any).hijos ?? [];
      if (hijos.length === 0) return;
      if (!childrenByParent[inc.id]) childrenByParent[inc.id] = [];
      const alreadyAdded = new Set(childrenByParent[inc.id].map((c: any) => c.id));
      hijos.forEach((hid: string) => {
        if (!alreadyAdded.has(hid)) {
          const child = incidenciasFiltradas.find((c: any) => c.id === hid);
          if (child) {
            childrenByParent[inc.id].push(child);
            alreadyAdded.add(hid);
          }
        }
      });
    }
  });

  // Top-level: exclude children (those with parentId OR those in hijosFromParent)
  const topLevel = incidenciasFiltradas.filter((inc: any) =>
    !(inc as any).parentId && !hijosFromParent.has(inc.id)
  );

  function toggleGroup(id: string) {
    setExpandedGroups(prev => ({ ...prev, [id]: !prev[id] }));
  }

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
          {sortByPrioridad(topLevel).map((inc) => {
            const isAIParent = (inc as any).tipo_problema === 'inspeccion_preventiva'
              || (inc as any).autor_id === 'sistema_ia'
              || (inc as any).creado_por_avatar === 'ia';
            const children     = childrenByParent[inc.id] ?? [];
            // Fallback: use stored total_hijos from the doc if no children in local state
            const storedHijos  = (inc as any).total_hijos as number ?? 0;
            const isExpanded   = expandedGroups[inc.id] ?? false;

            // Only count open children for display; hide group if all resolved
            const openChildren = children.filter(
              c => !['resuelta', 'cerrada'].includes((c as any).estado ?? '')
            );

            if (isAIParent && (children.length > 0 || storedHijos > 0)) {
              return (
                <div key={inc.id} className="flex flex-col gap-2">
                  {/* AI parent group header */}
                  <button
                    className="w-full text-left"
                    onClick={() => toggleGroup(inc.id)}
                  >
                    <Card className="border-0 shadow-sm bg-violet-50 ring-1 ring-violet-200 rounded-2xl overflow-hidden hover:shadow-md transition-all">
                      <CardContent className="p-3 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-violet-100 ring-1 ring-violet-300 flex items-center justify-center shrink-0">
                          <Bot className="w-4 h-4 text-violet-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-violet-800 truncate">{inc.titulo}</p>
                          <p className="text-xs text-violet-500 mt-0.5">
                            {openChildren.length > 0
                              ? `${openChildren.length} incidencia${openChildren.length !== 1 ? 's' : ''} activa${openChildren.length !== 1 ? 's' : ''}`
                              : storedHijos > 0
                                ? `${storedHijos} incidencia${storedHijos !== 1 ? 's' : ''} agrupada${storedHijos !== 1 ? 's' : ''}`
                                : 'Todas resueltas ✓'
                            }
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[10px] font-semibold text-violet-700 bg-violet-100 border border-violet-200 rounded-full px-2 py-0.5">
                            Agrupado por IA
                          </span>
                          {isExpanded
                            ? <ChevronDown  className="w-4 h-4 text-violet-400" />
                            : <ChevronRight className="w-4 h-4 text-violet-400" />
                          }
                        </div>
                      </CardContent>
                    </Card>
                  </button>

                  {/* Expanded children — exclude resolved/closed */}
                  {isExpanded && (
                    <div className="flex flex-col gap-2 pl-4 border-l-2 border-violet-200 ml-4">
                      {sortByPrioridad(
                        children.filter(c => !['resuelta', 'cerrada'].includes((c as any).estado ?? ''))
                      ).map(child => (
                        <IncidenciaCard
                          key={child.id}
                          incidencia={child}
                          totalVecinos={totalVecinos}
                        />
                      ))}
                      {/* Show resolved count if any */}
                      {(() => {
                        const resolvedCount = children.filter(c =>
                          ['resuelta', 'cerrada'].includes((c as any).estado ?? '')
                        ).length;
                        return resolvedCount > 0 ? (
                          <p className="text-[11px] text-muted-foreground px-2 py-1">
                            + {resolvedCount} resuelta{resolvedCount !== 1 ? 's' : ''} (oculta{resolvedCount !== 1 ? 's' : ''})
                          </p>
                        ) : null;
                      })()}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <IncidenciaCard
                key={inc.id}
                incidencia={inc}
                totalVecinos={totalVecinos}
              />
            );
          })}
        </StaggerList>
      )}
    </div>
  );
}
