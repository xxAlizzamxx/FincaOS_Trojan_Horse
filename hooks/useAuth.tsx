'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/client';
import { Perfil, PerfilPrivado } from '@/types/database';
import { createPerfilBatch, updatePerfilPrivado } from '@/lib/firebase/createPerfil';
import { trackEvent } from '@/lib/analytics';

interface AuthContextValue {
  user:            User | null;
  perfil:          Perfil | null;
  /** Datos privados del usuario actual — NUNCA compartir con otros componentes públicos. */
  perfilPrivado:   PerfilPrivado | null;
  loading:         boolean;
  perfilCargado:   boolean;
  signOut:         () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user:            null,
  perfil:          null,
  perfilPrivado:   null,
  loading:         true,
  perfilCargado:   false,
  signOut:         async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,            setUser]            = useState<User | null>(null);
  const [perfil,          setPerfil]          = useState<Perfil | null>(null);
  const [perfilPrivado,   setPerfilPrivado]   = useState<PerfilPrivado | null>(null);
  const [loading,         setLoading]         = useState(true);
  const [perfilCargado,   setPerfilCargado]   = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        await fetchPerfil(firebaseUser);
      } else {
        setPerfil(null);
        setPerfilPrivado(null);
        setPerfilCargado(true);
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  async function fetchPerfil(firebaseUser: User) {
    const uid = firebaseUser.uid;

    try {
      // ── 1. Intentar cargar perfil ──────────────────────────────────────────
      const snap = await getDoc(doc(db, 'perfiles', uid));

      if (!snap.exists()) {
        // Perfil NO existe → crearlo automáticamente
        await setDoc(doc(db, 'perfiles', uid), {
          id:              uid,
          nombre_completo: firebaseUser.displayName ?? 'Usuario',
          avatar_url:      firebaseUser.photoURL    ?? null,
          comunidad_id:    null,
          numero_piso:     null,
          torre:           null,
          piso:            null,
          puerta:          null,
          rol:             'vecino',
          coeficiente:     null,
          created_at:      new Date().toISOString(),
          updated_at:      new Date().toISOString(),
        });

        setPerfil({
          id:              uid,
          nombre_completo: firebaseUser.displayName ?? 'Usuario',
          avatar_url:      firebaseUser.photoURL    ?? null,
          comunidad_id:    null,
          numero_piso:     null,
          torre:           null,
          piso:            null,
          puerta:          null,
          rol:             'vecino',
          coeficiente:     null,
          created_at:      new Date().toISOString(),
          updated_at:      new Date().toISOString(),
        } as Perfil);
      } else {
        // Perfil existe → cargar datos
        const perfilData = { id: snap.id, ...snap.data() } as Perfil;

        // Enriquecer con comunidad si existe
        if (perfilData.comunidad_id) {
          try {
            const comunidadSnap = await getDoc(doc(db, 'comunidades', perfilData.comunidad_id));
            if (comunidadSnap.exists()) {
              perfilData.comunidad = { id: comunidadSnap.id, ...comunidadSnap.data() } as any;
            }
          } catch {
            // error cargar comunidad — no bloquear
          }
        }

        setPerfil(perfilData);
      }

      // ── 2. Cargar perfil privado (fire-and-forget) ────────────────────────
      getDoc(doc(db, 'perfiles_privados', uid)).then((privSnap) => {
        if (privSnap.exists()) {
          setPerfilPrivado({ uid, ...privSnap.data() } as PerfilPrivado);
        }
      }).catch(() => {});

      // ── 3. Analytics (fire-and-forget) ─────────────────────────────────────
      trackEvent('login', uid, snap.data()?.comunidad_id ?? null).catch(() => {});

    } catch (error) {
      console.error('[useAuth] Error perfil:', error);
    } finally {
      // 🔴 CRÍTICO: SIEMPRE establecer que perfil fue resuelto
      setPerfilCargado(true);
      setLoading(false);
    }
  }

  async function signOut() {
    await firebaseSignOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, perfil, perfilPrivado, loading, perfilCargado, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
