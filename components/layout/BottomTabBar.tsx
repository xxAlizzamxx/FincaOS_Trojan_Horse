'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Chrome as Home, CircleAlert as AlertCircle, Plus, Users, DoorOpen, ShieldCheck, LucideIcon } from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';

interface TabItem {
  href:   string;
  icon:   LucideIcon;
  label:  string;
  isFab?: boolean;
  badge?: number;
}

export function BottomTabBar() {
  const pathname = usePathname();
  const { perfil, user } = useAuth();
  const [porteriaBadge, setPorteriaBadge] = useState(0);

  const esVigilante = perfil?.rol === 'vigilante';

  // Badge portería: mensajes no leídos del vigilante
  useEffect(() => {
    if (!user || !perfil?.comunidad_id || esVigilante) return;

    const unsubChats = onSnapshot(
      query(
        collection(db, 'chats_vigilancia'),
        where('comunidad_id', '==', perfil.comunidad_id),
        where('vecino_id', '==', user.uid),
      ),
      (snap) => {
        const noLeidos = snap.docs.reduce((sum, d) => sum + (d.data().no_leidos_vecino || 0), 0);
        setPorteriaBadge(noLeidos);
      },
    );

    return () => unsubChats();
  }, [user, perfil?.comunidad_id, esVigilante]);

  // Tabs para vigilante: acceso directo al panel
  const tabsVigilante: TabItem[] = [
    { href: '/vigilante',            icon: ShieldCheck, label: 'Panel'    },
    { href: '/vigilante/alertas',    icon: AlertCircle, label: 'Alertas'  },
    { href: '/vigilante/bitacora',   icon: Plus,        label: 'Bitácora', isFab: true },
    { href: '/vigilante/chats',      icon: DoorOpen,    label: 'Chats'    },
    { href: '/vigilante/paqueteria', icon: Users,       label: 'Paquetes' },
  ];

  // Tabs para vecinos
  const tabsVecino: TabItem[] = [
    { href: '/inicio',      icon: Home,        label: 'Inicio'      },
    { href: '/incidencias', icon: AlertCircle, label: 'Incidencias' },
    { href: '/nueva',       icon: Plus,        label: 'Nuevo', isFab: true },
    { href: '/porteria',    icon: DoorOpen,    label: 'Portería', badge: porteriaBadge },
    { href: '/comunidad',   icon: Users,       label: 'Comunidad'   },
  ];

  const tabs: TabItem[] = esVigilante ? tabsVigilante : tabsVecino;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border safe-bottom">
      <div className="flex items-center h-16 max-w-lg md:max-w-2xl lg:max-w-5xl mx-auto">
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.href);
          const Icon = tab.icon;

          if (tab.isFab) {
            return (
              <div key={tab.href} className="flex-1 relative self-stretch">
                <Link
                  href={tab.href}
                  className="absolute left-1/2 -translate-x-1/2 -top-7 flex flex-col items-center"
                >
                  <div className="w-14 h-14 rounded-full bg-finca-coral flex items-center justify-center shadow-lg shadow-finca-coral/30 transition-transform active:scale-95">
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <span className="text-[10px] mt-1 text-finca-coral font-medium whitespace-nowrap">{tab.label}</span>
                </Link>
              </div>
            );
          }

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1 rounded-xl transition-colors"
            >
              <div className="relative">
                <Icon
                  className={cn(
                    'w-5 h-5 transition-colors',
                    isActive ? 'text-finca-coral' : 'text-finca-gray'
                  )}
                />
                {'badge' in tab && (tab.badge ?? 0) > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-finca-coral text-white rounded-full text-[9px] flex items-center justify-center font-bold">
                    {(tab.badge ?? 0) > 9 ? '9+' : tab.badge}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  'text-[10px] font-medium transition-colors',
                  isActive ? 'text-finca-coral' : 'text-finca-gray'
                )}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
