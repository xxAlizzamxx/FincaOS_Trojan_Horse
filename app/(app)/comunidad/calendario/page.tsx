'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { crearNotificacionComunidad } from '@/lib/firebase/notifications';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

import {
  ArrowLeft, ChevronLeft, ChevronRight,
  Plus, Vote, Wallet, AlertCircle, X,
  Calendar as CalendarIcon, Users, FileText,
  Pencil, Trash2, Loader2,
} from 'lucide-react';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
} from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/* ─── Tipos de evento unificados ─── */

type TipoEvento = 'reunion' | 'cuota' | 'votacion' | 'incidencia' | 'evento';

interface CalendarioEvent {
  id: string;
  titulo: string;
  tipo: TipoEvento;
  fecha: Date;
  descripcion?: string;
  color: string;
  url?: string;
  source: 'votaciones' | 'cuotas' | 'incidencias' | 'eventos_calendario';
  editable: boolean;
}

const TIPO_CONFIG: Record<TipoEvento, { label: string; color: string; colorDot: string; icon: React.ElementType }> = {
  reunion:    { label: 'Reunion',    color: 'bg-blue-500',    colorDot: 'bg-blue-500',    icon: Users },
  cuota:      { label: 'Cuota',      color: 'bg-green-500',   colorDot: 'bg-green-500',   icon: Wallet },
  votacion:   { label: 'Votacion',   color: 'bg-purple-500',  colorDot: 'bg-purple-500',  icon: Vote },
  incidencia: { label: 'Incidencia', color: 'bg-red-500',     colorDot: 'bg-red-500',     icon: AlertCircle },
  evento:     { label: 'Evento',     color: 'bg-finca-coral', colorDot: 'bg-finca-coral', icon: CalendarIcon },
};

export default function CalendarioPage() {
  const router = useRouter();
  const { perfil, user } = useAuth();
  const [mes, setMes] = useState(new Date());
  const [eventos, setEventos] = useState<CalendarioEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [diaSeleccionado, setDiaSeleccionado] = useState<Date | null>(null);

  // Modal states
  const [modalCrear, setModalCrear] = useState(false);
  const [modalDetalle, setModalDetalle] = useState<CalendarioEvent | null>(null);
  const [modalEditar, setModalEditar] = useState<CalendarioEvent | null>(null);

  // Form states
  const [formTipo, setFormTipo] = useState<TipoEvento>('reunion');
  const [formTitulo, setFormTitulo] = useState('');
  const [formDescripcion, setFormDescripcion] = useState('');
  const [formFecha, setFormFecha] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const comunidadId = perfil?.comunidad_id;
  const esAdmin = perfil?.rol === 'admin' || perfil?.rol === 'presidente';

  const fetchEventos = useCallback(async (cid: string) => {
    setLoading(true);
    const mesInicio = startOfMonth(mes);
    const mesFin = endOfMonth(mes);
    const mesInicioISO = mesInicio.toISOString();
    const mesFinISO = mesFin.toISOString();

    try {
      const [votSnap, cuotaSnap, incSnap, evtSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'votaciones'),
          where('comunidad_id', '==', cid),
          where('created_at', '>=', mesInicioISO),
          where('created_at', '<=', mesFinISO),
        )),
        getDocs(query(
          collection(db, 'cuotas'),
          where('comunidad_id', '==', cid),
          where('fecha_limite', '>=', mesInicioISO),
          where('fecha_limite', '<=', mesFinISO),
        )),
        getDocs(query(
          collection(db, 'incidencias'),
          where('comunidad_id', '==', cid),
        )),
        getDocs(query(
          collection(db, 'eventos_calendario'),
          where('comunidad_id', '==', cid),
          where('fecha', '>=', mesInicioISO),
          where('fecha', '<=', mesFinISO),
        )),
      ]);

      const evts: CalendarioEvent[] = [
        ...votSnap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            titulo: data.titulo as string,
            tipo: 'votacion' as const,
            fecha: new Date(data.created_at as string),
            descripcion: data.descripcion as string | undefined,
            color: TIPO_CONFIG.votacion.color,
            url: '/votos',
            source: 'votaciones' as const,
            editable: false,
          };
        }),
        ...cuotaSnap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            titulo: (data.nombre as string) || 'Cuota',
            tipo: 'cuota' as const,
            fecha: new Date(data.fecha_limite as string),
            descripcion: data.monto ? `${data.monto}€` : undefined,
            color: TIPO_CONFIG.cuota.color,
            url: '/cuotas',
            source: 'cuotas' as const,
            editable: false,
          };
        }),
        ...incSnap.docs
          .filter(d => {
            const ca = d.data().created_at as string | undefined;
            if (!ca) return false;
            const t = new Date(ca).getTime();
            return t >= mesInicio.getTime() && t <= mesFin.getTime();
          })
          .map(d => {
            const data = d.data();
            return {
              id: d.id,
              titulo: data.titulo as string,
              tipo: 'incidencia' as const,
              fecha: new Date(data.created_at as string),
              descripcion: data.descripcion as string | undefined,
              color: TIPO_CONFIG.incidencia.color,
              url: `/incidencias/${d.id}`,
              source: 'incidencias' as const,
              editable: false,
            };
          }),
        ...evtSnap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            titulo: data.titulo as string,
            tipo: (data.tipo as TipoEvento) || 'evento',
            fecha: new Date(data.fecha as string),
            descripcion: data.descripcion as string | undefined,
            color: TIPO_CONFIG[(data.tipo as TipoEvento) || 'evento']?.color || TIPO_CONFIG.evento.color,
            source: 'eventos_calendario' as const,
            editable: true,
          };
        }),
      ];
      setEventos(evts);
    } catch (e) {
      console.error('[Calendario] fetchEventos error:', e);
    } finally {
      setLoading(false);
    }
  }, [mes]);

  useEffect(() => {
    if (!comunidadId) return;
    fetchEventos(comunidadId);
  }, [comunidadId, fetchEventos]);

  const diasDelMes = eachDayOfInterval({ start: startOfMonth(mes), end: endOfMonth(mes) });
  const primerDia = getDay(startOfMonth(mes));
  const diasVacios = (primerDia + 6) % 7;
  const eventosDelDia = diaSeleccionado
    ? eventos.filter(e => isSameDay(e.fecha, diaSeleccionado))
    : [];

  function seleccionarDia(dia: Date) {
    setDiaSeleccionado(dia);
    if (esAdmin) {
      abrirModalCrear(dia);
    }
  }

  function abrirModalCrear(dia: Date) {
    setFormTipo('reunion');
    setFormTitulo('');
    setFormDescripcion('');
    setFormFecha(format(dia, 'yyyy-MM-dd'));
    setModalCrear(true);
  }

  function abrirModalEditar(evt: CalendarioEvent) {
    setModalDetalle(null);
    setFormTipo(evt.tipo);
    setFormTitulo(evt.titulo);
    setFormDescripcion(evt.descripcion || '');
    setFormFecha(format(evt.fecha, 'yyyy-MM-dd'));
    setModalEditar(evt);
  }

  async function handleCrear() {
    if (!formTitulo.trim()) { toast.error('El titulo es obligatorio'); return; }
    if (!formFecha) { toast.error('La fecha es obligatoria'); return; }
    if (!comunidadId || !user) return;

    setSubmitting(true);
    try {
      const fechaISO = new Date(formFecha + 'T12:00:00').toISOString();

      if (formTipo === 'cuota') {
        router.push(`/cuotas/nueva?fecha=${formFecha}`);
        setModalCrear(false);
        return;
      }
      if (formTipo === 'votacion') {
        router.push(`/votos/nuevo?fecha=${formFecha}`);
        setModalCrear(false);
        return;
      }
      if (formTipo === 'incidencia') {
        router.push(`/nueva/incidencia?fecha=${formFecha}`);
        setModalCrear(false);
        return;
      }

      const ref = await addDoc(collection(db, 'eventos_calendario'), {
        comunidad_id: comunidadId,
        titulo: formTitulo.trim(),
        descripcion: formDescripcion.trim() || null,
        tipo: formTipo,
        fecha: fechaISO,
        created_by: user.uid,
        created_at: new Date().toISOString(),
      });

      void crearNotificacionComunidad(comunidadId, {
        tipo: 'anuncio',
        titulo: formTitulo.trim(),
        mensaje: formTipo === 'reunion'
          ? `Nueva reunion programada para ${format(new Date(fechaISO), "d 'de' MMMM", { locale: es })}`
          : `Nuevo evento: ${formTitulo.trim()}`,
        created_by: user.uid,
        related_id: ref.id,
        link: '/comunidad/calendario',
      });

      fetch('/api/notificaciones/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comunidad_id: comunidadId,
          title: formTipo === 'reunion' ? 'Nueva reunion' : 'Nuevo evento',
          body: formTitulo.trim(),
          url: '/comunidad/calendario',
        }),
      }).catch(() => {});

      toast.success('Evento creado');
      setModalCrear(false);
      await fetchEventos(comunidadId);
    } catch {
      toast.error('Error al crear el evento');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEditar() {
    if (!modalEditar || !comunidadId) return;
    if (!formTitulo.trim()) { toast.error('El titulo es obligatorio'); return; }

    setSubmitting(true);
    try {
      const fechaISO = new Date(formFecha + 'T12:00:00').toISOString();
      await updateDoc(doc(db, 'eventos_calendario', modalEditar.id), {
        titulo: formTitulo.trim(),
        descripcion: formDescripcion.trim() || null,
        tipo: formTipo,
        fecha: fechaISO,
        updated_at: new Date().toISOString(),
      });
      toast.success('Evento actualizado');
      setModalEditar(null);
      await fetchEventos(comunidadId);
    } catch {
      toast.error('Error al actualizar');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEliminar(evt: CalendarioEvent) {
    if (!comunidadId) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'eventos_calendario', evt.id));
      toast.success('Evento eliminado');
      setModalDetalle(null);
      setModalEditar(null);
      await fetchEventos(comunidadId);
    } catch {
      toast.error('Error al eliminar');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="px-4 py-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="w-8 h-8 -ml-1" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-finca-dark dark:text-white">Calendario</h1>
          <p className="text-xs text-muted-foreground">Reuniones, cuotas, votaciones, incidencias</p>
        </div>
        {esAdmin && (
          <Button
            size="sm"
            className="bg-finca-coral hover:bg-finca-coral/90 text-white rounded-full gap-1"
            onClick={() => {
              const dia = diaSeleccionado || new Date();
              abrirModalCrear(dia);
            }}
          >
            <Plus className="w-4 h-4" />
            Crear
          </Button>
        )}
      </div>

      {/* Month navigation */}
      <Card className="border-0 shadow-sm dark:bg-card">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <Button variant="ghost" size="icon" onClick={() => setMes(m => subMonths(m, 1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <h2 className="font-semibold text-finca-dark dark:text-white capitalize">
              {format(mes, 'MMMM yyyy', { locale: es })}
            </h2>
            <Button variant="ghost" size="icon" onClick={() => setMes(m => addMonths(m, 1))}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-2">
            {['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'].map(d => (
              <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1">{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: diasVacios }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {diasDelMes.map(dia => {
              const evtsDia = eventos.filter(e => isSameDay(e.fecha, dia));
              const seleccionado = diaSeleccionado && isSameDay(dia, diaSeleccionado);
              return (
                <button
                  key={dia.toISOString()}
                  onClick={() => seleccionarDia(dia)}
                  className={cn(
                    'relative flex flex-col items-center justify-start rounded-xl p-1 min-h-[40px] transition-all text-sm',
                    isToday(dia) && 'bg-finca-coral text-white font-bold',
                    seleccionado && !isToday(dia) && 'bg-finca-peach/40 ring-2 ring-finca-coral dark:bg-finca-coral/20',
                    !isToday(dia) && !seleccionado && 'hover:bg-muted',
                  )}
                >
                  <span className={cn('text-xs', isToday(dia) ? 'text-white' : 'text-finca-dark dark:text-white')}>
                    {format(dia, 'd')}
                  </span>
                  {evtsDia.length > 0 && (
                    <div className="flex gap-0.5 mt-0.5 flex-wrap justify-center">
                      {evtsDia.slice(0, 3).map((e, i) => (
                        <span
                          key={i}
                          className={cn('w-1.5 h-1.5 rounded-full', isToday(dia) ? 'bg-white' : TIPO_CONFIG[e.tipo]?.colorDot || 'bg-gray-400')}
                        />
                      ))}
                      {evtsDia.length > 3 && (
                        <span className="text-[8px] text-muted-foreground">+{evtsDia.length - 3}</span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Leyenda */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {Object.entries(TIPO_CONFIG).map(([key, cfg]) => (
          <span key={key} className="flex items-center gap-1">
            <span className={cn('w-2 h-2 rounded-full inline-block', cfg.colorDot)} />
            {cfg.label}
          </span>
        ))}
      </div>

      {loading && (
        <p className="text-xs text-muted-foreground text-center py-2">Cargando eventos...</p>
      )}

      {/* Panel del dia seleccionado */}
      {diaSeleccionado && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-finca-dark dark:text-white">
              {format(diaSeleccionado, "EEEE d 'de' MMMM", { locale: es })}
            </h3>
            <button
              onClick={() => setDiaSeleccionado(null)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {eventosDelDia.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Sin eventos este dia
              {esAdmin && ' — toca un dia para crear uno.'}
            </p>
          ) : (
            eventosDelDia.map(evt => {
              const cfg = TIPO_CONFIG[evt.tipo] || TIPO_CONFIG.evento;
              const Icon = cfg.icon;
              return (
                <Card
                  key={evt.id}
                  className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow dark:bg-card"
                  onClick={() => setModalDetalle(evt)}
                >
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', cfg.color)}>
                      <Icon className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-finca-dark dark:text-white truncate">{evt.titulo}</p>
                      <Badge className="text-[10px] mt-0.5 bg-muted text-muted-foreground border-0">
                        {cfg.label}
                      </Badge>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}

      {/* ─── MODAL CREAR EVENTO ─── */}
      <Dialog open={modalCrear} onOpenChange={setModalCrear}>
        <DialogContent className="max-w-[92vw] rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-finca-dark dark:text-white">Crear evento</DialogTitle>
            <DialogDescription>
              {formFecha && format(new Date(formFecha + 'T12:00:00'), "EEEE d 'de' MMMM yyyy", { locale: es })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Tipo */}
            <div className="space-y-1.5">
              <Label>Tipo de evento</Label>
              <div className="grid grid-cols-3 gap-2">
                {(['reunion', 'cuota', 'votacion', 'incidencia', 'evento'] as TipoEvento[]).map(t => {
                  const cfg = TIPO_CONFIG[t];
                  const Icon = cfg.icon;
                  const selected = formTipo === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setFormTipo(t)}
                      className={cn(
                        'flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all text-xs font-medium',
                        selected
                          ? `${cfg.color} text-white border-transparent shadow-sm`
                          : 'bg-muted/50 hover:bg-muted border-transparent text-muted-foreground',
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Titulo */}
            <div className="space-y-1.5">
              <Label htmlFor="titulo">Titulo</Label>
              <Input
                id="titulo"
                placeholder={formTipo === 'reunion' ? 'Ej: Junta ordinaria' : 'Titulo del evento'}
                value={formTitulo}
                onChange={e => setFormTitulo(e.target.value)}
              />
            </div>

            {/* Fecha */}
            <div className="space-y-1.5">
              <Label htmlFor="fecha">Fecha</Label>
              <Input
                id="fecha"
                type="date"
                value={formFecha}
                onChange={e => setFormFecha(e.target.value)}
              />
            </div>

            {/* Descripcion - solo para reunion/evento */}
            {(formTipo === 'reunion' || formTipo === 'evento') && (
              <div className="space-y-1.5">
                <Label htmlFor="desc">Descripcion (opcional)</Label>
                <Textarea
                  id="desc"
                  placeholder="Detalles del evento..."
                  value={formDescripcion}
                  onChange={e => setFormDescripcion(e.target.value)}
                  rows={3}
                />
              </div>
            )}

            {/* Aviso para tipos que redirigen */}
            {(formTipo === 'cuota' || formTipo === 'votacion' || formTipo === 'incidencia') && (
              <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded-lg">
                Al crear {formTipo === 'cuota' ? 'una cuota' : formTipo === 'votacion' ? 'una votacion' : 'una incidencia'}, se abrira el formulario completo con la fecha pre-seleccionada.
              </p>
            )}

            <Button
              className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white"
              onClick={handleCrear}
              disabled={submitting}
            >
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {formTipo === 'reunion' || formTipo === 'evento' ? 'Crear evento' : `Ir a crear ${TIPO_CONFIG[formTipo].label.toLowerCase()}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL DETALLE EVENTO ─── */}
      <Dialog open={!!modalDetalle} onOpenChange={() => setModalDetalle(null)}>
        <DialogContent className="max-w-[92vw] rounded-2xl sm:max-w-md">
          {modalDetalle && (() => {
            const cfg = TIPO_CONFIG[modalDetalle.tipo] || TIPO_CONFIG.evento;
            const Icon = cfg.icon;
            return (
              <>
                <DialogHeader>
                  <div className="flex items-center gap-3">
                    <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', cfg.color)}>
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <DialogTitle className="text-finca-dark dark:text-white">{modalDetalle.titulo}</DialogTitle>
                      <DialogDescription>
                        <Badge className={cn('text-[10px] mt-1', cfg.color, 'text-white border-0')}>
                          {cfg.label}
                        </Badge>
                      </DialogDescription>
                    </div>
                  </div>
                </DialogHeader>

                <div className="space-y-3 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CalendarIcon className="w-4 h-4" />
                    {format(modalDetalle.fecha, "EEEE d 'de' MMMM yyyy", { locale: es })}
                  </div>

                  {modalDetalle.descripcion && (
                    <div className="bg-muted/50 p-3 rounded-lg text-muted-foreground">
                      {modalDetalle.descripcion}
                    </div>
                  )}

                  <div className="flex gap-2 pt-2">
                    {modalDetalle.url && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => { setModalDetalle(null); router.push(modalDetalle.url!); }}
                      >
                        <FileText className="w-4 h-4 mr-1" />
                        Ver en modulo
                      </Button>
                    )}
                    {modalDetalle.editable && esAdmin && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => abrirModalEditar(modalDetalle)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-500 hover:text-red-600 hover:bg-red-50"
                          onClick={() => handleEliminar(modalDetalle)}
                          disabled={deleting}
                        >
                          {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ─── MODAL EDITAR EVENTO ─── */}
      <Dialog open={!!modalEditar} onOpenChange={() => setModalEditar(null)}>
        <DialogContent className="max-w-[92vw] rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-finca-dark dark:text-white">Editar evento</DialogTitle>
            <DialogDescription>Modifica los datos del evento</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <div className="grid grid-cols-2 gap-2">
                {(['reunion', 'evento'] as TipoEvento[]).map(t => {
                  const cfg = TIPO_CONFIG[t];
                  const Icon = cfg.icon;
                  const selected = formTipo === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setFormTipo(t)}
                      className={cn(
                        'flex items-center justify-center gap-2 p-2.5 rounded-xl border transition-all text-xs font-medium',
                        selected
                          ? `${cfg.color} text-white border-transparent`
                          : 'bg-muted/50 hover:bg-muted border-transparent text-muted-foreground',
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-titulo">Titulo</Label>
              <Input
                id="edit-titulo"
                value={formTitulo}
                onChange={e => setFormTitulo(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-fecha">Fecha</Label>
              <Input
                id="edit-fecha"
                type="date"
                value={formFecha}
                onChange={e => setFormFecha(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-desc">Descripcion (opcional)</Label>
              <Textarea
                id="edit-desc"
                value={formDescripcion}
                onChange={e => setFormDescripcion(e.target.value)}
                rows={3}
              />
            </div>

            <div className="flex gap-2">
              <Button
                className="flex-1 bg-finca-coral hover:bg-finca-coral/90 text-white"
                onClick={handleEditar}
                disabled={submitting}
              >
                {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Guardar cambios
              </Button>
              {modalEditar && (
                <Button
                  variant="outline"
                  className="text-red-500 hover:text-red-600 hover:bg-red-50"
                  onClick={() => handleEliminar(modalEditar)}
                  disabled={deleting}
                >
                  {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
