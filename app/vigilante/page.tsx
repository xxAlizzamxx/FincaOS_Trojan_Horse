'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Package, DoorOpen, AlertTriangle, MessageSquare, ClipboardList,
  ShieldAlert, ChevronRight, Phone, Bell, Clock, Users, Activity,
} from 'lucide-react';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
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
    tipo: string;
    texto: string;
    hora: string;
    icono: string;
  }>>([]);

  const comunidadId = perfil?.comunidad_id;

  useEffect(() => {
    if (!comunidadId) return;
    fetchDashboardData();
  }, [comunidadId]);

  async function fetchDashboardData() {
    try {
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);

      const [paqSnap, accSnap, alertSnap, chatSnap, incSnap, vecSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'paqueteria'),
          where('comunidad_id', '==', comunidadId),
          where('estado', 'in', ['recibido', 'notificado']),
        )).catch(() => ({ size: 0 })),
        getDocs(query(
          collection(db, 'accesos'),
          where('comunidad_id', '==', comunidadId),
          where('hora_entrada', '>=', hoy.toISOString()),
        )).catch(() => ({ size: 0 })),
        getDocs(query(
          collection(db, 'alertas_comunidad'),
          where('comunidad_id', '==', comunidadId),
          where('activa', '==', true),
        )).catch(() => ({ size: 0 })),
        getDocs(query(
          collection(db, 'chats_vigilancia'),
          where('comunidad_id', '==', comunidadId),
          where('vigilante_id', '==', user?.uid || ''),
        )).catch(() => ({ size: 0, docs: [] })),
        getDocs(query(
          collection(db, 'incidencias'),
          where('comunidad_id', '==', comunidadId),
        )).catch(() => ({ size: 0, docs: [] })),
        getDocs(query(
          collection(db, 'perfiles'),
          where('comunidad_id', '==', comunidadId),
        )).catch(() => ({ size: 0 })),
      ]);

      const incDocs = 'docs' in incSnap ? incSnap.docs : [];
      const abiertas = incDocs.filter(
        (d) => !['resuelta', 'cerrada'].includes(d.data().estado),
      ).length;

      setStats({
        paquetesPendientes: paqSnap.size,
        visitasHoy: accSnap.size,
        alertasActivas: alertSnap.size,
        chatsNoLeidos: 0,
        incidenciasAbiertas: abiertas,
        vecinos: vecSnap.size,
      });

      // Actividad reciente simulada para mostrar la UI
      const ahora = new Date();
      setActividadReciente([
        { tipo: 'info', texto: 'Panel de vigilancia activo', hora: format(ahora, 'HH:mm', { locale: es }), icono: 'shield' },
      ]);
    } catch (err) {
      console.error('[Vigilante] Error cargando dashboard:', err);
    } finally {
      setLoading(false);
    }
  }

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
        onClick={() => {/* TODO: implementar alerta de emergencia */}}
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
            <Clock className="w-3 h-3" /> Hoy
          </span>
        </div>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            {actividadReciente.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">
                No hay actividad registrada hoy
              </div>
            ) : (
              actividadReciente.map((act, idx) => (
                <div key={idx} className={cn(
                  'px-4 py-3 flex items-center gap-3',
                  idx < actividadReciente.length - 1 && 'border-b border-border/50',
                )}>
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                    <Bell className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-finca-dark">{act.texto}</p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{act.hora}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
