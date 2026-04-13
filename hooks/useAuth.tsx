'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
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
