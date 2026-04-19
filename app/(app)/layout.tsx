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

// ── Public routes ─────────────────────────────────────────────────────────────
// These paths are accessible without authentication.
// /login and /registro live in (auth)/ but are listed here so the layout
// never accidentally gates them if routing ever changes.
const PUBLIC_ROUTES = ['/', '/login', '/registro'];

// ── Shared spinner ────────────────────────────────────────────────────────────
function FullScreenSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-8 h-8 rounded-full border-4 border-finca-coral border-t-transparent animate-spin" />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, perfil, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isPublicRoute = PUBLIC_ROUTES.includes(pathname ?? '');

  // ── Role guard ────────────────────────────────────────────────────────────
  // If the logged-in user is a provider, send them to their portal.
  // We track roleChecked separately so we never flash app-chrome before we know.
  const [roleChecked, setRoleChecked] = useState(false);
  const [isProveedor, setIsProveedor] = useState(false);

  useEffect(() => {
    // No user yet — mark role as resolved immediately so we don't stall renders
    if (!loading && !user) {
      setRoleChecked(true);
      return;
    }
    if (loading || !user) return;

    getDoc(doc(db, 'proveedores', user.uid))
      .then((snap) => {
        if (snap.exists()) {
          setIsProveedor(true);
          router.replace('/proveedor');
        }
      })
      .catch(() => { /* network error — don't block the app */ })
      .finally(() => setRoleChecked(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, loading]);

  // ── Auth guard: redirect unauthenticated users on protected routes ─────────
  useEffect(() => {
    if (loading || !roleChecked) return;
    if (!user && !isPublicRoute) {
      router.replace('/login');
    }
  }, [user, loading, roleChecked, isPublicRoute, router]);

  // ── Onboarding guard ───────────────────────────────────────────────────────
  // Redirect to onboarding when:
  //   • user is authenticated
  //   • role check is done and user is NOT a provider
  //   • EITHER: user has NO perfil yet (newly registered)
  //   • OR: user has perfil but no community yet
  // The pathname check prevents an infinite redirect loop.
  useEffect(() => {
    if (loading || !roleChecked || !user || isProveedor) return;
    if (pathname === '/onboarding') return;

    // 🔴 New user (no perfil in Firestore yet)
    if (user && !perfil) {
      router.replace('/onboarding');
      return;
    }

    // User with perfil but no community
    if (perfil && !perfil.comunidad_id) {
      router.replace('/onboarding');
    }
  }, [user, perfil, loading, pathname, roleChecked, isProveedor, router]);

  // ── Loading states — NEVER return null ────────────────────────────────────

  // Still resolving Firebase auth
  if (loading) return <FullScreenSpinner />;

  // Logged in but role check not yet complete
  if (user && !roleChecked) return <FullScreenSpinner />;

  // Provider redirect in-flight
  if (isProveedor) return <FullScreenSpinner />;

  // ── Unauthenticated ────────────────────────────────────────────────────────
  if (!user) {
    if (isPublicRoute) {
      // Render public pages without app chrome (no header/tabs)
      return <>{children}</>;
    }
    // Protected route — redirect to /login is in-flight from the effect above.
    // Return spinner instead of null so the screen is never blank.
    return <FullScreenSpinner />;
  }

  // ── Onboarding: simplified layout ─────────────────────────────────────────
  if (pathname === '/onboarding') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-finca-peach/30 via-background to-background flex flex-col">
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    );
  }

  // ── Full app layout ────────────────────────────────────────────────────────
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
