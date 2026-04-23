'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, CircleAlert as AlertCircle, LayoutGrid, List, CheckSquare, Bot, Trash2, Loader2, Cpu } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/firebase/client';
import {
  collection, query, where, orderBy, limit, startAfter,
  getDocs, doc, getDoc, updateDoc,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { Incidencia } from '@/types/database';
import { notificarUsuario } from '@/lib/firebase/notifications';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const estadoConfig: Record<string, { label: string; color: string }> = {
  pendiente:     { label: 'Pendiente',     color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  en_revision:   { label: 'En revisión',   color: 'bg-blue-100 text-blue-700 border-blue-200' },
  presupuestada: { label: 'Presupuestada', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  en_ejecucion:  { label: 'En ejecución',  color: 'bg-purple-100 text-purple-700 border-purple-200' },
  resuelta:      { label: 'Resuelta',      color: 'bg-green-100 text-green-700 border-green-200' },
};

const KANBAN_COLUMNS = ['pendiente', 'en_revision', 'presupuestada', 'en_ejecucion', 'resuelta'];

export default function AdminIncidenciasPage() {
  const { user, perfil } = useAuth();
  const [incidencias, setIncidencias] = useState<Incidencia[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
  const [actualizando, setActualizando] = useState<string | null>(null);
  const [vista, setVista] = useState<'lista' | 'kanban'>('lista');
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [accionLote, setAccionLote] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);

  const PAGE_SIZE = 50;

  useEffect(() => {
    if (perfil?.comunidad_id) fetchIncidencias();
  }, [perfil?.comunidad_id]);

  /**
   * Fetches a page of incidencias.
   *
   * Performance strategy:
   *  1. Query is limited to PAGE_SIZE (50) docs — avoids loading 1000+ items.
   *  2. New incidencias already carry `autor_nombre` (denormalized at creation)
   *     so zero extra reads are needed for them.
   *  3. Legacy docs without `autor_nombre` are enriched via a single
   *     Promise.all over the DEDUPLICATED set of missing autor_ids — no
   *     sequential awaits, no duplicate fetches for the same author.
   *  4. Cursor-based pagination via startAfter(lastDoc).
   */
  async function fetchIncidencias(cursor?: QueryDocumentSnapshot | null) {
    if (cursor) setLoadingMore(true);
    else setLoading(true);

    try {
      const incQuery = cursor
        ? query(
            collection(db, 'incidencias'),
            where('comunidad_id', '==', perfil!.comunidad_id!),
            orderBy('created_at', 'desc'),
            limit(PAGE_SIZE),
            startAfter(cursor),
          )
        : query(
            collection(db, 'incidencias'),
            where('comunidad_id', '==', perfil!.comunidad_id!),
            orderBy('created_at', 'desc'),
            limit(PAGE_SIZE),
          );

      const incSnap = await getDocs(incQuery);

      // Track cursor for next page
      const newLastDoc = incSnap.docs[incSnap.docs.length - 1] ?? null;
      setLastDoc(newLastDoc);
      setHasMore(incSnap.docs.length === PAGE_SIZE);

      const rawList = incSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Incidencia);

      // ── Enrich legacy docs that lack denormalized autor_nombre ──────────
      // Collect UNIQUE autor_ids that still need a profile fetch
      const missingIds = Array.from(new Set(
        rawList
          .filter(inc => !inc.autor_nombre && inc.autor_id)
          .map(inc => inc.autor_id),
      ));

      // One parallel batch — not a sequential loop
      const profileMap = new Map<string, any>();
      if (missingIds.length > 0) {
        const snaps = await Promise.all(
          missingIds.map(id => getDoc(doc(db, 'perfiles', id))),
        );
        snaps.forEach(snap => {
          if (snap.exists()) profileMap.set(snap.id, snap.data());
        });
      }

      // Merge: prefer denormalized field, fall back to fetched profile
      const enriched: Incidencia[] = rawList.map(inc => {
        if (inc.autor_nombre) {
          // Denormalized — shape into the .autor object the UI already expects
          return {
            ...inc,
            autor: { id: inc.autor_id, nombre_completo: inc.autor_nombre } as any,
          };
        }
        const profileData = profileMap.get(inc.autor_id);
        return {
          ...inc,
          autor: profileData ? { id: inc.autor_id, ...profileData } as any : undefined,
        };
      });

      setIncidencias(prev => cursor ? [...prev, ...enriched] : enriched);
    } catch (err) {
      console.error('[fetchIncidencias]', err);
      toast.error('Error al cargar las incidencias');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  async function cambiarEstado(id: string, nuevoEstado: string) {
    setActualizando(id);

    // Capture old state BEFORE update — needed to detect transitions
    const oldEstado = incidencias.find(i => i.id === id)?.estado ?? '';

    try {
      const ahora = new Date().toISOString();
      await updateDoc(doc(db, 'incidencias', id), {
        estado: nuevoEstado,
        updated_at: ahora,
        ...(nuevoEstado === 'resuelta' ? { resuelta_at: ahora } : {}),
      });

      // ── Optimistic local update — no re-fetch needed ──────────────────
      setIncidencias(prev =>
        prev.map(i =>
          i.id === id
            ? { ...i, estado: nuevoEstado as Incidencia['estado'], updated_at: ahora }
            : i,
        ),
      );

      // ── Learning metrics — fire-and-forget ────────────────────────────
      // Detect transitions that matter for provider scoring:
      //   any → resuelta  : update performance metrics
      //   resuelta → any  : increment reopen counter
      const metricsType =
        nuevoEstado === 'resuelta'
          ? 'resuelta'
          : oldEstado === 'resuelta'
          ? 'reopen'
          : null;

      if (metricsType && user) {
        user.getIdToken()
          .then(token =>
            fetch('/api/ai/metrics/incidencia', {
              method:  'POST',
              headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify({ incidenciaId: id, tipo: metricsType }),
            }),
          )
          .catch(() => {}); // fire-and-forget, never block UI
      }

      const inc = incidencias.find((i) => i.id === id);
      if (inc?.autor_id && perfil?.comunidad_id) {
        const label = estadoConfig[nuevoEstado]?.label || nuevoEstado;
        notificarUsuario(inc.autor_id, perfil.comunidad_id, 'estado', `Incidencia actualizada`, `"${inc.titulo}" ahora está: ${label}`, `/incidencias/${id}`);
      }
      toast.success('Estado actualizado');
    } catch {
      toast.error('Error al actualizar el estado');
    }
    setActualizando(null);
  }

  async function cambiarEstadoLote(nuevoEstado: string) {
    if (seleccionados.size === 0) return;
    setActualizando('lote');
    const ahora = new Date().toISOString();
    try {
      // All writes fire in parallel
      await Promise.all(
        Array.from(seleccionados).map(id =>
          updateDoc(doc(db, 'incidencias', id), {
            estado: nuevoEstado,
            updated_at: ahora,
            ...(nuevoEstado === 'resuelta' ? { resuelta_at: ahora } : {}),
          }),
        ),
      );

      // ── Optimistic local update — no re-fetch needed ──────────────────
      setIncidencias(prev =>
        prev.map(i =>
          seleccionados.has(i.id)
            ? { ...i, estado: nuevoEstado as Incidencia['estado'], updated_at: ahora }
            : i,
        ),
      );

      // ── Learning metrics for batch — fire-and-forget ──────────────────
      if (nuevoEstado === 'resuelta' && user) {
        const idsToMark = Array.from(seleccionados);
        user.getIdToken().then(token => {
          idsToMark.forEach(incId => {
            fetch('/api/ai/metrics/incidencia', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ incidenciaId: incId, tipo: 'resuelta' }),
            }).catch(() => {});
          });
        }).catch(() => {});
      }

      toast.success(`${seleccionados.size} incidencias actualizadas`);
      setSeleccionados(new Set());
      setAccionLote(false);
    } catch {
      toast.error('Error al actualizar');
    }
    setActualizando(null);
  }

  async function eliminarLote() {
    if (seleccionados.size === 0 || !user) return;
    setEliminando(true);
    setConfirmandoEliminar(false);
    const ids = Array.from(seleccionados);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/incidencias/bulk-action', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ ids, accion: 'eliminar' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // ── Remove deleted items from local state immediately ─────────────
      setIncidencias(prev => prev.filter(i => !seleccionados.has(i.id)));

      toast.success(`${ids.length} incidencia${ids.length !== 1 ? 's' : ''} eliminada${ids.length !== 1 ? 's' : ''}`);
      setSeleccionados(new Set());
      setAccionLote(false);
    } catch {
      toast.error('Error al eliminar las incidencias');
    }
    setEliminando(false);
  }

  function toggleSeleccion(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleTodos() {
    if (seleccionados.size === filtradas.length) {
      setSeleccionados(new Set());
    } else {
      setSeleccionados(new Set(filtradas.map((i) => i.id)));
    }
  }

  // useMemo — avoids re-filtering on every render unrelated to these deps
  const filtradas = useMemo(() =>
    incidencias.filter(inc => {
      const matchBusqueda = inc.titulo.toLowerCase().includes(busqueda.toLowerCase());
      const matchEstado   = filtroEstado === 'todos' || inc.estado === filtroEstado;
      return matchBusqueda && matchEstado;
    }),
    [incidencias, busqueda, filtroEstado],
  );

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-finca-dark">Incidencias</h1>
          <p className="text-sm text-muted-foreground">
            {incidencias.length} incidencias cargadas{hasMore ? ' · hay más' : ''}
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button variant={vista === 'lista' ? 'default' : 'outline'} size="icon" className="w-9 h-9" onClick={() => setVista('lista')}>
            <List className="w-4 h-4" />
          </Button>
          <Button variant={vista === 'kanban' ? 'default' : 'outline'} size="icon" className="w-9 h-9" onClick={() => setVista('kanban')}>
            <LayoutGrid className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex gap-3 flex-col sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar por título..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="pl-9" />
        </div>
        {vista === 'lista' && (
          <Select value={filtroEstado} onValueChange={setFiltroEstado}>
            <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              {KANBAN_COLUMNS.map((e) => (
                <SelectItem key={e} value={e}>{estadoConfig[e]?.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Barra de acciones en lote */}
      {vista === 'lista' && (
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setAccionLote(!accionLote)}>
            <CheckSquare className="w-3.5 h-3.5 mr-1.5" />
            {accionLote ? 'Cancelar selección' : 'Selección múltiple'}
          </Button>
          {accionLote && seleccionados.size > 0 && (
            <>
              <span className="text-xs text-muted-foreground">{seleccionados.size} seleccionada{seleccionados.size !== 1 ? 's' : ''}</span>
              <Select onValueChange={(v) => cambiarEstadoLote(v)}>
                <SelectTrigger className="w-48 h-8 text-xs"><SelectValue placeholder="Cambiar estado a..." /></SelectTrigger>
                <SelectContent>
                  {KANBAN_COLUMNS.map((e) => (
                    <SelectItem key={e} value={e}>{estadoConfig[e]?.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* ── Eliminar selección ── */}
              {!confirmandoEliminar ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs text-red-600 border-red-200 hover:bg-red-50 hover:border-red-400 gap-1.5"
                  onClick={() => setConfirmandoEliminar(true)}
                  disabled={eliminando}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Eliminar
                </Button>
              ) : (
                <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
                  <span className="text-xs text-red-700 font-medium">¿Eliminar {seleccionados.size}?</span>
                  <Button
                    size="sm"
                    className="h-6 text-[11px] px-2 bg-red-600 hover:bg-red-700 text-white gap-1"
                    onClick={eliminarLote}
                    disabled={eliminando}
                  >
                    {eliminando
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Trash2 className="w-3 h-3" />
                    }
                    {eliminando ? 'Eliminando…' : 'Confirmar'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[11px] px-2 text-red-600"
                    onClick={() => setConfirmandoEliminar(false)}
                    disabled={eliminando}
                  >
                    No
                  </Button>
                </div>
              )}
            </>
          )}
          {accionLote && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={toggleTodos}>
              {seleccionados.size === filtradas.length ? 'Deseleccionar todo' : 'Seleccionar todo'}
            </Button>
          )}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : vista === 'kanban' ? (
        /* ── KANBAN VIEW ── */
        <div className="grid grid-cols-5 gap-3 min-h-[400px]">
          {KANBAN_COLUMNS.map((estado) => {
            const cfg = estadoConfig[estado];
            const items = filtradas.filter((i) => i.estado === estado);
            return (
              <div key={estado} className="space-y-2">
                <div className="flex items-center justify-between px-2">
                  <Badge className={cn('text-[10px] border', cfg.color)}>{cfg.label}</Badge>
                  <span className="text-[10px] text-muted-foreground font-medium">{items.length}</span>
                </div>
                <div className="space-y-2 min-h-[200px] bg-muted/30 rounded-lg p-2">
                  {items.map((inc) => (
                    <Card key={inc.id} className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow">
                      <CardContent className="p-3 space-y-1.5">
                        <p className="text-xs font-semibold text-finca-dark line-clamp-2">{inc.titulo}</p>
                        {(inc as any).creado_por_avatar === 'ia' ? (
                          <p className="text-[10px] text-violet-600 font-medium flex items-center gap-0.5">
                            <Bot className="w-2.5 h-2.5" />
                            Asistente IA
                          </p>
                        ) : (
                          <p className="text-[10px] text-muted-foreground">{(inc.autor as any)?.nombre_completo}</p>
                        )}
                        {inc.prioridad === 'urgente' && (
                          <span className="text-[9px] font-bold text-red-600 bg-red-50 px-1 py-0.5 rounded">URGENTE</span>
                        )}
                        {(inc as any).asignado_por === 'sistema_ia' && (
                          <span className="text-[9px] font-medium text-blue-600 bg-blue-50 px-1 py-0.5 rounded flex items-center gap-0.5">
                            <Cpu className="w-2.5 h-2.5" />
                            Auto
                          </span>
                        )}
                        <div className="flex gap-1 pt-1 flex-wrap">
                          {KANBAN_COLUMNS.filter((e) => e !== estado).map((e) => (
                            <button
                              key={e}
                              onClick={() => cambiarEstado(inc.id, e)}
                              disabled={actualizando === inc.id}
                              className="text-[9px] px-1.5 py-0.5 rounded bg-white border border-border text-muted-foreground hover:border-finca-coral hover:text-finca-coral transition-colors"
                            >
                              {estadoConfig[e]?.label}
                            </button>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : filtradas.length === 0 ? (
        <div className="py-16 text-center space-y-2">
          <AlertCircle className="w-12 h-12 text-muted-foreground/30 mx-auto" />
          <p className="font-medium text-finca-dark">Sin incidencias</p>
        </div>
      ) : (
        /* ── LIST VIEW ── */
        <div className="space-y-3">
          {filtradas.map((inc) => {
            const estado = estadoConfig[inc.estado] || estadoConfig.pendiente;
            return (
              <Card key={inc.id} className={cn('border-0 shadow-sm', seleccionados.has(inc.id) && 'ring-2 ring-finca-coral')}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    {accionLote && (
                      <input
                        type="checkbox"
                        checked={seleccionados.has(inc.id)}
                        onChange={() => toggleSeleccion(inc.id)}
                        className="mt-1 w-4 h-4 rounded border-border text-finca-coral focus:ring-finca-coral shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold text-sm text-finca-dark">{inc.titulo}</p>
                        {inc.prioridad === 'urgente' && (
                          <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">URGENTE</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        {(inc as any).creado_por_avatar === 'ia' ? (
                          <span className="inline-flex items-center gap-1 text-violet-600 font-medium">
                            <Bot className="w-3.5 h-3.5" />
                            Asistente IA
                          </span>
                        ) : (
                          <span>{(inc.autor as any)?.nombre_completo}</span>
                        )}
                        <span>· {format(new Date(inc.created_at), "d MMM yyyy", { locale: es })}</span>
                        {(inc as any).asignado_por === 'sistema_ia' && (
                          <span className="inline-flex items-center gap-1 text-blue-600 font-medium bg-blue-50 px-1.5 py-0.5 rounded-full">
                            <Cpu className="w-3 h-3" />
                            🤖 Asignado automáticamente
                          </span>
                        )}
                      </div>
                      {inc.estimacion_min != null && inc.estimacion_max != null && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Est. IA: <span className="font-medium text-finca-dark">{inc.estimacion_min}€ – {inc.estimacion_max}€</span>
                          {(inc as any).presupuesto_proveedor != null && (
                            <>
                              {' · '}Proveedor: <span className={cn(
                                'font-medium',
                                (inc as any).presupuesto_proveedor > inc.estimacion_max * 1.2 ? 'text-red-600' : 'text-green-600'
                              )}>{(inc as any).presupuesto_proveedor}€</span>
                            </>
                          )}
                        </p>
                      )}
                    </div>
                    <Badge className={cn('text-[10px] border shrink-0', estado.color)}>{estado.label}</Badge>
                  </div>

                  {!accionLote && (
                    <div className="mt-3 pt-3 border-t border-border/50">
                      <p className="text-xs text-muted-foreground mb-2">Cambiar estado:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {KANBAN_COLUMNS.map((e) => (
                          <button
                            key={e}
                            onClick={() => cambiarEstado(inc.id, e)}
                            disabled={inc.estado === e || actualizando === inc.id}
                            className={cn(
                              'px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all border',
                              inc.estado === e
                                ? estadoConfig[e].color + ' opacity-100'
                                : 'bg-white border-border text-muted-foreground hover:border-finca-salmon hover:text-finca-coral',
                              'disabled:cursor-default'
                            )}
                          >
                            {estadoConfig[e]?.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {/* ── Pagination ── */}
          {hasMore && (
            <div className="pt-2 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchIncidencias(lastDoc)}
                disabled={loadingMore}
                className="text-xs h-8 gap-1.5"
              >
                {loadingMore
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : null}
                {loadingMore ? 'Cargando…' : 'Cargar más'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
