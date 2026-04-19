'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/client';
import { Perfil, PerfilPrivado } from '@/types/database';
import { createPerfilBatch, updatePerfilPrivado } from '@/lib/firebase/createPerfil';
import { trackEvent } from '@/lib/analytics';

interface AuthContextValue {
  user:          User | null;
  perfil:        Perfil | null;
  /** Datos privados del usuario actual — NUNCA compartir con otros componentes públicos. */
  perfilPrivado: PerfilPrivado | null;
  loading:       boolean;
  signOut:       () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user:          null,
  perfil:        null,
  perfilPrivado: null,
  loading:       true,
  signOut:       async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,          setUser]          = useState<User | null>(null);
  const [perfil,        setPerfil]        = useState<Perfil | null>(null);
  const [perfilPrivado, setPerfilPrivado] = useState<PerfilPrivado | null>(null);
  const [loading,       setLoading]       = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        await fetchPerfil(firebaseUser);
      } else {
        setPerfil(null);
        setPerfilPrivado(null);
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  async function fetchPerfil(firebaseUser: User) {
    const uid = firebaseUser.uid;

    // ── 0. Proveedor priority check ───────────────────────────────────────
    // If this UID already has a proveedores document, skip ALL perfiles logic.
    // Providers must NEVER get a perfiles doc auto-created; that would break
    // the single-role enforcement and the Firestore create rule on /proveedores.
    try {
      const proveedorSnap = await getDoc(doc(db, 'proveedores', uid));
      if (proveedorSnap.exists()) {
        // Provider is authenticated — let layout.tsx handle the redirect
        setLoading(false);
        return;
      }
    } catch {
      // Network error — fall through and try perfiles normally
    }

    // ── 1. Cargar perfil público ──────────────────────────────────────────
    const perfilSnap = await getDoc(doc(db, 'perfiles', uid));

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
      // Perfil no encontrado — registro con Google fue interrumpido.
      // Crear perfil mínimo via batch (crea también perfiles_privados).
      const nuevoPerfil = {
        nombre_completo: firebaseUser.displayName || 'Usuario',
        avatar_url:      firebaseUser.photoURL    || null,
        comunidad_id:    null,
        numero_piso:     null,
        torre:           null,
        piso:            null,
        puerta:          null,
        rol:             'vecino' as const,
        coeficiente:     null,
        created_at:      new Date().toISOString(),
        updated_at:      new Date().toISOString(),
      };
      try {
        await createPerfilBatch(uid, nuevoPerfil, {
          email:       firebaseUser.email ?? null,
          telefono:    null,
          plan:        'free',
          ultimo_login: new Date().toISOString(),
        });
        setPerfil({ id: uid, ...nuevoPerfil } as Perfil);
      } catch (err) {
        console.error('[useAuth] No se pudo crear el perfil de recuperación:', err);
      }
    }

    // ── 2. Cargar perfil privado (solo para el propio usuario) ────────────
    try {
      const privadoSnap = await getDoc(doc(db, 'perfiles_privados', uid));
      if (privadoSnap.exists()) {
        setPerfilPrivado({ uid, ...privadoSnap.data() } as PerfilPrivado);
      } else {
        // Perfil privado no existe aún (usuario pre-migración) — crearlo ahora
        await createPerfilBatch(uid, {} as any, {
          email:       firebaseUser.email ?? null,
          telefono:    null,
          plan:        'free',
          ultimo_login: new Date().toISOString(),
        });
        setPerfilPrivado({
          uid,
          email:        firebaseUser.email ?? null,
          telefono:     null,
          plan:         'free',
          ultimo_login: new Date().toISOString(),
          preferencias_notificaciones: { push: true, email: true },
          created_at:   new Date().toISOString(),
          updated_at:   new Date().toISOString(),
        });
      }
    } catch {
      // Si falla el perfil privado, no bloquear el resto de la app
    }

    // ── 3. Actualizar ultimo_login (fire-and-forget) ──────────────────────
    updatePerfilPrivado(uid, { ultimo_login: new Date().toISOString() }).catch(() => {});

    // ── 4. Analytics — evento login (fire-and-forget, sin await) ─────────
    //    Obtenemos comunidad_id del perfil si ya existe para el contexto
    getDoc(doc(db, 'perfiles', uid)).then((snap) => {
      const comunidadId = snap.data()?.comunidad_id ?? null;
      trackEvent('login', uid, comunidadId).catch(() => {});
    }).catch(() => {});

    setLoading(false);
  }

  async function signOut() {
    await firebaseSignOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, perfil, perfilPrivado, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
