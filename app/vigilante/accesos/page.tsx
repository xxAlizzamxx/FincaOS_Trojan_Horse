'use client';

import { useEffect, useState } from 'react';
import {
  collection, query, where, getDocs, addDoc, onSnapshot,
  doc, setDoc, updateDoc, getDoc,
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
  UserCheck, Search, User, QrCode,
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
  const [accesos, setAccesos] = useState<Acceso[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // QR modal state
  const [qrAcceso, setQrAcceso] = useState<Acceso | null>(null);

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
        hora_entrada:        new Date().toISOString(),
        hora_salida:         null,
        created_at:          new Date().toISOString(),
      });

      // Si hay vecino identificado, enviarle un chat de notificación
      if (vecinoSeleccionado) {
        const chatId  = `${user.uid}_${vecinoSeleccionado.id}`;
        const chatRef = doc(db, 'chats_vigilancia', chatId);
        const chatSnap = await getDoc(chatRef);

        if (!chatSnap.exists()) {
          await setDoc(chatRef, {
            comunidad_id:   comunidadId,
            vigilante_id:   user.uid,
            vecino_id:      vecinoSeleccionado.id,
            vecino_nombre:  vecinoSeleccionado.nombre_completo,
            ultimo_mensaje: '',
            no_leidos_vigilante: 0,
            no_leidos_vecino:    0,
            updated_at:     new Date().toISOString(),
          });
        }

        const texto = `🚪 Tiene una visita esperando en portería.\n👤 Visitante: ${nombre}${cedula ? ` (C.C. ${cedula})` : ''}${motivo ? `\n📋 Motivo: ${motivo}` : ''}\n\nPor favor responda AUTORIZAR o RECHAZAR desde la sección Portería.`;

        await addDoc(collection(db, 'chats_vigilancia', chatId, 'mensajes'), {
          sender_id:     user.uid,
          texto,
          tipo:          'plantilla',
          plantilla_tipo:'visita',
          acceso_id:     accesoRef.id,
          leido:         false,
          created_at:    new Date().toISOString(),
        });

        await updateDoc(chatRef, {
          ultimo_mensaje:   texto.slice(0, 100),
          no_leidos_vecino: 1,
          updated_at:       new Date().toISOString(),
        });

        toast.success('Visita registrada — vecino notificado');
      } else {
        toast.success('Visita registrada');
      }

      setShowForm(false);
      resetForm();
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-finca-dark">Control de accesos</h1>
          <p className="text-sm text-muted-foreground">Registro de visitantes de hoy</p>
        </div>
        <Button
          onClick={() => { setShowForm(!showForm); if (showForm) resetForm(); }}
          className={showForm ? 'bg-gray-500 hover:bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'}
        >
          {showForm
            ? <><X className="w-4 h-4 mr-1" />Cancelar</>
            : <><Plus className="w-4 h-4 mr-1" />Registrar visita</>}
        </Button>
      </div>

      {/* Formulario */}
      {showForm && (
        <Card className="border-2 border-blue-200 shadow-md">
          <CardContent className="p-4">
            <form onSubmit={handleRegistrar} className="space-y-3">

              {/* Buscar vecino */}
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

      {/* Lista */}
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
                a.estado === 'esperando' && 'border-l-4 border-l-yellow-400',
                a.estado === 'autorizado' && 'border-l-4 border-l-green-400',
                a.estado === 'rechazado' && 'border-l-4 border-l-red-400',
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
                    {a.estado === 'autorizado' && (
                      <button
                        onClick={() => setQrAcceso(a)}
                        className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-800 mt-1"
                      >
                        <QrCode className="w-3 h-3" />
                        Ver QR
                      </button>
                    )}
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

      {/* QR Modal */}
      {qrAcceso && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setQrAcceso(null)}
        >
          <div
            className="bg-white rounded-2xl p-6 max-w-xs w-full shadow-2xl space-y-4 text-center"
            onClick={e => e.stopPropagation()}
          >
            <p className="font-semibold text-finca-dark">Código QR de acceso</p>
            <p className="text-xs text-muted-foreground">{qrAcceso.visitante_nombre} → Apto {qrAcceso.apartamento_destino}</p>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
                JSON.stringify({ id: qrAcceso.id, nombre: qrAcceso.visitante_nombre, apto: qrAcceso.apartamento_destino, tipo: qrAcceso.tipo, hora: qrAcceso.hora_entrada })
              )}`}
              alt="QR de acceso"
              className="w-48 h-48 mx-auto rounded-xl"
            />
            <p className="text-[10px] text-muted-foreground">Muestra este código en portería</p>
            <Button className="w-full bg-finca-coral text-white" onClick={() => setQrAcceso(null)}>Cerrar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
