'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Building2, UserPlus } from 'lucide-react';
import { doc, setDoc, updateDoc, collection, query, where, getDocs, addDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { perfil, user } = useAuth();
  const [loading, setLoading] = useState(false);

  const [piso, setPiso] = useState('');
  const [codigoComunidad, setCodigoComunidad] = useState('');

  // Pre-rellenar el código si viene de un link de invitación (?codigo=XXXXX)
  useEffect(() => {
    const code = searchParams.get('codigo');
    if (code) setCodigoComunidad(code.toUpperCase());
  }, [searchParams]);

  const [nombreComunidad, setNombreComunidad] = useState('');
  const [direccion, setDireccion] = useState('');
  const [numViviendas, setNumViviendas] = useState('');

  async function handleUnirse(e: React.FormEvent) {
    e.preventDefault();
    if (!codigoComunidad || !user) return;
    setLoading(true);

    try {
      const q = query(collection(db, 'comunidades'), where('codigo', '==', codigoComunidad.toUpperCase()));
      const snap = await getDocs(q);

      if (snap.empty) {
        toast.error('Código de comunidad no encontrado');
        setLoading(false);
        return;
      }

      const comunidadDoc = snap.docs[0];

      // Usamos setDoc con merge para que funcione tanto si el perfil ya existe
      // como si fue creado de forma incompleta (race condition en registro Google)
      await setDoc(doc(db, 'perfiles', user.uid), {
        comunidad_id:  comunidadDoc.id,
        numero_piso:   piso || null,
        rol:           perfil?.rol ?? 'vecino',   // preservar rol si ya existe
        nombre_completo: perfil?.nombre_completo ?? user.displayName ?? 'Usuario',
        avatar_url:    perfil?.avatar_url ?? user.photoURL ?? null,
        telefono:      perfil?.telefono ?? null,
        updated_at:    new Date().toISOString(),
        created_at:    perfil?.created_at ?? new Date().toISOString(),
      }, { merge: true });

      toast.success('¡Te has unido a la comunidad!');
      window.location.href = '/inicio';
    } catch (err: any) {
      console.error('[Onboarding] Error al unirse:', err);
      toast.error('Error al unirse a la comunidad. Inténtalo de nuevo.');
      setLoading(false);
    }
  }

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombreComunidad || !direccion || !perfil) return;
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

      await updateDoc(doc(db, 'perfiles', perfil.id), {
        comunidad_id: comunidadRef.id,
        numero_piso: piso || null,
        rol: 'presidente',
        updated_at: new Date().toISOString(),
      });

      toast.success(`Comunidad creada. Código: ${codigo}`);
      window.location.href = '/inicio';
    } catch {
      toast.error('Error al crear la comunidad');
    }
    setLoading(false);
  }

  return (
    <div className="px-4 py-8 max-w-sm mx-auto space-y-6">
      <div className="text-center space-y-2">
        <div className="w-16 h-16 bg-finca-peach/50 rounded-full flex items-center justify-center mx-auto">
          <Building2 className="w-8 h-8 text-finca-coral" />
        </div>
        <h1 className="text-2xl font-semibold text-finca-dark">
          Hola, {perfil?.nombre_completo?.split(' ')[0] || user?.displayName?.split(' ')[0] || 'vecino'}
        </h1>
        <p className="text-sm text-muted-foreground">
          Únete a tu comunidad para empezar
        </p>
      </div>

      <Card className="border-0 shadow-lg">
        <CardContent className="pt-6">
          <Tabs defaultValue="unirse">
            <TabsList className="w-full mb-4">
              <TabsTrigger value="unirse" className="flex-1">Unirme</TabsTrigger>
              <TabsTrigger value="crear" className="flex-1">Crear nueva</TabsTrigger>
            </TabsList>

            <TabsContent value="unirse">
              <form onSubmit={handleUnirse} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="codigo">Código de comunidad</Label>
                  <Input
                    id="codigo"
                    placeholder="Ej: ABC123"
                    value={codigoComunidad}
                    onChange={(e) => setCodigoComunidad(e.target.value)}
                    className="uppercase text-center text-lg tracking-widest"
                    required
                  />
                  <p className="text-xs text-muted-foreground">Pídele el código a un vecino o al administrador</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="piso-u">Piso / puerta <span className="text-muted-foreground text-xs">(opcional)</span></Label>
                  <Input id="piso-u" placeholder="Ej: 2B" value={piso} onChange={(e) => setPiso(e.target.value)} />
                </div>
                <Button type="submit" className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-11" disabled={loading || !codigoComunidad}>
                  {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><UserPlus className="w-4 h-4 mr-2" />Unirme a la comunidad</>}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="crear">
              <form onSubmit={handleCrear} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="nombre-c">Nombre del edificio</Label>
                  <Input id="nombre-c" placeholder="Ej: Residencial Las Flores" value={nombreComunidad} onChange={(e) => setNombreComunidad(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dir">Dirección</Label>
                  <Input id="dir" placeholder="Calle Mayor 15, Madrid" value={direccion} onChange={(e) => setDireccion(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="num-v">Nº viviendas <span className="text-muted-foreground text-xs">(opcional)</span></Label>
                  <Input id="num-v" type="number" placeholder="Ej: 24" value={numViviendas} onChange={(e) => setNumViviendas(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="piso-c">Tu piso / puerta <span className="text-muted-foreground text-xs">(opcional)</span></Label>
                  <Input id="piso-c" placeholder="Ej: 2B" value={piso} onChange={(e) => setPiso(e.target.value)} />
                </div>
                <Button type="submit" className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-11" disabled={loading || !nombreComunidad || !direccion}>
                  {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><Building2 className="w-4 h-4 mr-2" />Crear comunidad</>}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
