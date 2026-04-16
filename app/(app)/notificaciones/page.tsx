'use client';

import { useRouter } from 'next/navigation';
import {
  ArrowLeft, BellOff, CheckCheck,
  AlertCircle, Vote, Megaphone, FileText,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useNotifications } from '@/hooks/useNotifications';
import { useAuth } from '@/hooks/useAuth';
import type { TipoNotificacion, NotificacionComunidad } from '@/types/database';

/* ── Config visual por tipo ── */
const TIPO_CONFIG: Record<TipoNotificacion, {
  icon  : React.ElementType;
  bg    : string;
  text  : string;
  badge : string;
  label : string;
}> = {
  incidencia: { icon: AlertCircle, bg: 'bg-orange-100', text: 'text-orange-600', badge: 'bg-orange-100 text-orange-700', label: 'Incidencia'  },
  votacion:   { icon: Vote,        bg: 'bg-violet-100', text: 'text-violet-600', badge: 'bg-violet-100 text-violet-700', label: 'Votación'    },
  anuncio:    { icon: Megaphone,   bg: 'bg-blue-100',   text: 'text-blue-600',   badge: 'bg-blue-100 text-blue-700',    label: 'Anuncio'     },
  documento:  { icon: FileText,    bg: 'bg-green-100',  text: 'text-green-600',  badge: 'bg-green-100 text-green-700',  label: 'Documento'   },
};

function tipoConfig(tipo: string) {
  return TIPO_CONFIG[tipo as TipoNotificacion] ?? TIPO_CONFIG.anuncio;
}

export default function NotificacionesPage() {
  const router = useRouter();
  const { perfil } = useAuth();
  const { notifications, unreadCount, markAllRead, loading } = useNotifications(50);

  const lastRead      = perfil?.notificaciones_last_read ?? '1970-01-01T00:00:00.000Z';
  const currentUserId = perfil?.id ?? '';

  function isUnread(n: NotificacionComunidad) {
    return n.created_at > lastRead && n.created_by !== currentUserId;
  }

  function handleClick(n: NotificacionComunidad) {
    router.push(n.link);
  }

  /* ── Skeleton ── */
  if (loading) {
    return (
      <div className="px-4 py-5 space-y-4">
        <Skeleton className="h-8 w-40" />
        {[1, 2, 3].map((i) => (
          <Card key={i} className="border-0 shadow-sm">
            <CardContent className="p-4 flex gap-3">
              <Skeleton className="w-9 h-9 rounded-xl shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
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
          <Button variant="ghost" size="icon" onClick={() => router.back()} className="w-8 h-8 -ml-1">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-finca-dark">Notificaciones</h1>
            {unreadCount > 0 && (
              <p className="text-xs text-muted-foreground">{unreadCount} sin leer</p>
            )}
          </div>
        </div>

        {unreadCount > 0 && (
          <Button
            variant="outline" size="sm"
            onClick={markAllRead}
            className="text-xs border-finca-coral text-finca-coral hover:bg-finca-coral hover:text-white"
          >
            <CheckCheck className="w-3.5 h-3.5 mr-1.5" />
            Leer todas
          </Button>
        )}
      </div>

      {/* Empty state */}
      {notifications.length === 0 ? (
        <div className="py-16 text-center space-y-3">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <BellOff className="w-7 h-7 text-muted-foreground/50" />
          </div>
          <p className="font-medium text-finca-dark">Sin notificaciones</p>
          <p className="text-sm text-muted-foreground">
            Aquí aparecerán las novedades de tu comunidad en tiempo real
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => {
            const cfg  = tipoConfig(n.tipo);
            const Icon = cfg.icon;
            const unread = isUnread(n);

            return (
              <Card
                key={n.id}
                onClick={() => handleClick(n)}
                className={cn(
                  'border-0 shadow-sm cursor-pointer transition-all active:scale-[0.99]',
                  'hover:shadow-md',
                  unread && 'border-l-4 border-l-finca-coral bg-finca-peach/5',
                )}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    {/* Icono tipo */}
                    <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5', cfg.bg)}>
                      <Icon className={cn('w-4.5 h-4.5', cfg.text)} />
                    </div>

                    {/* Contenido */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <Badge className={cn('text-[10px] border-0 px-1.5', cfg.badge)}>
                          {cfg.label}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: es })}
                        </span>
                      </div>

                      <p className={cn('text-sm leading-snug', unread ? 'font-semibold text-finca-dark' : 'text-muted-foreground')}>
                        {n.titulo}
                      </p>

                      {n.mensaje && (
                        <p className="text-xs text-muted-foreground truncate">{n.mensaje}</p>
                      )}
                    </div>

                    {/* Punto de no leída */}
                    {unread && (
                      <span className="w-2 h-2 rounded-full bg-finca-coral shrink-0 mt-1.5" />
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
