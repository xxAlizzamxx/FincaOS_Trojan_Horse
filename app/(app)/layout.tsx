'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { AppHeader } from '@/components/layout/AppHeader';
import { BottomTabBar } from '@/components/layout/BottomTabBar';
import { useAuth } from '@/hooks/useAuth';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, perfil, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  // Redirect to onboarding if user has no community (except if already on onboarding)
  useEffect(() => {
    if (!loading && user && perfil && !perfil.comunidad_id && pathname !== '/onboarding') {
      router.replace('/onboarding');
    }
  }, [user, perfil, loading, pathname, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 rounded-full border-4 border-finca-coral border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  // On onboarding page, show simplified layout
  if (pathname === '/onboarding') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-finca-peach/30 via-background to-background flex flex-col">
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader />
      <main className="flex-1 overflow-y-auto pb-safe max-w-lg mx-auto w-full">
        {children}
      </main>
      <BottomTabBar />
    </div>
  );
}
