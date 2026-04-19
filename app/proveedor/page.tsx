'use client';

/**
 * /proveedor — Smart gate page
 *
 * State machine:
 *   loading          → spinner
 *   guest / vecino   → marketing landing (original content)
 *   proveedor, no servicios/especialidad configured → service setup screen
 *   proveedor, configured → redirect to /proveedor/dashboard
 *
 * "Configured" means: servicios.length > 0 OR especialidad is a non-empty string.
 * This handles both the new onboarding path (servicios array) and old registrations
 * (especialidad string from /proveedor/registro).
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';

// Available service types
const SERVICIOS_DISPONIBLES = [
  { id: 'electricidad',   label: 'Electricidad',     emoji: '⚡' },
  { id: 'fontaneria',     label: 'Fontanería',        emoji: '🔧' },
  { id: 'pintura',        label: 'Pintura',           emoji: '🎨' },
  { id: 'limpieza',       label: 'Limpieza',          emoji: '🧹' },
  { id: 'cerrajeria',     label: 'Cerrajería',        emoji: '🔑' },
  { id: 'albanileria',    label: 'Albañilería',       emoji: '🧱' },
  { id: 'jardineria',     label: 'Jardinería',        emoji: '🌿' },
  { id: 'ascensores',     label: 'Ascensores',        emoji: '🛗' },
  { id: 'climatizacion',  label: 'Climatización',     emoji: '❄️' },
  { id: 'telecomunicaciones', label: 'Telecomunicaciones', emoji: '📡' },
  { id: 'desinfeccion',   label: 'Desinfección/Plagas', emoji: '🐀' },
  { id: 'otros',          label: 'Otros',             emoji: '🔩' },
];

type PageState = 'loading' | 'guest' | 'setup' | 'ready';

export default function ProveedorPage() {
  const router = useRouter();
  const [state, setState] = useState<PageState>('loading');
  const [uid, setUid] = useState<string | null>(null);
  const [selectedServicios, setSelectedServicios] = useState<string[]>([]);
  const [zona, setZona] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setState('guest');
        return;
      }

      try {
        const provSnap = await getDoc(doc(db, 'proveedores', firebaseUser.uid));
        if (!provSnap.exists()) {
          // Logged in but not a proveedor — show marketing landing
          setState('guest');
          return;
        }

        const data = provSnap.data();
        setUid(firebaseUser.uid);

        // "Configured" if they have at least one servicio OR a non-empty especialidad
        const isConfigured =
          (Array.isArray(data.servicios) && data.servicios.length > 0) ||
          (typeof data.especialidad === 'string' && data.especialidad.trim() !== '');

        if (isConfigured) {
          // Already set up — send straight to dashboard
          setState('ready');
          router.replace('/proveedor/dashboard');
        } else {
          // Needs setup
          setState('setup');
          // Pre-fill from existing data if any
          if (Array.isArray(data.servicios)) setSelectedServicios(data.servicios);
          if (data.zona) setZona(data.zona);
        }
      } catch {
        // Network error — fall back to marketing
        setState('guest');
      }
    });

    return () => unsubscribe();
  }, [router]);

  function toggleServicio(id: string) {
    setSelectedServicios((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }

  async function handleGuardarServicios() {
    if (!uid || selectedServicios.length === 0) {
      toast.error('Selecciona al menos un servicio');
      return;
    }
    setSaving(true);
    try {
      // Use the first selected service as `especialidad` for backward compat
      await updateDoc(doc(db, 'proveedores', uid), {
        servicios:    selectedServicios,
        especialidad: selectedServicios[0],
        zona:         zona.trim() || '',
        updated_at:   new Date().toISOString(),
      });
      toast.success('¡Perfil configurado! Bienvenido a FincaOS.');
      router.replace('/proveedor/dashboard');
    } catch (err: any) {
      console.error('[/proveedor] Error guardando servicios:', err?.code ?? err);
      toast.error('Error al guardar. Inténtalo de nuevo.');
      setSaving(false);
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (state === 'loading' || state === 'ready') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 rounded-full border-4 border-finca-coral border-t-transparent animate-spin" />
      </div>
    );
  }

  // ── Service setup screen ──────────────────────────────────────────────────
  if (state === 'setup') {
    return (
      <div className="min-h-screen bg-background px-4 py-10 flex flex-col items-center">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <div className="text-4xl">🛠️</div>
            <h1 className="text-2xl font-semibold">Configura tus servicios</h1>
            <p className="text-sm text-muted-foreground">
              Selecciona los tipos de trabajo que ofreces. Las comunidades te filtrarán por especialidad.
            </p>
          </div>

          {/* Service chips */}
          <div className="flex flex-wrap gap-2 justify-center">
            {SERVICIOS_DISPONIBLES.map((s) => {
              const active = selectedServicios.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleServicio(s.id)}
                  className={[
                    'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                    active
                      ? 'bg-finca-coral text-white border-finca-coral'
                      : 'bg-background text-foreground border-border hover:border-finca-coral/60',
                  ].join(' ')}
                >
                  <span>{s.emoji}</span>
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Zone input */}
          <div className="space-y-1.5">
            <label htmlFor="zona" className="text-sm font-medium">
              Zona de trabajo <span className="text-muted-foreground text-xs">(opcional)</span>
            </label>
            <input
              id="zona"
              type="text"
              placeholder="Ej: Madrid centro, Barcelona, ..."
              value={zona}
              onChange={(e) => setZona(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <Button
            onClick={handleGuardarServicios}
            disabled={saving || selectedServicios.length === 0}
            className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-11"
          >
            {saving
              ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : 'Guardar y entrar al panel'
            }
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Podrás modificar tus servicios en cualquier momento desde tu perfil.
          </p>
        </div>
      </div>
    );
  }

  // ── Marketing landing (guest / non-provider) ──────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="flex flex-col items-center justify-center px-6 py-20 text-center bg-gradient-to-br from-finca-peach/30 via-background to-background">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          ¿Eres proveedor de servicios?
          <br />
          <span className="text-finca-coral">Únete a FincaOS</span>
        </h1>
        <p className="mt-4 max-w-xl text-muted-foreground text-base sm:text-lg">
          Recibe solicitudes de comunidades en tu zona, envía presupuestos y acumula valoraciones.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3">
          <Button
            asChild
            className="bg-finca-coral hover:bg-finca-coral/90 text-white"
            size="lg"
          >
            <Link href="/proveedor/registro">Registrarme como proveedor</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/proveedor/login">Ya tengo cuenta → Entrar</Link>
          </Button>
        </div>
      </section>

      {/* Benefits */}
      <section className="px-6 py-16 max-w-4xl mx-auto">
        <h2 className="text-xl font-semibold text-center mb-10">¿Por qué unirte?</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <Card>
            <CardContent className="pt-6">
              <div className="text-3xl mb-3">📩</div>
              <h3 className="font-semibold text-base mb-1">Recibe solicitudes automáticas</h3>
              <p className="text-sm text-muted-foreground">
                Las comunidades publican incidencias y tú las recibes filtradas por especialidad y zona.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-3xl mb-3">💶</div>
              <h3 className="font-semibold text-base mb-1">Presupuesta en digital</h3>
              <p className="text-sm text-muted-foreground">
                Envía presupuestos directamente desde la plataforma, sin llamadas ni papeles.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-3xl mb-3">⭐</div>
              <h3 className="font-semibold text-base mb-1">Sube en el ranking</h3>
              <p className="text-sm text-muted-foreground">
                Acumula valoraciones de vecinos y destaca frente a otros proveedores de tu sector.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
