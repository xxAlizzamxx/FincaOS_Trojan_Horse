'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  onAuthStateChanged,
  signOut as firebaseSignOut,
  User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocs,
  collection,
  collectionGroup,
  query,
  where,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

interface ProveedorProfile {
  uid: string;
  nombre: string;
  especialidad: string;     // legacy single-service field
  servicios?: string[];     // new multi-service array (from /proveedor setup screen)
  zona: string;
  email: string;
  rating: number;
  trabajosRealizados: number;
  createdAt: string;
}

interface Incidencia {
  id: string;
  titulo: string;
  descripcion: string | null;
  categoria: string;
  tipo_problema?: string;   // technical routing field — matches proveedor.servicios
  estado: string;
  estimacion_ia?: { min: number; max: number } | null;
  estimacion_min?: number | null;
  estimacion_max?: number | null;
  fotos?: Array<{ storage_path?: string; url?: string }>;
  created_at: string;
}

interface Presupuesto {
  id: string;
  idIncidencia: string;
  proveedor_id?: string;
  proveedor_nombre?: string;
  monto: number;
  mensaje: string;
  estado: string;
  created_at: any;
  // legacy fields (top-level collection)
  precio?: number;
  comentario?: string;
}

interface Valoracion {
  id: string;
  rating: number;
  comentario: string;
  createdAt: string;
}

type Tab = 'disponibles' | 'presupuestos' | 'valoraciones' | 'perfil';

export default function ProveedorDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [proveedor, setProveedor] = useState<ProveedorProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('disponibles');

  // Tab 1
  const [incidencias, setIncidencias] = useState<Incidencia[]>([]);
  const [loadingIncidencias, setLoadingIncidencias] = useState(false);
  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedIncidencia, setSelectedIncidencia] = useState<Incidencia | null>(null);
  const [precio, setPrecio] = useState('');
  const [comentario, setComentario] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Tab 2
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [loadingPresupuestos, setLoadingPresupuestos] = useState(false);

  // Tab 3
  const [valoraciones, setValoraciones] = useState<Valoracion[]>([]);
  const [loadingValoraciones, setLoadingValoraciones] = useState(false);

  // Auth + role check (single-role system — proveedores takes priority)
  //
  // Resolution order:
  //   1. Not authenticated             → /proveedor/login
  //   2. Has proveedores doc           → ✅ load dashboard
  //   3. Has perfiles doc (vecino)     → /inicio  (wrong portal)
  //   4. Neither doc                   → /proveedor/login
  //   5. Network / Firestore error     → /proveedor/login  (safe fallback, never stuck)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        router.replace('/proveedor/login');
        return;
      }

      try {
        // Step 1 — is this user a provider? (proveedores always wins)
        const provSnap = await getDoc(doc(db, 'proveedores', firebaseUser.uid));
        if (provSnap.exists()) {
          setUser(firebaseUser);
          setProveedor(provSnap.data() as ProveedorProfile);
          setAuthLoading(false);
          return;
        }

        // Step 2 — is this a vecino/admin who accidentally landed here?
        const perfilSnap = await getDoc(doc(db, 'perfiles', firebaseUser.uid));
        if (perfilSnap.exists()) {
          router.replace('/inicio');
          return;
        }

        // Step 3 — unknown/incomplete registration
        router.replace('/proveedor/login');
      } catch {
        // Network error or Firestore unavailable:
        // Never leave the user stuck on an infinite spinner.
        // Safe fallback → login page (they can retry).
        router.replace('/proveedor/login');
      }
    });
    return () => unsub();
  }, [router]);

  // Load data when tab changes
  useEffect(() => {
    if (!user || !proveedor) return;
    if (activeTab === 'disponibles') loadIncidencias();
    if (activeTab === 'presupuestos') loadPresupuestos();
    if (activeTab === 'valoraciones') loadValoraciones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, user, proveedor]);

  async function loadIncidencias() {
    if (!proveedor) return;
    setLoadingIncidencias(true);
    try {
      const q = query(
        collection(db, 'incidencias'),
        where('estado', 'in', ['pendiente', 'en_revision'])
      );
      const snap = await getDocs(q);
      const all: Incidencia[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Incidencia, 'id'>),
      }));

      // Build the service set for this provider.
      // New providers have servicios[] from the setup screen.
      // Legacy providers only have especialidad (string) — wrap it in an array.
      const servicios: string[] =
        proveedor.servicios && proveedor.servicios.length > 0
          ? proveedor.servicios
          : proveedor.especialidad
          ? [proveedor.especialidad]
          : [];

      // Filter by tipo_problema matching one of the provider's services.
      // Incidencias without tipo_problema are legacy — skip them (per spec).
      const filtered = all.filter(
        (inc) => inc.tipo_problema && servicios.includes(inc.tipo_problema)
      );

      setIncidencias(filtered);
    } catch {
      toast.error('Error al cargar incidencias');
    } finally {
      setLoadingIncidencias(false);
    }
  }

  async function loadPresupuestos() {
    if (!user) return;
    setLoadingPresupuestos(true);
    try {
      const q = query(
        collectionGroup(db, 'presupuestos'),
        where('proveedor_id', '==', user.uid)
      );
      const snap = await getDocs(q);
      const data: Presupuesto[] = snap.docs.map((d) => ({
        id: d.id,
        idIncidencia: d.ref.parent.parent?.id ?? '',
        ...(d.data() as Omit<Presupuesto, 'id' | 'idIncidencia'>),
      }));
      setPresupuestos(data);
    } catch {
      toast.error('Error al cargar presupuestos');
    } finally {
      setLoadingPresupuestos(false);
    }
  }

  async function loadValoraciones() {
    if (!user) return;
    setLoadingValoraciones(true);
    try {
      const q = query(
        collection(db, 'valoraciones_proveedor'),
        where('proveedorId', '==', user.uid)
      );
      const snap = await getDocs(q);
      const data: Valoracion[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Valoracion, 'id'>),
      }));
      setValoraciones(data);
    } catch {
      toast.error('Error al cargar valoraciones');
    } finally {
      setLoadingValoraciones(false);
    }
  }

  async function handleEnviarPresupuesto() {
    if (!selectedIncidencia || !user || !proveedor) return;
    if (!precio || isNaN(Number(precio))) {
      toast.error('Introduce un precio válido');
      return;
    }
    setSubmitting(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/proveedor/presupuesto', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          incidencia_id: selectedIncidencia.id,
          monto: Number(precio),
          mensaje: comentario,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Error ${res.status}`);
      }
      toast.success('Presupuesto enviado');
      setModalOpen(false);
      setPrecio('');
      setComentario('');
      setSelectedIncidencia(null);
    } catch (err: any) {
      toast.error(err.message ?? 'Error al enviar el presupuesto');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    await firebaseSignOut(auth);
    router.replace('/proveedor/login');
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-4 border-finca-coral border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!user || !proveedor) return null;

  const avgRating =
    valoraciones.length > 0
      ? (valoraciones.reduce((s, v) => s + v.rating, 0) / valoraciones.length).toFixed(1)
      : '—';

  const TABS: { key: Tab; label: string }[] = [
    { key: 'disponibles', label: 'Disponibles' },
    { key: 'presupuestos', label: 'Mis Presupuestos' },
    { key: 'valoraciones', label: 'Valoraciones' },
    { key: 'perfil', label: 'Mi Perfil' },
  ];

  const estadoBadgeVariant = (estado: string) => {
    if (estado === 'aceptado') return 'default';
    if (estado === 'rechazado') return 'destructive';
    return 'secondary';
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Navbar */}
      <header className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center justify-between">
        <div>
          <span className="font-semibold text-base">{proveedor.nombre}</span>
          <span className="ml-2 text-xs text-muted-foreground">{proveedor.especialidad}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={handleSignOut}>
          Cerrar sesión
        </Button>
      </header>

      {/* Tabs */}
      <nav className="flex border-b overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === t.key
                ? 'border-b-2 border-finca-coral text-finca-coral'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 p-4 max-w-2xl mx-auto w-full space-y-4">
        {/* ── TAB 1: Disponibles ── */}
        {activeTab === 'disponibles' && (
          <>
            {loadingIncidencias && (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 rounded-full border-4 border-finca-coral border-t-transparent animate-spin" />
              </div>
            )}
            {!loadingIncidencias && incidencias.length === 0 && (
              <p className="text-center text-muted-foreground py-8">
                No hay incidencias disponibles para tus servicios (
                {(proveedor.servicios?.length ? proveedor.servicios : [proveedor.especialidad]).join(', ')}
                ).
              </p>
            )}
            {incidencias.map((inc) => (
              <Card key={inc.id}>
                <CardContent className="pt-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-sm">{inc.titulo}</p>
                    <Badge variant="secondary" className="shrink-0 text-xs capitalize">
                      {inc.tipo_problema ?? inc.categoria}
                    </Badge>
                  </div>
                  {inc.descripcion && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {inc.descripcion}
                    </p>
                  )}
                  {(inc.estimacion_min || inc.estimacion_max) && (
                    <p className="text-xs text-muted-foreground">
                      Estimación IA: €{inc.estimacion_min ?? '?'} — €{inc.estimacion_max ?? '?'}
                    </p>
                  )}
                  {inc.fotos && inc.fotos.length > 0 && (
                    <div className="w-20 h-20 rounded overflow-hidden bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={inc.fotos[0].url ?? inc.fotos[0].storage_path ?? ''}
                        alt="foto"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    </div>
                  )}
                  <Dialog
                    open={modalOpen && selectedIncidencia?.id === inc.id}
                    onOpenChange={(open) => {
                      setModalOpen(open);
                      if (!open) {
                        setSelectedIncidencia(null);
                        setPrecio('');
                        setComentario('');
                      }
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button
                        size="sm"
                        className="bg-finca-coral hover:bg-finca-coral/90 text-white"
                        onClick={() => {
                          setSelectedIncidencia(inc);
                          setModalOpen(true);
                        }}
                      >
                        Enviar presupuesto
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Enviar presupuesto</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 pt-2">
                        <p className="text-sm text-muted-foreground">{inc.titulo}</p>
                        <div className="space-y-1">
                          <Label htmlFor="precio">Precio (€)</Label>
                          <Input
                            id="precio"
                            type="number"
                            min={0}
                            value={precio}
                            onChange={(e) => setPrecio(e.target.value)}
                            placeholder="0"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="comentario">Comentario</Label>
                          <Textarea
                            id="comentario"
                            value={comentario}
                            onChange={(e) => setComentario(e.target.value)}
                            placeholder="Describe brevemente tu propuesta…"
                            rows={3}
                          />
                        </div>
                        <Button
                          className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white"
                          onClick={handleEnviarPresupuesto}
                          disabled={submitting}
                        >
                          {submitting ? 'Enviando…' : 'Enviar presupuesto'}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>
            ))}
          </>
        )}

        {/* ── TAB 2: Mis Presupuestos ── */}
        {activeTab === 'presupuestos' && (
          <>
            {loadingPresupuestos && (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 rounded-full border-4 border-finca-coral border-t-transparent animate-spin" />
              </div>
            )}
            {!loadingPresupuestos && presupuestos.length === 0 && (
              <p className="text-center text-muted-foreground py-8">
                Aún no has enviado ningún presupuesto.
              </p>
            )}
            {presupuestos.map((p) => (
              <Card key={p.id}>
                <CardContent className="pt-4 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground font-mono">
                      #{p.idIncidencia.slice(0, 8)}
                    </p>
                    <Badge variant={estadoBadgeVariant(p.estado)} className="text-xs capitalize">
                      {p.estado}
                    </Badge>
                  </div>
                  <p className="font-semibold text-sm">€{p.precio}</p>
                  {p.comentario && (
                    <p className="text-sm text-muted-foreground">{p.comentario}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {new Date(p.createdAt).toLocaleDateString('es-ES', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                </CardContent>
              </Card>
            ))}
          </>
        )}

        {/* ── TAB 3: Valoraciones ── */}
        {activeTab === 'valoraciones' && (
          <>
            {loadingValoraciones && (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 rounded-full border-4 border-finca-coral border-t-transparent animate-spin" />
              </div>
            )}
            {!loadingValoraciones && valoraciones.length === 0 && (
              <p className="text-center text-muted-foreground py-8">
                Aún no tienes valoraciones. Completa trabajos para recibir puntuaciones.
              </p>
            )}
            {!loadingValoraciones && valoraciones.length > 0 && (
              <>
                <div className="text-center py-4">
                  <p className="text-5xl font-bold">⭐ {avgRating}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {valoraciones.length} valoración{valoraciones.length !== 1 ? 'es' : ''}
                  </p>
                </div>
                {valoraciones.map((v) => (
                  <Card key={v.id}>
                    <CardContent className="pt-4 space-y-1">
                      <p className="text-sm font-medium">
                        {'⭐'.repeat(v.rating)}
                        {'☆'.repeat(5 - v.rating)}
                      </p>
                      {v.comentario && (
                        <p className="text-sm text-muted-foreground">{v.comentario}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </>
            )}
          </>
        )}

        {/* ── TAB 4: Mi Perfil ── */}
        {activeTab === 'perfil' && (
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Nombre</p>
                <p className="font-medium">{proveedor.nombre}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Especialidad</p>
                <p className="font-medium capitalize">{proveedor.especialidad}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Zona</p>
                <p className="font-medium">{proveedor.zona}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Email</p>
                <p className="font-medium">{proveedor.email}</p>
              </div>
              <div className="flex gap-8">
                <div>
                  <p className="text-xs text-muted-foreground">Rating</p>
                  <p className="font-medium">⭐ {proveedor.rating}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Trabajos realizados</p>
                  <p className="font-medium">{proveedor.trabajosRealizados}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Miembro desde</p>
                <p className="font-medium">
                  {new Date(proveedor.createdAt).toLocaleDateString('es-ES', {
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full mt-4"
                onClick={handleSignOut}
              >
                Cerrar sesión
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
