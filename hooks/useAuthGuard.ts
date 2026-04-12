'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './useAuth';
import type { Rol } from '@/types/database';

/**
 * Redirige a /login si no hay sesión.
 * Si se pasa `roles`, redirige a `fallback` si el rol del usuario no está incluido.
 */
export function useAuthGuard(roles?: Rol[], fallback = '/') {
  const { user, perfil, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (roles && perfil && !roles.includes(perfil.rol)) {
      router.replace(fallback);
    }
  }, [user, perfil, loading, router]);

  return { user, perfil, loading };
}
