'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Trash2, ShieldAlert, Wrench, Droplets, Flame, Volume2, Car, Info } from 'lucide-react';
import {
  collection, query, where, orderBy, getDocs, onSnapshot,
  getDoc, doc as firestoreDoc,
  QueryDocumentSnapshot, DocumentData,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { useEliminar } from '@/hooks/useEliminar';
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog';
import { Anuncio } from '@/types/database';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AnuncioReacciones } from '@/components/ui/AnuncioReacciones';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
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

export default function AnunciosPage() {
  const { perfil } = useAuth();
  const router = useRouter();
  const [anuncios, setAnuncios] = useState<Anuncio[]>([]);
  const [alertas, setAlertas] = useState<AlertaComunidad[]>([]);
  const [loading, setLoading] = useState(true);

  const esAdmin = perfil?.rol === 'admin' || perfil?.rol === 'presidente';
  const { confirmar, dialogProps } = useEliminar();
  const comunidadId = perfil?.comunidad_id;

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

  useEffect(() => {
    if (comunidadId) fetchAnuncios();
  }, [comunidadId]);

  async function fetchAnuncios() {
    try {
      const anuncSnap = await getDocs(
        query(
          collection(db, 'anuncios'),
          where('comunidad_id', '==', comunidadId),
          orderBy('fijado', 'desc'),
          orderBy('publicado_at', 'desc'),
        ),
      );
      const anunciosRaw = anuncSnap.docs.map(
        (d: QueryDocumentSnapshot<DocumentData>) => ({ id: d.id, ...d.data() }),
      );
      const autorIds = Array.from(
        new Set(anunciosRaw.map((a: any) => a.autor_id).filter(Boolean)),
      ) as string[];
      const autorMap: Record<string, string> = {};
      await Promise.all(
        autorIds.map(async (autorId) => {
          try {
            const autorSnap = await getDoc(firestoreDoc(db, 'perfiles', autorId));
            if (autorSnap.exists()) autorMap[autorId] = (autorSnap.data() as any).nombre_completo;
          } catch {}
        }),
      );
      setAnuncios(
        anunciosRaw.map((a: any) => ({
          ...a,
          autor: a.autor_id ? { nombre_completo: autorMap[a.autor_id] || '' } : null,
        })) as Anuncio[],
      );
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="px-4 py-5 space-y-4">
        <Skeleton className="h-8 w-36" />
        {[1, 2, 3].map((i) => (
          <Card key={i} className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/2" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="px-4 py-5 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="w-8 h-8 -ml-1" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold text-finca-dark">Tablón</h1>
          <p className="text-xs text-muted-foreground">
            {alertas.length > 0 && `${alertas.length} alerta${alertas.length > 1 ? 's' : ''} activa${alertas.length > 1 ? 's' : ''} · `}
            {anuncios.length} anuncio{anuncios.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Alertas activas */}
      {alertas.map((a) => {
        const colorClass = ALERTA_COLORS[a.tipo] ?? ALERTA_COLORS.informativa;
        const [bg, text] = colorClass.split(' ');
        const IconComp = ALERTA_ICONS[a.tipo] ?? Info;
        return (
          <Card
            key={a.id}
            className={cn(
              'border-0 shadow-sm',
              a.prioridad === 'urgente' && 'border-l-4 border-l-red-500 bg-red-50/40',
              a.prioridad === 'alta' && 'border-l-4 border-l-orange-500 bg-orange-50/30',
              a.prioridad === 'media' && 'border-l-4 border-l-yellow-400',
            )}
          >
            <CardContent className="p-3 flex items-start gap-3">
              <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', bg)}>
                <IconComp className={cn('w-4 h-4', text)} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-red-600 uppercase tracking-wide">Alerta activa</p>
                <p className="text-sm font-semibold text-finca-dark">{a.titulo}</p>
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{a.descripcion}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {format(new Date(a.created_at), 'dd MMM · HH:mm', { locale: es })}
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* Anuncios */}
      {anuncios.length === 0 && alertas.length === 0 && (
        <div className="py-16 text-center space-y-3">
          <p className="font-medium text-finca-dark">Sin anuncios</p>
          <p className="text-sm text-muted-foreground">Aquí aparecerán los anuncios de tu comunidad</p>
        </div>
      )}

      {anuncios.map((anuncio) => (
        <Card key={anuncio.id} className={cn('border-0 shadow-sm', anuncio.fijado && 'border-l-4 border-l-finca-coral')}>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                {anuncio.fijado && (
                  <span className="text-[10px] font-semibold text-finca-coral uppercase tracking-wide block mb-0.5">
                    Fijado
                  </span>
                )}
                <p className="font-semibold text-sm text-finca-dark">{anuncio.titulo}</p>
              </div>
              {esAdmin && (
                <button
                  onClick={() =>
                    confirmar({
                      tipo: 'anuncio',
                      id: anuncio.id,
                      nombre: anuncio.titulo,
                      onExito: () => setAnuncios((prev) => prev.filter((a) => a.id !== anuncio.id)),
                    })
                  }
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
              <p className="text-[11px] text-muted-foreground">
                {(anuncio.autor as any)?.nombre_completo?.split(' ')[0]}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {format(new Date(anuncio.publicado_at), 'd MMM yyyy', { locale: es })}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}

      <ConfirmDeleteDialog {...dialogProps} />
    </div>
  );
}
