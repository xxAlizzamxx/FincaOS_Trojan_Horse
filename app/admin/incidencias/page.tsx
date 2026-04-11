'use client';

import { useEffect, useState } from 'react';
import { Search, CircleAlert as AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/firebase/client';
import { collection, query, where, orderBy, getDocs, doc, getDoc, updateDoc } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { Incidencia } from '@/types/database';
import { notificarUsuario } from '@/lib/firebase/notifications';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const estadoConfig: Record<string, { label: string; color: string }> = {
  pendiente:    { label: 'Pendiente',    color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  en_revision:  { label: 'En revisión',  color: 'bg-blue-100 text-blue-700 border-blue-200' },
  presupuestada:{ label: 'Presupuestada', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  aprobada:     { label: 'Aprobada',     color: 'bg-teal-100 text-teal-700 border-teal-200' },
  en_ejecucion: { label: 'En ejecución', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  resuelta:     { label: 'Resuelta',     color: 'bg-green-100 text-green-700 border-green-200' },
  cerrada:      { label: 'Cerrada',      color: 'bg-gray-100 text-gray-500 border-gray-200' },
};

const estados = ['pendiente', 'en_revision', 'presupuestada', 'aprobada', 'en_ejecucion', 'resuelta', 'cerrada'];

export default function AdminIncidenciasPage() {
  const { perfil } = useAuth();
  const [incidencias, setIncidencias] = useState<Incidencia[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [loading, setLoading] = useState(true);
  const [actualizando, setActualizando] = useState<string | null>(null);

  useEffect(() => {
    if (perfil?.comunidad_id) fetchIncidencias();
  }, [perfil?.comunidad_id]);

  async function fetchIncidencias() {
    const incQuery = query(
      collection(db, 'incidencias'),
      where('comunidad_id', '==', perfil!.comunidad_id!),
      orderBy('created_at', 'desc')
    );
    const incSnap = await getDocs(incQuery);
    const incList: Incidencia[] = [];
    for (const d of incSnap.docs) {
      const data = { id: d.id, ...d.data() } as Incidencia;
      // Fetch autor
      if (data.autor_id) {
        const autorSnap = await getDoc(doc(db, 'perfiles', data.autor_id));
        if (autorSnap.exists()) {
          data.autor = { id: autorSnap.id, ...autorSnap.data() } as any;
        }
      }
      // Fetch categoria
      if (data.categoria_id) {
        const catSnap = await getDoc(doc(db, 'categorias_incidencia', String(data.categoria_id)));
        if (catSnap.exists()) {
          data.categoria = { id: catSnap.id, ...catSnap.data() } as any;
        }
      }
      incList.push(data);
    }
    setIncidencias(incList);
    setLoading(false);
  }

  async function cambiarEstado(id: string, nuevoEstado: string) {
    setActualizando(id);
    try {
      await updateDoc(doc(db, 'incidencias', id), {
        estado: nuevoEstado,
        updated_at: new Date().toISOString(),
        ...(nuevoEstado === 'resuelta' ? { resuelta_at: new Date().toISOString() } : {}),
      });
      // Notify incidencia author
      const inc = incidencias.find((i) => i.id === id);
      if (inc?.autor_id && perfil?.comunidad_id) {
        const label = estadoConfig[nuevoEstado]?.label || nuevoEstado;
        notificarUsuario(inc.autor_id, perfil.comunidad_id, 'estado', `Incidencia actualizada`, `"${inc.titulo}" ahora está: ${label}`, `/incidencias/${id}`);
      }
      toast.success('Estado actualizado');
      fetchIncidencias();
    } catch {
      toast.error('Error al actualizar el estado');
    }
    setActualizando(null);
  }

  const filtradas = incidencias.filter((inc) => {
    const matchBusqueda = inc.titulo.toLowerCase().includes(busqueda.toLowerCase());
    const matchEstado = filtroEstado === 'todos' || inc.estado === filtroEstado;
    return matchBusqueda && matchEstado;
  });

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-finca-dark">Incidencias</h1>
        <p className="text-sm text-muted-foreground">{incidencias.length} incidencias en total</p>
      </div>

      <div className="flex gap-3 flex-col sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por título..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filtroEstado} onValueChange={setFiltroEstado}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los estados</SelectItem>
            {estados.map((e) => (
              <SelectItem key={e} value={e}>{estadoConfig[e]?.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <div className="pt-3 border-t border-border/50 flex gap-1.5">
                  {[1, 2, 3, 4].map((j) => (
                    <Skeleton key={j} className="h-6 w-20 rounded-lg" />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtradas.length === 0 ? (
        <div className="py-16 text-center space-y-2">
          <AlertCircle className="w-12 h-12 text-muted-foreground/30 mx-auto" />
          <p className="font-medium text-finca-dark">Sin incidencias</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtradas.map((inc) => {
            const estado = estadoConfig[inc.estado] || estadoConfig.pendiente;
            return (
              <Card key={inc.id} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold text-sm text-finca-dark">{inc.titulo}</p>
                        {inc.prioridad === 'urgente' && (
                          <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">URGENTE</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        <span>{(inc.autor as any)?.nombre_completo}</span>
                        {(inc.autor as any)?.numero_piso && <span>· Piso {(inc.autor as any).numero_piso}</span>}
                        {(inc.categoria as any)?.nombre && <span>· {(inc.categoria as any).nombre}</span>}
                        <span>· {format(new Date(inc.created_at), "d MMM yyyy", { locale: es })}</span>
                      </div>
                      {inc.estimacion_min && inc.estimacion_max && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Est. IA: <span className="font-medium text-finca-dark">{inc.estimacion_min}€ – {inc.estimacion_max}€</span>
                        </p>
                      )}
                    </div>
                    <Badge className={cn('text-[10px] border shrink-0', estado.color)}>{estado.label}</Badge>
                  </div>

                  <div className="mt-3 pt-3 border-t border-border/50">
                    <p className="text-xs text-muted-foreground mb-2">Cambiar estado:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {estados.map((e) => (
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
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
