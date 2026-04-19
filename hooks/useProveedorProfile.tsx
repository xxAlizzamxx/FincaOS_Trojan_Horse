'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut as firebaseSignOut, User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/client';

export interface ProveedorProfile {
  uid: string;
  nombre: string;
  especialidad: string;
  zona: string;
  email: string;
  rating: number;
  trabajosRealizados: number;
  createdAt: string;
}

interface ProveedorProfileContextValue {
  proveedor: ProveedorProfile | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const ProveedorProfileContext = createContext<ProveedorProfileContextValue>({
  proveedor: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

export function ProveedorProfileProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [proveedor, setProveedor] = useState<ProveedorProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setProveedor(null);
        setLoading(false);
        router.replace('/proveedor/login');
        return;
      }
      setUser(firebaseUser);
      const snap = await getDoc(doc(db, 'proveedores', firebaseUser.uid));
      if (!snap.exists()) {
        setProveedor(null);
        setLoading(false);
        router.replace('/proveedor/login');
        return;
      }
      setProveedor(snap.data() as ProveedorProfile);
      setLoading(false);
    });
    return () => unsub();
  }, [router]);

  async function signOut() {
    await firebaseSignOut(auth);
    router.replace('/proveedor/login');
  }

  return (
    <ProveedorProfileContext.Provider value={{ proveedor, user, loading, signOut }}>
      {children}
    </ProveedorProfileContext.Provider>
  );
}

export function useProveedorProfile(): ProveedorProfileContextValue {
  return useContext(ProveedorProfileContext);
}
