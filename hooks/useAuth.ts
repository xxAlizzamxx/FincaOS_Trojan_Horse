'use client';

import { useEffect, useState } from 'react';
import { User, onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/client';
import { Perfil } from '@/types/database';

export function useAuth() {
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

  return { user, perfil, loading, signOut };
}
