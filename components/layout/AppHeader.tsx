'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

export function AppHeader() {
  const { perfil, user } = useAuth();
  const [unread, setUnread] = useState(0);
  const [imgError, setImgError] = useState(false);

  const fotoUrl  = perfil?.avatar_url || user?.photoURL || null;
  const hasPhoto = !!fotoUrl && !imgError;
  const iniciales = perfil?.nombre_completo
    ?.split(' ')
    .slice(0, 2)
    .map((n: string) => n[0]?.toUpperCase() ?? '')
    .join('') || '?';

  useEffect(() => {
    if (!perfil?.id) return;

    const q = query(
      collection(db, 'notificaciones'),
      where('usuario_id', '==', perfil.id),
      where('leida', '==', false)
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      setUnread(snap.size);
    });

    return () => unsubscribe();
  }, [perfil?.id]);

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

          {/* Notificaciones */}
          <Link href="/notificaciones">
            <Button variant="ghost" size="icon" className="relative w-9 h-9">
              <Bell className="w-5 h-5 text-finca-dark" />
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-finca-coral text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </Button>
          </Link>

          {/* Avatar del usuario → acceso directo al perfil */}
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
