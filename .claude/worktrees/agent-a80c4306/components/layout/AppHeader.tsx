'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SoundToggle } from '@/components/ui/sound-toggle';
import { NotificationsPanel } from '@/components/layout/NotificationsPanel';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/hooks/useNotifications';
import { cn } from '@/lib/utils';

export function AppHeader() {
  const { perfil, user } = useAuth();
  const { notifications, unreadCount, markAllRead } = useNotifications(20);

  const [panelOpen, setPanelOpen] = useState(false);
  const [imgError, setImgError]   = useState(false);

  const fotoUrl   = perfil?.avatar_url || user?.photoURL || null;
  const hasPhoto  = !!fotoUrl && !imgError;
  const iniciales = perfil?.nombre_completo
    ?.split(' ')
    .slice(0, 2)
    .map((n: string) => n[0]?.toUpperCase() ?? '')
    .join('') || '?';

  const lastRead = perfil?.notificaciones_last_read ?? '1970-01-01T00:00:00.000Z';

  function handleBellClick() {
    const opening = !panelOpen;
    setPanelOpen(opening);
    /* Marcar como leídas al abrir el panel */
    if (opening && unreadCount > 0) {
      markAllRead();
    }
  }

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-border safe-top">
      <div className="flex items-center justify-between h-14 px-4 max-w-lg mx-auto">
        <Image
          src="/Logo sin bg.png"
          alt="FincaOS"
          width={110}
          height={40}
          className="object-contain"
          priority
        />

        <div className="flex items-center gap-2">
          {perfil?.comunidad && (
            <span className="text-xs text-muted-foreground bg-finca-peach/50 px-2 py-1 rounded-full max-w-[120px] truncate">
              {(perfil.comunidad as any).nombre}
            </span>
          )}

          {/* Sonido */}
          <SoundToggle size="sm" />

          {/* Campana — posición relativa para el panel flotante */}
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              className="relative w-9 h-9"
              onClick={handleBellClick}
              aria-label="Notificaciones"
              aria-expanded={panelOpen}
            >
              <Bell className={cn('w-5 h-5', unreadCount > 0 ? 'text-finca-coral' : 'text-finca-dark')} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-finca-coral text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 pointer-events-none">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Button>

            {/* Panel flotante de notificaciones */}
            {panelOpen && perfil && (
              <NotificationsPanel
                notifications={notifications}
                unreadCount={unreadCount}
                onMarkAllRead={markAllRead}
                onClose={() => setPanelOpen(false)}
                lastRead={lastRead}
                currentUserId={perfil.id}
              />
            )}
          </div>

          {/* Avatar → perfil */}
          <Link href="/perfil">
            <div
              className={cn(
                'w-8 h-8 rounded-full overflow-hidden flex items-center justify-center font-bold text-xs ring-2 ring-finca-coral/40 transition-all hover:ring-finca-coral active:scale-95',
                !hasPhoto && 'bg-finca-peach text-finca-coral',
              )}
            >
              {hasPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={fotoUrl!}
                  alt="Mi perfil"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                  onError={() => setImgError(true)}
                />
              ) : (
                <span>{iniciales}</span>
              )}
            </div>
          </Link>
        </div>
      </div>
    </header>
  );
}
