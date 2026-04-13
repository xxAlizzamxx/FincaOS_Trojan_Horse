'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, ArrowRight, MessageSquare, Send,
  UserPlus, UserMinus, Users, Star,
  CircleCheck as CheckCircle2, Loader2, History,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  collection, query, where, orderBy, getDocs,
  getDoc, addDoc, deleteDoc, updateDoc, doc,
  QueryDocumentSnapshot, DocumentData,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Incidencia, Comentario } from '@/types/database';
import { notificarUsuario } from '@/lib/firebase/notifications';
import {
  ESTADO_CONFIG, ACCION_ESTADO, SIGUIENTE_ESTADO, WORKFLOW_STEPS,
  actualizarEstadoIncidencia, puedeGestionar,
} from '@/lib/incidencias/workflow';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

export default function IncidenciaDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { perfil } = useAuth();

  const [incidencia, setIncidencia]     = useState<Incidencia | null>(null);
  const [comentarios, setComentarios]   = useState<Comentario[]>([]);
  const [nuevoComentario, setNuevo]     = useState('');
  const [enviando, setEnviando]         = useState(false);
  const [loading, setLoading]           = useState(true);
  const [afectados, setAfectados]       = useState<{ id: string; vecino_id: string }[]>([]);
  const [sumandome, setSumandome]       = useState(false);

  /* Valoración (autor cuando estado = en_ejecucion) */
  const [valoracion, setValoracion]         = useState(0);
  const [resolviendo, setResolviendo]       = useState(false);
  const [mostrarResolver, setMostrarResolver] = useState(false);

  /* Workflow (admin / presidente) */
  const [avanzando, setAvanzando] = useState(false);

  /* Historial expandido */
  const [historialAbierto, setHistorialAbierto] = useState(false);

  const incidenciaId = params.id as string;

  /* ── Vivienda del autor (torre · piso · puerta, con fallback a numero_piso) ── */
  function lineaVivienda(autor: any): string {
    const parts = [
      autor?.torre  && `Torre ${autor.torre}`,
      autor?.piso   && `${autor.piso}º`,
      autor?.puerta,
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(' · ');
    return autor?.numero_piso ?? '';
  }

  /* ── Emoji de prioridad ── */
  const prioridadEmoji: Record<string, string> = {
    baja: '🟢', normal: '🔵', alta: '⚠️', urgente: '🚨',
  };

  useEffect(() => { fetchIncidencia(); fetchAfectados(); }, [incidenciaId]);

  async function fetchIncidencia() {
    const incSnap = await getDoc(doc(db, 'incidencias', incidenciaId));
    if (incSnap.exists()) {
      const incData: any = { id: incSnap.id, ...incSnap.data() };

      if (incData.autor_id) {
        const autorSnap = await getDoc(doc(db, 'perfiles', incData.autor_id));
        if (autorSnap.exists()) {
          const a = autorSnap.data();
          incData.autor = {
            id: autorSnap.id,
            nombre_completo: a.nombre_completo,
            torre: a.torre ?? null,
            piso:  a.piso  ?? null,
            puerta: a.puerta ?? null,
            numero_piso: a.numero_piso ?? null,  // fallback legacy
          };
        }
      }

      if (incData.categoria_id) {
        const catSnap = await getDoc(doc(db, 'categorias_incidencia', incData.categoria_id));
        if (catSnap.exists()) {
          const c = catSnap.data();
          incData.categoria = { nombre: c.nombre, icono: c.icono };
        }
      }

      setIncidencia(incData as Incidencia);
    }

    const comQ = query(
      collection(db, 'comentarios'),
      where('incidencia_id', '==', incidenciaId),
      orderBy('created_at', 'asc'),
    );
    const comSnap = await getDocs(comQ);
    const comItems = comSnap.docs.map((d: QueryDocumentSnapshot<DocumentData>) => ({ id: d.id, ...d.data() })) as any[];

    const enrichedComs = await Promise.all(
      comItems.map(async (com) => {
        if (com.autor_id) {
          const autorSnap = await getDoc(doc(db, 'perfiles', com.autor_id));
          if (autorSnap.exists()) {
            const a = autorSnap.data();
            com.autor = { id: autorSnap.id, nombre_completo: a.nombre_completo, numero_piso: a.numero_piso };
          }
        }
        return com;
      }),
    );

    setComentarios(enrichedComs as Comentario[]);
    setLoading(false);
  }

  async function fetchAfectados() {
    const q = query(collection(db, 'incidencia_afectados'), where('incidencia_id', '==', incidenciaId));
    const snap = await getDocs(q);
    setAfectados(snap.docs.map((d: QueryDocumentSnapshot<DocumentData>) => ({ id: d.id, vecino_id: d.data().vecino_id })));
  }

  /* ── Flags derivados ── */
  const esAdmin      = puedeGestionar(perfil?.rol);
  const esAutor      = incidencia?.autor_id === perfil?.id;
  const yaSumado     = afectados.some((a) => a.vecino_id === perfil?.id);
  const estadoActual = incidencia?.estado ?? 'pendiente';
  const estadoCfg    = ESTADO_CONFIG[estadoActual] ?? ESTADO_CONFIG.pendiente;
  const accion       = ACCION_ESTADO[estadoActual];
  const siguienteKey = SIGUIENTE_ESTADO[estadoActual];
  const siguienteCfg = siguienteKey ? ESTADO_CONFIG[siguienteKey] : null;
  const puedeResolver = esAutor && estadoActual === 'en_ejecucion';
  const historial     = (incidencia as any)?.historial_estados ?? [];

  /* ── Avanzar estado (admin / presidente) ── */
  async function avanzarEstado() {
    if (!incidencia || !perfil || !accion) return;
    setAvanzando(true);
    try {
      const nuevo = await actualizarEstadoIncidencia(incidencia.id, estadoActual, perfil.id);

      // Notificar al autor
      if (incidencia.autor_id !== perfil.id && perfil.comunidad_id) {
        const nuevoCfg = ESTADO_CONFIG[nuevo];
        notificarUsuario(
          incidencia.autor_id,
          perfil.comunidad_id,
          'estado',
          incidencia.titulo,
          `Estado actualizado a "${nuevoCfg?.label}"`,
          `/incidencias/${incidencia.id}`,
        );
      }

      toast.success(`Estado actualizado: ${ESTADO_CONFIG[nuevo]?.label}`);
      fetchIncidencia();
    } catch (err: any) {
      toast.error(err.message ?? 'Error al cambiar el estado');
    } finally {
      setAvanzando(false);
    }
  }

  /* ── Sumarme / quitarme ── */
  async function toggleSumarme() {
    if (!perfil || esAutor) return;
    setSumandome(true);
    if (yaSumado) {
      const q = query(
        collection(db, 'incidencia_afectados'),
        where('incidencia_id', '==', incidenciaId),
        where('vecino_id', '==', perfil.id),
      );
      const snap = await getDocs(q);
      await Promise.all(snap.docs.map((d: QueryDocumentSnapshot<DocumentData>) => deleteDoc(doc(db, 'incidencia_afectados', d.id))));
      toast.success('Ya no apareces como afectado');
    } else {
      try {
        await addDoc(collection(db, 'incidencia_afectados'), {
          incidencia_id: incidenciaId,
          vecino_id: perfil.id,
        });
        toast.success('Te has sumado a la incidencia');
      } catch {
        toast.error('Error al sumarte a la incidencia');
      }
    }
    fetchAfectados();
    setSumandome(false);
  }

  /* ── Comentarios ── */
  async function enviarComentario() {
    if (!nuevoComentario.trim() || !perfil) return;
    setEnviando(true);
    try {
      await addDoc(collection(db, 'comentarios'), {
        incidencia_id: incidenciaId,
        autor_id: perfil.id,
        contenido: nuevoComentario.trim(),
        created_at: new Date().toISOString(),
      });
      setNuevo('');
      if (incidencia && incidencia.autor_id !== perfil.id && perfil.comunidad_id) {
        notificarUsuario(
          incidencia.autor_id, perfil.comunidad_id, 'comentario',
          incidencia.titulo,
          `${perfil.nombre_completo} comentó en tu incidencia`,
          `/incidencias/${incidencia.id}`,
        );
      }
      fetchIncidencia();
    } catch {
      toast.error('Error al enviar el comentario');
    }
    setEnviando(false);
  }

  /* ── Autor confirma resolución ── */
  async function marcarResuelta() {
    if (!perfil || !incidencia || valoracion === 0) return;
    setResolviendo(true);
    await updateDoc(doc(db, 'incidencias', incidencia.id), {
      estado: 'resuelta',
      resuelta_at: new Date().toISOString(),
      valoracion,
      updated_at: new Date().toISOString(),
    });
    toast.success('Incidencia marcada como resuelta');
    setMostrarResolver(false);
    fetchIncidencia();
    setResolviendo(false);
  }

  /* ── Loading ── */
  if (loading) {
    return (
      <div className="pb-6">
        <div className="px-4 py-3 flex items-center gap-3 border-b">
          <Skeleton className="w-8 h-8 rounded-lg" />
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-5 w-16 rounded-full ml-auto" />
        </div>
        <div className="px-4 py-4 space-y-4">
          <div className="flex gap-1">{[1,2,3,4,5].map((i) => <Skeleton key={i} className="flex-1 h-1.5 rounded-full" />)}</div>
          <Card className="border-0 shadow-sm"><CardContent className="p-4 space-y-3">
            <div className="flex gap-3"><Skeleton className="w-10 h-10 rounded-full" /><div className="space-y-1.5"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-44" /></div></div>
            <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" />
          </CardContent></Card>
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (!incidencia) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-muted-foreground">Incidencia no encontrada</p>
        <Button onClick={() => router.back()} variant="ghost" className="mt-4">Volver</Button>
      </div>
    );
  }

  const currentStep = estadoCfg.step;
  const totalAfectados = afectados.length + 1;

  return (
    <div className="pb-10">

      {/* ── Header sticky ── */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-border px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()} className="w-8 h-8 -ml-1">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="font-semibold text-finca-dark truncate flex-1">{incidencia.titulo}</h1>
        <Badge className={cn('text-[10px] border shrink-0', estadoCfg.badge)}>{estadoCfg.label}</Badge>
      </div>

      <div className="px-4 py-4 space-y-4">

        {/* ── Barra de progreso del workflow ── */}
        <div className="space-y-1.5">
          <div className="flex gap-1">
            {WORKFLOW_STEPS.map((_, idx) => (
              <div
                key={idx}
                className={cn(
                  'flex-1 h-1.5 rounded-full transition-all',
                  idx + 1 <= currentStep ? 'bg-finca-coral' : 'bg-muted',
                )}
              />
            ))}
          </div>
          <div className="flex justify-between">
            {WORKFLOW_STEPS.map((step, idx) => (
              <span
                key={step}
                className={cn(
                  'text-[9px] font-medium',
                  idx + 1 <= currentStep ? 'text-finca-coral' : 'text-muted-foreground',
                )}
              >
                {step}
              </span>
            ))}
          </div>
        </div>

        {/* ── Tarjeta principal ── */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-finca-peach flex items-center justify-center shrink-0">
                <span className="text-sm font-semibold text-finca-coral">
                  {(incidencia.autor as any)?.nombre_completo?.charAt(0) || '?'}
                </span>
              </div>
              <div>
                <p className="font-medium text-sm text-finca-dark">{(incidencia.autor as any)?.nombre_completo}</p>
                <p className="text-xs text-muted-foreground">
                  {lineaVivienda(incidencia.autor) && `${lineaVivienda(incidencia.autor)} · `}
                  {format(new Date(incidencia.created_at), "d 'de' MMMM, HH:mm", { locale: es })}
                </p>
              </div>
            </div>

            {incidencia.descripcion && (
              <p className="text-sm text-foreground leading-relaxed">{incidencia.descripcion}</p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {(incidencia.categoria as any)?.nombre && (
                <div className="flex items-center gap-1.5 bg-muted rounded-lg px-2.5 py-1.5">
                  <span className="text-sm leading-none">
                    {(incidencia.categoria as any)?.icono ?? '🏷️'}
                  </span>
                  <span className="text-xs text-muted-foreground">{(incidencia.categoria as any).nombre}</span>
                </div>
              )}
              {incidencia.ubicacion && (
                <div className="flex items-center gap-1.5 bg-muted rounded-lg px-2.5 py-1.5">
                  <span className="text-sm leading-none">📍</span>
                  <span className="text-xs text-muted-foreground">{incidencia.ubicacion}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 bg-muted rounded-lg px-2.5 py-1.5">
                <span className="text-sm leading-none">{prioridadEmoji[incidencia.prioridad] ?? '🔵'}</span>
                <span className="text-xs text-muted-foreground capitalize">{incidencia.prioridad}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ─────────────────────────────────────────────────────
            PANEL DE WORKFLOW — solo admin / presidente
            Muestra botón para avanzar al siguiente estado.
        ───────────────────────────────────────────────────── */}
        {esAdmin && accion && siguienteCfg && (
          <Card className="border-0 shadow-sm border-l-4 border-l-finca-coral bg-finca-peach/5">
            <CardContent className="p-4 space-y-3">

              {/* Título del panel */}
              <p className="text-xs font-semibold text-finca-coral uppercase tracking-wide">
                Gestión de estado
              </p>

              {/* Transición visual: estado actual → siguiente */}
              <div className="flex items-center gap-2">
                <Badge className={cn('text-[10px] border', estadoCfg.badge)}>
                  {estadoCfg.label}
                </Badge>
                <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                <Badge className={cn('text-[10px] border', siguienteCfg.badge)}>
                  {siguienteCfg.label}
                </Badge>
              </div>

              <p className="text-xs text-muted-foreground">{accion.descripcion}</p>

              {/* Botón de acción */}
              <Button
                className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-11"
                onClick={avanzarEstado}
                disabled={avanzando}
              >
                {avanzando
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <>{accion.label} <ArrowRight className="w-4 h-4 ml-1.5" /></>
                }
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Estado final: resuelta — banner para admin */}
        {esAdmin && estadoActual === 'resuelta' && (
          <Card className="border-0 shadow-sm bg-green-50 border-l-4 border-l-green-500">
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
              <p className="text-sm font-medium text-green-800">
                Incidencia resuelta · flujo completado
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── Afectados ── */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-muted rounded-xl px-3 py-2 shrink-0">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-finca-dark">{totalAfectados}</span>
            <span className="text-xs text-muted-foreground">{totalAfectados === 1 ? 'afectado' : 'afectados'}</span>
          </div>
          {!esAutor && (
            <Button
              onClick={toggleSumarme}
              disabled={sumandome}
              variant={yaSumado ? 'outline' : 'default'}
              size="sm"
              className={cn(
                'flex-1 h-10',
                yaSumado
                  ? 'border-finca-coral text-finca-coral hover:bg-finca-peach/20'
                  : 'bg-finca-coral hover:bg-finca-coral/90 text-white',
              )}
            >
              {yaSumado
                ? <><UserMinus className="w-4 h-4 mr-1.5" />Ya no me afecta</>
                : <><UserPlus className="w-4 h-4 mr-1.5" />A mí también me afecta</>
              }
            </Button>
          )}
        </div>

        {/* ── Autor confirma resolución (cuando estado = en_ejecucion) ── */}
        {puedeResolver && (
          <Card className="border-0 shadow-sm bg-green-50 border-l-4 border-l-green-500">
            <CardContent className="p-4 space-y-3">
              {!mostrarResolver ? (
                <Button
                  onClick={() => setMostrarResolver(true)}
                  className="w-full bg-green-600 hover:bg-green-700 text-white h-11"
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Confirmar que se ha resuelto
                </Button>
              ) : (
                <>
                  <p className="text-sm font-medium text-green-800">Valora la reparación</p>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button key={star} onClick={() => setValoracion(star)} className="p-1">
                        <Star className={cn('w-8 h-8 transition-colors', star <= valoracion ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300')} />
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={marcarResuelta}
                      disabled={valoracion === 0 || resolviendo}
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                    >
                      {resolviendo
                        ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : 'Confirmar'}
                    </Button>
                    <Button variant="outline" onClick={() => { setMostrarResolver(false); setValoracion(0); }}>
                      Cancelar
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Valoración (ya resuelta) ── */}
        {estadoActual === 'resuelta' && (incidencia as any).valoracion && (
          <Card className="border-0 shadow-sm bg-green-50">
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-green-800">Valoración del vecino</p>
                <div className="flex gap-0.5 mt-0.5">
                  {[1,2,3,4,5].map((star) => (
                    <Star key={star} className={cn('w-4 h-4', star <= (incidencia as any).valoracion ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300')} />
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Estimación IA ── */}
        {(incidencia.estimacion_min != null || incidencia.estimacion_max != null) && (
          <Card className="border-0 shadow-sm bg-finca-peach/20 border-l-4 border-l-finca-coral">
            <CardContent className="p-4">
              <p className="text-xs font-semibold text-finca-coral uppercase tracking-wide mb-1">Estimación IA</p>
              <p className="text-lg font-bold text-finca-dark">
                {incidencia.estimacion_min ?? 0}€ – {incidencia.estimacion_max ?? 0}€
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Rango estimado de coste de reparación</p>
            </CardContent>
          </Card>
        )}

        {/* ── Historial de estados (acordeón) ── */}
        {historial.length > 0 && (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-2">
              <button
                className="w-full flex items-center justify-between text-left"
                onClick={() => setHistorialAbierto((v) => !v)}
              >
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm font-medium text-finca-dark">Historial de estados</p>
                  <Badge className="bg-muted text-muted-foreground border-0 text-[10px]">{historial.length}</Badge>
                </div>
                <span className="text-xs text-muted-foreground">{historialAbierto ? 'Ocultar' : 'Ver'}</span>
              </button>

              {historialAbierto && (
                <div className="mt-2 space-y-2">
                  <Separator />
                  {[...historial].reverse().map((entrada: any, idx: number) => {
                    const cfg = ESTADO_CONFIG[entrada.estado] ?? ESTADO_CONFIG.pendiente;
                    return (
                      <div key={idx} className="flex items-center gap-3 pt-2">
                        <div className={cn('w-2 h-2 rounded-full shrink-0', cfg.dot)} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-finca-dark">{cfg.label}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {formatDistanceToNow(new Date(entrada.fecha), { addSuffix: true, locale: es })}
                          </p>
                        </div>
                        <Badge className={cn('text-[9px] border-0 shrink-0', cfg.badge)}>
                          {cfg.label}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Comentarios ── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold text-finca-dark text-sm">Comentarios ({comentarios.length})</h2>
          </div>

          {comentarios.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No hay comentarios aún. Sé el primero en comentar.
            </p>
          ) : (
            <div className="space-y-3">
              {comentarios.map((com) => {
                const esPropio = (com.autor as any)?.id === perfil?.id;
                return (
                  <div key={com.id} className={cn('flex gap-2.5', esPropio && 'flex-row-reverse')}>
                    <div className="w-8 h-8 rounded-full bg-finca-peach flex items-center justify-center shrink-0">
                      <span className="text-xs font-semibold text-finca-coral">
                        {(com.autor as any)?.nombre_completo?.charAt(0) || '?'}
                      </span>
                    </div>
                    <div className={cn(
                      'max-w-[80%] rounded-2xl px-3 py-2',
                      esPropio
                        ? 'bg-finca-coral text-white rounded-tr-sm'
                        : 'bg-muted text-foreground rounded-tl-sm',
                    )}>
                      <p className={cn('text-[11px] font-medium mb-0.5', esPropio ? 'text-white/80' : 'text-muted-foreground')}>
                        {(com.autor as any)?.nombre_completo?.split(' ')[0]}
                      </p>
                      <p className="text-sm leading-relaxed">{com.contenido}</p>
                      <p className={cn('text-[10px] mt-1', esPropio ? 'text-white/60' : 'text-muted-foreground')}>
                        {format(new Date(com.created_at), 'HH:mm')}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex gap-2 mt-4">
            <Textarea
              placeholder="Escribe un comentario..."
              value={nuevoComentario}
              onChange={(e) => setNuevo(e.target.value)}
              rows={2}
              className="resize-none text-sm"
            />
            <Button
              onClick={enviarComentario}
              disabled={!nuevoComentario.trim() || enviando}
              size="icon"
              className="bg-finca-coral hover:bg-finca-coral/90 text-white shrink-0 self-end h-10 w-10"
            >
              {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </section>

      </div>
    </div>
  );
}
