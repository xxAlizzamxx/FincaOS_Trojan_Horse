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
  AlertTriangle, Plus, X, Loader2, ShieldAlert, Info,
  Wrench, Droplets, Flame, Volume2, Car, Bell, BellOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';

interface Alerta {
  id: string;
  titulo: string;
  descripcion: string;
  tipo: string;
  prioridad: string;
  activa: boolean;
  created_at: string;
  creado_por: string;
}

const tiposAlerta = [
  { value: 'emergencia',    label: 'Emergencia',     icon: ShieldAlert,   color: 'bg-red-50 text-red-600'      },
  { value: 'mantenimiento', label: 'Mantenimiento',  icon: Wrench,        color: 'bg-orange-50 text-orange-600' },
  { value: 'agua',          label: 'Corte de agua',  icon: Droplets,      color: 'bg-blue-50 text-blue-600'     },
  { value: 'gas',           label: 'Corte de gas',   icon: Flame,         color: 'bg-amber-50 text-amber-600'   },
  { value: 'ruido',         label: 'Ruido',          icon: Volume2,       color: 'bg-purple-50 text-purple-600' },
  { value: 'vehiculo',      label: 'Vehiculo',       icon: Car,           color: 'bg-cyan-50 text-cyan-600'     },
  { value: 'informativa',   label: 'Informativa',    icon: Info,          color: 'bg-green-50 text-green-600'   },
];

const prioridades = [
  { value: 'baja',   label: 'Baja',   color: 'bg-green-100 text-green-700 border-green-200'  },
  { value: 'media',  label: 'Media',  color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  { value: 'alta',   label: 'Alta',   color: 'bg-orange-100 text-orange-700 border-orange-200' },
  { value: 'urgente',label: 'Urgente',color: 'bg-red-100 text-red-700 border-red-200'         },
];

export default function AlertasPage() {
  const { perfil, user } = useAuth();
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [tipo, setTipo] = useState('informativa');
  const [prioridad, setPrioridad] = useState('media');

  const comunidadId = perfil?.comunidad_id;

  useEffect(() => {
    if (!comunidadId) return;

    const q = query(
      collection(db, 'alertas_comunidad'),
      where('comunidad_id', '==', comunidadId),
      orderBy('created_at', 'desc'),
    );

    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Alerta));
      setAlertas(items);
      setLoading(false);
    }, () => setLoading(false));

    return () => unsub();
  }, [comunidadId]);

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo || !descripcion || !comunidadId || !user) return;
    setSaving(true);

    try {
      await addDoc(collection(db, 'alertas_comunidad'), {
        comunidad_id: comunidadId,
        creado_por: user.uid,
        creado_por_nombre: perfil?.nombre_completo || 'Vigilante',
        titulo,
        descripcion,
        tipo,
        prioridad,
        activa: true,
        created_at: new Date().toISOString(),
      });

      toast.success('Alerta creada y enviada a la comunidad');
      setShowForm(false);
      setTitulo(''); setDescripcion(''); setTipo('informativa'); setPrioridad('media');
    } catch (err) {
      console.error('[Alertas] Error:', err);
      toast.error('Error al crear la alerta');
    } finally {
      setSaving(false);
    }
  }

  async function toggleAlerta(alertaId: string, activa: boolean) {
    try {
      await updateDoc(doc(db, 'alertas_comunidad', alertaId), { activa: !activa });
      toast.success(activa ? 'Alerta desactivada' : 'Alerta reactivada');
    } catch (err) {
      console.error('[Alertas] Error:', err);
      toast.error('Error al actualizar');
    }
  }

  const activas = alertas.filter(a => a.activa);
  const inactivas = alertas.filter(a => !a.activa);

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-finca-dark">Alertas comunitarias</h1>
          <p className="text-sm text-muted-foreground">Avisos y alertas para la comunidad</p>
        </div>
        <Button
          onClick={() => setShowForm(!showForm)}
          className={showForm ? 'bg-gray-500 hover:bg-gray-600' : 'bg-orange-600 hover:bg-orange-700'}
        >
          {showForm ? <><X className="w-4 h-4 mr-1" />Cancelar</> : <><Plus className="w-4 h-4 mr-1" />Nueva alerta</>}
        </Button>
      </div>

      {/* Formulario */}
      {showForm && (
        <Card className="border-2 border-orange-200 shadow-md">
          <CardContent className="p-4">
            <form onSubmit={handleCrear} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="a-titulo">Titulo *</Label>
                <Input id="a-titulo" placeholder="Titulo de la alerta" value={titulo} onChange={e => setTitulo(e.target.value)} required />
              </div>

              {/* Tipo */}
              <div className="space-y-1.5">
                <Label>Tipo de alerta</Label>
                <div className="flex flex-wrap gap-1.5">
                  {tiposAlerta.map(t => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setTipo(t.value)}
                      className={cn(
                        'inline-flex items-center gap-1.5 text-xs font-medium border rounded-full px-3 py-1.5 transition-colors',
                        tipo === t.value
                          ? 'bg-orange-600 text-white border-orange-600'
                          : 'bg-white text-finca-dark border-border hover:bg-orange-50',
                      )}
                    >
                      <t.icon className="w-3 h-3" />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Prioridad */}
              <div className="space-y-1.5">
                <Label>Prioridad</Label>
                <div className="flex gap-2">
                  {prioridades.map(p => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setPrioridad(p.value)}
                      className={cn(
                        'text-xs font-medium border rounded-lg px-3 py-1.5 transition-all',
                        prioridad === p.value
                          ? p.color + ' ring-2 ring-offset-1 ring-orange-400'
                          : 'bg-white text-finca-dark border-border hover:bg-gray-50',
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="a-desc">Descripcion *</Label>
                <textarea
                  id="a-desc"
                  placeholder="Describe la alerta con detalle..."
                  value={descripcion}
                  onChange={e => setDescripcion(e.target.value)}
                  required
                  rows={3}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <Button type="submit" className="w-full bg-orange-600 hover:bg-orange-700" disabled={saving || !titulo || !descripcion}>
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Bell className="w-4 h-4 mr-2" />}
                Enviar alerta
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Lista */}
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Card key={i} className="border-0 shadow-sm"><CardContent className="p-3"><Skeleton className="h-14 w-full" /></CardContent></Card>)}</div>
      ) : alertas.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="py-8 text-center">
            <AlertTriangle className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No hay alertas registradas</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {activas.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-finca-dark mb-2">
                Activas ({activas.length})
              </h2>
              <div className="space-y-2">
                {activas.map(a => {
                  const tipoInfo = tiposAlerta.find(t => t.value === a.tipo) || tiposAlerta[6];
                  const prioInfo = prioridades.find(p => p.value === a.prioridad) || prioridades[1];
                  const TipoIcon = tipoInfo.icon;

                  return (
                    <Card key={a.id} className={cn(
                      'border-0 shadow-sm',
                      a.prioridad === 'urgente' && 'border-l-4 border-l-red-500',
                      a.prioridad === 'alta' && 'border-l-4 border-l-orange-500',
                    )}>
                      <CardContent className="p-3">
                        <div className="flex items-start gap-3">
                          <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', tipoInfo.color.split(' ')[0])}>
                            <TipoIcon className={cn('w-5 h-5', tipoInfo.color.split(' ')[1])} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <p className="text-sm font-semibold text-finca-dark truncate">{a.titulo}</p>
                              <Badge className={cn('text-[10px] border shrink-0', prioInfo.color)}>{prioInfo.label}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2">{a.descripcion}</p>
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {format(new Date(a.created_at), "dd MMM yyyy - HH:mm", { locale: es })}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 shrink-0"
                            onClick={() => toggleAlerta(a.id, a.activa)}
                          >
                            <BellOff className="w-3 h-3 mr-1" />
                            Desactivar
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}

          {inactivas.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground mb-2">
                Historial ({inactivas.length})
              </h2>
              <div className="space-y-1.5">
                {inactivas.slice(0, 10).map(a => {
                  const tipoInfo = tiposAlerta.find(t => t.value === a.tipo) || tiposAlerta[6];
                  const TipoIcon = tipoInfo.icon;
                  return (
                    <Card key={a.id} className="border-0 shadow-sm opacity-60">
                      <CardContent className="p-3 flex items-center gap-3">
                        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', tipoInfo.color.split(' ')[0])}>
                          <TipoIcon className={cn('w-5 h-5', tipoInfo.color.split(' ')[1])} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-finca-dark truncate">{a.titulo}</p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(a.created_at), "dd MMM yyyy", { locale: es })}
                          </p>
                        </div>
                        <Badge className="text-[10px] border bg-gray-100 text-gray-500 border-gray-200">Inactiva</Badge>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
