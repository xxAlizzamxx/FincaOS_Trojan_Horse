'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { Building2, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/client';
import { Comunidad } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const codigo = (params.codigo as string).toUpperCase();

  const [comunidad, setComunidad] = useState<Comunidad | null>(null);
  const [vecinos, setVecinos]     = useState(0);
  const [loading, setLoading]     = useState(true);
  const [notFound, setNotFound]   = useState(false);

  /* Auth state */
  const [authChecked, setAuthChecked]     = useState(false);
  const [isLoggedIn, setIsLoggedIn]       = useState(false);
  const [yaEnComunidad, setYaEnComunidad] = useState(false);
  const [redirecting, setRedirecting]     = useState(false);

  /* ── 1. Verificar auth + si ya pertenece a una comunidad ── */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Wait for Firebase to finish restoring the session from IndexedDB.
      // Without this, onAuthStateChanged fires with `null` on hard reload before
      // the session is restored, causing a redirect loop with /login.
      await auth.authStateReady();
      if (cancelled) return;

      const u = auth.currentUser;
      if (!u) {
        if (typeof window !== 'undefined') {
          localStorage.setItem('finca_invite_code', codigo);
        }
        router.push('/login');
        return;
      }

      setIsLoggedIn(true);

      try {
        const perfilSnap = await getDoc(doc(db, 'perfiles', u.uid));
        if (cancelled) return;
        if (perfilSnap.exists() && perfilSnap.data().comunidad_id) {
          /* ✋ Usuario ya está en una comunidad → redirigir a /inicio */
          setYaEnComunidad(true);
          setRedirecting(true);
          toast.info('Ya perteneces a una comunidad');
          router.replace('/inicio');
          return;
        }
      } catch (err) {
        console.error('[InvitePage] Error leyendo perfil:', err);
      }

      if (cancelled) return;
      setYaEnComunidad(false);
      setAuthChecked(true);
    })();

    return () => { cancelled = true; };
  }, []);

  /* ── 2. Cargar datos de la comunidad ── */
  useEffect(() => {
    fetchComunidad();
  }, [codigo]);

  async function fetchComunidad() {
    const q    = query(collection(db, 'comunidades'), where('codigo', '==', codigo));
    const snap = await getDocs(q);

    if (snap.empty) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    const comDoc  = snap.docs[0];
    const comData = { id: comDoc.id, ...comDoc.data() } as Comunidad;
    setComunidad(comData);

    const vecSnap = await getDocs(
      query(collection(db, 'perfiles'), where('comunidad_id', '==', comDoc.id)),
    );
    setVecinos(vecSnap.size);
    setLoading(false);
  }

  /* ── Skeleton / redirigiendo ── */
  if (loading || redirecting) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-finca-peach/30 via-background to-background flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6">
          {redirecting ? (
            <div className="text-center space-y-3">
              <Loader2 className="w-8 h-8 text-finca-coral animate-spin mx-auto" />
              <p className="text-sm text-muted-foreground">Redirigiendo a tu comunidad…</p>
            </div>
          ) : (
            <>
              <div className="flex justify-center">
                <Skeleton className="w-[200px] h-[80px]" />
              </div>
              <Skeleton className="h-40 w-full rounded-2xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </>
          )}
        </div>
      </div>
    );
  }

  /* ── Comunidad no encontrada ── */
  if (notFound) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-finca-peach/30 via-background to-background flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <Image src="/Logo sin bg.png" alt="FincaOS" width={200} height={80} className="object-contain mx-auto" />
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
            <Building2 className="w-8 h-8 text-red-400" />
          </div>
          <h1 className="text-xl font-semibold text-finca-dark">Comunidad no encontrada</h1>
          <p className="text-sm text-muted-foreground">
            El código <span className="font-mono font-bold">{codigo}</span> no corresponde a ninguna comunidad registrada.
          </p>
          <Button onClick={() => router.push('/registro')} className="bg-finca-coral hover:bg-finca-coral/90 text-white">
            Crear una comunidad
          </Button>
        </div>
      </div>
    );
  }

  /* ── Vista principal ── */
  return (
    <div className="min-h-screen bg-gradient-to-br from-finca-peach/30 via-background to-background flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">

        <div className="flex justify-center">
          <Image src="/Logo sin bg.png" alt="FincaOS" width={200} height={80} className="object-contain" priority />
        </div>

        {/* ── Card comunidad ── */}
        <Card className="border-0 shadow-lg overflow-hidden">
          <div className="h-3 bg-gradient-to-r from-finca-coral to-finca-salmon" />
          <CardContent className="p-6 text-center space-y-4">
            <div className="w-16 h-16 bg-finca-peach/50 rounded-2xl flex items-center justify-center mx-auto">
              <Building2 className="w-8 h-8 text-finca-coral" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">Te han invitado a</p>
              <h1 className="text-xl font-bold text-finca-dark">{comunidad?.nombre}</h1>
              {comunidad?.direccion && (
                <p className="text-sm text-muted-foreground mt-1">{comunidad.direccion}</p>
              )}
            </div>
            <div className="flex items-center justify-center gap-6 py-2">
              <div className="text-center">
                <p className="text-2xl font-bold text-finca-coral">{vecinos}</p>
                <p className="text-xs text-muted-foreground">{vecinos === 1 ? 'vecino' : 'vecinos'}</p>
              </div>
              {comunidad && comunidad.num_viviendas > 0 && (
                <div className="text-center">
                  <p className="text-2xl font-bold text-finca-dark">{comunidad.num_viviendas}</p>
                  <p className="text-xs text-muted-foreground">viviendas</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── CTA según estado ── */}
        {isLoggedIn && !yaEnComunidad && (
          /* Autenticado sin comunidad → unirse directamente */
          <Button
            onClick={() => router.push(`/onboarding?codigo=${codigo}`)}
            className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-12 text-base font-medium shadow-md shadow-finca-coral/20"
          >
            Unirme a esta comunidad
            <ChevronRight className="w-5 h-5 ml-1" />
          </Button>
        )}

        {!isLoggedIn && authChecked && (
          /* No autenticado → flujo de registro / login */
          <>
            <Button
              onClick={() => router.push(`/registro?codigo=${codigo}`)}
              className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-12 text-base font-medium shadow-md shadow-finca-coral/20"
            >
              Unirme a esta comunidad
              <ChevronRight className="w-5 h-5 ml-1" />
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              ¿Ya tienes cuenta?{' '}
              <button
                onClick={() => router.push('/login')}
                className="text-finca-coral font-medium hover:underline"
              >
                Inicia sesión
              </button>
            </p>
          </>
        )}

        {/* yaEnComunidad=true → ya disparó router.replace('/inicio'), no se renderiza nada */}

      </div>
    </div>
  );
}
