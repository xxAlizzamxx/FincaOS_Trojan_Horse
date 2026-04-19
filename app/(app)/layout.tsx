'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { AppHeader } from '@/components/layout/AppHeader';
import { BottomTabBar } from '@/components/layout/BottomTabBar';
import { PushNotificationPrompt } from '@/components/PushNotificationPrompt';
import { PageTransition } from '@/components/animation/PageTransition';
import { useAuth } from '@/hooks/useAuth';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, perfil, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // ── Role guard: if logged-in user is a provider, send them to their portal ──
  // Runs once when auth resolves. A single doc read by ID is cheap and safe.
  const [roleChecked,  setRoleChecked]  = useState(false);
  const [isProveedor,  setIsProveedor]  = useState(false);
  useEffect(() => {
    if (loading || !user) return;
    getDoc(doc(db, 'proveedores', user.uid))
      .then((snap) => {
        if (snap.exists()) {
          // This user is a provider — keep spinner up and redirect
          setIsProveedor(true);
          router.replace('/proveedor/dashboard');
        }
      })
      .catch(() => { /* network error: don't block the app */ })
      .finally(() => setRoleChecked(true));
  }, [user, loading, router]);

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

  // Show spinner while auth OR role check is in progress OR redirect is queued
  if (loading || (user && !roleChecked) || isProveedor) {
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
      <PushNotificationPrompt />
      <main className="flex-1 overflow-y-auto pb-safe max-w-lg mx-auto w-full">
        <PageTransition className="min-h-full">
          {children}
        </PageTransition>
      </main>
      <BottomTabBar />
    </div>
  );
}
