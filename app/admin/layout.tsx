'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { LayoutDashboard, CircleAlert as AlertCircle, Users, Building2, Megaphone, Settings, LogOut, Menu, X, Wallet } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/admin', icon: LayoutDashboard, label: 'Panel' },
  { href: '/admin/incidencias', icon: AlertCircle, label: 'Incidencias' },
  { href: '/admin/vecinos', icon: Users, label: 'Vecinos' },
  { href: '/admin/anuncios', icon: Megaphone, label: 'Anuncios' },
  { href: '/admin/cobros', icon: Wallet, label: 'Cobros' },
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
    <aside className="w-64 bg-finca-dark flex flex-col h-full">
      <div className="p-4 border-b border-white/10">
        <Image src="/Logo sin bg.png" alt="FincaOS" width={130} height={50} className="object-contain brightness-0 invert" />
        <p className="text-xs text-white/40 mt-1">Panel Administrador</p>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setSidebarOpen(false)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                isActive
                  ? 'bg-finca-coral text-white'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              )}
            >
              <item.icon className="w-4.5 h-4.5 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-white/10 space-y-1">
        <Link
          href="/inicio"
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors"
        >
          <Users className="w-4 h-4" />
          Vista vecino
        </Link>
        <button
          onClick={signOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-400 hover:text-red-300 hover:bg-white/10 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
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
            <div className="w-8 h-8 rounded-full bg-finca-peach flex items-center justify-center">
              <span className="text-xs font-semibold text-finca-coral">
                {perfil?.nombre_completo?.charAt(0) || 'A'}
              </span>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
