'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, addDoc, onSnapshot, getDocs, doc, updateDoc } from 'firebase/firestore';
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
  DoorOpen, AlertTriangle, Wrench, MapPin, ArrowRightLeft,
  LogIn, LogOut, CheckCircle2, AlertCircle,
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
  // Ronda
  areas_ronda?: string[];
  tiene_novedad?: boolean;
  // Novedad
  urgencia?: string;
  // Acceso
  tipo_acceso?: string;
  nombre_acceso?: string;
  apartamento_acceso?: string;
  motivo_acceso?: string;
  // Mantenimiento
  ubicacion?: string;
  estado_mantenimiento?: string;
  // Turno
  vigilante_entrega?: string;
  vigilante_recibe?: string;
  estado_instalaciones?: string;
  // Incidente
  acciones_tomadas?: string;
  estado_incidente?: string;
}

const tiposEntrada = [
  { value: 'observacion',   label: 'Observacion',    icon: Eye,            color: 'bg-blue-50 text-blue-600'     },
  { value: 'ronda',         label: 'Ronda',           icon: MapPin,         color: 'bg-green-50 text-green-600'   },
  { value: 'novedad',       label: 'Novedad',         icon: AlertTriangle,  color: 'bg-yellow-50 text-yellow-600' },
  { value: 'acceso',        label: 'Acceso',          icon: DoorOpen,       color: 'bg-purple-50 text-purple-600' },
  { value: 'mantenimiento', label: 'Mantenimiento',   icon: Wrench,         color: 'bg-orange-50 text-orange-600' },
  { value: 'turno',         label: 'Cambio de turno', icon: ArrowRightLeft, color: 'bg-finca-peach/40 text-finca-coral' },
  { value: 'incidente',     label: 'Incidente',       icon: ShieldCheck,    color: 'bg-red-50 text-red-600'       },
];

const AREAS_RONDA = ['Parqueadero', 'Acceso principal', 'Escaleras', 'Azotea', 'Jardín', 'Sala comunal', 'Sótano', 'Perímetro'];
const URGENCIAS  = [
  { value: 'baja',    label: 'Baja',    cls: 'bg-green-100 text-green-700 border-green-200'   },
  { value: 'media',   label: 'Media',   cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  { value: 'alta',    label: 'Alta',    cls: 'bg-orange-100 text-orange-700 border-orange-200' },
  { value: 'urgente', label: 'Urgente', cls: 'bg-red-100 text-red-700 border-red-200'           },
];
const ESTADOS_MANT = [
  { value: 'reportado',   label: 'Reportado'  },
  { value: 'en_proceso',  label: 'En proceso' },
  { value: 'resuelto',    label: 'Resuelto'   },
];
const ESTADOS_INC = [
  { value: 'resuelto',    label: 'Resuelto'        },
  { value: 'seguimiento', label: 'En seguimiento'  },
  { value: 'escalado',    label: 'Escalado'        },
];
const ESTADOS_INST = [
  { value: 'normal',    label: 'Normal',       cls: 'bg-green-100 text-green-700 border-green-200'   },
  { value: 'novedad',   label: 'Con novedad',  cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  { value: 'incidente', label: 'Incidente',    cls: 'bg-red-100 text-red-700 border-red-200'           },
];

function PillSelector({ options, value, onChange, accent = false }: {
  options: { value: string; label: string; cls?: string }[];
  value: string;
  onChange: (v: string) => void;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'text-xs font-medium border rounded-full px-3 py-1.5 transition-all',
            value === o.value
              ? accent
                ? 'bg-finca-coral text-white border-finca-coral'
                : (o.cls ? o.cls + ' ring-2 ring-offset-1 ring-finca-coral/30' : 'bg-finca-coral text-white border-finca-coral')
              : 'bg-white text-finca-dark border-border hover:bg-finca-peach/20',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface VigilanteItem { id: string; nombre_completo: string; }

export default function BitacoraPage() {
  const { perfil, user } = useAuth();
  const [entradas, setEntradas] = useState<EntradaBitacora[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [tipo, setTipo]         = useState('observacion');

  // Vigilantes para cambio de turno
  const [vigilantes, setVigilantes] = useState<VigilanteItem[]>([]);
  const [busquedaVigilante, setBusquedaVigilante] = useState('');
  const [showVigSuggestions, setShowVigSuggestions] = useState(false);

  // ── Form state per type ──────────────────────────────────────────────────
  // Observacion / fallback
  const [titulo,      setTitulo]      = useState('');
  const [descripcion, setDescripcion] = useState('');

  // Ronda
  const [areasRonda,       setAreasRonda]       = useState<string[]>([]);
  const [tieneNovedadRonda, setTieneNovedadRonda] = useState(false);

  // Novedad
  const [urgencia, setUrgencia] = useState('media');

  // Acceso
  const [tipoAcceso,        setTipoAcceso]        = useState<'entrada' | 'salida'>('entrada');
  const [nombreAcceso,      setNombreAcceso]       = useState('');
  const [apartamentoAcceso, setApartamentoAcceso]  = useState('');
  const [motivoAcceso,      setMotivoAcceso]       = useState('');

  // Mantenimiento
  const [ubicacion,    setUbicacion]    = useState('');
  const [estadoMant,   setEstadoMant]   = useState('reportado');

  // Cambio de turno
  const [vigilanteRecibe,     setVigilanteRecibe]     = useState('');
  const [estadoInstalaciones, setEstadoInstalaciones] = useState('normal');
  const [notasTurno,          setNotasTurno]          = useState('');

  // Incidente
  const [accionesTomadas, setAccionesTomadas] = useState('');
  const [estadoIncidente, setEstadoIncidente] = useState('resuelto');

  const comunidadId = perfil?.comunidad_id;

  // Reset form when tipo changes
  function resetForm() {
    setTitulo(''); setDescripcion('');
    setAreasRonda([]); setTieneNovedadRonda(false);
    setUrgencia('media');
    setTipoAcceso('entrada'); setNombreAcceso(''); setApartamentoAcceso(''); setMotivoAcceso('');
    setUbicacion(''); setEstadoMant('reportado');
    setVigilanteRecibe(''); setEstadoInstalaciones('normal'); setNotasTurno('');
    setAccionesTomadas(''); setEstadoIncidente('resuelto');
  }

  useEffect(() => { resetForm(); }, [tipo]);

  // Load vigilantes for turno search
  useEffect(() => {
    if (!comunidadId) return;
    getDocs(query(collection(db, 'perfiles'), where('comunidad_id', '==', comunidadId), where('rol', '==', 'vigilante')))
      .then(snap => setVigilantes(snap.docs
        .map(d => ({ id: d.id, nombre_completo: d.data().nombre_completo || '' }))
        .filter(v => v.id !== user?.uid && v.nombre_completo)
      ))
      .catch(() => {});
  }, [comunidadId, user?.uid]);

  const vigSugerencias = vigilantes.filter(v =>
    busquedaVigilante.length >= 1 &&
    v.nombre_completo.toLowerCase().includes(busquedaVigilante.toLowerCase())
  );

  useEffect(() => {
    if (!comunidadId) return;
    const q = query(collection(db, 'bitacora_vigilancia'), where('comunidad_id', '==', comunidadId));
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as EntradaBitacora))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setEntradas(items);
      setLoading(false);
    }, (err) => { console.error('[Bitacora]', err); setLoading(false); });
    return () => unsub();
  }, [comunidadId]);

  // ── Validation per type ──────────────────────────────────────────────────
  function isValid(): boolean {
    switch (tipo) {
      case 'observacion': return !!titulo;
      case 'ronda':       return areasRonda.length > 0;
      case 'novedad':     return !!titulo;
      case 'acceso':      return !!nombreAcceso;
      case 'mantenimiento': return !!titulo;
      case 'turno':       return !!vigilanteRecibe;
      case 'incidente':   return !!titulo;
      default:            return !!titulo;
    }
  }

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    if (!comunidadId || !user || !isValid()) return;
    setSaving(true);

    try {
      const base = {
        comunidad_id:     comunidadId,
        vigilante_id:     user.uid,
        vigilante_nombre: perfil?.nombre_completo || 'Vigilante',
        tipo,
        created_at:       new Date().toISOString(),
      };

      let extra: Record<string, unknown> = {};

      switch (tipo) {
        case 'observacion':
          extra = { titulo, descripcion };
          break;
        case 'ronda':
          extra = {
            titulo:        `Ronda de control${areasRonda.length ? ' — ' + areasRonda.join(', ') : ''}`,
            descripcion:   tieneNovedadRonda ? descripcion : '',
            areas_ronda:   areasRonda,
            tiene_novedad: tieneNovedadRonda,
          };
          break;
        case 'novedad':
          extra = { titulo, descripcion, urgencia };
          break;
        case 'acceso':
          extra = {
            titulo:              `${tipoAcceso === 'entrada' ? 'Entrada' : 'Salida'}: ${nombreAcceso}`,
            descripcion:         motivoAcceso,
            tipo_acceso:         tipoAcceso,
            nombre_acceso:       nombreAcceso,
            apartamento_acceso:  apartamentoAcceso,
            motivo_acceso:       motivoAcceso,
          };
          break;
        case 'mantenimiento':
          extra = { titulo, descripcion, ubicacion, estado_mantenimiento: estadoMant };
          break;
        case 'turno':
          extra = {
            titulo:               'Cambio de turno',
            descripcion:          notasTurno,
            vigilante_entrega:    perfil?.nombre_completo || 'Vigilante',
            vigilante_recibe:     vigilanteRecibe,
            estado_instalaciones: estadoInstalaciones,
          };
          break;
        case 'incidente':
          extra = { titulo, descripcion, acciones_tomadas: accionesTomadas, estado_incidente: estadoIncidente };
          break;
        default:
          extra = { titulo, descripcion };
      }

      await addDoc(collection(db, 'bitacora_vigilancia'), { ...base, ...extra });
      // Al registrar cambio de turno → marcar vigilante como en descanso
      if (tipo === 'turno' && user?.uid) {
        updateDoc(doc(db, 'perfiles', user.uid), { en_turno: false }).catch(() => {});
      }
      toast.success('Entrada registrada en la bitacora');
      setShowForm(false);
      resetForm();
      setBusquedaVigilante('');
      setTipo('observacion');
    } catch (err) {
      console.error('[Bitacora] Error:', err);
      toast.error('Error al registrar la entrada');
    } finally {
      setSaving(false);
    }
  }

  // ── Grouped timeline ─────────────────────────────────────────────────────
  const entradasPorFecha = entradas.reduce((acc, e) => {
    const fecha = format(new Date(e.created_at), 'yyyy-MM-dd');
    if (!acc[fecha]) acc[fecha] = [];
    acc[fecha].push(e);
    return acc;
  }, {} as Record<string, EntradaBitacora[]>);
  const fechasOrdenadas = Object.keys(entradasPorFecha).sort((a, b) => b.localeCompare(a));

  // ── Current tipo info ────────────────────────────────────────────────────
  const tipoActual = tiposEntrada.find(t => t.value === tipo)!;

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-finca-dark">Bitacora de vigilancia</h1>
          <p className="text-sm text-muted-foreground">Registro de novedades y eventos del turno</p>
        </div>
        <Button
          onClick={() => { setShowForm(!showForm); if (showForm) { resetForm(); setTipo('observacion'); } }}
          className={showForm ? 'bg-gray-500 hover:bg-gray-600' : 'bg-finca-coral hover:bg-finca-salmon'}
        >
          {showForm ? <><X className="w-4 h-4 mr-1" />Cancelar</> : <><Plus className="w-4 h-4 mr-1" />Nueva entrada</>}
        </Button>
      </div>

      {/* ── Formulario ───────────────────────────────────────────────────── */}
      {showForm && (
        <Card className="border-2 border-finca-peach shadow-md">
          <CardContent className="p-4">
            <form onSubmit={handleCrear} className="space-y-4">

              {/* Selector de tipo */}
              <div className="space-y-2">
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
                          ? 'bg-finca-coral text-white border-finca-coral'
                          : 'bg-white text-finca-dark border-border hover:bg-finca-peach/30',
                      )}
                    >
                      <t.icon className="w-3 h-3" />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Separador con nombre del tipo */}
              <div className={cn('flex items-center gap-2 rounded-xl p-2.5', tipoActual.color.split(' ')[0])}>
                <tipoActual.icon className={cn('w-4 h-4 shrink-0', tipoActual.color.split(' ')[1])} />
                <p className={cn('text-xs font-semibold', tipoActual.color.split(' ')[1])}>{tipoActual.label}</p>
              </div>

              {/* ── Observacion ── */}
              {tipo === 'observacion' && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="b-titulo">¿Qué observaste? *</Label>
                    <Input id="b-titulo" placeholder="Describe brevemente la observación" value={titulo} onChange={e => setTitulo(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="b-desc">Detalle (opcional)</Label>
                    <textarea id="b-desc" placeholder="Información adicional..." value={descripcion} onChange={e => setDescripcion(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                </>
              )}

              {/* ── Ronda ── */}
              {tipo === 'ronda' && (
                <>
                  <div className="space-y-1.5">
                    <Label>Áreas recorridas * <span className="text-muted-foreground font-normal">(selecciona todas)</span></Label>
                    <div className="flex flex-wrap gap-1.5">
                      {AREAS_RONDA.map(area => (
                        <button
                          key={area}
                          type="button"
                          onClick={() => setAreasRonda(prev => prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area])}
                          className={cn(
                            'text-xs font-medium border rounded-full px-3 py-1.5 transition-all',
                            areasRonda.includes(area)
                              ? 'bg-green-600 text-white border-green-600'
                              : 'bg-white text-finca-dark border-border hover:bg-green-50',
                          )}
                        >
                          {areasRonda.includes(area) && <CheckCircle2 className="w-3 h-3 inline mr-1" />}
                          {area}
                        </button>
                      ))}
                    </div>
                    {areasRonda.length > 0 && (
                      <p className="text-xs text-green-600 font-medium">{areasRonda.length} área{areasRonda.length > 1 ? 's' : ''} seleccionada{areasRonda.length > 1 ? 's' : ''}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>¿Se encontraron novedades?</Label>
                    <div className="flex gap-2">
                      {[{ v: false, l: 'Sin novedades', cls: 'bg-green-600' }, { v: true, l: 'Sí, hay novedad', cls: 'bg-yellow-500' }].map(opt => (
                        <button
                          key={String(opt.v)}
                          type="button"
                          onClick={() => setTieneNovedadRonda(opt.v)}
                          className={cn(
                            'flex-1 text-xs font-medium border rounded-xl px-3 py-2 transition-all',
                            tieneNovedadRonda === opt.v
                              ? opt.cls + ' text-white border-transparent'
                              : 'bg-white text-finca-dark border-border hover:bg-gray-50',
                          )}
                        >
                          {opt.l}
                        </button>
                      ))}
                    </div>
                  </div>
                  {tieneNovedadRonda && (
                    <div className="space-y-1.5">
                      <Label htmlFor="b-novedad-ronda">Describe la novedad</Label>
                      <textarea id="b-novedad-ronda" placeholder="¿Qué encontraste?" value={descripcion} onChange={e => setDescripcion(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
                    </div>
                  )}
                </>
              )}

              {/* ── Novedad ── */}
              {tipo === 'novedad' && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="b-nov-titulo">¿Qué sucedió? *</Label>
                    <Input id="b-nov-titulo" placeholder="Título de la novedad" value={titulo} onChange={e => setTitulo(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Nivel de urgencia</Label>
                    <PillSelector options={URGENCIAS} value={urgencia} onChange={setUrgencia} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="b-nov-desc">Descripcion</Label>
                    <textarea id="b-nov-desc" placeholder="Detalla la novedad..." value={descripcion} onChange={e => setDescripcion(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                </>
              )}

              {/* ── Acceso ── */}
              {tipo === 'acceso' && (
                <>
                  <div className="space-y-1.5">
                    <Label>Tipo de acceso</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { v: 'entrada' as const, l: 'Entrada', icon: LogIn,  cls: 'bg-purple-600' },
                        { v: 'salida'  as const, l: 'Salida',  icon: LogOut, cls: 'bg-gray-600'   },
                      ].map(opt => (
                        <button
                          key={opt.v}
                          type="button"
                          onClick={() => setTipoAcceso(opt.v)}
                          className={cn(
                            'flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-all',
                            tipoAcceso === opt.v
                              ? opt.cls + ' text-white border-transparent shadow-sm'
                              : 'bg-white text-finca-dark border-border hover:bg-gray-50',
                          )}
                        >
                          <opt.icon className="w-4 h-4" />
                          {opt.l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="b-nombre-acc">Nombre de la persona *</Label>
                    <Input id="b-nombre-acc" placeholder="Nombre completo" value={nombreAcceso} onChange={e => setNombreAcceso(e.target.value)} required />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="b-apto-acc">Apartamento / Destino</Label>
                      <Input id="b-apto-acc" placeholder="Ej. 302" value={apartamentoAcceso} onChange={e => setApartamentoAcceso(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="b-motivo-acc">Motivo</Label>
                      <Input id="b-motivo-acc" placeholder="Visita, proveedor…" value={motivoAcceso} onChange={e => setMotivoAcceso(e.target.value)} />
                    </div>
                  </div>
                </>
              )}

              {/* ── Mantenimiento ── */}
              {tipo === 'mantenimiento' && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="b-mant-titulo">¿Qué requiere mantenimiento? *</Label>
                    <Input id="b-mant-titulo" placeholder="Ej. Ascensor, tubería, iluminación" value={titulo} onChange={e => setTitulo(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="b-mant-ubic">Ubicación / Área</Label>
                    <Input id="b-mant-ubic" placeholder="Ej. Parqueadero subsuelo, Piso 4" value={ubicacion} onChange={e => setUbicacion(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Estado</Label>
                    <PillSelector options={ESTADOS_MANT} value={estadoMant} onChange={setEstadoMant} accent />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="b-mant-desc">Descripcion del problema (opcional)</Label>
                    <textarea id="b-mant-desc" placeholder="Describe el daño o falla..." value={descripcion} onChange={e => setDescripcion(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                </>
              )}

              {/* ── Cambio de turno ── */}
              {tipo === 'turno' && (
                <div className="rounded-xl bg-finca-peach/20 border border-finca-peach p-3 space-y-3">
                  <div className="space-y-1.5">
                    <Label>Vigilante que entrega</Label>
                    <Input value={perfil?.nombre_completo || ''} disabled className="bg-gray-50 text-muted-foreground" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Vigilante que recibe *</Label>
                    <div className="relative">
                      <Input
                        placeholder={vigilantes.length ? 'Buscar vigilante...' : 'Nombre del vigilante entrante'}
                        value={busquedaVigilante}
                        onChange={e => { setBusquedaVigilante(e.target.value); setVigilanteRecibe(e.target.value); setShowVigSuggestions(true); }}
                        onFocus={() => setShowVigSuggestions(true)}
                        required
                      />
                      {showVigSuggestions && vigSugerencias.length > 0 && (
                        <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-white border border-border rounded-xl shadow-lg overflow-hidden">
                          {vigSugerencias.map(v => (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => { setBusquedaVigilante(v.nombre_completo); setVigilanteRecibe(v.nombre_completo); setShowVigSuggestions(false); }}
                              className="w-full text-left px-3 py-2.5 hover:bg-finca-peach/30 transition-colors border-b last:border-0 border-border/40"
                            >
                              <p className="text-sm font-medium text-finca-dark">{v.nombre_completo}</p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Estado de las instalaciones</Label>
                    <PillSelector options={ESTADOS_INST} value={estadoInstalaciones} onChange={setEstadoInstalaciones} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="b-notas">Notas del turno (opcional)</Label>
                    <textarea id="b-notas" placeholder="Pendientes, novedades, instrucciones para el siguiente turno..." value={notasTurno} onChange={e => setNotasTurno(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                </div>
              )}

              {/* ── Incidente ── */}
              {tipo === 'incidente' && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="b-inc-titulo">Titulo del incidente *</Label>
                    <Input id="b-inc-titulo" placeholder="Describe el incidente brevemente" value={titulo} onChange={e => setTitulo(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="b-inc-desc">Descripcion detallada</Label>
                    <textarea id="b-inc-desc" placeholder="¿Qué ocurrió exactamente? ¿Quiénes estuvieron involucrados?" value={descripcion} onChange={e => setDescripcion(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="b-inc-acc">Acciones tomadas</Label>
                    <textarea id="b-inc-acc" placeholder="¿Qué hiciste para atender el incidente?" value={accionesTomadas} onChange={e => setAccionesTomadas(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Estado actual del incidente</Label>
                    <PillSelector options={ESTADOS_INC} value={estadoIncidente} onChange={setEstadoIncidente} accent />
                  </div>
                </>
              )}

              <Button
                type="submit"
                className="w-full bg-finca-coral hover:bg-finca-salmon"
                disabled={saving || !isValid()}
              >
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ClipboardList className="w-4 h-4 mr-2" />}
                Registrar en bitacora
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ── Lista ──────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => (
          <Card key={i} className="border-0 shadow-sm"><CardContent className="p-3"><Skeleton className="h-14 w-full" /></CardContent></Card>
        ))}</div>
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
            const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
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
                  <div className="absolute left-[19px] top-3 bottom-3 w-0.5 bg-border" />
                  {entradasPorFecha[fecha].map(e => {
                    const ti = tiposEntrada.find(t => t.value === e.tipo) || tiposEntrada[0];
                    const TI = ti.icon;
                    const isTurno = e.tipo === 'turno';
                    const bgCls = isTurno ? 'bg-finca-peach/40' : ti.color.split(' ')[0];
                    const txtCls = isTurno ? 'text-finca-coral' : ti.color.split(' ')[1];

                    return (
                      <div key={e.id} className="relative flex gap-3 pl-0">
                        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0 z-10', bgCls)}>
                          <TI className={cn('w-5 h-5', txtCls)} />
                        </div>
                        <Card className="flex-1 border-0 shadow-sm">
                          <CardContent className="p-3">
                            <div className="flex items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                  <p className="text-sm font-medium text-finca-dark">{e.titulo}</p>
                                  <Badge variant="outline" className="text-[10px] shrink-0">{ti.label}</Badge>
                                  {/* Extra badges */}
                                  {e.urgencia && (
                                    <Badge className={cn('text-[10px] border shrink-0', URGENCIAS.find(u => u.value === e.urgencia)?.cls)}>{e.urgencia}</Badge>
                                  )}
                                  {e.estado_mantenimiento && (
                                    <Badge variant="outline" className="text-[10px] shrink-0">{ESTADOS_MANT.find(m => m.value === e.estado_mantenimiento)?.label}</Badge>
                                  )}
                                  {e.estado_incidente && (
                                    <Badge variant="outline" className="text-[10px] shrink-0">{ESTADOS_INC.find(i => i.value === e.estado_incidente)?.label}</Badge>
                                  )}
                                </div>

                                {/* Ronda areas */}
                                {e.areas_ronda && e.areas_ronda.length > 0 && (
                                  <p className="text-xs text-muted-foreground">{e.areas_ronda.join(' · ')}</p>
                                )}
                                {e.tipo === 'ronda' && (
                                  <p className={cn('text-xs font-medium mt-0.5', e.tiene_novedad ? 'text-yellow-600' : 'text-green-600')}>
                                    {e.tiene_novedad ? '⚠ Con novedad' : '✓ Sin novedades'}
                                  </p>
                                )}

                                {/* Acceso details */}
                                {e.tipo === 'acceso' && (e.apartamento_acceso || e.motivo_acceso) && (
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {[e.apartamento_acceso && `Apto ${e.apartamento_acceso}`, e.motivo_acceso].filter(Boolean).join(' — ')}
                                  </p>
                                )}

                                {/* Mantenimiento ubicacion */}
                                {e.ubicacion && (
                                  <p className="text-xs text-muted-foreground mt-0.5">📍 {e.ubicacion}</p>
                                )}

                                {/* Turno details */}
                                {isTurno && (
                                  <div className="mt-0.5 space-y-0.5">
                                    {e.vigilante_entrega && <p className="text-xs text-muted-foreground"><span className="font-medium">Entrega:</span> {e.vigilante_entrega}</p>}
                                    {e.vigilante_recibe  && <p className="text-xs text-muted-foreground"><span className="font-medium">Recibe:</span> {e.vigilante_recibe}</p>}
                                    {e.estado_instalaciones && (
                                      <span className={cn('inline-block px-1.5 py-0.5 rounded text-[10px] font-medium mt-0.5',
                                        ESTADOS_INST.find(s => s.value === e.estado_instalaciones)?.cls
                                      )}>
                                        {ESTADOS_INST.find(s => s.value === e.estado_instalaciones)?.label || e.estado_instalaciones}
                                      </span>
                                    )}
                                  </div>
                                )}

                                {/* Incidente acciones */}
                                {e.acciones_tomadas && (
                                  <p className="text-xs text-muted-foreground mt-0.5"><span className="font-medium">Acciones:</span> {e.acciones_tomadas}</p>
                                )}

                                {/* Descripcion general */}
                                {e.descripcion && e.tipo !== 'acceso' && (
                                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{e.descripcion}</p>
                                )}

                                <p className="text-[10px] text-muted-foreground mt-1">
                                  {format(new Date(e.created_at), 'HH:mm', { locale: es })} — {e.vigilante_nombre}
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
