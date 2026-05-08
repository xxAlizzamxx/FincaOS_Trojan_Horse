'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, addDoc, onSnapshot, orderBy, updateDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Package, Plus, X, Clock, CheckCircle2, Loader2, UserCheck,
  Flame, Zap, Droplets, FileText, Building2, Truck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';

interface Paquete {
  id: string;
  destinatario_nombre: string;
  apartamento: string;
  tipo: string;
  descripcion?: string;
  estado: string;
  created_at: string;
  recibo_tipo?: string;
}

const tiposPaquete = [
  { value: 'paquete',         label: 'Paquete',         icon: Package  },
  { value: 'sobre',           label: 'Sobre / Carta',   icon: FileText },
  { value: 'domicilio',       label: 'Domicilio',       icon: Truck    },
  { value: 'recibo',          label: 'Recibo',          icon: FileText },
];

const tiposRecibo = [
  { value: 'gas',           label: 'Gas',             icon: Flame,     color: 'bg-orange-50 text-orange-600 border-orange-200' },
  { value: 'luz',           label: 'Luz',             icon: Zap,       color: 'bg-yellow-50 text-yellow-600 border-yellow-200' },
  { value: 'agua',          label: 'Agua',            icon: Droplets,  color: 'bg-blue-50 text-blue-600 border-blue-200'       },
  { value: 'administracion',label: 'Administracion',  icon: Building2, color: 'bg-purple-50 text-purple-600 border-purple-200' },
  { value: 'otro',          label: 'Otro',            icon: FileText,  color: 'bg-gray-50 text-gray-600 border-gray-200'       },
];

const estadoConfig: Record<string, { label: string; color: string }> = {
  recibido:   { label: 'En porteria',  color: 'bg-amber-100 text-amber-700 border-amber-200'  },
  notificado: { label: 'Notificado',   color: 'bg-blue-100 text-blue-700 border-blue-200'     },
  entregado:  { label: 'Entregado',    color: 'bg-green-100 text-green-700 border-green-200'   },
};

export default function PaqueteriaPage() {
  const { perfil, user } = useAuth();
  const [paquetes, setPaquetes] = useState<Paquete[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form
  const [nombre, setNombre] = useState('');
  const [apartamento, setApartamento] = useState('');
  const [tipo, setTipo] = useState('paquete');
  const [reciboTipo, setReciboTipo] = useState('');
  const [descripcion, setDescripcion] = useState('');

  const comunidadId = perfil?.comunidad_id;

  useEffect(() => {
    if (!comunidadId) return;

    const q = query(
      collection(db, 'paqueteria'),
      where('comunidad_id', '==', comunidadId),
      orderBy('created_at', 'desc'),
    );

    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Paquete));
      setPaquetes(items);
      setLoading(false);
    }, () => setLoading(false));

    return () => unsub();
  }, [comunidadId]);

  async function handleRegistrar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre || !apartamento || !comunidadId || !user) return;
    setSaving(true);

    try {
      await addDoc(collection(db, 'paqueteria'), {
        comunidad_id: comunidadId,
        vigilante_id: user.uid,
        destinatario_nombre: nombre,
        apartamento,
        tipo,
        ...(tipo === 'recibo' && reciboTipo ? { recibo_tipo: reciboTipo } : {}),
        descripcion: descripcion || null,
        estado: 'recibido',
        created_at: new Date().toISOString(),
        entregado_at: null,
      });

      toast.success(tipo === 'recibo' ? 'Recibo registrado' : 'Paquete registrado');
      setShowForm(false);
      setNombre(''); setApartamento(''); setTipo('paquete'); setReciboTipo(''); setDescripcion('');
    } catch (err) {
      console.error('[Paqueteria] Error:', err);
      toast.error('Error al registrar');
    } finally {
      setSaving(false);
    }
  }

  async function marcarEntregado(paqueteId: string) {
    try {
      await updateDoc(doc(db, 'paqueteria', paqueteId), {
        estado: 'entregado',
        entregado_at: new Date().toISOString(),
      });
      toast.success('Marcado como entregado');
    } catch (err) {
      console.error('[Paqueteria] Error:', err);
      toast.error('Error al actualizar');
    }
  }

  const pendientes = paquetes.filter(p => p.estado !== 'entregado');
  const entregados = paquetes.filter(p => p.estado === 'entregado');

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-finca-dark">Paqueteria y recibos</h1>
          <p className="text-sm text-muted-foreground">Registro de paquetes, sobres y recibos</p>
        </div>
        <Button
          onClick={() => setShowForm(!showForm)}
          className={showForm ? 'bg-gray-500 hover:bg-gray-600' : 'bg-amber-600 hover:bg-amber-700'}
        >
          {showForm ? <><X className="w-4 h-4 mr-1" />Cancelar</> : <><Plus className="w-4 h-4 mr-1" />Registrar</>}
        </Button>
      </div>

      {/* Formulario */}
      {showForm && (
        <Card className="border-2 border-amber-200 shadow-md">
          <CardContent className="p-4">
            <form onSubmit={handleRegistrar} className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="p-nombre">Destinatario *</Label>
                  <Input id="p-nombre" placeholder="Nombre del residente" value={nombre} onChange={e => setNombre(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-apto">Apartamento *</Label>
                  <Input id="p-apto" placeholder="Ej: 504, Torre A - 302" value={apartamento} onChange={e => setApartamento(e.target.value)} required />
                </div>
              </div>

              {/* Tipo selector */}
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <div className="flex flex-wrap gap-2">
                  {tiposPaquete.map(t => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => { setTipo(t.value); if (t.value !== 'recibo') setReciboTipo(''); }}
                      className={cn(
                        'inline-flex items-center gap-1.5 text-xs font-medium border rounded-full px-3 py-1.5 transition-colors',
                        tipo === t.value
                          ? 'bg-amber-600 text-white border-amber-600'
                          : 'bg-white text-finca-dark border-border hover:bg-amber-50',
                      )}
                    >
                      <t.icon className="w-3 h-3" />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Recibo sub-tipo */}
              {tipo === 'recibo' && (
                <div className="space-y-1.5">
                  <Label>Tipo de recibo</Label>
                  <div className="flex flex-wrap gap-2">
                    {tiposRecibo.map(r => (
                      <button
                        key={r.value}
                        type="button"
                        onClick={() => setReciboTipo(r.value)}
                        className={cn(
                          'inline-flex items-center gap-1.5 text-xs font-medium border rounded-lg px-3 py-2 transition-all',
                          reciboTipo === r.value
                            ? r.color + ' ring-2 ring-offset-1 ring-amber-400'
                            : 'bg-white text-finca-dark border-border hover:bg-gray-50',
                        )}
                      >
                        <r.icon className="w-4 h-4" />
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="p-desc">Descripcion (opcional)</Label>
                <Input id="p-desc" placeholder="Detalles del paquete o recibo" value={descripcion} onChange={e => setDescripcion(e.target.value)} />
              </div>

              <Button type="submit" className="w-full bg-amber-600 hover:bg-amber-700" disabled={saving || !nombre || !apartamento}>
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserCheck className="w-4 h-4 mr-2" />}
                Registrar {tipo === 'recibo' ? 'recibo' : 'paquete'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Pendientes */}
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Card key={i} className="border-0 shadow-sm"><CardContent className="p-3"><Skeleton className="h-12 w-full" /></CardContent></Card>)}</div>
      ) : pendientes.length === 0 && entregados.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="py-8 text-center">
            <Package className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No hay paquetes ni recibos registrados</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {pendientes.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-finca-dark mb-2">
                Pendientes ({pendientes.length})
              </h2>
              <div className="space-y-2">
                {pendientes.map(p => {
                  const est = estadoConfig[p.estado] || estadoConfig.recibido;
                  const reciboInfo = p.recibo_tipo ? tiposRecibo.find(r => r.value === p.recibo_tipo) : null;
                  const TipoIcon = p.tipo === 'recibo' && reciboInfo ? reciboInfo.icon : Package;

                  return (
                    <Card key={p.id} className="border-0 shadow-sm">
                      <CardContent className="p-3 flex items-center gap-3">
                        <div className={cn(
                          'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                          p.tipo === 'recibo' && reciboInfo ? reciboInfo.color.split(' ')[0] : 'bg-amber-50',
                        )}>
                          <TipoIcon className={cn(
                            'w-5 h-5',
                            p.tipo === 'recibo' && reciboInfo ? reciboInfo.color.split(' ')[1] : 'text-amber-600',
                          )} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-finca-dark truncate">{p.destinatario_nombre}</p>
                          <p className="text-xs text-muted-foreground">
                            Apto {p.apartamento} - {p.tipo === 'recibo' && reciboInfo ? `Recibo ${reciboInfo.label}` : p.tipo} - {format(new Date(p.created_at), 'dd/MM HH:mm', { locale: es })}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge className={cn('text-[10px] border', est.color)}>{est.label}</Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-green-300 text-green-700 hover:bg-green-50"
                            onClick={() => marcarEntregado(p.id)}
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Entregar
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}

          {entregados.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground mb-2">
                Entregados ({entregados.length})
              </h2>
              <div className="space-y-1.5">
                {entregados.slice(0, 10).map(p => (
                  <Card key={p.id} className="border-0 shadow-sm opacity-60">
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-finca-dark truncate">{p.destinatario_nombre}</p>
                        <p className="text-xs text-muted-foreground">Apto {p.apartamento} - {p.tipo}</p>
                      </div>
                      <Badge className="text-[10px] border bg-green-100 text-green-700 border-green-200">Entregado</Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
