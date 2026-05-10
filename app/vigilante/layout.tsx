'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import Image from 'next/image';
import Link from 'next/link';
import {
  LayoutDashboard, MessageSquare, DoorOpen, Package, AlertTriangle,
  ClipboardList, LogOut, Menu, Users, ShieldCheck, MonitorDot, BarChart2, MapPin,
} from 'lucide-react';
import { AvatarVecino } from '@/components/ui/avatar-vecino';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { PageTransition } from '@/components/animation/PageTransition';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/vigilante',            icon: LayoutDashboard, label: 'Dashboard'  },
  { href: '/vigilante/monitor',    icon: MonitorDot,      label: 'Monitor'    },
  { href: '/vigilante/chats',      icon: MessageSquare,   label: 'Chats'      },
  { href: '/vigilante/accesos',    icon: DoorOpen,        label: 'Accesos'    },
  { href: '/vigilante/paqueteria', icon: Package,         label: 'Paqueteria' },
  { href: '/vigilante/alertas',    icon: AlertTriangle,   label: 'Alertas'    },
  { href: '/vigilante/rondas',        icon: MapPin,        label: 'Rondas'       },
  { href: '/vigilante/bitacora',      icon: ClipboardList, label: 'Bitacora'     },
  { href: '/vigilante/estadisticas', icon: BarChart2,      label: 'Estadisticas' },
];

export default function VigilanteLayout({ children }: { children: React.ReactNode }) {
  const { user, perfil, loading, signOut } = useAuth();
  const router   = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [enTurno, setEnTurno] = useState(true);
  const [togglingTurno, setTogglingTurno] = useState(false);

  // Sync turno status from Firestore perfiles doc
  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onSnapshot(doc(db, 'perfiles', user.uid), (snap) => {
      if (snap.exists() && snap.data().en_turno !== undefined) {
        setEnTurno(!!snap.data().en_turno);
      }
    });
    return () => unsub();
  }, [user?.uid]);

  async function toggleTurno() {
    if (!user?.uid || togglingTurno) return;
    setTogglingTurno(true);
    try {
      await updateDoc(doc(db, 'perfiles', user.uid), { en_turno: !enTurno });
    } catch { /* ignore */ } finally {
      setTogglingTurno(false);
    }
  }

  useEffect(() => {
    if (!loading && (!user || (perfil && perfil.rol !== 'vigilante'))) {
      router.replace('/inicio');
    }
  }, [user, perfil, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-4 border-finca-coral border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  const Sidebar = () => (
    <aside className="w-64 bg-card border-r border-border flex flex-col h-full">
      {/* Logo — misma cabecera que el panel admin */}
      <div className="px-5 py-4 bg-gradient-to-br from-finca-coral to-finca-salmon">
        <Image
          src="/Logo sin bg.png"
          alt="FincaOS"
          width={120}
          height={44}
          className="object-contain brightness-0 invert"
        />
        <p className="text-[11px] text-white/70 mt-1 font-medium tracking-wide uppercase">
          Panel Vigilancia
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href
            || (item.href !== '/vigilante' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setSidebarOpen(false)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-finca-coral text-white shadow-sm shadow-finca-coral/30'
                  : 'text-finca-dark/60 hover:text-finca-dark hover:bg-finca-peach/30',
              )}
            >
              <item.icon className={cn('w-4 h-4 shrink-0', isActive ? 'text-white' : 'text-finca-coral/70')} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="p-3 border-t border-border space-y-0.5">
        <Link
          href="/inicio"
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-finca-dark/60 hover:text-finca-dark hover:bg-finca-peach/30 transition-colors"
        >
          <Users className="w-4 h-4 text-finca-coral/70" />
          Vista comunidad
        </Link>
        <button
          onClick={signOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-500 hover:text-red-600 hover:bg-red-50 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Cerrar sesion
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden md:flex flex-col">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="flex flex-col w-64">
            <Sidebar />
          </div>
          <div className="flex-1 bg-black/50" onClick={() => setSidebarOpen(false)} />
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 bg-card border-b border-border flex items-center px-4 gap-3 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex-1 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-finca-coral" />
            <p className="text-sm font-medium text-finca-dark">
              {navItems.find((n) =>
                pathname === n.href || (n.href !== '/vigilante' && pathname.startsWith(n.href)),
              )?.label || 'Vigilancia'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              onClick={toggleTurno}
              disabled={togglingTurno}
              title="Toca para cambiar estado"
              className={cn(
                'text-xs px-2 py-0.5 rounded-full font-medium transition-colors',
                enTurno
                  ? 'bg-finca-peach/60 text-finca-coral hover:bg-finca-peach'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80',
              )}
            >
              {enTurno ? 'En turno' : 'En descanso'}
            </button>
            {perfil && <AvatarVecino perfil={perfil} size="sm" />}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <PageTransition duration={0.3}>
            {children}
          </PageTransition>
        </main>
      </div>
    </div>
  );
}
