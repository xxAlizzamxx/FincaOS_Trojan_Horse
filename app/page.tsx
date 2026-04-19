'use client';

/**
 * "/" — Public landing page
 *
 * Renders immediately for everyone — no auth gate, no spinner wall.
 * If the visitor is already logged in, a background effect redirects them
 * silently to their home (/inicio for vecinos, /proveedor for providers).
 *
 * This page is the public entry point and MUST work without authentication.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/client';
import { Button } from '@/components/ui/button';

export default function LandingPage() {
  const router = useRouter();

  // Silent redirect for already-authenticated users.
  // Runs in the background — never blocks the landing page from rendering.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) return; // guest — stay on landing

      // Check provider role first
      try {
        const provSnap = await getDoc(doc(db, 'proveedores', user.uid));
        if (provSnap.exists()) {
          router.replace('/proveedor');
          return;
        }
      } catch {
        // Network error — fall through to vecino redirect
      }

      router.replace('/inicio');
    });

    return () => unsubscribe();
  }, [router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-finca-peach/30 via-background to-background flex flex-col">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
        {/* Logo */}
        <div className="mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/Logo sin bg.png"
            alt="FincaOS"
            className="h-14 mx-auto object-contain"
          />
        </div>

        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Tu comunidad,{' '}
          <span className="text-finca-coral">en orden</span>
        </h1>

        <p className="mt-4 max-w-lg text-muted-foreground text-base sm:text-lg">
          Gestiona incidencias, votaciones, cuotas y comunicaciones de tu edificio desde una sola app.
        </p>

        {/* ── Role entry points ──────────────────────────────────────────── */}
        <div className="mt-10 w-full max-w-xs space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
            ¿Cómo quieres entrar?
          </p>

          <Button
            asChild
            size="lg"
            className="w-full h-12 text-base bg-finca-coral hover:bg-finca-coral/90 text-white"
          >
            <Link href="/login">
              👤&nbsp; Soy vecino / administrador
            </Link>
          </Button>

          <Button
            asChild
            size="lg"
            variant="outline"
            className="w-full h-12 text-base border-2"
          >
            <Link href="/proveedor">
              🛠️&nbsp; Soy proveedor de servicios
            </Link>
          </Button>
        </div>

        {/* ── Quick-value strip ─────────────────────────────────────────── */}
        <div className="mt-16 grid grid-cols-3 gap-6 max-w-sm w-full text-center">
          {[
            { emoji: '🏠', label: 'Incidencias' },
            { emoji: '🗳️', label: 'Votaciones' },
            { emoji: '💶', label: 'Cuotas' },
          ].map(({ emoji, label }) => (
            <div key={label} className="flex flex-col items-center gap-1">
              <span className="text-2xl">{emoji}</span>
              <span className="text-xs text-muted-foreground font-medium">{label}</span>
            </div>
          ))}
        </div>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="text-center text-xs text-muted-foreground pb-8 px-4">
        © {new Date().getFullYear()} FincaOS — Gestión inteligente de comunidades
      </footer>
    </div>
  );
}
