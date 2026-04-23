'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { LayoutDashboard, CircleAlert as AlertCircle, Users, Building2, Megaphone, Settings, LogOut, Menu, X, Wallet, CreditCard } from 'lucide-react';
import { AvatarVecino } from '@/components/ui/avatar-vecino';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { PageTransition } from '@/components/animation/PageTransition';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/admin', icon: LayoutDashboard, label: 'Panel' },
  { href: '/admin/incidencias', icon: AlertCircle, label: 'Incidencias' },
  { href: '/admin/vecinos', icon: Users, label: 'Vecinos' },
  { href: '/admin/anuncios', icon: Megaphone, label: 'Anuncios' },
  { href: '/admin/cobros', icon: Wallet, label: 'Cobros' },
  { href: '/admin/cuotas', icon: CreditCard, label: 'Cuotas' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, perfil, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!loading && (!user || (perfil && !['admin', 'presidente'].includes(perfil.rol)))) {
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
    <aside className="w-64 bg-white border-r border-border flex flex-col h-full">
      {/* Logo — coral gradient header */}
      <div className="px-5 py-4 bg-gradient-to-br from-finca-coral to-finca-salmon">
        <Image
          src="/Logo sin bg.png"
          alt="FincaOS"
          width={120}
          height={44}
          className="object-contain brightness-0 invert"
        />
        <p className="text-[11px] text-white/70 mt-1 font-medium tracking-wide uppercase">
          Panel Administrador
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setSidebarOpen(false)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-finca-coral text-white shadow-sm shadow-finca-coral/30'
                  : 'text-finca-dark/60 hover:text-finca-dark hover:bg-finca-peach/50'
              )}
            >
              <item.icon className={cn('w-4 h-4 shrink-0', isActive ? 'text-white' : 'text-finca-coral/70')} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom actions */}
      <div className="p-3 border-t border-border space-y-0.5">
        <Link
          href="/inicio"
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-finca-dark/60 hover:text-finca-dark hover:bg-finca-peach/50 transition-colors"
        >
          <Users className="w-4 h-4 text-finca-coral/70" />
          Vista vecino
        </Link>
        <button
          onClick={signOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-500 hover:text-red-600 hover:bg-red-50 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen bg-gray-50/80 overflow-hidden">
      <div className="hidden md:flex flex-col">
        <Sidebar />
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="flex flex-col w-64">
            <Sidebar />
          </div>
          <div className="flex-1 bg-black/50" onClick={() => setSidebarOpen(false)} />
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 bg-white border-b border-border flex items-center px-4 gap-3 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <p className="text-sm font-medium text-finca-dark">
              {navItems.find((n) => n.href === pathname)?.label || 'Admin'}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
