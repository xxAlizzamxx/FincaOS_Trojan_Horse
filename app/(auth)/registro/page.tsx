'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Eye, EyeOff, UserPlus, Building2 } from 'lucide-react';
import { createUserWithEmailAndPassword, updateProfile, GoogleAuthProvider, signInWithRedirect, getRedirectResult } from 'firebase/auth';
import { doc, setDoc, updateDoc, collection, query, where, getDocs, addDoc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const googleProvider = new GoogleAuthProvider();

export default function RegistroPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [piso, setPiso] = useState('');

  const [codigoComunidad, setCodigoComunidad] = useState('');

  // Pre-fill code from invite link
  useEffect(() => {
    const code = searchParams.get('codigo');
    if (code) setCodigoComunidad(code.toUpperCase());
  }, [searchParams]);

  // Manejar resultado del redirect de Google al volver a la app
  useEffect(() => {
    getRedirectResult(auth)
      .then(async (result) => {
        if (!result) return;
        const user = result.user;

        // Recuperar código de comunidad guardado antes del redirect
        const savedCode = sessionStorage.getItem('registro_codigo_comunidad') ?? '';
        sessionStorage.removeItem('registro_codigo_comunidad');

        let comunidadId: string | null = null;
        if (savedCode) {
          const q = query(collection(db, 'comunidades'), where('codigo', '==', savedCode.toUpperCase()));
          const snap = await getDocs(q);
          if (!snap.empty) comunidadId = snap.docs[0].id;
        }

        const perfilSnap = await getDoc(doc(db, 'perfiles', user.uid));
        if (!perfilSnap.exists()) {
          await setDoc(doc(db, 'perfiles', user.uid), {
            comunidad_id: comunidadId,
            nombre_completo: user.displayName || 'Sin nombre',
            numero_piso: null,
            rol: 'vecino',
            avatar_url: user.photoURL || null,
            telefono: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          router.replace(comunidadId ? '/inicio' : '/onboarding');
        } else {
          const data = perfilSnap.data();
          if (!data?.comunidad_id && comunidadId) {
            await updateDoc(doc(db, 'perfiles', user.uid), {
              comunidad_id: comunidadId,
              updated_at: new Date().toISOString(),
            });
            router.replace('/inicio');
          } else {
            router.replace(data?.comunidad_id ? '/inicio' : '/onboarding');
          }
        }
      })
      .catch((err: any) => {
        console.error('[Firebase Auth] Error en redirect de registro:', err.code, err.message);
        if (err.code !== 'auth/popup-closed-by-user') {
          toast.error('Error al registrarse con Google: ' + (err.code ?? err.message));
        }
      });
  }, [router]);
  const [nombreComunidad, setNombreComunidad] = useState('');
  const [direccion, setDireccion] = useState('');
  const [numViviendas, setNumViviendas] = useState('');

  async function handleGoogleRegistro() {
    setLoading(true);
    try {
      // Guardar código de comunidad antes del redirect para recuperarlo al volver
      if (codigoComunidad) {
        sessionStorage.setItem('registro_codigo_comunidad', codigoComunidad.toUpperCase());
      }
      await signInWithRedirect(auth, googleProvider);
      // La página se recarga — el resultado se procesa en el useEffect de arriba
    } catch (err: any) {
      console.error('[Firebase Auth] Error al iniciar redirect:', err.code, err.message);
      toast.error('Error al iniciar con Google');
      setLoading(false);
    }
  }

  async function handleRegistroUnirse(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre || !email || !password || !codigoComunidad) {
      toast.error('Completa todos los campos');
      return;
    }
    setLoading(true);

    const q = query(collection(db, 'comunidades'), where('codigo', '==', codigoComunidad.toUpperCase()));
    const snap = await getDocs(q);

    if (snap.empty) {
      toast.error('Código de comunidad no encontrado');
      setLoading(false);
      return;
    }

    const comunidadDoc = snap.docs[0];

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: nombre });

      await setDoc(doc(db, 'perfiles', cred.user.uid), {
        comunidad_id: comunidadDoc.id,
        nombre_completo: nombre,
        numero_piso: piso || null,
        rol: 'vecino',
        avatar_url: null,
        telefono: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      router.replace('/inicio');
    } catch (err: any) {
      toast.error(err.message || 'Error al crear la cuenta');
    }
    setLoading(false);
  }

  async function handleRegistroCrear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre || !email || !password || !nombreComunidad || !direccion) {
      toast.error('Completa todos los campos obligatorios');
      return;
    }
    setLoading(true);

    const codigo = Math.random().toString(36).substring(2, 8).toUpperCase();

    try {
      const comunidadRef = await addDoc(collection(db, 'comunidades'), {
        nombre: nombreComunidad,
        direccion,
        codigo,
        num_viviendas: parseInt(numViviendas) || 0,
        created_at: new Date().toISOString(),
      });

      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: nombre });

      await setDoc(doc(db, 'perfiles', cred.user.uid), {
        comunidad_id: comunidadRef.id,
        nombre_completo: nombre,
        numero_piso: piso || null,
        rol: 'presidente',
        avatar_url: null,
        telefono: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      toast.success(`Comunidad creada. Código de acceso: ${codigo}`);
      router.replace('/inicio');
    } catch (err: any) {
      toast.error(err.message || 'Error al crear la cuenta');
    }
    setLoading(false);
  }

  const commonFields = (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="nombre">Nombre completo</Label>
        <Input id="nombre" placeholder="María García López" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="reg-email">Email</Label>
        <Input id="reg-email" type="email" placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="reg-password">Contraseña</Label>
        <div className="relative">
          <Input id="reg-password" type={showPassword ? 'text' : 'password'} placeholder="Mínimo 8 caracteres" value={password} onChange={(e) => setPassword(e.target.value)} required className="pr-10" />
          <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="piso">Número de piso / puerta <span className="text-muted-foreground text-xs">(opcional)</span></Label>
        <Input id="piso" placeholder="Ej: 2B, Bajo Izq" value={piso} onChange={(e) => setPiso(e.target.value)} />
      </div>
    </div>
  );

  return (
    <Card className="shadow-lg border-0">
      <CardHeader className="space-y-1 pb-4">
        <CardTitle className="text-2xl font-semibold text-finca-dark">Crear cuenta</CardTitle>
        <CardDescription>Únete a tu comunidad de vecinos</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          type="button"
          variant="outline"
          className="w-full h-11 font-medium"
          onClick={handleGoogleRegistro}
          disabled={loading}
        >
          <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continuar con Google
        </Button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">o con email</span>
          </div>
        </div>

        <Tabs defaultValue="unirse">
          <TabsList className="w-full mb-4">
            <TabsTrigger value="unirse" className="flex-1">Unirme a comunidad</TabsTrigger>
            <TabsTrigger value="crear" className="flex-1">Crear comunidad</TabsTrigger>
          </TabsList>

          <TabsContent value="unirse">
            <form onSubmit={handleRegistroUnirse} className="space-y-4">
              {commonFields}
              <div className="space-y-1.5">
                <Label htmlFor="codigo">Código de comunidad</Label>
                <Input
                  id="codigo"
                  placeholder="Ej: ABC123"
                  value={codigoComunidad}
                  onChange={(e) => setCodigoComunidad(e.target.value)}
                  className="uppercase"
                  required
                  readOnly={!!searchParams.get('codigo')}
                />
                {searchParams.get('codigo')
                  ? <p className="text-xs text-green-600">Código pre-llenado desde link de invitación</p>
                  : <p className="text-xs text-muted-foreground">Pídele el código a un vecino o al administrador</p>
                }
              </div>
              <Button type="submit" className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-11" disabled={loading}>
                {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><UserPlus className="w-4 h-4 mr-2" />Unirme</>}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="crear">
            <form onSubmit={handleRegistroCrear} className="space-y-4">
              {commonFields}
              <div className="border-t pt-4 space-y-4">
                <p className="text-sm font-medium text-finca-dark flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-finca-coral" />
                  Datos de la comunidad
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="nombre-comunidad">Nombre del edificio</Label>
                  <Input id="nombre-comunidad" placeholder="Ej: Residencial Las Flores" value={nombreComunidad} onChange={(e) => setNombreComunidad(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="direccion">Dirección</Label>
                  <Input id="direccion" placeholder="Calle Mayor 15, Madrid" value={direccion} onChange={(e) => setDireccion(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="num-viviendas">Número de viviendas <span className="text-muted-foreground text-xs">(opcional)</span></Label>
                  <Input id="num-viviendas" type="number" placeholder="Ej: 24" value={numViviendas} onChange={(e) => setNumViviendas(e.target.value)} />
                </div>
              </div>
              <Button type="submit" className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-11" disabled={loading}>
                {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><Building2 className="w-4 h-4 mr-2" />Crear comunidad</>}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </CardContent>
      <CardFooter className="pt-0">
        <p className="text-sm text-center w-full text-muted-foreground">
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" className="text-finca-coral font-medium hover:underline">
            Inicia sesión
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
