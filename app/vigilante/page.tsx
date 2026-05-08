'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Package, DoorOpen, AlertTriangle, MessageSquare, ClipboardList,
  ShieldAlert, Phone, Bell, Clock, Users, Activity,
} from 'lucide-react';
import { collection, query, where, getDocs, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export default function VigilanteDashboard() {
  const { perfil, user } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    paquetesPendientes: 0,
    visitasHoy: 0,
    alertasActivas: 0,
    chatsNoLeidos: 0,
    incidenciasAbiertas: 0,
    vecinos: 0,
  });
  const [actividadReciente, setActividadReciente] = useState<Array<{
    tipo: 'acceso' | 'paquete' | 'alerta' | 'info';
    texto: string;
    hora: string;
    ts: number;
  }>>();

  const comunidadId = perfil?.comunidad_id;

  useEffect(() => {
    if (!comunidadId || !user?.uid) return;

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    // ── Stats en tiempo real con onSnapshot ──────────────────────────────────
    const unsubs: (() => void)[] = [];

    // 1. Paquetes pendientes
    unsubs.push(onSnapshot(
      query(collection(db, 'paqueteria'), where('comunidad_id', '==', comunidadId), where('estado', 'in', ['recibido', 'notificado'])),
      (s) => setStats(prev => ({ ...prev, paquetesPendientes: s.size })),
      () => {},
    ));

    // 2. Visitas de hoy
    unsubs.push(onSnapshot(
      query(collection(db, 'accesos'), where('comunidad_id', '==', comunidadId), where('hora_entrada', '>=', hoy.toISOString())),
      (s) => setStats(prev => ({ ...prev, visitasHoy: s.size })),
      () => {},
    ));

    // 3. Alertas activas
    unsubs.push(onSnapshot(
      query(collection(db, 'alertas_comunidad'), where('comunidad_id', '==', comunidadId), where('activa', '==', true)),
      (s) => setStats(prev => ({ ...prev, alertasActivas: s.size })),
      () => {},
    ));

    // 4. Incidencias abiertas (one-time OK — not super-dynamic)
    getDocs(query(collection(db, 'incidencias'), where('comunidad_id', '==', comunidadId)))
      .then(s => {
        const abiertas = s.docs.filter(d => !['resuelta', 'cerrada'].includes(d.data().estado)).length;
        setStats(prev => ({ ...prev, incidenciasAbiertas: abiertas }));
      }).catch(() => {});

    // 5. Vecinos (one-time)
    getDocs(query(collection(db, 'perfiles'), where('comunidad_id', '==', comunidadId)))
      .then(s => setStats(prev => ({ ...prev, vecinos: s.size })))
      .catch(() => {});

    // ── Actividad reciente: combina accesos + paquetes + alertas ─────────────
    type Entry = { tipo: 'acceso' | 'paquete' | 'alerta' | 'info'; texto: string; hora: string; ts: number };
    let accEntries: Entry[] = [];
    let paqEntries: Entry[] = [];
    let alertEntries: Entry[] = [];

    function merge() {
      const all = [...accEntries, ...paqEntries, ...alertEntries]
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 8);
      setActividadReciente(all.length > 0 ? all : undefined);
      setLoading(false);
    }

    unsubs.push(onSnapshot(
      query(collection(db, 'accesos'), where('comunidad_id', '==', comunidadId), orderBy('hora_entrada', 'desc'), limit(5)),
      (s) => {
        accEntries = s.docs.map(d => {
          const data = d.data();
          const ts = new Date(data.hora_entrada).getTime();
          const estado = data.estado === 'autorizado' ? '✅' : data.estado === 'rechazado' ? '❌' : '⏳';
          return { tipo: 'acceso' as const, texto: `${estado} Visita: ${data.visitante_nombre} → ${data.apartamento_destino}`, hora: format(new Date(data.hora_entrada), 'HH:mm', { locale: es }), ts };
        });
        merge();
      },
      () => { setLoading(false); },
    ));

    unsubs.push(onSnapshot(
      query(collection(db, 'paqueteria'), where('comunidad_id', '==', comunidadId), orderBy('created_at', 'desc'), limit(4)),
      (s) => {
        paqEntries = s.docs.map(d => {
          const data = d.data();
          const ts = new Date(data.created_at).getTime();
          const emoji = data.tipo === 'recibo' ? '📄' : data.tipo === 'domicilio' ? '🛵' : '📦';
          return { tipo: 'paquete' as const, texto: `${emoji} ${data.tipo === 'recibo' ? 'Recibo' : 'Paquete'} para ${data.destinatario_nombre}${data.remitente ? ` (${data.remitente})` : ''}`, hora: format(new Date(data.created_at), 'HH:mm', { locale: es }), ts };
        });
        merge();
      },
      () => {},
    ));

    unsubs.push(onSnapshot(
      query(collection(db, 'alertas_comunidad'), where('comunidad_id', '==', comunidadId), orderBy('created_at', 'desc'), limit(3)),
      (s) => {
        alertEntries = s.docs.map(d => {
          const data = d.data();
          const ts = new Date(data.created_at).getTime();
          const emoji = data.prioridad === 'urgente' ? '🚨' : data.prioridad === 'alta' ? '⚠️' : 'ℹ️';
          return { tipo: 'alerta' as const, texto: `${emoji} Alerta: ${data.titulo}`, hora: format(new Date(data.created_at), 'HH:mm', { locale: es }), ts };
        });
        merge();
      },
      () => {},
    ));

    return () => unsubs.forEach(u => u());
  }, [comunidadId, user?.uid]);

  const widgets = [
    { icon: Package,       label: 'Paquetes',      value: stats.paquetesPendientes, color: 'text-amber-600',   bg: 'bg-amber-50',   href: '/vigilante/paqueteria' },
    { icon: DoorOpen,      label: 'Visitas hoy',   value: stats.visitasHoy,         color: 'text-blue-600',    bg: 'bg-blue-50',    href: '/vigilante/accesos'    },
    { icon: AlertTriangle, label: 'Alertas',        value: stats.alertasActivas,     color: 'text-red-600',     bg: 'bg-red-50',     href: '/vigilante/alertas'    },
    { icon: MessageSquare, label: 'Mensajes',       value: stats.chatsNoLeidos,      color: 'text-emerald-600', bg: 'bg-emerald-50', href: '/vigilante/chats'      },
  ];

  const accionesRapidas = [
    { icon: DoorOpen,      label: 'Registrar visita',   sub: 'Control de accesos',       href: '/vigilante/accesos',    color: 'bg-blue-500'    },
    { icon: Package,       label: 'Registrar paquete',  sub: 'Paquetes y recibos',       href: '/vigilante/paqueteria', color: 'bg-amber-500'   },
    { icon: MessageSquare, label: 'Enviar mensaje',     sub: 'Chat con residentes',      href: '/vigilante/chats',      color: 'bg-emerald-500' },
    { icon: AlertTriangle, label: 'Crear alerta',       sub: 'Avisos comunitarios',      href: '/vigilante/alertas',    color: 'bg-orange-500'  },
    { icon: ClipboardList, label: 'Bitacora',           sub: 'Notas del turno',          href: '/vigilante/bitacora',   color: 'bg-purple-500'  },
    { icon: Phone,         label: 'Llamar residente',   sub: 'Proximamente',             href: '#',                     color: 'bg-gray-400'    },
  ];

  if (loading) {
    return (
      <div className="space-y-6 max-w-5xl">
        <div><Skeleton className="h-8 w-56" /><Skeleton className="h-4 w-40 mt-1" /></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => (
            <Card key={i} className="border-0 shadow-sm"><CardContent className="p-4 space-y-3"><Skeleton className="w-9 h-9 rounded-lg" /><Skeleton className="h-7 w-12" /><Skeleton className="h-3 w-16" /></CardContent></Card>
          ))}
        </div>
        <Skeleton className="h-14 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-finca-dark">
          Panel de Vigilancia
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {format(new Date(), "EEEE d 'de' MMMM, yyyy", { locale: es })} — {perfil?.nombre_completo}
        </p>
      </div>

      {/* Boton emergencia */}
      <Button
        className="w-full h-14 bg-red-600 hover:bg-red-700 text-white text-base font-bold shadow-lg shadow-red-600/30 animate-pulse hover:animate-none"
        onClick={() => router.push('/vigilante/alertas?tipo=emergencia')}
      >
        <ShieldAlert className="w-6 h-6 mr-3" />
        ALERTA DE EMERGENCIA
      </Button>

      {/* Stats widgets */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {widgets.map((w) => (
          <Link key={w.label} href={w.href}>
            <Card className="border-0 shadow-sm hover:shadow-md transition-shadow active:scale-[0.98]">
              <CardContent className="p-4">
                <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center mb-3', w.bg)}>
                  <w.icon className={cn('w-5 h-5', w.color)} />
                </div>
                <p className="text-2xl font-bold text-finca-dark">{w.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{w.label}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Info comunidad */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center">
              <Activity className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <p className="text-lg font-bold text-finca-dark">{stats.incidenciasAbiertas}</p>
              <p className="text-xs text-muted-foreground">Incidencias abiertas</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-cyan-50 flex items-center justify-center">
              <Users className="w-5 h-5 text-cyan-600" />
            </div>
            <div>
              <p className="text-lg font-bold text-finca-dark">{stats.vecinos}</p>
              <p className="text-xs text-muted-foreground">Residentes</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Acciones rapidas */}
      <section>
        <h2 className="font-semibold text-finca-dark mb-3">Acciones rapidas</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {accionesRapidas.map((a) => {
            const disabled = a.href === '#';
            return (
              <Link key={a.label} href={a.href} className={disabled ? 'pointer-events-none' : ''}>
                <Card className={cn(
                  'border-0 shadow-sm transition-all',
                  disabled ? 'opacity-50' : 'hover:shadow-md active:scale-[0.98]',
                )}>
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', a.color)}>
                      <a.icon className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-finca-dark">{a.label}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{a.sub}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Actividad reciente */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-finca-dark">Actividad reciente</h2>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" /> En vivo
          </span>
        </div>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            {!actividadReciente || actividadReciente.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">
                No hay actividad registrada aún
              </div>
            ) : (
              actividadReciente.map((act, idx) => {
                const iconBg   = act.tipo === 'alerta' ? 'bg-red-50'    : act.tipo === 'acceso' ? 'bg-blue-50'  : act.tipo === 'paquete' ? 'bg-amber-50' : 'bg-emerald-50';
                const iconColor= act.tipo === 'alerta' ? 'text-red-500' : act.tipo === 'acceso' ? 'text-blue-500': act.tipo === 'paquete' ? 'text-amber-600' : 'text-emerald-600';
                const IconComp = act.tipo === 'alerta' ? AlertTriangle  : act.tipo === 'acceso' ? DoorOpen       : act.tipo === 'paquete' ? Package         : Bell;
                return (
                  <div key={idx} className={cn(
                    'px-4 py-3 flex items-center gap-3',
                    idx < actividadReciente.length - 1 && 'border-b border-border/50',
                  )}>
                    <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', iconBg)}>
                      <IconComp className={cn('w-4 h-4', iconColor)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-finca-dark truncate">{act.texto}</p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{act.hora}</span>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
