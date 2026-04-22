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
import {
  Star, Briefcase, ClipboardList, Award, User as UserIcon,
  LogOut, Bell, ChevronRight, MapPin, Wrench, Calendar,
  CheckCircle2, Play, AlertCircle,
} from 'lucide-react';

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
  // Rejected incidencias — persisted in localStorage so they stay gone after reload
  const getRejectedKey = (uid: string) => `finca:proveedor_rechazadas:${uid}`;
  function loadRejected(uid: string): Set<string> {
    try {
      const raw = localStorage.getItem(getRejectedKey(uid));
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  }
  function saveRejected(uid: string, set: Set<string>) {
    try { localStorage.setItem(getRejectedKey(uid), JSON.stringify([...set])); } catch { /* quota */ }
  }
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
      // Also exclude incidencias the provider has previously rejected (localStorage).
      const rejected = user ? loadRejected(user.uid) : new Set<string>();
      const filtered = all.filter(
        (inc) =>
          inc.tipo_problema &&
          servicios.includes(inc.tipo_problema) &&
          !rejected.has(inc.id)
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

  function handleRechazarIncidencia(incidenciaId: string) {
    // Remove from UI immediately
    setIncidencias((prev) => prev.filter((inc) => inc.id !== incidenciaId));
    // Persist rejection so it doesn't reappear on reload
    if (user) {
      const rejected = loadRejected(user.uid);
      rejected.add(incidenciaId);
      saveRejected(user.uid, rejected);
    }
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
    { key: 'disponibles',  label: 'Disponibles' },
    { key: 'asignados',    label: 'Trabajos asignados' },
    { key: 'presupuestos', label: 'Mis Presupuestos' },
    { key: 'valoraciones', label: 'Valoraciones' },
    { key: 'perfil',       label: 'Mi Perfil' },
  ];

  const estadoBadgeVariant = (estado: string) => {
    if (estado === 'aceptado') return 'default';
    if (estado === 'rechazado') return 'destructive';
    return 'secondary';
  };

  // Compute initials for avatar
  const initials = proveedor.nombre
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  const SERVICIOS_LABELS: Record<string, string> = {
    electricidad: '⚡', fontaneria: '🔧', pintura: '🎨', limpieza: '🧹',
    cerrajeria: '🔑', albanileria: '🧱', jardineria: '🌿', ascensores: '🛗',
    climatizacion: '❄️', telecomunicaciones: '📡', desinfeccion: '🐀', otros: '🔩',
  };

  const servicioEmojis = (proveedor.servicios ?? [proveedor.especialidad])
    .map((s) => SERVICIOS_LABELS[s] ?? '🔧')
    .join(' ');

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white flex flex-col">
      {/* ── Hero header ── */}
      <header className="relative overflow-hidden">
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-finca-coral via-finca-salmon to-orange-400 opacity-90" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.15),transparent_70%)]" />

        <div className="relative px-4 pt-10 pb-5 flex items-end gap-4">
          {/* Avatar circle */}
          <div className="relative shrink-0">
            <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm border-2 border-white/40 flex items-center justify-center shadow-lg">
              <span className="text-2xl font-bold text-white">{initials}</span>
            </div>
            {/* Online indicator */}
            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-400 border-2 border-white" />
          </div>

          {/* Name + info */}
          <div className="flex-1 min-w-0 pb-1">
            <h1 className="text-xl font-bold text-white leading-tight truncate">
              {proveedor.nombre}
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-sm text-white/80 capitalize">{proveedor.especialidad}</span>
              {servicioEmojis && (
                <span className="text-xs bg-white/20 text-white rounded-full px-2 py-0.5">
                  {servicioEmojis}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-white/70">
              <span className="flex items-center gap-1">
                <Star className="w-3 h-3 fill-yellow-300 text-yellow-300" />
                {proveedor.rating || '—'}
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {proveedor.trabajosRealizados || 0} trabajos
              </span>
              {proveedor.zona && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {proveedor.zona}
                </span>
              )}
            </div>
          </div>

          {/* Sign out */}
          <button
            onClick={handleSignOut}
            className="shrink-0 w-9 h-9 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
          >
            <LogOut className="w-4 h-4 text-white" />
          </button>
        </div>

        {/* Notification bell (bottom-right corner) */}
        {unreadNotifications > 0 && (
          <button
            onClick={() => setActiveTab('presupuestos')}
            className="absolute top-4 right-4 flex items-center gap-1.5 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white rounded-full px-3 py-1.5 text-xs font-semibold transition-colors"
          >
            <Bell className="w-3.5 h-3.5 animate-pulse" />
            {unreadNotifications} nuevo{unreadNotifications > 1 ? 's' : ''}
          </button>
        )}
      </header>

      {/* ── Tab bar ── */}
      <nav className="flex bg-white border-b overflow-x-auto shadow-sm sticky top-0 z-10">
        {TABS.map((t) => {
          const isActive = activeTab === t.key;
          const icons: Record<Tab, React.ReactNode> = {
            disponibles:  <Briefcase  className="w-3.5 h-3.5" />,
            asignados:    <Wrench     className="w-3.5 h-3.5" />,
            presupuestos: <ClipboardList className="w-3.5 h-3.5" />,
            valoraciones: <Award      className="w-3.5 h-3.5" />,
            perfil:       <UserIcon   className="w-3.5 h-3.5" />,
          };
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`
                flex items-center gap-1.5 px-3 py-3 text-xs font-semibold whitespace-nowrap transition-all
                ${isActive
                  ? 'border-b-2 border-finca-coral text-finca-coral bg-finca-peach/20'
                  : 'text-muted-foreground hover:text-finca-dark border-b-2 border-transparent'}
              `}
            >
              {icons[t.key]}
              <span className="hidden sm:inline">{t.label}</span>
              <span className="sm:hidden">
                {t.key === 'disponibles'  ? 'Disp.'  :
                 t.key === 'asignados'    ? 'Asign.' :
                 t.key === 'presupuestos' ? 'Presup.' :
                 t.key === 'valoraciones' ? 'Val.'   : 'Perfil'}
              </span>
            </button>
          );
        })}
      </nav>

      <main className="flex-1 p-4 max-w-2xl mx-auto w-full space-y-3 pb-10">

        {/* ── TAB 1: Disponibles ── */}
        {activeTab === 'disponibles' && (
          <>
            {loadingIncidencias && (
              <div className="flex justify-center py-12">
                <div className="w-7 h-7 rounded-full border-[3px] border-finca-coral border-t-transparent animate-spin" />
              </div>
            )}
            {!loadingIncidencias && incidencias.length === 0 && (
              <div className="py-14 text-center space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-finca-peach/50 flex items-center justify-center mx-auto">
                  <Briefcase className="w-7 h-7 text-finca-coral/60" />
                </div>
                <p className="font-semibold text-finca-dark">Sin solicitudes disponibles</p>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto leading-relaxed">
                  No hay incidencias pendientes para{' '}
                  {(proveedor.servicios?.length ? proveedor.servicios : [proveedor.especialidad]).join(', ')}.
                </p>
              </div>
            )}
            {incidencias.map((inc, idx) => {
              const serviceEmoji = SERVICIOS_LABELS[inc.tipo_problema ?? ''] ?? '🔧';
              const hasEstimacion = inc.estimacion_min || inc.estimacion_max ||
                inc.estimacion_ia?.min || inc.estimacion_ia?.max;
              const eMin = inc.estimacion_min ?? inc.estimacion_ia?.min;
              const eMax = inc.estimacion_max ?? inc.estimacion_ia?.max;

              return (
                <div
                  key={inc.id}
                  className="animate-in fade-in slide-in-from-bottom-2 duration-300"
                  style={{ animationDelay: `${idx * 60}ms` }}
                >
                  <Card className="border-0 shadow-sm rounded-2xl overflow-hidden hover:shadow-md transition-all duration-200">
                    {/* Top accent bar */}
                    <div className="h-1 bg-gradient-to-r from-finca-coral to-orange-400" />
                    <CardContent className="pt-4 pb-4 space-y-3">
                      {/* Title + service badge */}
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-sm text-finca-dark leading-snug flex-1">
                          {inc.titulo}
                        </p>
                        <span className="shrink-0 text-xs bg-finca-peach text-finca-coral font-semibold rounded-full px-2.5 py-0.5 border border-finca-coral/20">
                          {serviceEmoji} {inc.tipo_problema ?? inc.categoria}
                        </span>
                      </div>

                      {/* Meta row */}
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {inc.zona && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {inc.zona}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(inc.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                        </span>
                      </div>

                      {/* Description + photo side by side */}
                      <div className="flex gap-3">
                        <div className="flex-1 min-w-0">
                          {inc.descripcion && (
                            <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                              {inc.descripcion}
                            </p>
                          )}
                          {hasEstimacion && (
                            <div className="mt-2 inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-full px-2.5 py-0.5 text-xs font-semibold">
                              ✨ IA: €{eMin ?? '?'} – €{eMax ?? '?'}
                            </div>
                          )}
                        </div>
                        {inc.fotos && inc.fotos.length > 0 && (
                          <div className="w-20 h-20 rounded-xl overflow-hidden bg-muted shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={inc.fotos[0].url ?? inc.fotos[0].storage_path ?? ''}
                              alt="foto"
                              className="w-full h-full object-cover"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          </div>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex gap-2 pt-1">
                        <Dialog
                          open={modalOpen && selectedIncidencia?.id === inc.id}
                          onOpenChange={(open) => {
                            setModalOpen(open);
                            if (!open) { setSelectedIncidencia(null); setPrecio(''); setComentario(''); }
                          }}
                        >
                          <DialogTrigger asChild>
                            <Button
                              size="sm"
                              className="flex-1 bg-finca-coral hover:bg-finca-coral/90 text-white rounded-xl font-semibold shadow-sm"
                              onClick={() => { setSelectedIncidencia(inc); setModalOpen(true); }}
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
                                <Input id="precio" type="number" min={0} value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="0" />
                              </div>
                              <div className="space-y-1">
                                <Label htmlFor="comentario">Comentario</Label>
                                <Textarea id="comentario" value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Describe brevemente tu propuesta…" rows={3} />
                              </div>
                              <Button className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white" onClick={handleEnviarPresupuesto} disabled={submitting}>
                                {submitting ? 'Enviando…' : 'Enviar presupuesto'}
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-xl text-red-500 hover:bg-red-50 border-red-200 hover:border-red-300"
                          onClick={() => handleRechazarIncidencia(inc.id)}
                        >
                          Rechazar
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </>
        )}

        {/* ── TAB 2: Trabajos asignados ── */}
        {activeTab === 'asignados' && (
          <>
            {loadingAsignados && (
              <div className="flex justify-center py-12">
                <div className="w-7 h-7 rounded-full border-[3px] border-finca-coral border-t-transparent animate-spin" />
              </div>
            )}
            {!loadingAsignados && asignados.length === 0 && (
              <div className="py-14 text-center space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto">
                  <Wrench className="w-7 h-7 text-amber-400" />
                </div>
                <p className="font-semibold text-finca-dark">Sin trabajos asignados</p>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto leading-relaxed">
                  Cuando el administrador acepte uno de tus presupuestos, aparecerá aquí.
                </p>
              </div>
            )}
            {asignados.map((inc, idx) => {
              const isUpdating = updatingEstado === inc.id;
              const statusConfig = {
                asignado:    { label: 'Asignado',     cls: 'bg-blue-50 text-blue-700 border-blue-200',   bar: 'bg-blue-500'   },
                en_ejecucion:{ label: 'En ejecución', cls: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'bg-amber-400'  },
                resuelta:    { label: 'Completado',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500' },
              }[inc.estado] ?? { label: inc.estado, cls: 'bg-gray-100 text-gray-600 border-gray-200', bar: 'bg-gray-400' };

              return (
                <div
                  key={inc.id}
                  className="animate-in fade-in slide-in-from-bottom-2 duration-300"
                  style={{ animationDelay: `${idx * 60}ms` }}
                >
                  <Card className="border-0 shadow-sm rounded-2xl overflow-hidden hover:shadow-md transition-all duration-200">
                    {/* Status accent bar */}
                    <div className={`h-1 ${statusConfig.bar}`} />
                    <CardContent className="pt-4 pb-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-sm text-finca-dark leading-snug flex-1">{inc.titulo}</p>
                        <span className={`shrink-0 text-xs font-semibold rounded-full px-2.5 py-0.5 border ${statusConfig.cls}`}>
                          {statusConfig.label}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {inc.zona && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {inc.zona}</span>}
                        {inc.tipo_problema && <span className="flex items-center gap-1"><Wrench className="w-3 h-3" /> {inc.tipo_problema}</span>}
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(inc.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                        </span>
                      </div>

                      <div className="flex gap-3">
                        <div className="flex-1 min-w-0">
                          {inc.descripcion && (
                            <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">{inc.descripcion}</p>
                          )}
                        </div>
                        {inc.fotos && inc.fotos.length > 0 && (
                          <div className="w-20 h-20 rounded-xl overflow-hidden bg-muted shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={inc.fotos[0].url ?? inc.fotos[0].storage_path ?? ''} alt="foto" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          </div>
                        )}
                      </div>

                      {inc.estado === 'asignado' && (
                        <Button
                          size="sm"
                          className="w-full bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold shadow-sm gap-1.5"
                          disabled={isUpdating}
                          onClick={() => handleActualizarEstado(inc.id, 'en_ejecucion')}
                        >
                          {isUpdating
                            ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            : <><Play className="w-3.5 h-3.5" /> Iniciar trabajo</>}
                        </Button>
                      )}
                      {inc.estado === 'en_ejecucion' && (
                        <Button
                          size="sm"
                          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold shadow-sm gap-1.5"
                          disabled={isUpdating}
                          onClick={() => handleActualizarEstado(inc.id, 'resuelta')}
                        >
                          {isUpdating
                            ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            : <><CheckCircle2 className="w-3.5 h-3.5" /> Marcar como completado</>}
                        </Button>
                      )}
                      {inc.estado === 'resuelta' && (
                        <div className="flex items-center justify-center gap-1.5 bg-emerald-50 rounded-xl py-2 border border-emerald-200">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          <span className="text-xs text-emerald-700 font-semibold">Trabajo completado</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </>
        )}

        {/* ── TAB 3: Mis Presupuestos ── */}
        {activeTab === 'presupuestos' && (
          <>
            {loadingPresupuestos && (
              <div className="flex justify-center py-12">
                <div className="w-7 h-7 rounded-full border-[3px] border-finca-coral border-t-transparent animate-spin" />
              </div>
            )}
            {!loadingPresupuestos && presupuestos.length === 0 && (
              <div className="py-14 text-center space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-purple-50 flex items-center justify-center mx-auto">
                  <ClipboardList className="w-7 h-7 text-purple-400" />
                </div>
                <p className="font-semibold text-finca-dark">Sin presupuestos enviados</p>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto leading-relaxed">
                  Visita la pestaña Disponibles y envía un presupuesto para verlo aquí.
                </p>
              </div>
            )}
            {presupuestos.map((p, idx) => {
              const statusConfig = {
                pendiente:  { cls: 'bg-yellow-50 text-yellow-700 border-yellow-200', label: 'Pendiente',  bar: 'bg-yellow-400' },
                aceptado:   { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Aceptado', bar: 'bg-emerald-500' },
                rechazado:  { cls: 'bg-red-50 text-red-700 border-red-200', label: 'Rechazado',           bar: 'bg-red-400' },
              }[p.estado] ?? { cls: 'bg-gray-100 text-gray-600 border-gray-200', label: p.estado, bar: 'bg-gray-300' };

              return (
                <div
                  key={p.id}
                  className="animate-in fade-in slide-in-from-bottom-2 duration-300"
                  style={{ animationDelay: `${idx * 60}ms` }}
                >
                  <Card className="border-0 shadow-sm rounded-2xl overflow-hidden">
                    <div className={`h-1 ${statusConfig.bar}`} />
                    <CardContent className="pt-4 pb-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-sm text-finca-dark line-clamp-2 flex-1 leading-snug">
                          {p.incidencia_titulo ?? `#${p.idIncidencia.slice(0, 8)}`}
                        </p>
                        <span className={`shrink-0 text-xs font-semibold rounded-full px-2.5 py-0.5 border ${statusConfig.cls}`}>
                          {statusConfig.label}
                        </span>
                      </div>

                      <p className="text-xl font-bold text-finca-coral">
                        €{p.monto ?? p.precio}
                      </p>

                      {(p.mensaje || p.comentario) && (
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {p.mensaje ?? p.comentario}
                        </p>
                      )}

                      {(p.created_at || (p as any).createdAt) && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(
                            (p.created_at as any)?.toDate?.() ?? p.created_at ?? (p as any).createdAt
                          ).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </p>
                      )}

                      {p.estado === 'aceptado' && (
                        <div className="flex items-center gap-1.5 bg-emerald-50 rounded-xl py-2 px-3 border border-emerald-200 mt-1">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span className="text-xs text-emerald-700 font-semibold">¡Presupuesto aceptado! Revisa la pestaña de trabajos.</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </>
        )}

        {/* ── TAB 4: Valoraciones ── */}
        {activeTab === 'valoraciones' && (
          <>
            {loadingValoraciones && (
              <div className="flex justify-center py-12">
                <div className="w-7 h-7 rounded-full border-[3px] border-finca-coral border-t-transparent animate-spin" />
              </div>
            )}
            {!loadingValoraciones && valoraciones.length === 0 && (
              <div className="py-14 text-center space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-yellow-50 flex items-center justify-center mx-auto">
                  <Star className="w-7 h-7 text-yellow-400" />
                </div>
                <p className="font-semibold text-finca-dark">Sin valoraciones aún</p>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto leading-relaxed">
                  Completa trabajos para que los vecinos puedan puntuarte.
                </p>
              </div>
            )}
            {!loadingValoraciones && valoraciones.length > 0 && (
              <>
                {/* Summary card */}
                <Card className="border-0 shadow-sm rounded-2xl overflow-hidden bg-gradient-to-br from-yellow-50 to-orange-50">
                  <CardContent className="pt-5 pb-5 text-center space-y-1">
                    <div className="text-6xl font-black text-finca-dark">{avgRating}</div>
                    <div className="flex justify-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          className={`w-5 h-5 ${
                            s <= Math.round(Number(avgRating))
                              ? 'fill-yellow-400 text-yellow-400'
                              : 'text-gray-200 fill-gray-200'
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {valoraciones.length} valoración{valoraciones.length !== 1 ? 'es' : ''}
                    </p>
                  </CardContent>
                </Card>

                {valoraciones.map((v, idx) => (
                  <div
                    key={v.id}
                    className="animate-in fade-in slide-in-from-bottom-2 duration-300"
                    style={{ animationDelay: `${idx * 60}ms` }}
                  >
                    <Card className="border-0 shadow-sm rounded-2xl">
                      <CardContent className="pt-4 pb-4 space-y-2">
                        <div className="flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <Star
                              key={s}
                              className={`w-4 h-4 ${
                                s <= v.rating
                                  ? 'fill-yellow-400 text-yellow-400'
                                  : 'text-gray-200 fill-gray-200'
                              }`}
                            />
                          ))}
                          <span className="ml-2 text-xs text-muted-foreground font-medium">{v.rating}/5</span>
                        </div>
                        {v.comentario && (
                          <p className="text-sm text-finca-dark leading-relaxed">{v.comentario}</p>
                        )}
                        {v.createdAt && (
                          <p className="text-xs text-muted-foreground">
                            {new Date(v.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {/* ── TAB 5: Mi Perfil ── */}
        {activeTab === 'perfil' && (
          <div className="space-y-3 animate-in fade-in duration-300">
            {/* Avatar + name card */}
            <Card className="border-0 shadow-sm rounded-2xl overflow-hidden">
              <div className="h-16 bg-gradient-to-r from-finca-coral to-orange-400" />
              <CardContent className="pb-5">
                <div className="-mt-8 mb-3 flex items-end justify-between gap-2">
                  <div className="w-16 h-16 rounded-2xl bg-white shadow-md border-2 border-white flex items-center justify-center shrink-0">
                    <span className="text-2xl font-black text-finca-coral">{initials}</span>
                  </div>
                  <div className="pb-1 flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-xs text-emerald-600 font-semibold">Activo</span>
                  </div>
                </div>
                <h2 className="text-lg font-bold text-finca-dark">{proveedor.nombre}</h2>
                <p className="text-sm text-muted-foreground capitalize">{proveedor.especialidad}</p>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-2 mt-4">
                  {[
                    { label: 'Rating', value: `⭐ ${proveedor.rating || '—'}` },
                    { label: 'Trabajos', value: String(proveedor.trabajosRealizados || 0) },
                    { label: 'Zona', value: proveedor.zona || '—' },
                  ].map((stat) => (
                    <div key={stat.label} className="bg-gray-50 rounded-xl p-2.5 text-center">
                      <p className="text-sm font-bold text-finca-dark">{stat.value}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{stat.label}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Services card */}
            {(proveedor.servicios?.length ?? 0) > 0 && (
              <Card className="border-0 shadow-sm rounded-2xl">
                <CardContent className="pt-4 pb-4 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Servicios</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(proveedor.servicios ?? [proveedor.especialidad]).map((s) => (
                      <span
                        key={s}
                        className="inline-flex items-center gap-1 bg-finca-peach text-finca-coral text-xs font-semibold rounded-full px-2.5 py-1 border border-finca-coral/20"
                      >
                        {SERVICIOS_LABELS[s] ?? '🔧'} {s}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Contact info card */}
            <Card className="border-0 shadow-sm rounded-2xl">
              <CardContent className="pt-4 pb-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Datos de contacto</p>
                <div className="space-y-2">
                  {[
                    { label: 'Email', value: proveedor.email },
                    {
                      label: 'Miembro desde',
                      value: new Date(proveedor.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }),
                    },
                  ].map((item) => (
                    <div key={item.label} className="flex items-start justify-between gap-2">
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                      <p className="text-sm font-medium text-finca-dark text-right">{item.value}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Sign out */}
            <Button
              variant="outline"
              className="w-full rounded-xl border-red-200 text-red-500 hover:bg-red-50 hover:border-red-300 gap-1.5"
              onClick={handleSignOut}
            >
              <LogOut className="w-4 h-4" />
              Cerrar sesión
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
