'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CircleAlert as AlertCircle, CircleCheck as CheckCircle2, TrendingUp, ChevronRight, Plus, Share2, Scale, ShieldAlert, Wrench, Droplets, Flame, Volume2, Car, Info, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  collection, query, where, orderBy, limit, getDocs, doc, getDoc, onSnapshot,
  QuerySnapshot, DocumentData, QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Incidencia, Anuncio } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { AnuncioReacciones } from '@/components/ui/AnuncioReacciones';
import { useEliminar } from '@/hooks/useEliminar';
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog';
import { formatDistanceToNow, format } from 'date-fns';
import { es } from 'date-fns/locale';

interface AlertaComunidad {
  id: string;
  titulo: string;
  descripcion: string;
  tipo: string;
  prioridad: string;
  activa: boolean;
  created_at: string;
}

const ALERTA_ICONS: Record<string, React.ElementType> = {
  emergencia:    ShieldAlert,
  mantenimiento: Wrench,
  agua:          Droplets,
  gas:           Flame,
  ruido:         Volume2,
  vehiculo:      Car,
  informativa:   Info,
};

const ALERTA_COLORS: Record<string, string> = {
  emergencia:    'bg-red-50 text-red-600',
  mantenimiento: 'bg-orange-50 text-orange-600',
  agua:          'bg-blue-50 text-blue-600',
  gas:           'bg-amber-50 text-amber-600',
  ruido:         'bg-purple-50 text-purple-600',
  vehiculo:      'bg-cyan-50 text-cyan-600',
  informativa:   'bg-green-50 text-green-600',
};

const estadoConfig: Record<string, { label: string; color: string }> = {
  pendiente:    { label: 'Pendiente',    color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  en_revision:  { label: 'En revisión',  color: 'bg-blue-100 text-blue-700 border-blue-200' },
  presupuestada:{ label: 'Presupuestada', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  aprobada:     { label: 'Aprobada',     color: 'bg-teal-100 text-teal-700 border-teal-200' },
  en_ejecucion: { label: 'En ejecución', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  resuelta:     { label: 'Resuelta',     color: 'bg-green-100 text-green-700 border-green-200' },
  cerrada:      { label: 'Cerrada',      color: 'bg-gray-100 text-gray-500 border-gray-200' },
};

export default function InicioPage() {
  const { perfil, user, loading: authLoading } = useAuth();
  const [incidencias, setIncidencias] = useState<Incidencia[]>([]);
  const [anuncios, setAnuncios] = useState<Anuncio[]>([]);
  const [alertas, setAlertas] = useState<AlertaComunidad[]>([]);
  const [stats, setStats] = useState({ abiertas: 0, resueltas: 0, vecinos: 0 });
  const [mediacionesCount, setMediacionesCount] = useState<{ disponibles: number; total: number } | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  const esAdmin = perfil?.rol === 'admin' || perfil?.rol === 'presidente';
  const verMediaciones = perfil?.rol === 'mediador' || perfil?.rol === 'admin' || perfil?.rol === 'presidente';
  const esMediador = perfil?.rol === 'mediador';
  const { confirmar, dialogProps } = useEliminar();

  const nombreCorto = perfil?.nombre_completo?.split(' ')[0] || 'Vecino';
  const comunidadId = perfil?.comunidad_id;
  const loading = authLoading || dataLoading;

  useEffect(() => {
    if (authLoading) return;
    if (!comunidadId) {
      setDataLoading(false);
      return;
    }
    fetchData();
  }, [comunidadId, authLoading]);

  // Real-time listener for incidencias
  useEffect(() => {
    if (!comunidadId) return;

    const q = query(
      collection(db, 'incidencias'),
      where('comunidad_id', '==', comunidadId),
      orderBy('created_at', 'desc'),
      limit(5),
    );

    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => {
        const data = d.data();
        if (data.created_at?.toDate) data.created_at = data.created_at.toDate().toISOString();
        if (data.updated_at?.toDate) data.updated_at = data.updated_at.toDate().toISOString();
        return { id: d.id, ...data } as Incidencia;
      });

      // Enrich with categoria names (fire-and-forget)
      Promise.all(
        items.map(async (inc) => {
          if (inc.categoria_id && !inc.categoria) {
            try {
              const catSnap = await getDoc(doc(db, 'categorias_incidencia', String(inc.categoria_id)));
              if (catSnap.exists()) inc.categoria = { id: catSnap.id, ...catSnap.data() } as Incidencia['categoria'];
            } catch {}
          }
        }),
      ).then(() => setIncidencias([...items]));
    });

    return () => unsub();
  }, [comunidadId]);

  // Real-time listener for alertas activas
  useEffect(() => {
    if (!comunidadId) return;
    const q = query(
      collection(db, 'alertas_comunidad'),
      where('comunidad_id', '==', comunidadId),
      where('activa', '==', true),
    );
    return onSnapshot(q, (snap) => {
      setAlertas(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() } as AlertaComunidad))
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
      );
    }, () => {});
  }, [comunidadId]);

  async function fetchData() {
    try {
      const rol = perfil?.rol;
      const canSeeMediaciones = rol === 'mediador' || rol === 'admin' || rol === 'presidente';

      console.log('[Inicio] fetchData — comunidadId:', comunidadId, 'rol:', rol);

      const [anuncSnap, allIncSnap, vecinosSnap] = await Promise.all([
        getDocs(query(collection(db, 'anuncios'),   where('comunidad_id', '==', comunidadId), orderBy('publicado_at', 'desc'), limit(20))) as Promise<QuerySnapshot<DocumentData>>,
        getDocs(query(collection(db, 'incidencias'), where('comunidad_id', '==', comunidadId))) as Promise<QuerySnapshot<DocumentData>>,
        getDocs(query(collection(db, 'perfiles'),   where('comunidad_id', '==', comunidadId))) as Promise<QuerySnapshot<DocumentData>>,
      ]);

      console.log('[Inicio] anuncios:', anuncSnap.size, '| allIncs:', allIncSnap.size);

      const anunciosRaw = anuncSnap.docs.map(
        (d: QueryDocumentSnapshot<DocumentData>) => ({ id: d.id, ...d.data() }),
      );
      // Resolve autor names
      const autorIds = Array.from(new Set(anunciosRaw.map((a: any) => a.autor_id).filter(Boolean))) as string[];
      const autorMap: Record<string, string> = {};
      await Promise.all(autorIds.map(async (autorId) => {
        try {
          const autorSnap = await getDoc(doc(db, 'perfiles', autorId));
          if (autorSnap.exists()) autorMap[autorId] = (autorSnap.data() as any).nombre_completo;
        } catch {}
      }));
      const anuncsTodos: Anuncio[] = anunciosRaw.map((a: any) => ({
        ...a,
        autor: a.autor_id ? { nombre_completo: autorMap[a.autor_id] || '' } : null,
      })) as Anuncio[];
      // Pinned first, then recientes; show up to 5
      const anuncs = [
        ...anuncsTodos.filter(a => a.fijado),
        ...anuncsTodos.filter(a => !a.fijado),
      ].slice(0, 5);
      const allIncs: DocumentData[] = allIncSnap.docs.map(
        (d: QueryDocumentSnapshot<DocumentData>) => d.data(),
      );

      setAnuncios(anuncs);

      const abiertas = allIncs.filter(
        (i: DocumentData) => !['resuelta', 'cerrada'].includes(i['estado'] as string),
      ).length;
      const resueltas = allIncs.filter(
        (i: DocumentData) => i['estado'] === 'resuelta',
      ).length;
      setStats({ abiertas, resueltas, vecinos: vecinosSnap.size });

      // Mediaciones (solo para mediador / admin / presidente)
      if (canSeeMediaciones) {
        try {
          const [dispSnap, totalSnap] = await Promise.all([
            getDocs(query(collection(db, 'mediaciones'), where('comunidad_id', '==', comunidadId), where('estado', '==', 'solicitada'))) as Promise<QuerySnapshot<DocumentData>>,
            getDocs(query(collection(db, 'mediaciones'), where('comunidad_id', '==', comunidadId))) as Promise<QuerySnapshot<DocumentData>>,
          ]);
          setMediacionesCount({ disponibles: dispSnap.size, total: totalSnap.size });
        } catch (e) {
          console.error('[Inicio] Error cargando mediaciones:', e);
        }
      }
    } catch (err) {
      console.error('[Inicio] Error en fetchData:', err);
    } finally {
      setDataLoading(false);
    }
  }

  async function compartirLink() {
    if (!comunidadId) return;
    const comunidadSnap = await getDoc(doc(db, 'comunidades', comunidadId));
    if (!comunidadSnap.exists()) return;
    const codigo = comunidadSnap.data().codigo;
    const url = `${process.env.NEXT_PUBLIC_APP_URL || window.location.origin}/invite/${codigo}`;

    if (navigator.share) {
      navigator.share({ title: 'Únete a mi comunidad en FincaOS', text: `Únete a nuestra comunidad con este enlace:`, url });
    } else {
      navigator.clipboard.writeText(url);
      toast.success('Link de invitación copiado');
    }
  }

  if (loading) {
    return (
      <div className="px-4 py-5 space-y-6">
        <div className="space-y-1">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-3 text-center space-y-2">
                <Skeleton className="w-8 h-8 rounded-lg mx-auto" />
                <Skeleton className="h-6 w-8 mx-auto" />
                <Skeleton className="h-3 w-14 mx-auto" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Skeleton className="h-12 w-full rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-3 flex items-center justify-between">
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!comunidadId) {
    return (
      <div className="px-4 py-8 space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold text-finca-dark">Hola, {nombreCorto}</h1>
          <p className="text-muted-foreground">Aún no perteneces a ninguna comunidad</p>
        </div>
        <Card className="border-dashed border-2 border-finca-peach">
          <CardContent className="pt-6 pb-6 text-center space-y-4">
            <div className="w-16 h-16 bg-finca-peach/50 rounded-full flex items-center justify-center mx-auto">
              <Plus className="w-8 h-8 text-finca-coral" />
            </div>
            <p className="text-sm text-muted-foreground">Únete a tu comunidad con un código de acceso o crea una nueva</p>
            <Link href="/registro">
              <Button className="bg-finca-coral hover:bg-finca-coral/90 text-white">Unirme a una comunidad</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-4 py-5 space-y-6">
      <div className="space-y-0.5">
        <h1 className="text-2xl font-semibold text-finca-dark">Hola, {nombreCorto} 👋</h1>
        <p className="text-sm text-muted-foreground">{new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </div>

      <div className="grid grid-cols-3 gap-3 lg:gap-4">
        {[
          { icon: AlertCircle, value: stats.abiertas, label: 'Abiertas', color: 'text-yellow-600', bg: 'bg-yellow-50' },
          { icon: CheckCircle2, value: stats.resueltas, label: 'Resueltas', color: 'text-green-600', bg: 'bg-green-50' },
          { icon: TrendingUp, value: stats.vecinos, label: 'Vecinos', color: 'text-finca-coral', bg: 'bg-finca-peach/30' },
        ].map((stat) => (
          <Card key={stat.label} className="border-0 shadow-sm">
            <CardContent className="p-3 lg:p-5 text-center">
              <div className={cn('w-8 h-8 lg:w-10 lg:h-10 rounded-lg flex items-center justify-center mx-auto mb-1.5', stat.bg)}>
                <stat.icon className={cn('w-4 h-4 lg:w-5 lg:h-5', stat.color)} />
              </div>
              <p className="text-xl lg:text-2xl font-bold text-finca-dark">{stat.value}</p>
              <p className="text-xs lg:text-sm text-muted-foreground">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <Button className="w-full rounded-2xl bg-finca-coral hover:bg-finca-salmon text-white h-13 text-base font-semibold shadow-lg shadow-finca-coral/30 transition-all active:scale-[0.98]" asChild>
          <Link href="/nueva/incidencia">
            <Plus className="w-5 h-5 mr-2" />
            Reportar incidencia
          </Link>
        </Button>
      </div>

      {(alertas.length > 0 || anuncios.length > 0) && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-finca-dark">Tablón</h2>
            <Link href="/comunidad" className="text-xs text-finca-coral flex items-center gap-0.5">
              Ver todo <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {/* Alertas activas */}
            {alertas.map(a => {
              const colorClass = ALERTA_COLORS[a.tipo] ?? ALERTA_COLORS.informativa;
              const [bg, text] = colorClass.split(' ');
              const IconComp = ALERTA_ICONS[a.tipo] ?? Info;
              return (
                <Card key={a.id} className={cn(
                  'border-0 shadow-sm',
                  a.prioridad === 'urgente' && 'border-l-4 border-l-red-500 bg-red-50/40',
                  a.prioridad === 'alta'    && 'border-l-4 border-l-orange-500 bg-orange-50/30',
                  a.prioridad === 'media'   && 'border-l-4 border-l-yellow-400',
                )}>
                  <CardContent className="p-3 flex items-start gap-3">
                    <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', bg)}>
                      <IconComp className={cn('w-4 h-4', text)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-red-600 uppercase tracking-wide">⚠ Alerta activa</p>
                      <p className="text-sm font-semibold text-finca-dark">{a.titulo}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{a.descripcion}</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {/* Anuncios */}
            {anuncios.map((anuncio) => (
              <Card key={anuncio.id} className={cn('border-0 shadow-sm', anuncio.fijado && 'border-l-4 border-l-finca-coral')}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      {anuncio.fijado && <span className="text-[10px] font-semibold text-finca-coral uppercase tracking-wide block mb-0.5">Fijado</span>}
                      <p className="font-semibold text-sm text-finca-dark">{anuncio.titulo}</p>
                    </div>
                    {esAdmin && (
                      <button
                        onClick={() => confirmar({
                          tipo: 'anuncio',
                          id: anuncio.id,
                          nombre: anuncio.titulo,
                          onExito: () => setAnuncios((prev) => prev.filter((a) => a.id !== anuncio.id)),
                        })}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                        title="Eliminar anuncio"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{anuncio.contenido}</p>
                  <AnuncioReacciones anuncioId={anuncio.id} />
                  <div className="flex items-center justify-between pt-1">
                    <p className="text-[11px] text-muted-foreground">{(anuncio.autor as any)?.nombre_completo?.split(' ')[0]}</p>
                    <p className="text-[11px] text-muted-foreground">{format(new Date(anuncio.publicado_at), "d MMM", { locale: es })}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* ── Acceso rápido Mediaciones (mediador / admin / presidente) ── */}
      {verMediaciones && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-finca-dark">Mediaciones</h2>
            <Link href="/mediaciones" className="text-xs text-finca-coral flex items-center gap-0.5">
              Ver todo <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          <Link href="/mediaciones" className="block">
            <Card className="border-0 shadow-sm bg-gradient-to-r from-violet-50 to-purple-50 hover:shadow-md transition-shadow active:scale-[0.99]">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-11 h-11 rounded-2xl bg-violet-100 flex items-center justify-center shrink-0">
                  <Scale className="w-5 h-5 text-violet-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-finca-dark">
                    {esMediador ? 'Solicitudes disponibles' : 'Conflictos en la comunidad'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {esMediador
                      ? mediacionesCount?.disponibles
                        ? `${mediacionesCount.disponibles} solicitud${mediacionesCount.disponibles > 1 ? 'es' : ''} sin asignar`
                        : 'Sin solicitudes nuevas'
                      : mediacionesCount?.total
                      ? `${mediacionesCount.total} mediación${mediacionesCount.total > 1 ? 'es' : ''} registradas`
                      : 'Sin mediaciones registradas'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {esMediador && mediacionesCount?.disponibles ? (
                    <span className="w-5 h-5 rounded-full bg-violet-600 text-white text-[10px] font-bold flex items-center justify-center">
                      {mediacionesCount.disponibles}
                    </span>
                  ) : null}
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </Link>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-finca-dark">Incidencias recientes</h2>
          <Link href="/incidencias" className="text-xs text-finca-coral flex items-center gap-0.5">
            Ver todo <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
        {incidencias.length === 0 ? (
          <Card className="border-dashed border-2 border-border">
            <CardContent className="py-8 text-center space-y-2">
              <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto" />
              <p className="font-medium text-finca-dark">¡Tu comunidad está en orden!</p>
              <p className="text-sm text-muted-foreground">No hay incidencias abiertas. Si algo se rompe, repórtalo aquí.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col lg:grid lg:grid-cols-2 gap-3">
            {incidencias.map((inc) => {
              const estado = estadoConfig[inc.estado] || estadoConfig.pendiente;
              return (
                <Link key={inc.id} href={`/incidencias/${inc.id}`}>
                  <Card className="border-0 shadow-sm hover:shadow-md transition-shadow active:scale-[0.99]">
                    <CardContent className="p-3 flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-finca-dark truncate">{inc.titulo}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {inc.categoria?.nombre} • {formatDistanceToNow(new Date(inc.created_at), { addSuffix: true, locale: es })}
                        </p>
                      </div>
                      <Badge className={cn('text-[10px] border shrink-0', estado.color)}>{estado.label}</Badge>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <Card className="bg-finca-peach/20 border-finca-peach/50">
        <CardContent className="p-4 flex items-center justify-between gap-3">
          <div>
            <p className="font-medium text-sm text-finca-dark">Invita a tus vecinos</p>
            <p className="text-xs text-muted-foreground">Comparte el link de invitación</p>
          </div>
          <Button size="sm" variant="outline" className="border-finca-coral text-finca-coral hover:bg-finca-coral hover:text-white" onClick={compartirLink}>
            <Share2 className="w-3.5 h-3.5 mr-1.5" />
            Invitar
          </Button>
        </CardContent>
      </Card>

      <ConfirmDeleteDialog {...dialogProps} />
    </div>
  );
}
