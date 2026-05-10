'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection, query, where, getDocs, addDoc, onSnapshot,
  doc, updateDoc, getDoc, setDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DoorOpen, Plus, X, Clock, CheckCircle2, XCircle, Loader2,
  UserCheck, Search, User, QrCode, ScanLine,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';

interface Acceso {
  id: string;
  visitante_nombre: string;
  visitante_cedula?: string;
  tipo: string;
  apartamento_destino: string;
  motivo?: string;
  estado: string;
  hora_entrada: string;
  vecino_id?: string;
  vecino_nombre?: string;
}

interface Vecino {
  id: string;
  nombre_completo: string;
  torre?: string;
  piso?: string;
  puerta?: string;
}

const tiposVisitante = [
  { value: 'visitante',  label: 'Visitante'  },
  { value: 'repartidor', label: 'Repartidor' },
  { value: 'proveedor',  label: 'Proveedor'  },
  { value: 'tecnico',    label: 'Tecnico'    },
  { value: 'familiar',   label: 'Familiar'   },
];

const estadoConfig: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  esperando:  { label: 'Esperando',  color: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: Clock        },
  autorizado: { label: 'Autorizado', color: 'bg-green-100 text-green-700 border-green-200',    icon: CheckCircle2 },
  rechazado:  { label: 'Rechazado',  color: 'bg-red-100 text-red-700 border-red-200',          icon: XCircle      },
};

export default function AccesosPage() {
  const { perfil, user } = useAuth();
  const router = useRouter();
  const [accesos, setAccesos] = useState<Acceso[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // QR scanner state
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animRef = useRef<number>(0);

  // Form state
  const [nombre, setNombre] = useState('');
  const [cedula, setCedula] = useState('');
  const [tipo, setTipo] = useState('visitante');
  const [apartamento, setApartamento] = useState('');
  const [motivo, setMotivo] = useState('');

  // Búsqueda de vecino
  const [busquedaVecino, setBusquedaVecino] = useState('');
  const [vecinos, setVecinos] = useState<Vecino[]>([]);
  const [vecinoSeleccionado, setVecinoSeleccionado] = useState<Vecino | null>(null);
  const [showVecinoSearch, setShowVecinoSearch] = useState(false);
  const [loadingVecinos, setLoadingVecinos] = useState(false);

  const comunidadId = perfil?.comunidad_id;

  // Cargar vecinos de la comunidad una sola vez
  useEffect(() => {
    if (!comunidadId) return;
    setLoadingVecinos(true);
    getDocs(query(
      collection(db, 'perfiles'),
      where('comunidad_id', '==', comunidadId),
    )).then(snap => {
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Vecino))
        .filter(v => v.id !== user?.uid && v.nombre_completo)
        .sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo));
      setVecinos(list);
    }).finally(() => setLoadingVecinos(false));
  }, [comunidadId, user?.uid]);

  // Accesos en tiempo real
  useEffect(() => {
    if (!comunidadId) return;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const q = query(
      collection(db, 'accesos'),
      where('comunidad_id', '==', comunidadId),
    );

    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Acceso))
        .filter(a => new Date(a.hora_entrada) >= hoy)
        .sort((a, b) => new Date(b.hora_entrada).getTime() - new Date(a.hora_entrada).getTime());
      setAccesos(items);
      setLoading(false);
    }, (err) => { console.error('[Accesos] onSnapshot error:', err); setLoading(false); });

    return () => unsub();
  }, [comunidadId]);

  // ── QR Scanner ────────────────────────────────────────────────────────────

  async function startScanner() {
    setScanError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setScanning(true);
      // Give React time to render the video element
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().then(() => scheduleDetect()).catch(() => {});
        }
      }, 100);
    } catch {
      setScanError('No se pudo acceder a la cámara. Usa el escáner del sistema.');
    }
  }

  function scheduleDetect() {
    if (!('BarcodeDetector' in window)) {
      setScanError('Tu navegador no soporta escaneo automático. Abre la URL del QR manualmente.');
      stopScanner();
      return;
    }
    const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
    const tick = async () => {
      if (!videoRef.current || !streamRef.current) return;
      try {
        const codes = await detector.detect(videoRef.current);
        if (codes.length > 0) {
          const raw: string = codes[0].rawValue;
          const match = raw.match(/\/validar-pase\?t=([a-f0-9]+)/);
          if (match) {
            stopScanner();
            router.push(`/validar-pase?t=${match[1]}`);
            return;
          }
        }
      } catch {}
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
  }

  function stopScanner() {
    cancelAnimationFrame(animRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setScanning(false);
  }

  // ── Vecinos ────────────────────────────────────────────────────────────────

  const vecinosFiltrados = vecinos.filter(v => {
    const q = busquedaVecino.toLowerCase();
    return (
      v.nombre_completo.toLowerCase().includes(q) ||
      v.puerta?.toLowerCase().includes(q) ||
      v.torre?.toLowerCase().includes(q)
    );
  });

  function seleccionarVecino(v: Vecino) {
    setVecinoSeleccionado(v);
    const apto = [v.torre && `Torre ${v.torre}`, v.puerta].filter(Boolean).join(' - ');
    setApartamento(apto || v.puerta || '');
    setShowVecinoSearch(false);
    setBusquedaVecino('');
  }

  async function handleRegistrar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre || !apartamento || !comunidadId || !user) return;
    setSaving(true);

    try {
      const now = new Date().toISOString();
      const accesoRef = await addDoc(collection(db, 'accesos'), {
        comunidad_id:        comunidadId,
        vigilante_id:        user.uid,
        visitante_nombre:    nombre,
        visitante_cedula:    cedula || null,
        tipo,
        vecino_id:           vecinoSeleccionado?.id || '',
        vecino_nombre:       vecinoSeleccionado?.nombre_completo || '',
        apartamento_destino: apartamento,
        motivo:              motivo || null,
        estado:              'esperando',
        hora_entrada:        now,
        hora_salida:         null,
        created_at:          now,
      });

      toast.success(vecinoSeleccionado ? 'Visita registrada — vecino notificado' : 'Visita registrada');
      setShowForm(false);
      resetForm();

      // Notificar al vecino via chats_comunidad — fire-and-forget
      if (vecinoSeleccionado && comunidadId) {
        const chatId  = `${comunidadId}_vigilante_${vecinoSeleccionado.id}`;
        const chatRef = doc(db, 'chats_comunidad', chatId);
        const texto = `🚪 Tiene una visita esperando en portería.\n👤 Visitante: ${nombre}${cedula ? ` (C.C. ${cedula})` : ''}${motivo ? `\n📋 Motivo: ${motivo}` : ''}\n\nAutorizar o rechazar desde la sección Portería.`;

        setDoc(chatRef, {
          comunidad_id:   comunidadId,
          tipo:           'vigilante',
          contraparte_id: user.uid,
          contraparte_rol:'vigilante',
          vecino_id:      vecinoSeleccionado.id,
          updated_at:     now,
          created_at:     now,
        }, { merge: true })
          .then(() => addDoc(collection(db, 'chats_comunidad', chatId, 'mensajes'), {
            sender_id:      user.uid,
            sender_rol:     'vigilante',
            texto,
            tipo:           'plantilla',
            plantilla_tipo: 'visita',
            acceso_id:      accesoRef.id,
            leido:          false,
            created_at:     now,
          }))
          .then(() => updateDoc(chatRef, {
            ultimo_mensaje:   texto.slice(0, 100),
            no_leidos_vecino: 1,
            updated_at:       now,
          }))
          .catch(err => console.error('[Accesos] Chat notify error:', err));
      }
    } catch (err) {
      console.error('[Accesos] Error:', err);
      toast.error('Error al registrar la visita');
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setNombre(''); setCedula(''); setTipo('visitante');
    setApartamento(''); setMotivo('');
    setVecinoSeleccionado(null); setBusquedaVecino('');
  }

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-finca-dark">Control de accesos</h1>
          <p className="text-sm text-muted-foreground">Registro de visitantes de hoy</p>
        </div>
        <div className="flex gap-2">
          {/* Botón escanear QR */}
          <Button
            variant="outline"
            onClick={scanning ? stopScanner : startScanner}
            className={cn('gap-1.5', scanning && 'border-finca-coral text-finca-coral')}
          >
            <ScanLine className="w-4 h-4" />
            {scanning ? 'Detener' : 'Escanear pase QR'}
          </Button>
          <Button
            onClick={() => { setShowForm(!showForm); if (showForm) resetForm(); }}
            className={showForm ? 'bg-gray-500 hover:bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'}
          >
            {showForm
              ? <><X className="w-4 h-4 mr-1" />Cancelar</>
              : <><Plus className="w-4 h-4 mr-1" />Registrar visita</>}
          </Button>
        </div>
      </div>

      {/* ── Visor de cámara QR ── */}
      {scanning && (
        <Card className="border-2 border-finca-coral/40 shadow-md overflow-hidden">
          <CardContent className="p-0 relative">
            <video
              ref={videoRef}
              className="w-full max-h-64 object-cover bg-black"
              playsInline
              muted
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-48 h-48 border-2 border-finca-coral/80 rounded-xl shadow-lg" />
            </div>
            <div className="p-3 text-center bg-black/70">
              <p className="text-white text-xs flex items-center justify-center gap-1.5">
                <ScanLine className="w-3.5 h-3.5 animate-pulse" />
                Apunta al QR del pase del visitante
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {scanError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {scanError}
        </div>
      )}

      {/* ── Formulario manual ── */}
      {showForm && (
        <Card className="border-2 border-blue-200 shadow-md">
          <CardContent className="p-4">
            <form onSubmit={handleRegistrar} className="space-y-3">

              <div className="space-y-1.5">
                <Label>Residente destino</Label>
                {vecinoSeleccionado ? (
                  <div className="flex items-center gap-2 p-2.5 rounded-md border border-emerald-300 bg-emerald-50">
                    <div className="w-8 h-8 rounded-full bg-emerald-200 flex items-center justify-center text-emerald-700 font-bold text-xs shrink-0">
                      {vecinoSeleccionado.nombre_completo[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-emerald-800 truncate">{vecinoSeleccionado.nombre_completo}</p>
                      <p className="text-xs text-emerald-600">
                        {[vecinoSeleccionado.torre && `Torre ${vecinoSeleccionado.torre}`, vecinoSeleccionado.puerta && `Apto ${vecinoSeleccionado.puerta}`].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <button type="button" onClick={() => { setVecinoSeleccionado(null); setApartamento(''); }} className="text-emerald-600 hover:text-emerald-800">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar por nombre o apartamento..."
                      value={busquedaVecino}
                      onChange={e => { setBusquedaVecino(e.target.value); setShowVecinoSearch(true); }}
                      onFocus={() => setShowVecinoSearch(true)}
                      className="pl-9"
                    />
                    {showVecinoSearch && busquedaVecino && (
                      <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-white border border-border rounded-lg shadow-lg max-h-44 overflow-y-auto">
                        {loadingVecinos ? (
                          <div className="p-3 text-xs text-muted-foreground text-center">Cargando...</div>
                        ) : vecinosFiltrados.length === 0 ? (
                          <div className="p-3 text-xs text-muted-foreground text-center">Sin resultados</div>
                        ) : vecinosFiltrados.slice(0, 8).map(v => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => seleccionarVecino(v)}
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-blue-50 text-left transition-colors"
                          >
                            <User className="w-4 h-4 text-muted-foreground shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-finca-dark truncate">{v.nombre_completo}</p>
                              <p className="text-xs text-muted-foreground">
                                {[v.torre && `Torre ${v.torre}`, v.puerta && `Apto ${v.puerta}`].filter(Boolean).join(' · ') || 'Sin apartamento'}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">Opcional — si lo seleccionas el residente recibe notificación automática</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="v-nombre">Nombre del visitante *</Label>
                  <Input id="v-nombre" placeholder="Nombre completo" value={nombre} onChange={e => setNombre(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="v-cedula">Cedula / Documento</Label>
                  <Input id="v-cedula" placeholder="Numero de documento" value={cedula} onChange={e => setCedula(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="v-tipo">Tipo</Label>
                  <select id="v-tipo" value={tipo} onChange={e => setTipo(e.target.value)} className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm">
                    {tiposVisitante.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="v-apto">Apartamento destino *</Label>
                  <Input id="v-apto" placeholder="Ej: 504, Torre A - 302" value={apartamento} onChange={e => setApartamento(e.target.value)} required />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="v-motivo">Motivo (opcional)</Label>
                <Input id="v-motivo" placeholder="Motivo de la visita" value={motivo} onChange={e => setMotivo(e.target.value)} />
              </div>

              <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={saving || !nombre || !apartamento}>
                {saving
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : <UserCheck className="w-4 h-4 mr-2" />}
                {vecinoSeleccionado ? 'Registrar y notificar residente' : 'Registrar visita'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ── Lista de accesos ── */}
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i =>
          <Card key={i} className="border-0 shadow-sm"><CardContent className="p-3"><Skeleton className="h-12 w-full" /></CardContent></Card>
        )}</div>
      ) : accesos.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="py-8 text-center">
            <DoorOpen className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No hay visitas registradas hoy</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {accesos.map(a => {
            const est = estadoConfig[a.estado] || estadoConfig.esperando;
            const EstIcon = est.icon;
            return (
              <Card key={a.id} className={cn(
                'border-0 shadow-sm',
                a.estado === 'esperando'  && 'border-l-4 border-l-yellow-400',
                a.estado === 'autorizado' && 'border-l-4 border-l-green-400',
                a.estado === 'rechazado'  && 'border-l-4 border-l-red-400',
              )}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                    <DoorOpen className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-finca-dark truncate">{a.visitante_nombre}</p>
                    <p className="text-xs text-muted-foreground">
                      Apto {a.apartamento_destino} · {a.tipo} · {format(new Date(a.hora_entrada), 'HH:mm', { locale: es })}
                      {a.vecino_nombre && <span className="text-emerald-600"> · {a.vecino_nombre}</span>}
                    </p>
                  </div>
                  <Badge className={cn('text-[10px] border shrink-0 flex items-center gap-1', est.color)}>
                    <EstIcon className="w-3 h-3" />
                    {est.label}
                  </Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
