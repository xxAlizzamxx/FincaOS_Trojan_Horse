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
  onSnapshot,
  getDoc,
  getDocs,
  collection,
  collectionGroup,
  query,
  where,
  updateDoc,
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
  zona?: string;
  proveedor_asignado?: string;
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
  incidencia_titulo?: string;  // Task 4 — loaded from incidencia doc
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

type Tab = 'disponibles' | 'asignados' | 'presupuestos' | 'valoraciones' | 'perfil';

export default function ProveedorDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [proveedor, setProveedor] = useState<ProveedorProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('disponibles');

  // Tab 1: Disponibles
  const [incidencias, setIncidencias] = useState<Incidencia[]>([]);
  const [loadingIncidencias, setLoadingIncidencias] = useState(false);
  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedIncidencia, setSelectedIncidencia] = useState<Incidencia | null>(null);
  const [precio, setPrecio] = useState('');
  const [comentario, setComentario] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Tab 2: Asignados (Task 1)
  const [asignados, setAsignados] = useState<Incidencia[]>([]);
  const [loadingAsignados, setLoadingAsignados] = useState(false);
  const [updatingEstado, setUpdatingEstado] = useState<string | null>(null);

  // Tab 3: Presupuestos
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [loadingPresupuestos, setLoadingPresupuestos] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  // Tab 4: Valoraciones
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
    if (activeTab === 'asignados') loadAsignados();
    if (activeTab === 'valoraciones') loadValoraciones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, user, proveedor]);

  // Setup presupuestos listener + notifications listener when tab is active
  useEffect(() => {
    if (activeTab !== 'presupuestos' || !user) return;

    console.log('[ProveedorDashboard] Setting up presupuestos listener');
    let unsubscribe: (() => void) | undefined;

    (async () => {
      unsubscribe = await loadPresupuestos();
    })();

    // Mark all notifications as read when opening presupuestos tab (Task 5)
    markNotificationsAsRead();

    return () => {
      if (unsubscribe) {
        console.log('[ProveedorDashboard] Cleaning up presupuestos listener');
        unsubscribe();
      }
    };
  }, [activeTab, user]);

  // Setup notifications listener (Task 5)
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'notificaciones'),
      where('usuario_id', '==', user.uid),
      where('leida', '==', false)
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      setUnreadNotifications(snap.docs.length);
    }, (err) => {
      console.error('[ProveedorDashboard] Error loading notifications:', err);
    });

    return () => unsubscribe();
  }, [user]);

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

  // Task 1: Load assigned work (proveedor_asignado == user.uid, estado NOT IN resuelta/cerrada)
  async function loadAsignados() {
    if (!user) return;
    setLoadingAsignados(true);
    try {
      const q = query(
        collection(db, 'incidencias'),
        where('proveedor_asignado', '==', user.uid),
        where('estado', 'not-in', ['resuelta', 'cerrada'])
      );
      const snap = await getDocs(q);
      const data: Incidencia[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Incidencia, 'id'>),
      }));
      setAsignados(data);
    } catch {
      toast.error('Error al cargar trabajos asignados');
    } finally {
      setLoadingAsignados(false);
    }
  }


  async function loadPresupuestos() {
    if (!user) return;
    setLoadingPresupuestos(true);

    const q = query(
      collectionGroup(db, 'presupuestos'),
      where('proveedor_id', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, async (snap) => {
      console.log('[ProveedorDashboard] Presupuestos actualizados:', snap.docs.length);
      const data: Presupuesto[] = snap.docs.map((d) => ({
        id: d.id,
        idIncidencia: d.ref.parent.parent?.id ?? '',
        ...(d.data() as Omit<Presupuesto, 'id' | 'idIncidencia'>),
      }));

      // Task 4: Load incidencia titles for each presupuesto
      const enriched = await Promise.all(
        data.map(async (p) => {
          try {
            const incDoc = await getDoc(doc(db, 'incidencias', p.idIncidencia));
            if (incDoc.exists()) {
              return {
                ...p,
                incidencia_titulo: (incDoc.data() as any).titulo ?? 'Sin título',
              };
            }
          } catch {
            // Silently fail — presupuesto stays without titulo
          }
          return p;
        })
      );

      setPresupuestos(enriched);
      setLoadingPresupuestos(false);
    }, (err) => {
      console.error('[ProveedorDashboard] Error presupuestos:', err);
      toast.error('Error al cargar presupuestos');
      setLoadingPresupuestos(false);
    });

    return unsubscribe;
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

  async function handleRechazarIncidencia(incidenciaId: string) {
    setIncidencias((prev) => prev.filter((inc) => inc.id !== incidenciaId));
    toast.success('Solicitud rechazada');
  }

  // Task 2: Update work status (asignado → en_ejecucion → resuelta)
  async function handleActualizarEstado(incidenciaId: string, nuevoEstado: string) {
    if (!user) return;
    setUpdatingEstado(incidenciaId);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/proveedor/actualizar-estado', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          incidencia_id: incidenciaId,
          nuevo_estado: nuevoEstado,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Error ${res.status}`);
      }
      toast.success('Estado actualizado');
      // Reload asignados
      await loadAsignados();
    } catch (err: any) {
      toast.error(err.message ?? 'Error al actualizar el estado');
    } finally {
      setUpdatingEstado(null);
    }
  }

  // Task 5: Mark all notifications as read
  async function markNotificationsAsRead() {
    if (!user) return;
    try {
      const q = query(
        collection(db, 'notificaciones'),
        where('usuario_id', '==', user.uid),
        where('leida', '==', false)
      );
      const snap = await getDocs(q);
      // Use Promise.all to update all notifications in parallel
      const promises = snap.docs.map((d) =>
        updateDoc(d.ref, { leida: true })
      );
      await Promise.all(promises);
      setUnreadNotifications(0);
    } catch (err) {
      console.error('[ProveedorDashboard] Error marking notifications as read:', err);
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
    { key: 'asignados', label: 'Trabajos asignados' },
    {
      key: 'presupuestos',
      label: unreadNotifications > 0
        ? `Mis Presupuestos (${unreadNotifications})`
        : 'Mis Presupuestos'
    },
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
                  {/* Meta row: zona + date */}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {inc.zona && <span>📍 {inc.zona}</span>}
                    <span>
                      📅{' '}
                      {new Date(inc.created_at).toLocaleDateString('es-ES', {
                        day: '2-digit',
                        month: 'short',
                      })}
                    </span>
                  </div>
                  {inc.descripcion && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {inc.descripcion}
                    </p>
                  )}
                  {(inc.estimacion_min || inc.estimacion_max) && (
                    <p className="text-xs font-medium text-finca-coral">
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
                  <div className="flex gap-2">
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
                          className="flex-1 bg-finca-coral hover:bg-finca-coral/90 text-white"
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
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 hover:bg-red-50 border-red-200"
                      onClick={() => handleRechazarIncidencia(inc.id)}
                    >
                      Rechazar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </>
        )}

        {/* ── TAB 2: Trabajos asignados ── */}
        {activeTab === 'asignados' && (
          <>
            {loadingAsignados && (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 rounded-full border-4 border-finca-coral border-t-transparent animate-spin" />
              </div>
            )}
            {!loadingAsignados && asignados.length === 0 && (
              <div className="text-center py-12 space-y-2">
                <p className="text-4xl">🔨</p>
                <p className="font-medium text-finca-dark">Sin trabajos asignados</p>
                <p className="text-sm text-muted-foreground">
                  Cuando el admin acepte uno de tus presupuestos, el trabajo aparecerá aquí.
                </p>
              </div>
            )}
            {asignados.map((inc) => {
              const isUpdating = updatingEstado === inc.id;
              return (
                <Card key={inc.id}>
                  <CardContent className="pt-4 space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-sm">{inc.titulo}</p>
                      <Badge
                        variant="secondary"
                        className={`shrink-0 text-xs capitalize ${
                          inc.estado === 'asignado'
                            ? 'bg-blue-100 text-blue-700'
                            : inc.estado === 'en_ejecucion'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {inc.estado === 'asignado'
                          ? 'Asignado'
                          : inc.estado === 'en_ejecucion'
                          ? 'En ejecución'
                          : inc.estado}
                      </Badge>
                    </div>

                    {/* Meta */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {inc.zona && <span>📍 {inc.zona}</span>}
                      {inc.tipo_problema && <span>🔧 {inc.tipo_problema}</span>}
                      <span>
                        📅{' '}
                        {new Date(inc.created_at).toLocaleDateString('es-ES', {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </span>
                    </div>

                    {inc.descripcion && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {inc.descripcion}
                      </p>
                    )}

                    {/* Photos */}
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

                    {/* Action buttons */}
                    {inc.estado === 'asignado' && (
                      <Button
                        size="sm"
                        className="w-full bg-amber-500 hover:bg-amber-600 text-white"
                        disabled={isUpdating}
                        onClick={() => handleActualizarEstado(inc.id, 'en_ejecucion')}
                      >
                        {isUpdating ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          '🔨 Iniciar trabajo'
                        )}
                      </Button>
                    )}
                    {inc.estado === 'en_ejecucion' && (
                      <Button
                        size="sm"
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                        disabled={isUpdating}
                        onClick={() => handleActualizarEstado(inc.id, 'resuelta')}
                      >
                        {isUpdating ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          '✅ Marcar como completado'
                        )}
                      </Button>
                    )}
                    {inc.estado === 'resuelta' && (
                      <p className="text-xs text-emerald-600 font-medium text-center py-1">
                        ✅ Trabajo completado
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </>
        )}

        {/* ── TAB 3: Mis Presupuestos ── */}
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
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-sm line-clamp-1">
                      {p.incidencia_titulo ?? `#${p.idIncidencia.slice(0, 8)}`}
                    </p>
                    <Badge variant={estadoBadgeVariant(p.estado)} className="text-xs capitalize shrink-0">
                      {p.estado}
                    </Badge>
                  </div>
                  <p className="text-base font-bold text-finca-coral">€{p.monto ?? p.precio}</p>
                  {(p.mensaje || p.comentario) && (
                    <p className="text-sm text-muted-foreground">{p.mensaje ?? p.comentario}</p>
                  )}
                  {(p.created_at || (p as any).createdAt) && (
                    <p className="text-xs text-muted-foreground">
                      {new Date((p.created_at as any)?.toDate?.() ?? p.created_at ?? (p as any).createdAt).toLocaleDateString('es-ES', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  )}
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
