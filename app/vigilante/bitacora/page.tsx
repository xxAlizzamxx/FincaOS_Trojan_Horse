'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, addDoc, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ClipboardList, Plus, X, Loader2, Clock, Eye, ShieldCheck,
  DoorOpen, AlertTriangle, Wrench, Coffee, MapPin,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';

interface EntradaBitacora {
  id: string;
  tipo: string;
  titulo: string;
  descripcion: string;
  created_at: string;
  vigilante_nombre: string;
}

const tiposEntrada = [
  { value: 'observacion',   label: 'Observacion',    icon: Eye,            color: 'bg-blue-50 text-blue-600'     },
  { value: 'ronda',         label: 'Ronda',           icon: MapPin,         color: 'bg-green-50 text-green-600'   },
  { value: 'novedad',       label: 'Novedad',         icon: AlertTriangle,  color: 'bg-yellow-50 text-yellow-600' },
  { value: 'acceso',        label: 'Acceso',          icon: DoorOpen,       color: 'bg-purple-50 text-purple-600' },
  { value: 'mantenimiento', label: 'Mantenimiento',   icon: Wrench,         color: 'bg-orange-50 text-orange-600' },
  { value: 'turno',         label: 'Cambio de turno', icon: Coffee,         color: 'bg-cyan-50 text-cyan-600'     },
  { value: 'incidente',     label: 'Incidente',       icon: ShieldCheck,    color: 'bg-red-50 text-red-600'       },
];

export default function BitacoraPage() {
  const { perfil, user } = useAuth();
  const [entradas, setEntradas] = useState<EntradaBitacora[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [tipo, setTipo] = useState('observacion');

  const comunidadId = perfil?.comunidad_id;

  useEffect(() => {
    if (!comunidadId) return;

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const q = query(
      collection(db, 'bitacora_vigilancia'),
      where('comunidad_id', '==', comunidadId),
      orderBy('created_at', 'desc'),
    );

    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as EntradaBitacora));
      setEntradas(items);
      setLoading(false);
    }, () => setLoading(false));

    return () => unsub();
  }, [comunidadId]);

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo || !comunidadId || !user) return;
    setSaving(true);

    try {
      await addDoc(collection(db, 'bitacora_vigilancia'), {
        comunidad_id: comunidadId,
        vigilante_id: user.uid,
        vigilante_nombre: perfil?.nombre_completo || 'Vigilante',
        tipo,
        titulo,
        descripcion: descripcion || '',
        created_at: new Date().toISOString(),
      });

      toast.success('Entrada registrada en la bitacora');
      setShowForm(false);
      setTitulo(''); setDescripcion(''); setTipo('observacion');
    } catch (err) {
      console.error('[Bitacora] Error:', err);
      toast.error('Error al registrar la entrada');
    } finally {
      setSaving(false);
    }
  }

  // Group entries by date
  const entradasPorFecha = entradas.reduce((acc, e) => {
    const fecha = format(new Date(e.created_at), 'yyyy-MM-dd');
    if (!acc[fecha]) acc[fecha] = [];
    acc[fecha].push(e);
    return acc;
  }, {} as Record<string, EntradaBitacora[]>);

  const fechasOrdenadas = Object.keys(entradasPorFecha).sort((a, b) => b.localeCompare(a));

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-finca-dark">Bitacora de vigilancia</h1>
          <p className="text-sm text-muted-foreground">Registro de novedades y eventos del turno</p>
        </div>
        <Button
          onClick={() => setShowForm(!showForm)}
          className={showForm ? 'bg-gray-500 hover:bg-gray-600' : 'bg-purple-600 hover:bg-purple-700'}
        >
          {showForm ? <><X className="w-4 h-4 mr-1" />Cancelar</> : <><Plus className="w-4 h-4 mr-1" />Nueva entrada</>}
        </Button>
      </div>

      {/* Formulario */}
      {showForm && (
        <Card className="border-2 border-purple-200 shadow-md">
          <CardContent className="p-4">
            <form onSubmit={handleCrear} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="b-titulo">Titulo *</Label>
                <Input id="b-titulo" placeholder="Que sucedio?" value={titulo} onChange={e => setTitulo(e.target.value)} required />
              </div>

              {/* Tipo */}
              <div className="space-y-1.5">
                <Label>Tipo de entrada</Label>
                <div className="flex flex-wrap gap-1.5">
                  {tiposEntrada.map(t => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setTipo(t.value)}
                      className={cn(
                        'inline-flex items-center gap-1.5 text-xs font-medium border rounded-full px-3 py-1.5 transition-colors',
                        tipo === t.value
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'bg-white text-finca-dark border-border hover:bg-purple-50',
                      )}
                    >
                      <t.icon className="w-3 h-3" />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="b-desc">Descripcion (opcional)</Label>
                <textarea
                  id="b-desc"
                  placeholder="Detalla la novedad..."
                  value={descripcion}
                  onChange={e => setDescripcion(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <Button type="submit" className="w-full bg-purple-600 hover:bg-purple-700" disabled={saving || !titulo}>
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ClipboardList className="w-4 h-4 mr-2" />}
                Registrar en bitacora
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Lista agrupada por fecha */}
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Card key={i} className="border-0 shadow-sm"><CardContent className="p-3"><Skeleton className="h-14 w-full" /></CardContent></Card>)}</div>
      ) : entradas.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="py-8 text-center">
            <ClipboardList className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No hay entradas en la bitacora</p>
            <p className="text-xs text-muted-foreground mt-1">Registra novedades, rondas e incidentes de tu turno</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {fechasOrdenadas.map(fecha => {
            const fechaDate = new Date(fecha + 'T12:00:00');
            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);
            const esHoy = fechaDate.toDateString() === hoy.toDateString();

            return (
              <section key={fecha}>
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                  <h2 className="text-sm font-semibold text-finca-dark">
                    {esHoy ? 'Hoy' : format(fechaDate, "EEEE d 'de' MMMM", { locale: es })}
                  </h2>
                  <Badge variant="outline" className="text-[10px]">
                    {entradasPorFecha[fecha].length} entrada{entradasPorFecha[fecha].length !== 1 ? 's' : ''}
                  </Badge>
                </div>

                <div className="space-y-1.5 relative">
                  {/* Timeline line */}
                  <div className="absolute left-[19px] top-3 bottom-3 w-0.5 bg-border" />

                  {entradasPorFecha[fecha].map(e => {
                    const tipoInfo = tiposEntrada.find(t => t.value === e.tipo) || tiposEntrada[0];
                    const TipoIcon = tipoInfo.icon;

                    return (
                      <div key={e.id} className="relative flex gap-3 pl-0">
                        {/* Timeline dot */}
                        <div className={cn(
                          'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 z-10',
                          tipoInfo.color.split(' ')[0],
                        )}>
                          <TipoIcon className={cn('w-5 h-5', tipoInfo.color.split(' ')[1])} />
                        </div>

                        <Card className="flex-1 border-0 shadow-sm">
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <p className="text-sm font-medium text-finca-dark">{e.titulo}</p>
                                  <Badge variant="outline" className="text-[10px] shrink-0">{tipoInfo.label}</Badge>
                                </div>
                                {e.descripcion && (
                                  <p className="text-xs text-muted-foreground line-clamp-2">{e.descripcion}</p>
                                )}
                                <p className="text-[10px] text-muted-foreground mt-1">
                                  {format(new Date(e.created_at), 'HH:mm', { locale: es })} - {e.vigilante_nombre}
                                </p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
