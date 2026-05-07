'use client';

/**
 * NotificationsPanel — panel flotante de notificaciones para AppHeader.
 * Se abre al pulsar la campana. Muestra las últimas notificaciones
 * con sus iconos, títulos y timestamps. Incluye "Marcar leídas" y "Ver todas".
 */

import { useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell, BellOff, CheckCheck, ChevronRight,
  AlertCircle, Vote, Megaphone, FileText, X, MessageSquare, Zap,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { NotificacionComunidad, TipoNotificacion } from '@/types/database';

/* ── Iconos y colores por tipo ── */
const TIPO_CONFIG: Record<TipoNotificacion, {
  icon: React.ElementType;
  bg: string;
  text: string;
  label: string;
}> = {
  incidencia: { icon: AlertCircle, bg: 'bg-orange-100', text: 'text-orange-600', label: 'Incidencia'  },
  votacion:   { icon: Vote,        bg: 'bg-violet-100', text: 'text-violet-600', label: 'Votación'    },
  anuncio:    { icon: Megaphone,   bg: 'bg-blue-100',   text: 'text-blue-600',   label: 'Anuncio'     },
  documento:  { icon: FileText,    bg: 'bg-green-100',  text: 'text-green-600',  label: 'Documento'   },
  comentario: { icon: MessageSquare, bg: 'bg-cyan-100',  text: 'text-cyan-600',   label: 'Comentario'  },
  estado:     { icon: Zap,         bg: 'bg-amber-100', text: 'text-amber-600',  label: 'Estado'      },
};

interface NotificationsPanelProps {
  notifications : NotificacionComunidad[];
  unreadCount   : number;
  onMarkAllRead : () => void;
  onClose       : () => void;
  lastRead      : string;
  currentUserId : string;
}

export function NotificationsPanel({
  notifications,
  unreadCount,
  onMarkAllRead,
  onClose,
  lastRead,
  currentUserId,
}: NotificationsPanelProps) {
  const router    = useRouter();
  const panelRef  = useRef<HTMLDivElement>(null);

  /* Cerrar al pulsar fuera del panel */
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  /* Cerrar con Escape */
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  function handleNotifClick(n: NotificacionComunidad) {
    onClose();
    router.push(n.link);
  }

  function handleVerTodas() {
    onClose();
    router.push('/notificaciones');
  }

  const preview = notifications.slice(0, 5);

  return (
    <div
      ref={panelRef}
      className={cn(
        'absolute right-0 top-full mt-2 w-80 z-50',
        'bg-white rounded-2xl shadow-xl border border-border',
        'overflow-hidden',
      )}
    >
      {/* Header del panel */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-finca-dark" />
          <span className="text-sm font-semibold text-finca-dark">Notificaciones</span>
          {unreadCount > 0 && (
            <span className="min-w-[20px] h-5 bg-finca-coral text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1.5">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              onClick={onMarkAllRead}
              className="flex items-center gap-1 text-[11px] text-finca-coral hover:text-finca-coral/80 font-medium transition-colors px-2 py-1 rounded-lg hover:bg-finca-peach/20"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Leer todas
            </button>
          )}
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-muted/60 text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Lista de notificaciones */}
      <div className="max-h-[360px] overflow-y-auto">
        {preview.length === 0 ? (
          <div className="py-10 flex flex-col items-center gap-2 text-center">
            <BellOff className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Sin notificaciones</p>
          </div>
        ) : (
          preview.map((n) => {
            const cfg     = TIPO_CONFIG[n.tipo] ?? TIPO_CONFIG.anuncio;
            const Icon    = cfg.icon;
            const isNew   = n.created_at > lastRead && n.created_by !== currentUserId;

            return (
              <button
                key={n.id}
                onClick={() => handleNotifClick(n)}
                className={cn(
                  'w-full flex items-start gap-3 px-4 py-3 text-left transition-colors',
                  'hover:bg-muted/40 border-b border-border/50 last:border-0',
                  isNew && 'bg-finca-peach/10',
                )}
              >
                {/* Icono de tipo */}
                <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5', cfg.bg)}>
                  <Icon className={cn('w-4 h-4', cfg.text)} />
                </div>

                {/* Contenido */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-1">
                    <p className={cn('text-xs font-medium leading-snug truncate', isNew ? 'text-finca-dark' : 'text-muted-foreground')}>
                      {n.titulo}
                    </p>
                    {isNew && (
                      <span className="w-2 h-2 rounded-full bg-finca-coral shrink-0 mt-0.5" />
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{n.mensaje}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: es })}
                  </p>
                </div>

                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0 mt-2" />
              </button>
            );
          })
        )}
      </div>

      {/* Footer */}
      {notifications.length > 0 && (
        <div className="border-t border-border px-4 py-2.5">
          <button
            onClick={handleVerTodas}
            className="w-full text-xs text-finca-coral font-medium hover:text-finca-coral/80 transition-colors py-1 text-center"
          >
            Ver todas las notificaciones →
          </button>
        </div>
      )}
    </div>
  );
}
