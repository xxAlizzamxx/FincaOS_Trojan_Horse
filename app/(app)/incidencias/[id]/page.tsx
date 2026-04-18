'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  ArrowLeft, ArrowRight, MessageSquare, Send,
  UserPlus, UserMinus, Users, Star, ImageIcon,
  CircleCheck as CheckCircle2, Loader2, History, CreditCard, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { getAuth } from 'firebase/auth';
import {
  collection, query, where, orderBy, getDocs,
  getDoc, addDoc, deleteDoc, updateDoc, doc, onSnapshot,
  QueryDocumentSnapshot, DocumentData,
} from 'firebase/firestore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Incidencia, Comentario } from '@/types/database';
import { notificarUsuario } from '@/lib/firebase/notifications';
import { useEliminar } from '@/hooks/useEliminar';
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog';
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
import { AvatarVecino } from '@/components/ui/avatar-vecino';

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
  const [fotos, setFotos]               = useState<{ id: string; url: string }[]>([]);
  const [sumandome, setSumandome]       = useState(false);

  /* Valoración (autor cuando estado = en_ejecucion) */
  const [valoracion, setValoracion]         = useState(0);
  const [resolviendo, setResolviendo]       = useState(false);
  const [mostrarResolver, setMostrarResolver] = useState(false);

  /* Workflow (admin / presidente) */
  const [avanzando, setAvanzando] = useState(false);

  /* Presupuesto proveedor */
  const [presupuestoInput, setPresupuestoInput] = useState('');
  const [proveedorInput, setProveedorInput] = useState('');
  const [guardandoPresupuesto, setGuardandoPresupuesto] = useState(false);

  /* Historial expandido */
  const [historialAbierto, setHistorialAbierto] = useState(false);

  /* Stripe */
  const [pagandoStripe, setPagandoStripe] = useState(false);

  const { confirmar, dialogProps } = useEliminar();

  const incidenciaId = params.id as string;

  // Cache de datos enriquecidos (autor/categoría) — se obtienen una vez y se reutilizan
  const enrichmentRef = useRef<{ autor: any; categoria: any; _autorId?: string; _categoriaId?: string } | null>(null);

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

  // ── onSnapshot: actualiza la incidencia en tiempo real ──
  useEffect(() => {
    enrichmentRef.current = null; // resetear cache al cambiar de incidencia
    const incRef = doc(db, 'incidencias', incidenciaId);

    const unsub = onSnapshot(incRef, async (snap) => {
      if (!snap.exists()) {
        setLoading(false);
        return;
      }

      const incData: any = { id: snap.id, ...snap.data() };

      // Enriquece autor y categoría sólo la primera vez (o si cambia autor/categoría)
      if (!enrichmentRef.current ||
          enrichmentRef.current._autorId !== incData.autor_id ||
          enrichmentRef.current._categoriaId !== incData.categoria_id) {
        const [autorSnap, catSnap] = await Promise.all([
          incData.autor_id     ? getDoc(doc(db, 'perfiles',              incData.autor_id))     : Promise.resolve(null),
          incData.categoria_id ? getDoc(doc(db, 'categorias_incidencia', incData.categoria_id)) : Promise.resolve(null),
        ]);

        let autor = null;
        if (autorSnap?.exists()) {
          const a = autorSnap.data();
          autor = {
            id:              autorSnap.id,
            nombre_completo: a.nombre_completo,
            avatar_url:      a.avatar_url  ?? null,
            rol:             a.rol         ?? 'vecino',
            torre:           a.torre       ?? null,
            piso:            a.piso        ?? null,
            puerta:          a.puerta      ?? null,
            numero_piso:     a.numero_piso ?? null,
          };
        }

        let categoria = null;
        if (catSnap?.exists()) {
          const c = catSnap.data();
          categoria = { nombre: c.nombre, icono: c.icono };
        }

        enrichmentRef.current = {
          _autorId:     incData.autor_id,
          _categoriaId: incData.categoria_id,
          autor,
          categoria,
        };
      }

      setIncidencia({ ...incData, ...enrichmentRef.current } as Incidencia);
      setLoading(false);
    });

    return () => unsub();
  }, [incidenciaId]);

  useEffect(() => { fetchAfectados(); fetchFotos(); }, [incidenciaId]);

  // fetchComentarios separado (comentarios no tienen onSnapshot para evitar reads excesivos)
  async function fetchIncidencia() {
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
            com.autor = {
              id:              autorSnap.id,
              nombre_completo: a.nombre_completo,
              avatar_url:      a.avatar_url ?? null,
              rol:             a.rol        ?? 'vecino',
              numero_piso:     a.numero_piso ?? null,
            };
          }
        }
        return com;
      }),
    );

    setComentarios(enrichedComs as Comentario[]);
  }

  async function fetchFotos() {
    const q = query(collection(db, 'incidencias_fotos'), where('incidencia_id', '==', incidenciaId), orderBy('created_at', 'asc'));
    try {
      const snap = await getDocs(q);
      setFotos(snap.docs.map((d) => ({ id: d.id, url: d.data().url })));
    } catch {
      // Index may not exist yet — ignore
    }
  }

  async function fetchAfectados() {
    // Primero intentar la subcollección nueva (generada por /api/incidencias/afectar)
    try {
      const subSnap = await getDocs(collection(db, 'incidencias', incidenciaId, 'afectados'));
      if (subSnap.size > 0) {
        // En la subcollección el doc id ES el vecino_id
        setAfectados(subSnap.docs.map((d) => ({ id: d.id, vecino_id: d.id })));
        console.log('[Afectados] subcollección:', subSnap.size);
        return;
      }
    } catch {
      // Si la subcollección no existe, continuar con fallback
    }
    // Fallback: colección global legacy
    const q = query(collection(db, 'incidencia_afectados'), where('incidencia_id', '==', incidenciaId));
    const snap = await getDocs(q);
    console.log('[Afectados] colección global (legacy):', snap.size);
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

  /* ── Sumarme / quitarme — usa /api/incidencias/afectar ── */
  async function toggleSumarme() {
    if (!perfil || esAutor) return;
    setSumandome(true);
    const wasAdded = yaSumado;

    // Optimistic update: reflejar el cambio en pantalla antes de esperar al servidor
    setAfectados((prev) =>
      wasAdded
        ? prev.filter((a) => a.vecino_id !== perfil.id)
        : [...prev, { id: perfil.id, vecino_id: perfil.id }],
    );

    try {
      const token = await getAuth().currentUser?.getIdToken(false);
      console.log('[Afectar] llamando API — incidenciaId:', incidenciaId, '| quitar:', wasAdded);
      const res = await fetch('/api/incidencias/afectar', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ incidenciaId, quitar: wasAdded }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Error ${res.status}`);
      }

      console.log('[Afectar] éxito — recargando incidencia para quórum actualizado');
      toast.success(wasAdded ? 'Ya no apareces como afectado' : '¡Te has sumado a la incidencia!');
      // Recargar incidencia para mostrar quórum actualizado
      fetchIncidencia();
    } catch (err: any) {
      // Revertir update optimista
      setAfectados((prev) =>
        wasAdded
          ? [...prev, { id: perfil.id, vecino_id: perfil.id }]
          : prev.filter((a) => a.vecino_id !== perfil.id),
      );
      console.error('[Afectar] error:', err.message);
      toast.error(err.message ?? 'Error al actualizar');
    } finally {
      setSumandome(false);
    }
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

  /* ── Stripe payment (autor / vecino) ── */
  async function pagarIncidenciaConStripe() {
    if (!incidencia || !perfil) return;
    const monto = (incidencia as any).presupuesto_proveedor;
    if (!monto) return;
    setPagandoStripe(true);
    try {
      const res = await fetch('/api/stripe/create-checkout-session', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monto,
          tipo:         'incidencia',
          referencia_id: incidencia.id,
          usuario_id:   perfil.id,
          comunidad_id: perfil.comunidad_id,
          descripcion:  `Reparación: ${incidencia.titulo}`,
          email:        (perfil as any).email ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error desconocido');
      if (data.url) window.location.href = data.url;
    } catch (err: any) {
      console.error('[Stripe Incidencia]', err);
      toast.error(err.message ?? 'No se pudo iniciar el pago');
    } finally {
      setPagandoStripe(false);
    }
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
        {(esAdmin || esAutor) && (
          <button
            onClick={() => confirmar({
              tipo: 'incidencia',
              id: incidencia.id,
              nombre: incidencia.titulo,
              onExito: () => router.replace('/incidencias'),
            })}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
            title="Eliminar incidencia"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
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
              <AvatarVecino
                perfil={{
                  nombre_completo: (incidencia.autor as any)?.nombre_completo ?? '?',
                  avatar_url:      (incidencia.autor as any)?.avatar_url ?? null,
                  rol:             (incidencia.autor as any)?.rol ?? 'vecino',
                }}
                size="md"
              />
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

        {/* ── Fotos ── */}
        {fotos.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-finca-dark">Fotos ({fotos.length})</h2>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {fotos.map((foto) => (
                <a
                  key={foto.id}
                  href={foto.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative w-28 h-28 rounded-lg overflow-hidden border border-border shrink-0"
                >
                  <Image src={foto.url} alt="Foto incidencia" fill className="object-cover" sizes="112px" />
                </a>
              ))}
            </div>
          </div>
        )}

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

        {/* ── Afectados + barra de quórum ── */}
        <div className="space-y-3">
          {/* Barra de quórum — muestra si existe el campo quorum O si hay afectados */}
          {(() => {
            const q       = (incidencia as any).quorum;
            const count   = q?.afectados_count ?? afectados.length;
            const umbral  = q?.umbral ?? 30;
            const alcanzado = q?.alcanzado ?? false;
            // Barra: mostramos cuántos afectados hay respecto a un estimado de vecinos
            // Si tenemos afectados_count del servidor úsalo, si no, usa el local
            const barPct = Math.min(100, alcanzado ? 100 : Math.round((count / Math.max(1, count + 3)) * 80));
            return (
              <div className={cn('rounded-xl p-3 space-y-2 border', alcanzado ? 'bg-red-50 border-red-200' : 'bg-muted/30 border-border/50')}>
                <div className="flex items-center justify-between text-xs">
                  <span className={cn('font-medium', alcanzado ? 'text-red-700' : 'text-finca-dark')}>
                    {alcanzado ? '⚠️ Quórum alcanzado' : '👥 Vecinos afectados'}
                  </span>
                  <span className={cn('font-medium tabular-nums', alcanzado ? 'text-red-600' : 'text-muted-foreground')}>
                    {count} afectado{count !== 1 ? 's' : ''} · umbral {umbral}%
                  </span>
                </div>
                <div className="h-2 bg-white rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all duration-700', alcanzado ? 'bg-red-500' : 'bg-finca-coral')}
                    style={{ width: `${barPct}%` }}
                  />
                </div>
              </div>
            );
          })()}

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

        {/* ── Presupuesto proveedor (admin) ── */}
        {esAdmin && (incidencia.estimacion_min != null) && (
          <Card className="border-0 shadow-sm border-l-4 border-l-blue-400">
            <CardContent className="p-4 space-y-3">
              <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Presupuesto proveedor</p>
              {(incidencia as any).presupuesto_proveedor ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-lg font-bold text-finca-dark">{(incidencia as any).presupuesto_proveedor}€</p>
                    {(incidencia as any).presupuesto_proveedor > (incidencia.estimacion_max ?? 0) * 1.2 ? (
                      <Badge className="text-[10px] bg-red-100 text-red-700 border-0">+20% sobre IA</Badge>
                    ) : (
                      <Badge className="text-[10px] bg-green-100 text-green-700 border-0">Dentro del rango</Badge>
                    )}
                  </div>
                  {(incidencia as any).proveedor_nombre && (
                    <p className="text-xs text-muted-foreground">{(incidencia as any).proveedor_nombre}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Proveedor</Label>
                      <Input placeholder="Nombre" value={proveedorInput} onChange={(e) => setProveedorInput(e.target.value)} className="h-9 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Importe (€)</Label>
                      <Input type="number" placeholder="0" value={presupuestoInput} onChange={(e) => setPresupuestoInput(e.target.value)} className="h-9 text-sm" />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="w-full bg-blue-500 hover:bg-blue-600 text-white h-9"
                    disabled={!presupuestoInput || guardandoPresupuesto}
                    onClick={async () => {
                      setGuardandoPresupuesto(true);
                      await updateDoc(doc(db, 'incidencias', incidencia.id), {
                        presupuesto_proveedor: parseFloat(presupuestoInput),
                        proveedor_nombre: proveedorInput.trim() || null,
                        updated_at: new Date().toISOString(),
                      });
                      toast.success('Presupuesto guardado');
                      fetchIncidencia();
                      setGuardandoPresupuesto(false);
                    }}
                  >
                    {guardandoPresupuesto ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Guardar presupuesto'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Pago de presupuesto (autor / vecino) ── */}
        {esAutor && (incidencia as any).presupuesto_proveedor != null &&
          (incidencia as any).estado_pago_proveedor !== 'pagado' && (
          <Card className="border-0 shadow-sm border-l-4 border-l-finca-coral bg-finca-peach/10">
            <CardContent className="p-4 space-y-3">
              <p className="text-xs font-semibold text-finca-coral uppercase tracking-wide">
                Pago de reparación
              </p>
              <p className="text-sm text-muted-foreground">
                El presupuesto de{' '}
                <span className="font-semibold text-finca-dark">
                  {(incidencia as any).presupuesto_proveedor}€
                  {(incidencia as any).proveedor_nombre ? ` · ${(incidencia as any).proveedor_nombre}` : ''}
                </span>{' '}
                está pendiente de pago.
              </p>
              <Button
                className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-11"
                onClick={pagarIncidenciaConStripe}
                disabled={pagandoStripe}
              >
                {pagandoStripe
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <><CreditCard className="w-4 h-4 mr-2" />Pagar {(incidencia as any).presupuesto_proveedor}€</>}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ── Pago completado banner ── */}
        {(incidencia as any).estado_pago_proveedor === 'pagado' && (
          <Card className="border-0 shadow-sm bg-green-50 border-l-4 border-l-green-500">
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
              <p className="text-sm font-medium text-green-800">Pago al proveedor completado ✓</p>
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
                    <AvatarVecino
                      perfil={{
                        nombre_completo: (com.autor as any)?.nombre_completo ?? '?',
                        avatar_url:      (com.autor as any)?.avatar_url ?? null,
                        rol:             (com.autor as any)?.rol ?? 'vecino',
                      }}
                      size="sm"
                    />
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

      <ConfirmDeleteDialog {...dialogProps} />
    </div>
  );
}
