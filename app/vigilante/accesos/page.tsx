'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, getDocs, addDoc, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DoorOpen, Plus, X, Clock, CheckCircle2, XCircle, Loader2, UserCheck,
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

  // Form state
  const [nombre, setNombre] = useState('');
  const [cedula, setCedula] = useState('');
  const [tipo, setTipo] = useState('visitante');
  const [apartamento, setApartamento] = useState('');
  const [motivo, setMotivo] = useState('');

  const comunidadId = perfil?.comunidad_id;

  useEffect(() => {
    if (!comunidadId) return;

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const q = query(
      collection(db, 'accesos'),
      where('comunidad_id', '==', comunidadId),
      orderBy('hora_entrada', 'desc'),
    );

    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Acceso))
        .filter(a => new Date(a.hora_entrada) >= hoy);
      setAccesos(items);
      setLoading(false);
    }, () => setLoading(false));

    return () => unsub();
  }, [comunidadId]);

  async function handleRegistrar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre || !apartamento || !comunidadId || !user) return;
    setSaving(true);

    try {
      await addDoc(collection(db, 'accesos'), {
        comunidad_id: comunidadId,
        vigilante_id: user.uid,
        visitante_nombre: nombre,
        visitante_cedula: cedula || null,
        tipo,
        vecino_id: '',
        apartamento_destino: apartamento,
        motivo: motivo || null,
        estado: 'esperando',
        hora_entrada: new Date().toISOString(),
        hora_salida: null,
        created_at: new Date().toISOString(),
      });

      toast.success('Visita registrada');
      setShowForm(false);
      setNombre(''); setCedula(''); setTipo('visitante'); setApartamento(''); setMotivo('');
    } catch (err) {
      console.error('[Accesos] Error:', err);
      toast.error('Error al registrar la visita');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-finca-dark">Control de accesos</h1>
          <p className="text-sm text-muted-foreground">Registro de visitantes de hoy</p>
        </div>
        <Button
          onClick={() => setShowForm(!showForm)}
          className={showForm ? 'bg-gray-500 hover:bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'}
        >
          {showForm ? <><X className="w-4 h-4 mr-1" />Cancelar</> : <><Plus className="w-4 h-4 mr-1" />Registrar visita</>}
        </Button>
      </div>

      {/* Formulario */}
      {showForm && (
        <Card className="border-2 border-blue-200 shadow-md">
          <CardContent className="p-4">
            <form onSubmit={handleRegistrar} className="space-y-3">
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
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserCheck className="w-4 h-4 mr-2" />}
                Registrar visita
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Lista */}
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Card key={i} className="border-0 shadow-sm"><CardContent className="p-3"><Skeleton className="h-12 w-full" /></CardContent></Card>)}</div>
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
            return (
              <Card key={a.id} className="border-0 shadow-sm">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                    <DoorOpen className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-finca-dark truncate">{a.visitante_nombre}</p>
                    <p className="text-xs text-muted-foreground">
                      Apto {a.apartamento_destino} - {a.tipo} - {format(new Date(a.hora_entrada), 'HH:mm', { locale: es })}
                    </p>
                  </div>
                  <Badge className={cn('text-[10px] border shrink-0', est.color)}>{est.label}</Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
