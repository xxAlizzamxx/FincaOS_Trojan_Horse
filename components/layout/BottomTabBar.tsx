'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Chrome as Home, CircleAlert as AlertCircle, Plus, Users, User } from 'lucide-react';
import { cn } from '@/lib/utils';

export function BottomTabBar() {
  const pathname = usePathname();

  const tabs = [
    { href: '/inicio',      icon: Home,        label: 'Inicio'      },
    { href: '/incidencias', icon: AlertCircle, label: 'Incidencias' },
    { href: '/nueva',       icon: Plus,        label: 'Nuevo', isFab: true },
    { href: '/comunidad',   icon: Users,       label: 'Comunidad'   },
    { href: '/perfil',      icon: User,        label: 'Perfil'      },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border safe-bottom">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.href);
          const Icon = tab.icon;

          if (tab.isFab) {
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className="flex flex-col items-center justify-center -mt-6"
              >
                <div className="w-14 h-14 rounded-full bg-finca-coral flex items-center justify-center shadow-lg shadow-finca-coral/30 transition-transform active:scale-95">
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <span className="text-[10px] mt-1 text-finca-coral font-medium">{tab.label}</span>
              </Link>
            );
          }

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex flex-col items-center justify-center gap-0.5 px-3 py-1 rounded-xl transition-colors"
            >
              <Icon
                className={cn(
                  'w-5 h-5 transition-colors',
                  isActive ? 'text-finca-coral' : 'text-finca-gray'
                )}
              />
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
