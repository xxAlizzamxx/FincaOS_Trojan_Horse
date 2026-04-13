'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/client';
import { Perfil } from '@/types/database';

interface AuthContextValue {
  user: User | null;
  perfil: Perfil | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  perfil: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        await fetchPerfil(firebaseUser.uid);
      } else {
        setPerfil(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  async function fetchPerfil(userId: string) {
    const perfilSnap = await getDoc(doc(db, 'perfiles', userId));
    if (perfilSnap.exists()) {
      const perfilData = { id: perfilSnap.id, ...perfilSnap.data() } as Perfil;
      if (perfilData.comunidad_id) {
        const comunidadSnap = await getDoc(doc(db, 'comunidades', perfilData.comunidad_id));
        if (comunidadSnap.exists()) {
          perfilData.comunidad = { id: comunidadSnap.id, ...comunidadSnap.data() } as any;
        }
      }
      setPerfil(perfilData);
    } else {
      // Perfil no encontrado — puede ocurrir si el registro con Google fue interrumpido.
      // Creamos un perfil mínimo para que el flujo de onboarding funcione correctamente.
      const firebaseUser = auth.currentUser;
      if (firebaseUser) {
        const nuevoPerfil = {
          nombre_completo: firebaseUser.displayName || 'Usuario',
          avatar_url:      firebaseUser.photoURL || null,
          telefono:        null,
          comunidad_id:    null,
          numero_piso:     null,
          rol:             'vecino' as const,
          created_at:      new Date().toISOString(),
          updated_at:      new Date().toISOString(),
        };
        try {
          await setDoc(doc(db, 'perfiles', userId), nuevoPerfil);
          setPerfil({ id: userId, ...nuevoPerfil } as Perfil);
        } catch (err) {
          console.error('[useAuth] No se pudo crear el perfil de recuperación:', err);
        }
      }
    }
    setLoading(false);
  }

  async function signOut() {
    await firebaseSignOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, perfil, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
