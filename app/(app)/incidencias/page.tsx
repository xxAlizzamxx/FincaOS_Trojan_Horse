'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, Filter, CircleAlert as AlertCircle } from 'lucide-react';
import { db } from '@/lib/firebase/client';
import { collection, query, where, orderBy, getDocs, getDoc, doc } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { Incidencia } from '@/types/database';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

const estadoConfig: Record<string, { label: string; color: string; dot: string }> = {
  pendiente:    { label: 'Pendiente',    color: 'bg-yellow-100 text-yellow-700 border-yellow-200', dot: 'bg-yellow-500' },
  en_revision:  { label: 'En revisión',  color: 'bg-blue-100 text-blue-700 border-blue-200',       dot: 'bg-blue-500' },
  presupuestada:{ label: 'Presupuestada', color: 'bg-orange-100 text-orange-700 border-orange-200', dot: 'bg-orange-500' },
  aprobada:     { label: 'Aprobada',     color: 'bg-teal-100 text-teal-700 border-teal-200',       dot: 'bg-teal-500' },
  en_ejecucion: { label: 'En ejecución', color: 'bg-blue-100 text-blue-700 border-blue-200',       dot: 'bg-blue-600' },
  resuelta:     { label: 'Resuelta',     color: 'bg-green-100 text-green-700 border-green-200',    dot: 'bg-green-500' },
  cerrada:      { label: 'Cerrada',      color: 'bg-gray-100 text-gray-500 border-gray-200',       dot: 'bg-gray-400' },
};

const prioridadConfig: Record<string, string> = {
  baja: 'text-green-600',
  normal: 'text-blue-600',
  alta: 'text-orange-600',
  urgente: 'text-red-600',
};

const filtros = ['Todas', 'Pendiente', 'En revisión', 'Resuelta'];
const filtroMap: Record<string, string[]> = {
  'Todas': [],
  'Pendiente': ['pendiente'],
  'En revisión': ['en_revision', 'presupuestada', 'aprobada', 'en_ejecucion'],
  'Resuelta': ['resuelta', 'cerrada'],
};

export default function IncidenciasPage() {
  const { perfil } = useAuth();
  const [incidencias, setIncidencias] = useState<Incidencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [filtroActivo, setFiltroActivo] = useState('Todas');

  useEffect(() => {
    if (perfil?.comunidad_id) fetchIncidencias();
  }, [perfil?.comunidad_id]);

  async function fetchIncidencias() {
    const q = query(
      collection(db, 'incidencias'),
      where('comunidad_id', '==', perfil!.comunidad_id!),
      orderBy('created_at', 'desc')
    );
    const snap = await getDocs(q);
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const enriched = await Promise.all(
      items.map(async (inc: any) => {
        let autor = null;
        if (inc.autor_id) {
          const autorSnap = await getDoc(doc(db, 'perfiles', inc.autor_id));
          if (autorSnap.exists()) {
            const data = autorSnap.data();
            autor = { nombre_completo: data.nombre_completo, numero_piso: data.numero_piso };
          }
        }

        let categoria = null;
        if (inc.categoria_id) {
          const catSnap = await getDoc(doc(db, 'categorias_incidencia', inc.categoria_id));
          if (catSnap.exists()) {
            const data = catSnap.data();
            categoria = { nombre: data.nombre, icono: data.icono };
          }
        }

        return { ...inc, autor, categoria } as Incidencia;
      })
    );

    setIncidencias(enriched);
    setLoading(false);
  }

  const incidenciasFiltradas = incidencias.filter((inc) => {
    const matchBusqueda = inc.titulo.toLowerCase().includes(busqueda.toLowerCase());
    const estadosFiltro = filtroMap[filtroActivo];
    const matchFiltro = estadosFiltro.length === 0 || estadosFiltro.includes(inc.estado);
    return matchBusqueda && matchFiltro;
  });

  return (
    <div className="px-4 py-5 space-y-4">
      <div className="space-y-0.5">
        <h1 className="text-2xl font-semibold text-finca-dark">Incidencias</h1>
        <p className="text-sm text-muted-foreground">Problemas reportados en tu comunidad</p>
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
        <div className="space-y-2">
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
        <div className="space-y-2">
          {incidenciasFiltradas.map((inc) => {
            const estado = estadoConfig[inc.estado] || estadoConfig.pendiente;
            return (
              <Link key={inc.id} href={`/incidencias/${inc.id}`}>
                <Card className="border-0 shadow-sm hover:shadow-md transition-all active:scale-[0.99] cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <div className={cn('w-2 h-2 rounded-full shrink-0', estado.dot)} />
                          <p className="font-medium text-sm text-finca-dark truncate">{inc.titulo}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {(inc.categoria as any)?.nombre && (
                            <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                              {(inc.categoria as any).nombre}
                            </span>
                          )}
                          <span className={cn('text-xs font-medium', prioridadConfig[inc.prioridad])}>
                            {inc.prioridad === 'urgente' ? '🚨 Urgente' : inc.prioridad === 'alta' ? '⚠️ Alta' : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[11px] text-muted-foreground">
                            {(inc.autor as any)?.nombre_completo?.split(' ')[0]} • {formatDistanceToNow(new Date(inc.created_at), { addSuffix: true, locale: es })}
                          </span>
                        </div>
                      </div>
                      <Badge className={cn('text-[10px] border shrink-0 self-start', estado.color)}>
                        {estado.label}
                      </Badge>
                    </div>
                    {inc.estimacion_min && inc.estimacion_max && (
                      <div className="mt-2 pt-2 border-t border-border/50">
                        <p className="text-xs text-muted-foreground">
                          Estimación IA: <span className="font-medium text-finca-dark">{inc.estimacion_min}€ – {inc.estimacion_max}€</span>
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
