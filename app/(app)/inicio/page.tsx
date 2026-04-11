'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CircleAlert as AlertCircle, CircleCheck as CheckCircle2, Clock, TrendingUp, ChevronRight, Plus, Share2, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Incidencia, Anuncio } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

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
  const [stats, setStats] = useState({ abiertas: 0, resueltas: 0, vecinos: 0 });
  const [dataLoading, setDataLoading] = useState(true);

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

  async function fetchData() {
    const [incSnap, anuncSnap, allIncSnap] = await Promise.all([
      getDocs(query(collection(db, 'incidencias'), where('comunidad_id', '==', comunidadId), orderBy('created_at', 'desc'), limit(5))),
      getDocs(query(collection(db, 'anuncios'), where('comunidad_id', '==', comunidadId), orderBy('publicado_at', 'desc'), limit(3))),
      getDocs(query(collection(db, 'incidencias'), where('comunidad_id', '==', comunidadId))),
    ]);

    const incs = incSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Incidencia));
    const anuncs = anuncSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Anuncio));
    const allIncs = allIncSnap.docs.map((d) => d.data());

    // Fetch autor names for incidencias
    for (const inc of incs) {
      if (inc.autor_id) {
        const autorSnap = await getDoc(doc(db, 'perfiles', inc.autor_id));
        if (autorSnap.exists()) inc.autor = { id: autorSnap.id, ...autorSnap.data() } as any;
      }
      if (inc.categoria_id) {
        const catSnap = await getDoc(doc(db, 'categorias_incidencia', String(inc.categoria_id)));
        if (catSnap.exists()) inc.categoria = { id: catSnap.id, ...catSnap.data() } as any;
      }
    }

    setIncidencias(incs);
    setAnuncios(anuncs);

    const abiertas = allIncs.filter((i: any) => !['resuelta', 'cerrada'].includes(i.estado)).length;
    const resueltas = allIncs.filter((i: any) => i.estado === 'resuelta').length;
    setStats({ abiertas, resueltas, vecinos: 0 });
    setDataLoading(false);
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

      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: AlertCircle, value: stats.abiertas, label: 'Abiertas', color: 'text-yellow-600', bg: 'bg-yellow-50' },
          { icon: CheckCircle2, value: stats.resueltas, label: 'Resueltas', color: 'text-green-600', bg: 'bg-green-50' },
          { icon: TrendingUp, value: stats.abiertas + stats.resueltas, label: 'Totales', color: 'text-finca-coral', bg: 'bg-finca-peach/30' },
        ].map((stat) => (
          <Card key={stat.label} className="border-0 shadow-sm">
            <CardContent className="p-3 text-center">
              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center mx-auto mb-1.5', stat.bg)}>
                <stat.icon className={cn('w-4 h-4', stat.color)} />
              </div>
              <p className="text-xl font-bold text-finca-dark">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <Button className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-12 text-base font-medium shadow-md shadow-finca-coral/20" asChild>
          <Link href="/nueva">
            <Plus className="w-5 h-5 mr-2" />
            Reportar incidencia
          </Link>
        </Button>
      </div>

      {anuncios.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-finca-dark">Tablón</h2>
            <Link href="/comunidad" className="text-xs text-finca-coral flex items-center gap-0.5">
              Ver todo <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {anuncios.map((anuncio) => (
              <Card key={anuncio.id} className={cn('border-0 shadow-sm', anuncio.fijado && 'border-l-4 border-l-finca-coral')}>
                <CardContent className="p-3">
                  {anuncio.fijado && (
                    <span className="text-[10px] font-medium text-finca-coral uppercase tracking-wide">Fijado</span>
                  )}
                  <p className="font-medium text-sm text-finca-dark">{anuncio.titulo}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{anuncio.contenido}</p>
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    {formatDistanceToNow(new Date(anuncio.publicado_at), { addSuffix: true, locale: es })}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
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
          <div className="space-y-2">
            {incidencias.map((inc) => {
              const estado = estadoConfig[inc.estado] || estadoConfig.pendiente;
              return (
                <Link key={inc.id} href={`/incidencias/${inc.id}`}>
                  <Card className="border-0 shadow-sm hover:shadow-md transition-shadow active:scale-[0.99]">
                    <CardContent className="p-3 flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-finca-dark truncate">{inc.titulo}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {(inc.categoria as any)?.nombre} • {formatDistanceToNow(new Date(inc.created_at), { addSuffix: true, locale: es })}
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
    </div>
  );
}
