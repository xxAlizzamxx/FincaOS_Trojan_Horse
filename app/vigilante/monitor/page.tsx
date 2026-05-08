'use client';

/**
 * Centro de Monitoreo — Modo Operador
 *
 * Feed unificado en tiempo real de todas las colecciones del vigilante:
 * accesos · paquetería · alertas · bitácora · chats
 *
 * Stats en vivo + acciones rápidas directamente desde el feed.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  collection, query, where, onSnapshot, orderBy, limit,
  doc, updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  DoorOpen, Package, AlertTriangle, MessageSquare, ClipboardList,
  CheckCircle2, XCircle, Bell, ShieldAlert, Activity,
  Users, Clock, Wifi, Circle, ChevronRight, Wrench,
  Droplets, Flame, Volume2, Car, Info, MapPin,
} from 'lucide-react';

// ── Tipos ────────────────────────────────────────────────────────────────────

type EventoTipo = 'acceso' | 'paquete' | 'alerta' | 'bitacora' | 'chat';

interface EventoFeed {
  id:        string;
  tipo:      EventoTipo;
  titulo:    string;
  subtitulo?: string;
  ts:        number;
  estado?:   string;
  prioridad?: string;
  // datos originales para acciones rápidas
  raw:       Record<string, any>;
}

interface Stats {
  accesosEsperando: number;
  paquetesPendientes: number;
  alertasActivas: number;
  chatsNoLeidos: number;
  vecinosTotales: number;
}

// ── Config visual por tipo de evento ────────────────────────────────────────

const TIPO_CONFIG: Record<EventoTipo, { icon: React.ElementType; bg: string; text: string; label: string }> = {
  acceso:   { icon: DoorOpen,       bg: 'bg-blue-50',    text: 'text-blue-600',    label: 'Acceso'    },
  paquete:  { icon: Package,        bg: 'bg-amber-50',   text: 'text-amber-600',   label: 'Paquete'   },
  alerta:   { icon: AlertTriangle,  bg: 'bg-red-50',     text: 'text-red-600',     label: 'Alerta'    },
  bitacora: { icon: ClipboardList,  bg: 'bg-purple-50',  text: 'text-purple-600',  label: 'Bitácora'  },
  chat:     { icon: MessageSquare,  bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'Mensaje'   },
};

const ALERTA_ICONS: Record<string, React.ElementType> = {
  emergencia:    ShieldAlert,
  mantenimiento: Wrench,
  agua:          Droplets,
  gas:           Flame,
  ruido:         Volume2,
  vehiculo:      Car,
  informativa:   Info,
};

const ESTADO_ACCESO: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  esperando:  { label: 'Esperando',  color: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: Clock         },
  autorizado: { label: 'Autorizado', color: 'bg-green-100 text-green-700 border-green-200',   icon: CheckCircle2  },
  rechazado:  { label: 'Rechazado',  color: 'bg-red-100 text-red-700 border-red-200',         icon: XCircle       },
};

// ── Componente principal ─────────────────────────────────────────────────────

export default function MonitorPage() {
  const { perfil, user } = useAuth();
  const router = useRouter();

  const [feed, setFeed] = useState<EventoFeed[]>([]);
  const [stats, setStats] = useState<Stats>({
    accesosEsperando:   0,
    paquetesPendientes: 0,
    alertasActivas:     0,
    chatsNoLeidos:      0,
    vecinosTotales:     0,
  });
  const [enVivo, setEnVivo] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const comunidadId = perfil?.comunidad_id;

  // ── Merge helper ─────────────────────────────────────────────────────────
  // Cada colección actualiza su slice; mergeMaps las combina y setFeed
  const slices = {
    accesos:   [] as EventoFeed[],
    paquetes:  [] as EventoFeed[],
    alertas:   [] as EventoFeed[],
    bitacora:  [] as EventoFeed[],
    chats:     [] as EventoFeed[],
  };

  const merge = useCallback(() => {
    const all = [
      ...slices.accesos,
      ...slices.paquetes,
      ...slices.alertas,
      ...slices.bitacora,
      ...slices.chats,
    ].sort((a, b) => b.ts - a.ts).slice(0, 40);
    setFeed(all);
    setLastUpdate(new Date());
    setEnVivo(true);
  }, []); // eslint-disable-line

  // ── Subscriptions ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!comunidadId || !user?.uid) return;

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const unsubs: (() => void)[] = [];

    // 1. ACCESOS — últimos 20 del día
    unsubs.push(onSnapshot(
      query(
        collection(db, 'accesos'),
        where('comunidad_id', '==', comunidadId),
        where('hora_entrada', '>=', hoy.toISOString()),
        orderBy('hora_entrada', 'desc'),
        limit(20),
      ),
      (snap) => {
        // Stats: cuántos esperando
        const esperando = snap.docs.filter(d => d.data().estado === 'esperando').length;
        setStats(prev => ({ ...prev, accesosEsperando: esperando }));

        slices.accesos = snap.docs.map(d => {
          const data = d.data();
          const ts   = new Date(data.hora_entrada).getTime();
          return {
            id:        d.id,
            tipo:      'acceso' as EventoTipo,
            titulo:    `${data.visitante_nombre}  →  ${data.apartamento_destino}`,
            subtitulo: [data.tipo, data.motivo].filter(Boolean).join(' · '),
            ts,
            estado:    data.estado,
            raw:       { ...data, _id: d.id },
          };
        });
        merge();
      },
      () => {},
    ));

    // 2. PAQUETES — pendientes
    unsubs.push(onSnapshot(
      query(
        collection(db, 'paqueteria'),
        where('comunidad_id', '==', comunidadId),
        orderBy('created_at', 'desc'),
        limit(20),
      ),
      (snap) => {
        const pendientes = snap.docs.filter(d =>
          ['recibido', 'notificado'].includes(d.data().estado),
        ).length;
        setStats(prev => ({ ...prev, paquetesPendientes: pendientes }));

        slices.paquetes = snap.docs.map(d => {
          const data = d.data();
          const ts   = new Date(data.created_at).getTime();
          const tipo = data.tipo === 'recibo' ? `Recibo${data.recibo_tipo ? ` (${data.recibo_tipo})` : ''}` : data.tipo;
          return {
            id:        d.id,
            tipo:      'paquete' as EventoTipo,
            titulo:    `${data.destinatario_nombre}  ·  Apto ${data.apartamento}`,
            subtitulo: `${tipo}${data.remitente ? ` · ${data.remitente}` : ''}`,
            ts,
            estado:    data.estado,
            raw:       { ...data, _id: d.id },
          };
        });
        merge();
      },
      () => {},
    ));

    // 3. ALERTAS — activas
    unsubs.push(onSnapshot(
      query(
        collection(db, 'alertas_comunidad'),
        where('comunidad_id', '==', comunidadId),
        orderBy('created_at', 'desc'),
        limit(15),
      ),
      (snap) => {
        const activas = snap.docs.filter(d => d.data().activa).length;
        setStats(prev => ({ ...prev, alertasActivas: activas }));

        slices.alertas = snap.docs.map(d => {
          const data = d.data();
          const ts   = new Date(data.created_at).getTime();
          return {
            id:        d.id,
            tipo:      'alerta' as EventoTipo,
            titulo:    data.titulo,
            subtitulo: data.descripcion?.slice(0, 80),
            ts,
            prioridad: data.prioridad,
            estado:    data.activa ? 'activa' : 'inactiva',
            raw:       { ...data, _id: d.id },
          };
        });
        merge();
      },
      () => {},
    ));

    // 4. BITÁCORA — últimas entradas
    unsubs.push(onSnapshot(
      query(
        collection(db, 'bitacora_vigilancia'),
        where('comunidad_id', '==', comunidadId),
        orderBy('created_at', 'desc'),
        limit(10),
      ),
      (snap) => {
        slices.bitacora = snap.docs.map(d => {
          const data = d.data();
          const ts   = new Date(data.created_at).getTime();
          return {
            id:        d.id,
            tipo:      'bitacora' as EventoTipo,
            titulo:    data.titulo,
            subtitulo: `${data.tipo} · ${data.vigilante_nombre}`,
            ts,
            raw:       { ...data, _id: d.id },
          };
        });
        merge();
      },
      () => {},
    ));

    // 5. CHATS — mensajes no leídos
    unsubs.push(onSnapshot(
      query(
        collection(db, 'chats_vigilancia'),
        where('comunidad_id', '==', comunidadId),
        where('vigilante_id', '==', user.uid),
        orderBy('updated_at', 'desc'),
        limit(10),
      ),
      (snap) => {
        const noLeidos = snap.docs.reduce((s, d) => s + (d.data().no_leidos_vigilante || 0), 0);
        setStats(prev => ({ ...prev, chatsNoLeidos: noLeidos }));

        slices.chats = snap.docs
          .filter(d => d.data().ultimo_mensaje)
          .map(d => {
            const data = d.data();
            const ts   = new Date(data.updated_at).getTime();
            return {
              id:        d.id,
              tipo:      'chat' as EventoTipo,
              titulo:    data.vecino_nombre,
              subtitulo: data.ultimo_mensaje?.slice(0, 80),
              ts,
              estado:    data.no_leidos_vigilante > 0 ? 'no_leido' : 'leido',
              raw:       { ...data, _id: d.id },
            };
          });
        merge();
      },
      () => {},
    ));

    // 6. VECINOS — conteo
    unsubs.push(onSnapshot(
      query(collection(db, 'perfiles'), where('comunidad_id', '==', comunidadId)),
      (snap) => setStats(prev => ({ ...prev, vecinosTotales: snap.size })),
      () => {},
    ));

    return () => unsubs.forEach(u => u());
  }, [comunidadId, user?.uid]); // eslint-disable-line

  // ── Acciones rápidas ──────────────────────────────────────────────────────
  async function autorizarAcceso(accesoId: string, decision: 'autorizado' | 'rechazado') {
    try {
      await updateDoc(doc(db, 'accesos', accesoId), {
        estado:        decision,
        respondido_at: new Date().toISOString(),
      });
      toast.success(decision === 'autorizado' ? '✅ Acceso autorizado' : '❌ Acceso rechazado');
    } catch {
      toast.error('Error al actualizar acceso');
    }
  }

  async function marcarEntregado(paqueteId: string) {
    try {
      await updateDoc(doc(db, 'paqueteria', paqueteId), {
        estado:       'entregado',
        entregado_at: new Date().toISOString(),
      });
      toast.success('📦 Paquete marcado como entregado');
    } catch {
      toast.error('Error al actualizar paquete');
    }
  }

  async function desactivarAlerta(alertaId: string) {
    try {
      await updateDoc(doc(db, 'alertas_comunidad', alertaId), { activa: false });
      toast.success('Alerta desactivada');
    } catch {
      toast.error('Error al desactivar alerta');
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  function AccionesAcceso({ evento }: { evento: EventoFeed }) {
    const { _id, estado } = evento.raw;
    if (estado !== 'esperando') return null;
    return (
      <div className="flex gap-1.5 mt-2">
        <Button
          size="sm"
          className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
          onClick={(e) => { e.stopPropagation(); autorizarAcceso(_id, 'autorizado'); }}
        >
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Autorizar
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-red-300 text-red-600 hover:bg-red-50"
          onClick={(e) => { e.stopPropagation(); autorizarAcceso(_id, 'rechazado'); }}
        >
          <XCircle className="w-3 h-3 mr-1" />
          Rechazar
        </Button>
      </div>
    );
  }

  function AccionesPaquete({ evento }: { evento: EventoFeed }) {
    const { _id, estado } = evento.raw;
    if (estado === 'entregado') return null;
    return (
      <div className="flex gap-1.5 mt-2">
        <Button
          size="sm"
          className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
          onClick={(e) => { e.stopPropagation(); marcarEntregado(_id); }}
        >
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Entregar
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={(e) => { e.stopPropagation(); router.push('/vigilante/paqueteria'); }}
        >
          Ver detalle
        </Button>
      </div>
    );
  }

  function AccionesAlerta({ evento }: { evento: EventoFeed }) {
    const { _id, activa } = evento.raw;
    if (!activa) return null;
    return (
      <div className="flex gap-1.5 mt-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-red-300 text-red-600 hover:bg-red-50"
          onClick={(e) => { e.stopPropagation(); desactivarAlerta(_id); }}
        >
          Desactivar alerta
        </Button>
      </div>
    );
  }

  // ── Badge de estado para cada tipo ───────────────────────────────────────

  function EstadoBadge({ evento }: { evento: EventoFeed }) {
    if (evento.tipo === 'acceso' && evento.estado) {
      const cfg = ESTADO_ACCESO[evento.estado] ?? ESTADO_ACCESO.esperando;
      const Ic  = cfg.icon;
      return (
        <Badge className={cn('text-[10px] border shrink-0', cfg.color)}>
          <Ic className="w-2.5 h-2.5 mr-0.5" />
          {cfg.label}
        </Badge>
      );
    }
    if (evento.tipo === 'paquete' && evento.estado) {
      const colors: Record<string, string> = {
        recibido:   'bg-amber-100 text-amber-700 border-amber-200',
        notificado: 'bg-blue-100 text-blue-700 border-blue-200',
        entregado:  'bg-green-100 text-green-700 border-green-200',
      };
      return (
        <Badge className={cn('text-[10px] border shrink-0', colors[evento.estado] ?? colors.recibido)}>
          {evento.estado === 'recibido' ? 'En portería' : evento.estado === 'notificado' ? 'Notificado' : 'Entregado'}
        </Badge>
      );
    }
    if (evento.tipo === 'alerta' && evento.prioridad) {
      const colors: Record<string, string> = {
        urgente: 'bg-red-100 text-red-700 border-red-200',
        alta:    'bg-orange-100 text-orange-700 border-orange-200',
        media:   'bg-yellow-100 text-yellow-700 border-yellow-200',
        baja:    'bg-green-100 text-green-700 border-green-200',
      };
      return (
        <Badge className={cn('text-[10px] border shrink-0 capitalize', colors[evento.prioridad] ?? colors.media)}>
          {evento.prioridad}
        </Badge>
      );
    }
    if (evento.tipo === 'chat' && evento.estado === 'no_leido') {
      return (
        <Badge className="text-[10px] border shrink-0 bg-emerald-100 text-emerald-700 border-emerald-200">
          Nuevo
        </Badge>
      );
    }
    return null;
  }

  // ── Icono principal del evento ────────────────────────────────────────────
  function EventoIcon({ evento }: { evento: EventoFeed }) {
    const cfg = TIPO_CONFIG[evento.tipo];
    let IconComp: React.ElementType = cfg.icon;

    // Para alertas usar icono específico del tipo
    if (evento.tipo === 'alerta' && evento.raw.tipo) {
      IconComp = ALERTA_ICONS[evento.raw.tipo] ?? AlertTriangle;
    }

    return (
      <div className={cn(
        'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
        cfg.bg,
        // Borde rojo para urgente
        evento.prioridad === 'urgente' && 'ring-2 ring-red-400',
      )}>
        <IconComp className={cn('w-5 h-5', cfg.text)} />
      </div>
    );
  }

  // ── Stats widgets ─────────────────────────────────────────────────────────
  const statWidgets = [
    {
      label: 'Esperando acceso',
      value: stats.accesosEsperando,
      icon:  DoorOpen,
      bg:    'bg-blue-50',
      text:  'text-blue-600',
      href:  '/vigilante/accesos',
      pulse: stats.accesosEsperando > 0,
    },
    {
      label: 'Paquetes en portería',
      value: stats.paquetesPendientes,
      icon:  Package,
      bg:    'bg-amber-50',
      text:  'text-amber-600',
      href:  '/vigilante/paqueteria',
      pulse: false,
    },
    {
      label: 'Alertas activas',
      value: stats.alertasActivas,
      icon:  AlertTriangle,
      bg:    'bg-red-50',
      text:  'text-red-600',
      href:  '/vigilante/alertas',
      pulse: stats.alertasActivas > 0,
    },
    {
      label: 'Mensajes no leídos',
      value: stats.chatsNoLeidos,
      icon:  MessageSquare,
      bg:    'bg-emerald-50',
      text:  'text-emerald-600',
      href:  '/vigilante/chats',
      pulse: stats.chatsNoLeidos > 0,
    },
    {
      label: 'Residentes',
      value: stats.vecinosTotales,
      icon:  Users,
      bg:    'bg-violet-50',
      text:  'text-violet-600',
      href:  '#',
      pulse: false,
    },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 max-w-5xl">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-finca-dark flex items-center gap-2">
            Centro de Monitoreo
            <span className={cn(
              'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full',
              enVivo
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-500',
            )}>
              <Circle className={cn('w-2 h-2 fill-current', enVivo ? 'text-green-500 animate-pulse' : 'text-gray-400')} />
              {enVivo ? 'En vivo' : 'Conectando...'}
            </span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Última actualización: {format(lastUpdate, 'HH:mm:ss', { locale: es })}
          </p>
        </div>

        {/* Acceso rápido emergencia */}
        <Button
          className="bg-red-600 hover:bg-red-700 text-white text-xs h-9 shadow-md shadow-red-600/30"
          onClick={() => router.push('/vigilante/alertas?tipo=emergencia')}
        >
          <ShieldAlert className="w-4 h-4 mr-1.5" />
          Emergencia
        </Button>
      </div>

      {/* ── Stats widgets ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {statWidgets.map((w) => (
          <Link
            key={w.label}
            href={w.href}
            className={w.href === '#' ? 'pointer-events-none' : ''}
          >
            <Card className={cn(
              'border-0 shadow-sm transition-all hover:shadow-md active:scale-[0.98]',
              w.pulse && 'ring-2 ring-offset-1 ring-finca-coral/50',
            )}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', w.bg)}>
                    <w.icon className={cn('w-4 h-4', w.text)} />
                  </div>
                  {w.pulse && (
                    <span className="w-2 h-2 rounded-full bg-finca-coral animate-pulse" />
                  )}
                </div>
                <p className="text-2xl font-bold text-finca-dark">{w.value}</p>
                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{w.label}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* ── Feed en vivo ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-finca-dark flex items-center gap-2">
            <Activity className="w-4 h-4 text-finca-coral" />
            Feed en vivo
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {feed.length} eventos
            </span>
            {/* Leyenda */}
            <div className="hidden md:flex items-center gap-3 text-[10px] text-muted-foreground">
              {(Object.entries(TIPO_CONFIG) as [EventoTipo, typeof TIPO_CONFIG[EventoTipo]][]).map(([tipo, cfg]) => (
                <span key={tipo} className="flex items-center gap-1">
                  <cfg.icon className={cn('w-3 h-3', cfg.text)} />
                  {cfg.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        {feed.length === 0 ? (
          <Card className="border-dashed border-2">
            <CardContent className="py-16 text-center space-y-3">
              <Wifi className="w-12 h-12 text-muted-foreground/20 mx-auto" />
              <p className="text-sm font-medium text-finca-dark">Conectando al feed en vivo...</p>
              <p className="text-xs text-muted-foreground">Los eventos aparecerán aquí en tiempo real</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {feed.map((evento) => {
              const cfg    = TIPO_CONFIG[evento.tipo];
              const isUrgente = evento.prioridad === 'urgente';
              const href = evento.tipo === 'acceso'
                ? '/vigilante/accesos'
                : evento.tipo === 'paquete'
                ? '/vigilante/paqueteria'
                : evento.tipo === 'alerta'
                ? '/vigilante/alertas'
                : evento.tipo === 'bitacora'
                ? '/vigilante/bitacora'
                : `/vigilante/chats`;

              return (
                <Card
                  key={`${evento.tipo}-${evento.id}`}
                  className={cn(
                    'border-0 shadow-sm transition-all',
                    isUrgente && 'border-l-4 border-l-red-500',
                    evento.tipo === 'acceso' && evento.estado === 'esperando' && 'border-l-4 border-l-yellow-400',
                    evento.tipo === 'chat' && evento.estado === 'no_leido' && 'border-l-4 border-l-emerald-500',
                  )}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start gap-3">

                      {/* Icono */}
                      <EventoIcon evento={evento} />

                      {/* Contenido */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Label tipo */}
                          <span className={cn('text-[10px] font-semibold uppercase tracking-wide', cfg.text)}>
                            {cfg.label}
                          </span>
                          {/* Estado badge */}
                          <EstadoBadge evento={evento} />
                        </div>

                        <p className="text-sm font-medium text-finca-dark mt-0.5 leading-snug">
                          {evento.titulo}
                        </p>

                        {evento.subtitulo && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {evento.subtitulo}
                          </p>
                        )}

                        {/* Acciones rápidas según tipo */}
                        {evento.tipo === 'acceso'  && <AccionesAcceso  evento={evento} />}
                        {evento.tipo === 'paquete' && <AccionesPaquete evento={evento} />}
                        {evento.tipo === 'alerta'  && <AccionesAlerta  evento={evento} />}
                        {evento.tipo === 'chat' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs mt-2"
                            onClick={() => router.push('/vigilante/chats')}
                          >
                            <MessageSquare className="w-3 h-3 mr-1" />
                            Abrir chat
                          </Button>
                        )}
                      </div>

                      {/* Timestamp + enlace */}
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {formatDistanceToNow(new Date(evento.ts), { addSuffix: true, locale: es })}
                        </span>
                        <Link
                          href={href}
                          className="text-[10px] text-finca-coral hover:underline flex items-center gap-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Ver más
                          <ChevronRight className="w-2.5 h-2.5" />
                        </Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Accesos rápidos a secciones ── */}
      <div>
        <h2 className="font-semibold text-finca-dark mb-3 flex items-center gap-2">
          <MapPin className="w-4 h-4 text-finca-coral" />
          Ir a sección
        </h2>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {[
            { href: '/vigilante/accesos',    icon: DoorOpen,      label: 'Accesos',   color: 'bg-blue-500'    },
            { href: '/vigilante/paqueteria', icon: Package,       label: 'Paquetería', color: 'bg-amber-500'  },
            { href: '/vigilante/alertas',    icon: AlertTriangle, label: 'Alertas',   color: 'bg-red-500'     },
            { href: '/vigilante/chats',      icon: MessageSquare, label: 'Chats',     color: 'bg-emerald-500' },
            { href: '/vigilante/bitacora',   icon: ClipboardList, label: 'Bitácora',  color: 'bg-purple-500'  },
            { href: '/vigilante',            icon: Activity,      label: 'Dashboard', color: 'bg-finca-coral' },
          ].map((item) => (
            <Link key={item.href} href={item.href}>
              <Card className="border-0 shadow-sm hover:shadow-md active:scale-95 transition-all cursor-pointer">
                <CardContent className="p-3 flex flex-col items-center gap-1.5 text-center">
                  <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', item.color)}>
                    <item.icon className="w-4 h-4 text-white" />
                  </div>
                  <p className="text-[11px] font-medium text-finca-dark">{item.label}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

    </div>
  );
}
