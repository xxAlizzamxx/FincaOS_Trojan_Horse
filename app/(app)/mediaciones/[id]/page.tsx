'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Loader2, History, CheckCircle2,
  Euro, CircleCheck, ClipboardList,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  doc, getDoc, updateDoc, serverTimestamp, arrayUnion,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { notificarUsuario } from '@/lib/firebase/notifications';
import type { Mediacion, Perfil } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

/* ─── Constantes ─── */
const ESTADO_CFG: Record<string, { label: string; badge: string; dot: string; step: number }> = {
  solicitada: { label: 'Solicitada',  badge: 'bg-yellow-100 text-yellow-700 border-yellow-200',  dot: 'bg-yellow-500',  step: 1 },
  asignada:   { label: 'Asignada',   badge: 'bg-blue-100 text-blue-700 border-blue-200',         dot: 'bg-blue-500',    step: 2 },
  en_proceso: { label: 'En proceso', badge: 'bg-purple-100 text-purple-700 border-purple-200',   dot: 'bg-purple-500',  step: 3 },
  finalizada: { label: 'Finalizada', badge: 'bg-green-100 text-green-700 border-green-200',      dot: 'bg-green-500',   step: 4 },
};

const PASOS = ['Solicitada', 'Asignada', 'En proceso', 'Finalizada'];

/* ─── Helpers ─── */
function formatMonto(n: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
}

/* ════════════════════════════════════════════════════════════ */
export default function MediacionDetailPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const { perfil, user } = useAuth();

  const [mediacion, setMediacion] = useState<Mediacion | null>(null);
  const [solicitante, setSolicitante] = useState<Perfil | null>(null);
  const [loading, setLoading] = useState(true);
  const [accionando, setAccionando] = useState(false);
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [precioInput, setPrecioInput] = useState('');

  /* ── Roles derivados ── */
  const esMediador  = perfil?.rol === 'mediador';
  const esAdmin     = perfil?.rol === 'admin' || perfil?.rol === 'presidente';
  const uid         = user?.uid ?? '';

  /* ── Estado derivado (actualizado en tiempo real vía local state) ── */
  const estado      = mediacion?.estado ?? 'solicitada';
  const estadoCfg   = ESTADO_CFG[estado] ?? ESTADO_CFG.solicitada;
  const soyAsignado = mediacion?.mediador_id === uid;
  const sinAsignar  = !mediacion?.mediador_id;
  const historial   = mediacion?.historial ?? [];

  /* ── Fetch ── */
  useEffect(() => { if (id) fetchMediacion(); }, [id]);

  async function fetchMediacion() {
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, 'mediaciones', id));
      if (!snap.exists()) { toast.error('Mediación no encontrada'); router.back(); return; }
      const data = { id: snap.id, ...snap.data() } as Mediacion;
      setMediacion(data);
      setPrecioInput(data.precio_acordado ? String(data.precio_acordado) : '');

      /* Cargar perfil del solicitante */
      const solUid = data.solicitado_por ?? data.denunciante_id;
      if (solUid) {
        const solSnap = await getDoc(doc(db, 'perfiles', solUid));
        if (solSnap.exists()) setSolicitante({ id: solSnap.id, ...solSnap.data() } as Perfil);
      }
    } catch (err) {
      console.error(err);
      toast.error('Error cargando la mediación');
    } finally {
      setLoading(false);
    }
  }

  /* ─── Helper: entrada de historial ─── */
  function entradaHistorial(nuevoEstado: Mediacion['estado'], nota: string) {
    return {
      estado:     nuevoEstado,
      fecha:      new Date().toISOString(),
      usuario_id: uid,
      nota,
    };
  }

  /* ─── Helper: notificar al solicitante ─── */
  function notificarSolicitante(titulo: string, mensaje: string) {
    const solUid = mediacion?.solicitado_por ?? mediacion?.denunciante_id;
    if (!solUid || !perfil?.comunidad_id) return;
    notificarUsuario(solUid, perfil.comunidad_id, 'mediacion', titulo, mensaje, `/mediaciones/${id}`);
  }

  /* ─── ACCIONES ─── */

  /** [Mediador] Aceptar: solicitada → asignada */
  async function aceptarMediacion() {
    if (!esMediador || !sinAsignar) return;
    setAccionando(true);
    try {
      await updateDoc(doc(db, 'mediaciones', id), {
        estado:      'asignada',
        mediador_id: uid,
        updated_at:  serverTimestamp(),
        historial:   arrayUnion(entradaHistorial('asignada', 'Mediador aceptó la solicitud')),
      });
      notificarSolicitante('Mediador asignado', 'Un mediador ha aceptado tu solicitud de mediación');
      toast.success('Has aceptado la mediación');
      fetchMediacion();
    } catch { toast.error('Error al aceptar la mediación'); }
    finally { setAccionando(false); }
  }

  /** [Mediador asignado] Iniciar: asignada → en_proceso */
  async function iniciarMediacion() {
    if (!soyAsignado || estado !== 'asignada') return;
    setAccionando(true);
    try {
      await updateDoc(doc(db, 'mediaciones', id), {
        estado:     'en_proceso',
        updated_at: serverTimestamp(),
        historial:  arrayUnion(entradaHistorial('en_proceso', 'Mediación iniciada')),
      });
      notificarSolicitante('Mediación iniciada', 'El mediador ha comenzado a gestionar tu caso');
      toast.success('Mediación iniciada');
      fetchMediacion();
    } catch { toast.error('Error al iniciar la mediación'); }
    finally { setAccionando(false); }
  }

  /** [Mediador asignado] Finalizar: en_proceso → finalizada */
  async function finalizarMediacion() {
    if (!soyAsignado || estado !== 'en_proceso') return;
    setAccionando(true);
    const precio = precioInput ? parseFloat(precioInput.replace(',', '.')) : null;
    try {
      await updateDoc(doc(db, 'mediaciones', id), {
        estado:          'finalizada',
        precio_acordado: precio,
        updated_at:      serverTimestamp(),
        historial:       arrayUnion(entradaHistorial('finalizada', `Mediación finalizada${precio ? ` · ${formatMonto(precio)}` : ''}`)),
      });
      notificarSolicitante('Mediación finalizada', 'El mediador ha cerrado tu caso de mediación');
      toast.success('Mediación finalizada');
      fetchMediacion();
    } catch { toast.error('Error al finalizar la mediación'); }
    finally { setAccionando(false); }
  }

  /** [Mediador / Admin] Marcar como pagado */
  async function marcarPagado() {
    if (mediacion?.estado_pago === 'pagado') return;
    setAccionando(true);
    try {
      await updateDoc(doc(db, 'mediaciones', id), {
        estado_pago: 'pagado',
        updated_at:  serverTimestamp(),
        'pago.estado':    'pagado',
        'pago.paid_at':   new Date().toISOString(),
        'pago.precio_final': mediacion?.precio_acordado ?? mediacion?.precio_min ?? null,
      });
      toast.success('Pago registrado');
      fetchMediacion();
    } catch { toast.error('Error al registrar el pago'); }
    finally { setAccionando(false); }
  }

  /* ─── Loading ─── */
  if (loading) {
    return (
      <div className="pb-6">
        <div className="px-4 py-3 border-b flex items-center gap-3">
          <Skeleton className="w-8 h-8 rounded-lg" />
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-5 w-20 rounded-full ml-auto" />
        </div>
        <div className="px-4 py-4 space-y-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!mediacion) return null;

  const currentStep = estadoCfg.step;
  const pagado = mediacion.estado_pago === 'pagado';

  return (
    <div className="pb-10">

      {/* ── Header ── */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()} className="w-8 h-8 -ml-1">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="font-semibold text-finca-dark flex-1 truncate">Mediación profesional</h1>
        <Badge className={cn('text-[10px] border shrink-0', estadoCfg.badge)}>{estadoCfg.label}</Badge>
      </div>

      <div className="px-4 py-4 space-y-4">

        {/* ── Barra de progreso ── */}
        <div className="space-y-1.5">
          <div className="flex gap-1">
            {PASOS.map((_, idx) => (
              <div key={idx} className={cn(
                'flex-1 h-1.5 rounded-full transition-all',
                idx + 1 <= currentStep ? 'bg-finca-coral' : 'bg-muted',
              )} />
            ))}
          </div>
          <div className="flex justify-between">
            {PASOS.map((paso, idx) => (
              <span key={paso} className={cn(
                'text-[9px] font-medium',
                idx + 1 <= currentStep ? 'text-finca-coral' : 'text-muted-foreground',
              )}>
                {paso}
              </span>
            ))}
          </div>
        </div>

        {/* ── Info principal ── */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 space-y-3">
            {solicitante && (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-finca-peach flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-finca-coral">
                    {solicitante.nombre_completo.charAt(0)}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-medium text-finca-dark">
                    {mediacion.es_anonimo && !esMediador && !esAdmin
                      ? 'Vecino anónimo'
                      : solicitante.nombre_completo}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Solicitado {formatDistanceToNow(new Date(mediacion.created_at), { addSuffix: true, locale: es })}
                  </p>
                </div>
              </div>
            )}

            {mediacion.descripcion && (
              <p className="text-sm text-foreground leading-relaxed">{mediacion.descripcion}</p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <span className="text-xs bg-muted px-2 py-1 rounded-lg text-muted-foreground">
                💰 {formatMonto(mediacion.precio_min)} – {formatMonto(mediacion.precio_max)}
              </span>
              {mediacion.precio_acordado != null && (
                <span className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded-lg font-medium">
                  ✓ Acordado: {formatMonto(mediacion.precio_acordado)}
                </span>
              )}
              <span className={cn(
                'text-xs px-2 py-1 rounded-lg font-medium',
                pagado ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700',
              )}>
                {pagado ? '✓ Pagado' : '⏳ Pago pendiente'}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* ════════════════════════════════════════
            PANEL DE ACCIONES DEL MEDIADOR
        ════════════════════════════════════════ */}

        {/* [Mediador] Aceptar — estado: solicitada + sin asignar */}
        {esMediador && estado === 'solicitada' && sinAsignar && (
          <Card className="border-0 shadow-sm border-l-4 border-l-yellow-400 bg-yellow-50/30">
            <CardContent className="p-4 space-y-3">
              <p className="text-xs font-semibold text-yellow-700 uppercase tracking-wide">
                Mediación disponible
              </p>
              <p className="text-sm text-muted-foreground">
                Esta solicitud aún no tiene mediador asignado. Al aceptarla, quedará asignada a ti.
              </p>
              <Button
                className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-11"
                onClick={aceptarMediacion}
                disabled={accionando}
              >
                {accionando
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <><ClipboardList className="w-4 h-4 mr-2" />Aceptar mediación</>}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* [Mediador asignado] Iniciar — estado: asignada */}
        {soyAsignado && estado === 'asignada' && (
          <Card className="border-0 shadow-sm border-l-4 border-l-blue-400 bg-blue-50/30">
            <CardContent className="p-4 space-y-3">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                Mediación asignada
              </p>
              <p className="text-sm text-muted-foreground">
                Has aceptado esta mediación. Cuando contactes con las partes, márcala como iniciada.
              </p>
              <Button
                className="w-full bg-blue-600 hover:bg-blue-700 text-white h-11"
                onClick={iniciarMediacion}
                disabled={accionando}
              >
                {accionando
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <>🤝 Iniciar mediación</>}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* [Mediador asignado] Finalizar — estado: en_proceso */}
        {soyAsignado && estado === 'en_proceso' && (
          <Card className="border-0 shadow-sm border-l-4 border-l-purple-400 bg-purple-50/30">
            <CardContent className="p-4 space-y-4">
              <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide">
                Mediación en proceso
              </p>

              {/* Precio acordado */}
              <div className="space-y-1.5">
                <Label htmlFor="precio-acordado" className="text-sm">
                  Precio acordado (€) — opcional
                </Label>
                <div className="relative">
                  <Euro className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="precio-acordado"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0,00"
                    value={precioInput}
                    onChange={(e) => setPrecioInput(e.target.value)}
                    className="pl-8"
                  />
                </div>
              </div>

              <Button
                className="w-full bg-purple-600 hover:bg-purple-700 text-white h-11"
                onClick={finalizarMediacion}
                disabled={accionando}
              >
                {accionando
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <><CircleCheck className="w-4 h-4 mr-2" />Finalizar mediación</>}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* [Solo mediador asignado] Marcar pagado — estado: finalizada + pago pendiente */}
        {soyAsignado && estado === 'finalizada' && !pagado && (
          <Card className="border-0 shadow-sm border-l-4 border-l-green-400 bg-green-50/30">
            <CardContent className="p-4 space-y-3">
              <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">
                Pago pendiente
              </p>
              <p className="text-sm text-muted-foreground">
                La mediación ha finalizado.
                {mediacion.precio_acordado != null
                  ? ` Precio acordado: ${formatMonto(mediacion.precio_acordado)}.`
                  : ' Registra el pago cuando lo recibas.'}
              </p>
              <Button
                className="w-full bg-green-600 hover:bg-green-700 text-white h-11"
                onClick={marcarPagado}
                disabled={accionando}
              >
                {accionando
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <><CheckCircle2 className="w-4 h-4 mr-2" />Marcar como pagado</>}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Banner: finalizada + pagado */}
        {estado === 'finalizada' && pagado && (
          <Card className="border-0 shadow-sm bg-green-50 border-l-4 border-l-green-500">
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
              <p className="text-sm font-medium text-green-800">
                Mediación finalizada y pagada ✓
              </p>
            </CardContent>
          </Card>
        )}

        {/* [Vecino/Admin] vista de estado si no es mediador */}
        {!esMediador && estado !== 'finalizada' && (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-2">
              <p className="text-xs font-semibold text-finca-coral uppercase tracking-wide">Estado actual</p>
              <div className="flex items-center gap-2">
                <div className={cn('w-2 h-2 rounded-full', estadoCfg.dot)} />
                <p className="text-sm text-finca-dark font-medium">{estadoCfg.label}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {estado === 'solicitada' && 'Tu solicitud está pendiente de asignación de mediador.'}
                {estado === 'asignada'   && 'Un mediador ha aceptado tu caso y contactará contigo pronto.'}
                {estado === 'en_proceso' && 'El mediador está gestionando activamente tu caso.'}
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── Historial ── */}
        {historial.length > 0 && (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-2">
              <button
                className="w-full flex items-center justify-between text-left"
                onClick={() => setHistorialAbierto((v) => !v)}
              >
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm font-medium text-finca-dark">Historial</p>
                  <Badge className="bg-muted text-muted-foreground border-0 text-[10px]">
                    {historial.length}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  {historialAbierto ? 'Ocultar' : 'Ver'}
                </span>
              </button>

              {historialAbierto && (
                <div className="mt-2 space-y-2">
                  <Separator />
                  {[...historial].reverse().map((entrada: any, idx: number) => {
                    const cfg = ESTADO_CFG[entrada.estado] ?? ESTADO_CFG.solicitada;
                    return (
                      <div key={idx} className="flex items-start gap-3 pt-2">
                        <div className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', cfg.dot)} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-finca-dark">{cfg.label}</p>
                          {entrada.nota && (
                            <p className="text-[11px] text-muted-foreground">{entrada.nota}</p>
                          )}
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {formatDistanceToNow(new Date(entrada.fecha), { addSuffix: true, locale: es })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
}
