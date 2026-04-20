'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Vote, CheckCircle2, Lock, ChevronRight, ArrowLeft, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  collection, query, where, orderBy, getDocs,
  doc, getDoc, runTransaction,
  QueryDocumentSnapshot, DocumentData,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { useSound } from '@/hooks/useSound';
import { FX } from '@/lib/sound/gsapEffects';
import { useEliminar } from '@/hooks/useEliminar';
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Votacion, OpcionVotacion } from '@/types/database';

export default function VotosPage() {
  const router = useRouter();
  const { perfil, loading: authLoading } = useAuthGuard();

  const { playWithEffect } = useSound();
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const [votaciones, setVotaciones] = useState<Votacion[]>([]);
  const [misVotos, setMisVotos] = useState<Record<string, string>>({}); // votacion_id → opcion_id
  const [loading, setLoading] = useState(true);
  const [votando, setVotando] = useState<string | null>(null); // votacion_id en curso

  const esPresidente = perfil?.rol === 'presidente' || perfil?.rol === 'admin';
  const { confirmar, dialogProps } = useEliminar();

  useEffect(() => {
    if (perfil?.comunidad_id) fetchData();
  }, [perfil?.comunidad_id]);

  async function fetchData() {
    setLoading(true);
    try {
      const q = query(
        collection(db, 'votaciones'),
        where('comunidad_id', '==', perfil!.comunidad_id),
        orderBy('created_at', 'desc')
      );
      const snap = await getDocs(q);
      const lista = snap.docs.map((d: QueryDocumentSnapshot<DocumentData>) => ({ id: d.id, ...d.data() } as Votacion));
      setVotaciones(lista);

      // Cargar los votos del usuario actual
      const votosMap: Record<string, string> = {};
      await Promise.all(
        lista.map(async (v) => {
          const votoSnap = await getDoc(
            doc(db, 'votaciones', v.id, 'votos', perfil!.id)
          );
          if (votoSnap.exists()) {
            votosMap[v.id] = votoSnap.data().opcion_id as string;
          }
        })
      );
      setMisVotos(votosMap);
    } catch {
      toast.error('Error al cargar las votaciones');
    } finally {
      setLoading(false);
    }
  }

  async function votar(votacionId: string, opcionId: string) {
    if (!perfil?.id) return;
    setVotando(votacionId);
    try {
      const votacionRef = doc(db, 'votaciones', votacionId);
      const votoRef = doc(db, 'votaciones', votacionId, 'votos', perfil.id);
      const coef = perfil.coeficiente ?? 1;

      await runTransaction(db, async (tx) => {
        const votoSnap = await tx.get(votoRef);
        if (votoSnap.exists()) throw new Error('Ya has votado en esta votación');

        const votacionSnap = await tx.get(votacionRef);
        if (!votacionSnap.exists()) throw new Error('Votación no encontrada');
        if (!votacionSnap.data().activa) throw new Error('Esta votación ya está cerrada');

        const opciones: OpcionVotacion[] = votacionSnap.data().opciones.map((o: OpcionVotacion) =>
          o.id === opcionId ? { ...o, votos: o.votos + 1, peso_total: (o.peso_total || 0) + coef } : o
        );
        tx.update(votacionRef, { opciones });
        tx.set(votoRef, { opcion_id: opcionId, coeficiente: coef, created_at: new Date().toISOString() });
      });

      // Actualizar estado local
      setMisVotos((prev) => ({ ...prev, [votacionId]: opcionId }));
      setVotaciones((prev) =>
        prev.map((v) =>
          v.id !== votacionId ? v : {
            ...v,
            opciones: v.opciones.map((o) =>
              o.id === opcionId
                ? { ...o, votos: o.votos + 1, peso_total: (o.peso_total || 0) + coef }
                : o
            ),
          }
        )
      );
      toast.success('¡Voto registrado!');
      playWithEffect('voto_emitido', FX.voto, btnRefs.current[opcionId]);
    } catch (err: any) {
      toast.error(err.message ?? 'Error al votar');
    } finally {
      setVotando(null);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="px-4 py-5 space-y-4">
        <Skeleton className="h-8 w-40" />
        {[1, 2].map((i) => (
          <Card key={i} className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="px-4 py-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost" size="icon"
            className="w-8 h-8 -ml-1"
            onClick={() => router.push('/comunidad')}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-finca-dark">Votaciones</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {votaciones.filter((v) => v.activa).length} activas
            </p>
          </div>
        </div>
        {esPresidente && (
          <Button
            size="sm"
            className="bg-finca-coral hover:bg-finca-coral/90 text-white"
            onClick={() => router.push('/votos/nuevo')}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Nueva
          </Button>
        )}
      </div>

      {/* Lista vacía */}
      {votaciones.length === 0 && (
        <div className="py-16 text-center space-y-3">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <Vote className="w-7 h-7 text-muted-foreground/50" />
          </div>
          <p className="font-medium text-finca-dark">Sin votaciones</p>
          <p className="text-sm text-muted-foreground">
            {esPresidente
              ? 'Crea la primera votación para tu comunidad'
              : 'Aquí aparecerán las votaciones de tu comunidad'}
          </p>
          {esPresidente && (
            <Button
              className="bg-finca-coral hover:bg-finca-coral/90 text-white"
              onClick={() => router.push('/votos/nuevo')}
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Crear votación
            </Button>
          )}
        </div>
      )}

      {/* Cards */}
      <div className="space-y-4">
        {votaciones.map((votacion) => {
          const yaVote = !!misVotos[votacion.id];
          const miOpcionId = misVotos[votacion.id];
          const totalVotos = votacion.opciones.reduce((s, o) => s + o.votos, 0);
          const totalPeso = votacion.opciones.reduce((s, o) => s + (o.peso_total || 0), 0);
          const usaCoef = (votacion as any).usar_coeficientes;
          const quorumReq = (votacion as any).quorum_requerido;
          const isVotando = votando === votacion.id;

          return (
            <Card
              key={votacion.id}
              className={cn('border-0 shadow-sm', !votacion.activa && 'opacity-75')}
            >
              <CardContent className="p-4 space-y-3">
                {/* Estado + fecha + eliminar */}
                <div className="flex items-center justify-between gap-2">
                  <Badge
                    className={cn(
                      'text-[10px] border-0',
                      votacion.activa
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    )}
                  >
                    {votacion.activa ? 'Activa' : 'Cerrada'}
                  </Badge>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-muted-foreground">
                      {formatDistanceToNow(new Date(votacion.created_at), { addSuffix: true, locale: es })}
                    </span>
                    {esPresidente && (
                      <button
                        onClick={() => confirmar({
                          tipo: 'votacion',
                          id: votacion.id,
                          nombre: votacion.titulo,
                          onExito: () => setVotaciones((prev) => prev.filter((v) => v.id !== votacion.id)),
                        })}
                        className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Eliminar votación"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Título */}
                <p className="font-semibold text-finca-dark leading-snug">{votacion.titulo}</p>
                {votacion.descripcion && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{votacion.descripcion}</p>
                )}

                {/* Opciones */}
                <div className="space-y-2 pt-1">
                  {votacion.opciones.map((opcion) => {
                    const pct = usaCoef
                      ? (totalPeso > 0 ? Math.round(((opcion.peso_total || 0) / totalPeso) * 100) : 0)
                      : (totalVotos > 0 ? Math.round((opcion.votos / totalVotos) * 100) : 0);
                    const esMiVoto = miOpcionId === opcion.id;
                    const puedeVotar = votacion.activa && !yaVote;

                    return (
                      <button
                        key={opcion.id}
                        ref={(el) => { btnRefs.current[opcion.id] = el; }}
                        disabled={!puedeVotar || isVotando}
                        onClick={() => puedeVotar && votar(votacion.id, opcion.id)}
                        className={cn(
                          'w-full text-left rounded-xl border p-3 transition-all',
                          puedeVotar && !isVotando
                            ? 'hover:border-finca-coral hover:bg-finca-peach/10 active:scale-[0.99] cursor-pointer'
                            : 'cursor-default',
                          esMiVoto
                            ? 'border-finca-coral bg-finca-peach/20'
                            : 'border-border bg-white'
                        )}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className={cn('text-sm font-medium', esMiVoto ? 'text-finca-coral' : 'text-finca-dark')}>
                            {opcion.texto}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {esMiVoto && <CheckCircle2 className="w-3.5 h-3.5 text-finca-coral" />}
                            <span className="text-xs text-muted-foreground">
                              {yaVote || !votacion.activa ? `${pct}%` : ''}
                            </span>
                          </div>
                        </div>
                        {(yaVote || !votacion.activa) && (
                          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-finca-coral rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                        {(yaVote || !votacion.activa) && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {opcion.votos} {opcion.votos === 1 ? 'voto' : 'votos'}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-1 flex-wrap gap-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{totalVotos} {totalVotos === 1 ? 'voto' : 'votos'}</span>
                    {usaCoef && <span className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded text-[10px] font-medium">LPH</span>}
                    {quorumReq != null && (
                      <span className={cn(
                        'px-1.5 py-0.5 rounded text-[10px] font-medium',
                        totalPeso >= quorumReq ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'
                      )}>
                        Quórum: {Math.round(totalPeso)}% / {quorumReq}%
                      </span>
                    )}
                  </div>
                  {yaVote && (
                    <div className="flex items-center gap-1 text-xs text-green-600">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Ya has votado
                    </div>
                  )}
                  {!votacion.activa && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="w-3 h-3" />
                      Cerrada
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <ConfirmDeleteDialog {...dialogProps} />
    </div>
  );
}
