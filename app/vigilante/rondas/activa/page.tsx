'use client';

/**
 * /vigilante/rondas/activa
 *
 * Página de ronda activa. Flujo:
 *   1. Si no hay ronda activa → muestra "Iniciar ronda" con GPS
 *   2. Si hay ronda activa propia → modo operativo:
 *      - Temporizador en vivo
 *      - Lista de checkpoints ya marcados
 *      - Botón "Marcar checkpoint" (nombre libre o preset)
 *      - Botón "Finalizar ronda"
 *
 * Firestore:
 *   rondas_vigilancia/{rondaId}               — doc principal
 *   rondas_vigilancia/{rondaId}/checkpoints/  — subcollección
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection, doc, addDoc, updateDoc, onSnapshot,
  query, orderBy, where, getDocs, limit,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  MapPin, Play, CheckSquare2, Flag, Navigation, Loader2,
  Clock, ArrowLeft, AlertCircle, Wifi, WifiOff, X, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow, differenceInSeconds } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Ronda {
  id: string;
  vigilante_id: string;
  vigilante_nombre: string;
  estado: 'activa' | 'completada' | 'cancelada';
  iniciada_at: string;
  completada_at: string | null;
  total_checkpoints: number;
}

interface Checkpoint {
  id: string;
  nombre: string;
  lat: number | null;
  lng: number | null;
  precision: number | null;
  timestamp: string;
  nota: string;
  orden: number;
}

interface GpsState {
  lat: number | null;
  lng: number | null;
  precision: number | null;
  error: string | null;
  obteniendo: boolean;
}

// ── Checkpoints preset ────────────────────────────────────────────────────────
const PRESETS = [
  'Entrada principal',
  'Entrada secundaria',
  'Parqueadero',
  'Piscina',
  'Zonas comunes',
  'Lobby / Recepción',
  'Cuarto de máquinas',
  'Terraza',
  'Sótano',
  'Perímetro norte',
  'Perímetro sur',
  'Perímetro este',
  'Perímetro oeste',
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDuracion(segundos: number): string {
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = segundos % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function precisionLabel(m: number | null): string {
  if (m === null) return '—';
  if (m <= 10) return `±${m.toFixed(0)}m ✓`;
  if (m <= 30) return `±${m.toFixed(0)}m`;
  return `±${m.toFixed(0)}m (baja)`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function RondaActivaPage() {
  const { perfil, user } = useAuth();
  const router = useRouter();
  const comunidadId = perfil?.comunidad_id;

  // Ronda activa del vigilante
  const [ronda, setRonda] = useState<Ronda | null | 'loading'>('loading');
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);

  // GPS
  const [gps, setGps] = useState<GpsState>({
    lat: null, lng: null, precision: null, error: null, obteniendo: false,
  });

  // Modal de nuevo checkpoint
  const [modalOpen, setModalOpen] = useState(false);
  const [cpNombre, setCpNombre] = useState('');
  const [cpNota, setCpNota]   = useState('');
  const [savingCp, setSavingCp] = useState(false);

  // Acciones de ronda
  const [iniciando, setIniciando]   = useState(false);
  const [finalizando, setFinalizando] = useState(false);

  // Temporizador
  const [ahora, setAhora] = useState(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── GPS watch ──────────────────────────────────────────────────────────────
  const watchRef = useRef<number | null>(null);

  const iniciarGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGps(g => ({ ...g, error: 'GPS no disponible en este dispositivo.' }));
      return;
    }
    setGps(g => ({ ...g, obteniendo: true, error: null }));
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGps({
          lat:       pos.coords.latitude,
          lng:       pos.coords.longitude,
          precision: pos.coords.accuracy,
          error:     null,
          obteniendo: false,
        });
      },
      (err) => {
        const msg =
          err.code === 1 ? 'Permiso de ubicación denegado. Actívalo en tu navegador.' :
          err.code === 2 ? 'No se pudo obtener la ubicación.' :
          'Tiempo de espera agotado para GPS.';
        setGps(g => ({ ...g, error: msg, obteniendo: false }));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    );
  }, []);

  useEffect(() => {
    iniciarGps();
    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, [iniciarGps]);

  // ── Buscar ronda activa ────────────────────────────────────────────────────
  useEffect(() => {
    if (!comunidadId || !user?.uid) return;

    const q = query(
      collection(db, 'rondas_vigilancia'),
      where('comunidad_id', '==', comunidadId),
      where('vigilante_id', '==', user.uid),
      where('estado', '==', 'activa'),
      limit(1),
    );

    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) {
        setRonda(null);
      } else {
        setRonda({ id: snap.docs[0].id, ...snap.docs[0].data() } as Ronda);
      }
    }, () => setRonda(null));

    return () => unsub();
  }, [comunidadId, user?.uid]);

  // ── Checkpoints de la ronda activa ────────────────────────────────────────
  useEffect(() => {
    if (!ronda || ronda === 'loading') return;

    const q = query(
      collection(db, 'rondas_vigilancia', ronda.id, 'checkpoints'),
      orderBy('orden', 'asc'),
    );

    const unsub = onSnapshot(q, (snap) => {
      setCheckpoints(snap.docs.map(d => ({ id: d.id, ...d.data() } as Checkpoint)));
    }, () => {});

    return () => unsub();
  }, [ronda]);

  // ── Temporizador ──────────────────────────────────────────────────────────
  useEffect(() => {
    timerRef.current = setInterval(() => setAhora(Date.now()), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // ── Iniciar ronda ─────────────────────────────────────────────────────────
  async function iniciarRonda() {
    if (!comunidadId || !user?.uid) return;
    setIniciando(true);
    try {
      const ref = await addDoc(collection(db, 'rondas_vigilancia'), {
        comunidad_id:      comunidadId,
        vigilante_id:      user.uid,
        vigilante_nombre:  perfil?.nombre_completo ?? 'Vigilante',
        estado:            'activa',
        iniciada_at:       new Date().toISOString(),
        completada_at:     null,
        total_checkpoints: 0,
        duracion_min:      null,
      });
      toast.success('Ronda iniciada');
    } catch {
      toast.error('Error al iniciar la ronda');
    } finally {
      setIniciando(false);
    }
  }

  // ── Marcar checkpoint ─────────────────────────────────────────────────────
  async function marcarCheckpoint() {
    if (!ronda || ronda === 'loading' || !cpNombre.trim()) return;
    setSavingCp(true);
    try {
      const orden = checkpoints.length + 1;
      await addDoc(collection(db, 'rondas_vigilancia', ronda.id, 'checkpoints'), {
        nombre:    cpNombre.trim(),
        lat:       gps.lat,
        lng:       gps.lng,
        precision: gps.precision,
        timestamp: new Date().toISOString(),
        nota:      cpNota.trim(),
        orden,
      });
      await updateDoc(doc(db, 'rondas_vigilancia', ronda.id), {
        total_checkpoints: orden,
      });
      toast.success(`Checkpoint "${cpNombre.trim()}" marcado`);
      setModalOpen(false);
      setCpNombre('');
      setCpNota('');
    } catch {
      toast.error('Error al guardar el checkpoint');
    } finally {
      setSavingCp(false);
    }
  }

  // ── Finalizar ronda ───────────────────────────────────────────────────────
  async function finalizarRonda() {
    if (!ronda || ronda === 'loading') return;
    setFinalizando(true);
    try {
      const ahora = new Date().toISOString();
      const durMin = Math.round(
        differenceInSeconds(new Date(ahora), new Date(ronda.iniciada_at)) / 60,
      );
      await updateDoc(doc(db, 'rondas_vigilancia', ronda.id), {
        estado:        'completada',
        completada_at: ahora,
        duracion_min:  durMin,
      });
      toast.success(`Ronda completada — ${durMin} min · ${checkpoints.length} checkpoints`);
      router.replace('/vigilante/rondas');
    } catch {
      toast.error('Error al finalizar la ronda');
    } finally {
      setFinalizando(false);
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (ronda === 'loading') {
    return (
      <div className="space-y-4 max-w-lg">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }

  // ── GPS pill helper ───────────────────────────────────────────────────────
  const GpsPill = () => (
    <div className={cn(
      'inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1',
      gps.error        ? 'bg-red-50 text-red-600'    :
      gps.obteniendo   ? 'bg-gray-100 text-gray-500'  :
      gps.precision && gps.precision <= 30
                       ? 'bg-green-50 text-green-700' :
                         'bg-amber-50 text-amber-700',
    )}>
      {gps.error     ? <WifiOff className="w-3 h-3" /> :
       gps.obteniendo ? <Loader2 className="w-3 h-3 animate-spin" /> :
                        <Wifi className="w-3 h-3" />}
      {gps.error     ? 'Sin GPS' :
       gps.obteniendo ? 'Buscando GPS…' :
                        precisionLabel(gps.precision)}
    </div>
  );

  // ── PANTALLA: sin ronda activa → inicio ───────────────────────────────────
  if (!ronda) {
    return (
      <div className="space-y-5 max-w-lg">

        {/* Back */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-finca-dark transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>

        <div>
          <h1 className="text-2xl font-bold text-finca-dark">Nueva ronda</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Registra tu recorrido de seguridad con GPS
          </p>
        </div>

        {/* GPS status */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-finca-dark">Estado del GPS</p>
              <GpsPill />
            </div>

            {gps.error && (
              <div className="flex items-start gap-2 bg-red-50 rounded-xl p-3">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-600">{gps.error}</p>
              </div>
            )}

            {gps.lat && (
              <div className="bg-gray-50 rounded-xl p-3 font-mono text-xs text-muted-foreground">
                {gps.lat.toFixed(6)}, {gps.lng?.toFixed(6)}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              La ubicación GPS se registrará en cada checkpoint durante la ronda.
              Puedes iniciar sin GPS pero la precisión será menor.
            </p>
          </CardContent>
        </Card>

        {/* CTA */}
        <Button
          className="w-full h-14 bg-finca-coral hover:bg-finca-salmon text-white text-base font-bold rounded-2xl shadow-md shadow-finca-coral/30"
          onClick={iniciarRonda}
          disabled={iniciando}
        >
          {iniciando
            ? <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            : <Play className="w-5 h-5 mr-2" />}
          {iniciando ? 'Iniciando…' : 'Iniciar ronda ahora'}
        </Button>

        <p className="text-xs text-center text-muted-foreground">
          La ronda quedará registrada en el historial con fecha, hora y checkpoints.
        </p>
      </div>
    );
  }

  // ── PANTALLA: ronda activa ─────────────────────────────────────────────────
  const segundosActivos = differenceInSeconds(ahora, new Date(ronda.iniciada_at));

  return (
    <>
      <div className="space-y-4 max-w-lg pb-28">

        {/* Back */}
        <button
          onClick={() => router.push('/vigilante/rondas')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-finca-dark transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Historial
        </button>

        {/* Header de ronda activa */}
        <div className="rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 p-5 text-white shadow-lg shadow-blue-500/20">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Navigation className="w-4 h-4 animate-pulse" />
                <span className="text-xs font-medium text-blue-100 uppercase tracking-wide">Ronda en curso</span>
              </div>
              <p className="text-3xl font-bold tabular-nums">{formatDuracion(segundosActivos)}</p>
              <p className="text-xs text-blue-100 mt-1">
                Iniciada {format(new Date(ronda.iniciada_at), 'HH:mm', { locale: es })}
                {' · '}{checkpoints.length} checkpoint{checkpoints.length !== 1 ? 's' : ''}
              </p>
            </div>
            <GpsPill />
          </div>
        </div>

        {/* Checkpoints marcados */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-finca-dark mb-3">Checkpoints</p>

            {checkpoints.length === 0 ? (
              <div className="text-center py-6 space-y-1">
                <MapPin className="w-8 h-8 text-muted-foreground mx-auto opacity-30" />
                <p className="text-xs text-muted-foreground">Sin checkpoints aún.</p>
                <p className="text-xs text-muted-foreground">Toca el botón de abajo para marcar tu posición.</p>
              </div>
            ) : (
              <div className="space-y-0">
                {checkpoints.map((cp, idx) => (
                  <div key={cp.id} className="flex gap-3">
                    {/* Línea de tiempo */}
                    <div className="flex flex-col items-center">
                      <div className={cn(
                        'w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold',
                        idx === checkpoints.length - 1
                          ? 'bg-finca-coral text-white'
                          : 'bg-green-100 text-green-700',
                      )}>
                        {idx + 1}
                      </div>
                      {idx < checkpoints.length - 1 && (
                        <div className="w-px flex-1 bg-gray-200 my-1" />
                      )}
                    </div>

                    {/* Contenido */}
                    <div className={cn('flex-1 min-w-0', idx < checkpoints.length - 1 ? 'pb-3' : 'pb-1')}>
                      <p className="text-sm font-medium text-finca-dark leading-tight">{cp.nombre}</p>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(cp.timestamp), 'HH:mm:ss', { locale: es })}
                        </span>
                        {cp.lat && (
                          <span className="text-xs text-muted-foreground font-mono">
                            GPS ±{cp.precision?.toFixed(0)}m
                          </span>
                        )}
                      </div>
                      {cp.nota && (
                        <p className="text-xs text-muted-foreground mt-0.5 italic">"{cp.nota}"</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      {/* ── Barra de acciones fija abajo ── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-border p-4 space-y-2 max-w-lg mx-auto">
        <Button
          className="w-full h-12 bg-finca-coral hover:bg-finca-salmon text-white font-bold rounded-xl"
          onClick={() => setModalOpen(true)}
        >
          <MapPin className="w-4 h-4 mr-2" />
          Marcar checkpoint
        </Button>
        <Button
          variant="outline"
          className="w-full h-10 rounded-xl text-green-700 border-green-200 hover:bg-green-50 font-semibold"
          onClick={finalizarRonda}
          disabled={finalizando}
        >
          {finalizando
            ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            : <Flag className="w-4 h-4 mr-2" />}
          {finalizando ? 'Finalizando…' : 'Finalizar ronda'}
        </Button>
      </div>

      {/* ── Modal: nuevo checkpoint ── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div className="bg-white rounded-t-3xl w-full max-w-lg p-5 space-y-4 shadow-2xl">

            {/* Header modal */}
            <div className="flex items-center justify-between">
              <p className="font-semibold text-finca-dark">Marcar checkpoint</p>
              <button
                onClick={() => { setModalOpen(false); setCpNombre(''); setCpNota(''); }}
                className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {/* GPS en el modal */}
            <div className="flex items-center gap-2">
              <GpsPill />
              {gps.lat && (
                <span className="text-xs text-muted-foreground font-mono">
                  {gps.lat.toFixed(5)}, {gps.lng?.toFixed(5)}
                </span>
              )}
            </div>

            {/* Presets */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Selecciona o escribe:</p>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                {PRESETS.map(p => (
                  <button
                    key={p}
                    onClick={() => setCpNombre(p)}
                    className={cn(
                      'text-xs px-2.5 py-1.5 rounded-full border transition-all',
                      cpNombre === p
                        ? 'bg-finca-coral text-white border-finca-coral'
                        : 'bg-gray-50 text-finca-dark border-gray-200 hover:border-finca-coral/50',
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Nombre libre */}
            <Input
              placeholder="Nombre del checkpoint (ej: Zona norte)"
              value={cpNombre}
              onChange={e => setCpNombre(e.target.value)}
              className="text-sm"
            />

            {/* Nota opcional */}
            <Input
              placeholder="Nota opcional (ej: Todo en orden)"
              value={cpNota}
              onChange={e => setCpNota(e.target.value)}
              className="text-sm"
            />

            {/* Confirmar */}
            <Button
              className="w-full bg-finca-coral hover:bg-finca-salmon text-white font-bold h-12 rounded-xl"
              onClick={marcarCheckpoint}
              disabled={!cpNombre.trim() || savingCp}
            >
              {savingCp
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Check className="w-4 h-4 mr-2" />}
              {savingCp ? 'Guardando…' : 'Confirmar checkpoint'}
            </Button>

          </div>
        </div>
      )}
    </>
  );
}
