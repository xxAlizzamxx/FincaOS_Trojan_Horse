'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ArrowLeft, CircleCheck as CheckCircle2, Camera, X } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/firebase/client';
import { collection, addDoc, doc, setDoc } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { useSound } from '@/hooks/useSound';
import { crearNotificacionComunidad } from '@/lib/firebase/notifications';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { normalizeZona, type Zona } from '@/lib/incidencias/mapZona';

const CATEGORIAS = [
  { id: 'filtraciones', nombre: 'Filtraciones', emoji: '💧' },
  { id: 'altavoces',   nombre: 'Altavoces',    emoji: '🔊' },
  { id: 'mascotas',    nombre: 'Mascotas',      emoji: '🐾' },
  { id: 'parking',     nombre: 'Parking',       emoji: '🚗' },
  { id: 'obras',       nombre: 'Obras',         emoji: '🏗️' },
  { id: 'otros',       nombre: 'Otros',         emoji: '📦' },
];

// Technical routing options — used to match with proveedor.servicios.
// Independent of CATEGORIAS (user-facing labels). Defaults to 'general'.
// The first 4 are shown by default; selecting 'otro' expands ALL_SERVICIOS below.
const TIPO_PROBLEMA_OPTIONS = [
  { value: 'electricidad', label: 'Electricidad', emoji: '⚡' },
  { value: 'fontaneria',   label: 'Fontanería',   emoji: '🔧' },
  { value: 'ascensores',   label: 'Ascensores',   emoji: '🛗' },
  { value: 'general',      label: 'General',      emoji: '🔩' },
  { value: 'otro',         label: 'Otro…',        emoji: '➕' },
] as const;

// Full list of provider specialties — shown when "Otro…" is selected.
// Must match ESPECIALIDADES in /proveedor/registro and SERVICIOS_DISPONIBLES in /proveedor/page.
const ALL_SERVICIOS = [
  { value: 'electricidad',      label: 'Electricidad',        emoji: '⚡' },
  { value: 'fontaneria',        label: 'Fontanería',          emoji: '🔧' },
  { value: 'albanileria',       label: 'Albañilería',         emoji: '🧱' },
  { value: 'pintura',           label: 'Pintura',             emoji: '🎨' },
  { value: 'ascensores',        label: 'Ascensores',          emoji: '🛗' },
  { value: 'limpieza',          label: 'Limpieza',            emoji: '🧹' },
  { value: 'jardineria',        label: 'Jardinería',          emoji: '🌿' },
  { value: 'cerrajeria',        label: 'Cerrajería',          emoji: '🔑' },
  { value: 'climatizacion',     label: 'Climatización',       emoji: '❄️' },
  { value: 'telecomunicaciones',label: 'Telecomunicaciones',  emoji: '📡' },
  { value: 'desinfeccion',      label: 'Desinfección/Plagas', emoji: '🐀' },
  { value: 'general',           label: 'General',             emoji: '🔩' },
];

const prioridades = [
  { value: 'baja',    label: 'Baja',    emoji: '🟢', color: 'border-green-300 bg-green-50 text-green-700'   },
  { value: 'normal',  label: 'Normal',  emoji: '🔵', color: 'border-blue-300 bg-blue-50 text-blue-700'     },
  { value: 'alta',    label: 'Alta',    emoji: '⚠️', color: 'border-orange-300 bg-orange-50 text-orange-700' },
  { value: 'urgente', label: 'Urgente', emoji: '🚨', color: 'border-red-300 bg-red-50 text-red-700'         },
];

// Zonas con valor canónico (enum) — lo que se guarda en Firestore
const UBICACIONES: { label: string; emoji: string; zona: Zona }[] = [
  { label: 'Mi vivienda', emoji: '🏠', zona: 'vivienda'      },
  { label: 'Zona común',  emoji: '🏢', zona: 'zonas_comunes' },
  { label: 'Garaje',      emoji: '🅿️', zona: 'parking'       },
  { label: 'Jardín',      emoji: '🌳', zona: 'jardin'        },
  { label: 'Otro',        emoji: '📍', zona: 'otro'          },
];

export default function NuevaIncidenciaPage() {
  const router = useRouter();
  const { perfil, user } = useAuth();
  const { play } = useSound();
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [estimacion, setEstimacion] = useState<{ min: number; max: number } | null>(null);
  const [estimando, setEstimando] = useState(false);
  const [prioridadIA, setPrioridadIA] = useState<string | null>(null);
  const [fotos, setFotos] = useState<File[]>([]);
  const [fotoPreviews, setFotoPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [prioridad, setPrioridad] = useState('normal');
  const [ubicacion, setUbicacion] = useState('Zona común');   // label para display
  const [zona, setZona]           = useState<Zona>('zonas_comunes'); // enum para Firestore
  const [tipoProblema, setTipoProblema] = useState<string>('general'); // routing para proveedores

  async function fetchEstimacion(catNombre: string, desc: string, ubi: string) {
    setEstimando(true);
    try {
      const res = await fetch('/api/ai/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoria: catNombre, descripcion: desc, ubicacion: ubi }),
      });
      const data = await res.json();
      setEstimacion({ min: data.min, max: data.max });
      if (data.prioridad) {
        setPrioridad(data.prioridad);
        setPrioridadIA(data.prioridad);
      }
    } catch {
      setEstimacion({ min: 100, max: 600 });
    } finally {
      setEstimando(false);
    }
  }

  function handleFotoAdd(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    const maxFotos = 5;
    const remaining = maxFotos - fotos.length;
    const newFiles = files.slice(0, remaining);
    if (files.length > remaining) {
      toast.error(`Máximo ${maxFotos} fotos`);
    }
    setFotos((prev) => [...prev, ...newFiles]);
    newFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => setFotoPreviews((prev) => [...prev, ev.target?.result as string]);
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleFotoRemove(index: number) {
    setFotos((prev) => prev.filter((_, i) => i !== index));
    setFotoPreviews((prev) => prev.filter((_, i) => i !== index));
  }

  async function uploadFotos(incidenciaId: string, comunidadId: string): Promise<void> {
    for (const file of fotos) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('comunidad_id', comunidadId);
      formData.append('incidencia_id', incidenciaId);
      try {
        const res = await fetch('/api/upload-photo', { method: 'POST', body: formData });
        if (!res.ok) continue;
        const { url, public_id } = await res.json();
        await addDoc(collection(db, 'incidencias_fotos'), {
          incidencia_id: incidenciaId,
          url,
          storage_path: public_id,
          uploaded_by: perfil?.id || null,
          created_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error('Error subiendo foto:', err);
      }
    }
  }

  async function handleCategoriaChange(id: string) {
    setCategoriaId(id);
    const cat = CATEGORIAS.find((c) => c.id === id);
    if (!cat) return;
    setEstimacion(null);
    await fetchEstimacion(cat.nombre, descripcion, ubicacion);
  }

  async function handleDescripcionBlur() {
    if (!categoriaId) return;
    const cat = CATEGORIAS.find((c) => c.id === categoriaId);
    if (!cat) return;
    setEstimacion(null);
    await fetchEstimacion(cat.nombre, descripcion, ubicacion);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo.trim()) { toast.error('Añade un título a la incidencia'); return; }
    if (!perfil?.comunidad_id) { toast.error('No perteneces a ninguna comunidad'); return; }

    setLoading(true);
    const est = estimacion || { min: 100, max: 600 };

    try {
      const coef = (perfil as any).coeficiente ?? 1;
      const ahora = new Date().toISOString();

      // ── OPERACIÓN CRÍTICA ─────────────────────────────────────────
      // Solo addDoc puede bloquear el éxito. Si falla, mostramos error.

      const categoriaNombre = CATEGORIAS.find(c => c.id === categoriaId)?.nombre ?? '';

      const ref = await addDoc(collection(db, 'incidencias'), {
        comunidad_id:     perfil.comunidad_id,
        autor_id:         perfil.id,
        /** Denormalized — avoids N+1 getDoc on the admin panel */
        autor_nombre:     perfil.nombre_completo ?? '',
        titulo:           titulo.trim(),
        descripcion:      descripcion.trim() || null,
        categoria_id:     categoriaId,
        /** Denormalized — avoids N+1 getDoc on the admin panel */
        categoria_nombre: categoriaNombre,
        estado:           'pendiente',
        prioridad,
        ubicacion,                       // texto libre legacy — para display
        zona:         normalizeZona(zona), // enum canónico — para BuildingMap y filtros
        tipo_problema: tipoProblema,       // routing técnico — para matching con proveedores
        estimacion_min: est.min,
        estimacion_max: est.max,
        created_at:   ahora,
        updated_at:   ahora,
        resuelta_at:  null,
        quorum: {
          tipo:            'simple',
          umbral:          30,
          afectados_count: 1,
          peso_afectados:  coef,
          alcanzado:       false,
        },
      });

      console.log('[CREATE INCIDENCIA] doc principal creado — id:', ref.id);

      // ✅ Éxito confirmado: mostrar pantalla de confirmación AHORA,
      // antes de cualquier operación secundaria que pueda fallar.
      setEnviado(true);
      setLoading(false);

      // ── OPERACIONES SECUNDARIAS (fire-and-forget) ─────────────────
      // Fallos aquí NO deben mostrar error al usuario.
      // Cada operación tiene su propio try/catch y log exacto.

      // 1. Añadir creador como afectado (subcollección — requiere regla Firestore)
      setDoc(
        doc(db, 'incidencias', ref.id, 'afectados', perfil.id),
        { coeficiente: coef, added_at: ahora, es_autor: true },
      ).then(() => {
        console.log('[CREATE INCIDENCIA] afectados subcollection — ok');
      }).catch((err) => {
        console.error('[FIRESTORE WRITE FAILED] afectados subcollection:', err?.code, err?.message);
      });

      // 2. Subir fotos
      if (fotos.length > 0) {
        uploadFotos(ref.id, perfil.comunidad_id).catch((err) =>
          console.error('[FIRESTORE WRITE FAILED] uploadFotos:', err?.message ?? err),
        );
      }

      // 3. Notificación de comunidad (subcollección comunidades/{id}/notificaciones)
      //    (notificarAdmins eliminada: escribía en la colección global 'notificaciones'
      //     con usuario_id ajeno, lo que Firestore deniega para vecinos.
      //     crearNotificacionComunidad cubre el mismo caso sin ese problema.)
      crearNotificacionComunidad(perfil.comunidad_id, {
        tipo:       'incidencia',
        titulo:     titulo.trim(),
        mensaje:    `Reportado por ${perfil.nombre_completo}`,
        created_by: perfil.id,
        related_id: ref.id,
        link:       `/incidencias/${ref.id}`,
      }).catch((err) => {
        console.error('[FIRESTORE WRITE FAILED] crearNotificacionComunidad:', err?.code, err?.message);
      });

      // 5. Push notification a la comunidad
      fetch('/api/notificaciones/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comunidad_id: perfil.comunidad_id,
          title: '🔧 Nueva incidencia reportada',
          body: titulo.trim(),
          url: `/incidencias/${ref.id}`,
        }),
      }).catch(() => {});

      // 6. Sonido
      try { play('incidencia_creada'); } catch (err) {
        console.warn('[CREATE INCIDENCIA] play() ignorado:', err);
      }

      // 7. Auto-assign provider for urgent/alta incidencias.
      //    Only fires for prioridad urgente | alta. Fire-and-forget — any
      //    failure here is silent and never affects the incidencia creation UX.
      if (['urgente', 'alta'].includes(prioridad) && user && perfil.comunidad_id) {
        user.getIdToken()
          .then(token =>
            fetch('/api/ai/auto-assign', {
              method:  'POST',
              headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify({
                incidenciaId: ref.id,
                comunidadId:  perfil.comunidad_id,
              }),
            }),
          )
          .then(() => console.log('[CREATE INCIDENCIA] auto-assign triggered'))
          .catch(() => {}); // silent — never block incidencia creation
      }

      // 8. Ping the AI pattern engine in the background so the PatternAlertWidget
      //    updates automatically without the admin having to click "Analizar ahora".
      //    Fire-and-forget — failures are silent and never affect the UI.
      if (user && perfil.comunidad_id) {
        user.getIdToken()
          .then(token =>
            fetch(
              `/api/ai/pattern-engine?comunidadId=${encodeURIComponent(perfil.comunidad_id!)}`,
              { headers: { Authorization: `Bearer ${token}` } },
            ),
          )
          .then(() => console.log('[CREATE INCIDENCIA] pattern engine refreshed'))
          .catch(() => {}); // silent — never block incidencia creation
      }

    } catch (err: any) {
      // Solo llega aquí si addDoc falla (incidencia NO creada)
      console.error('[FIRESTORE WRITE FAILED] addDoc incidencias:', err?.code, err?.message, err);
      toast.error('Error al crear la incidencia');
      setLoading(false);
    }
  }

  if (enviado) {
    return (
      <div className="px-4 py-12 flex flex-col items-center text-center space-y-4">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
          <CheckCircle2 className="w-10 h-10 text-green-600" />
        </div>
        <h2 className="text-xl font-semibold text-finca-dark">Incidencia reportada</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          Tu administrador ha sido notificado. Recibirás actualizaciones del progreso.
        </p>
        {estimacion && (
          <Card className="w-full max-w-xs bg-finca-peach/20 border-finca-peach/50">
            <CardContent className="p-3 text-center">
              <p className="text-xs text-finca-coral font-semibold uppercase tracking-wide mb-1">Estimación IA</p>
              <p className="text-2xl font-bold text-finca-dark">{estimacion.min}€ – {estimacion.max}€</p>
              <p className="text-xs text-muted-foreground">Rango estimado de coste</p>
            </CardContent>
          </Card>
        )}
        <div className="flex gap-3 pt-2 w-full max-w-xs">
          <Button variant="outline" className="flex-1" onClick={() => router.push('/incidencias')}>Ver incidencias</Button>
          <Button className="flex-1 bg-finca-coral hover:bg-finca-coral/90 text-white" onClick={() => router.push('/nueva')}>Volver</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-6">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-border px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()} className="w-8 h-8 -ml-1">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="font-semibold text-finca-dark">Reportar incidencia</h1>
      </div>

      <form onSubmit={handleSubmit} className="px-4 py-4 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="titulo">¿Qué ha pasado? <span className="text-finca-coral">*</span></Label>
          <Input id="titulo" placeholder="Ej: Tubería rota en baño comunal" value={titulo} onChange={(e) => setTitulo(e.target.value)} required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="descripcion">Descripción detallada</Label>
          <Textarea id="descripcion" placeholder="Describe el problema con más detalle..." value={descripcion} onChange={(e) => setDescripcion(e.target.value)} onBlur={handleDescripcionBlur} rows={3} className="resize-none" />
        </div>

        <div className="space-y-2">
          <Label>Fotos <span className="text-muted-foreground text-xs font-normal">(opcional, máx. 5)</span></Label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            multiple
            className="hidden"
            onChange={handleFotoAdd}
          />
          <div className="flex gap-2 flex-wrap">
            {fotoPreviews.map((src, i) => (
              <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-border">
                <Image src={src} alt={`Foto ${i + 1}`} fill className="object-cover" />
                <button
                  type="button"
                  onClick={() => handleFotoRemove(i)}
                  className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center"
                >
                  <X className="w-3 h-3 text-white" />
                </button>
              </div>
            ))}
            {fotos.length < 5 && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-20 h-20 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center text-muted-foreground hover:border-finca-coral hover:text-finca-coral transition-colors"
              >
                <Camera className="w-5 h-5" />
                <span className="text-[10px] mt-1">Añadir</span>
              </button>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Categoría</Label>
          <div className="grid grid-cols-3 gap-2">
            {CATEGORIAS.map((cat) => (
              <button key={cat.id} type="button" onClick={() => handleCategoriaChange(cat.id)}
                className={cn('p-2.5 rounded-xl border text-center transition-all',
                  categoriaId === cat.id ? 'border-finca-coral bg-finca-peach/30 text-finca-coral' : 'border-border bg-white text-muted-foreground hover:border-finca-salmon'
                )}>
                <span className="text-xl block mb-1">{cat.emoji}</span>
                <span className="text-xs font-medium">{cat.nombre}</span>
              </button>
            ))}
          </div>
        </div>

        {(estimacion || estimando) && (
          <Card className="bg-finca-peach/20 border-finca-peach/50">
            <CardContent className="p-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-finca-coral font-semibold uppercase tracking-wide">Estimación IA</p>
                <p className="text-sm text-muted-foreground">Coste estimado de reparación</p>
              </div>
              {estimando ? (
                <p className="text-sm font-medium text-finca-coral animate-pulse">Estimando con IA...</p>
              ) : (
                estimacion && <p className="text-lg font-bold text-finca-dark">{estimacion.min}€ – {estimacion.max}€</p>
              )}
            </CardContent>
          </Card>
        )}

        <div className="space-y-2">
          <Label>¿Dónde?</Label>
          <div className="grid grid-cols-2 gap-2">
            {UBICACIONES.map((u) => (
              <button key={u.zona} type="button"
                onClick={() => { setUbicacion(u.label); setZona(u.zona); }}
                className={cn('p-2.5 rounded-xl border text-center transition-all',
                  u.zona === 'otro' && 'col-span-2',
                  zona === u.zona ? 'border-finca-coral bg-finca-peach/30 text-finca-coral' : 'border-border bg-white text-muted-foreground hover:border-finca-salmon'
                )}>
                <span className="text-xl block mb-1">{u.emoji}</span>
                <span className="text-xs font-medium">{u.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Tipo de problema (routing técnico para proveedores) ── */}
        <div className="space-y-2">
          <div>
            <Label>Tipo de problema</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Ayuda a conectar con el proveedor adecuado
            </p>
          </div>

          {/* Quick options — always visible */}
          <div className="grid grid-cols-5 gap-2">
            {TIPO_PROBLEMA_OPTIONS.map((t) => {
              const isOtro    = t.value === 'otro';
              const isExpanded = tipoProblema === 'otro' || (isOtro && !TIPO_PROBLEMA_OPTIONS.some(o => o.value === tipoProblema && o.value !== 'otro'));
              const isSelected = isOtro
                ? !TIPO_PROBLEMA_OPTIONS.slice(0, -1).some(o => o.value === tipoProblema)
                : tipoProblema === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => {
                    if (isOtro) setTipoProblema('otro');
                    else setTipoProblema(t.value);
                  }}
                  className={cn(
                    'p-2.5 rounded-xl border text-center transition-all',
                    isSelected
                      ? 'border-finca-coral bg-finca-peach/30 text-finca-coral'
                      : 'border-border bg-white text-muted-foreground hover:border-finca-salmon',
                  )}
                >
                  <span className="text-lg block mb-0.5">{t.emoji}</span>
                  <span className="text-xs font-medium">{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* Expanded specialties grid — shown when "Otro…" is selected */}
          {tipoProblema === 'otro' && (
            <div className="mt-2 p-3 rounded-xl border border-finca-coral/30 bg-finca-peach/10 space-y-2">
              <p className="text-xs font-medium text-finca-coral">
                Selecciona el tipo de proveedor que necesitas:
              </p>
              <div className="grid grid-cols-3 gap-2">
                {ALL_SERVICIOS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setTipoProblema(s.value)}
                    className={cn(
                      'p-2.5 rounded-xl border text-center transition-all',
                      tipoProblema === s.value
                        ? 'border-finca-coral bg-finca-peach/30 text-finca-coral'
                        : 'border-border bg-white text-muted-foreground hover:border-finca-salmon',
                    )}
                  >
                    <span className="text-lg block mb-0.5">{s.emoji}</span>
                    <span className="text-xs font-medium">{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Show selected specialty name if it's from the expanded list */}
          {tipoProblema !== 'otro' && !TIPO_PROBLEMA_OPTIONS.slice(0, -1).some(o => o.value === tipoProblema) && (
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[11px] text-finca-coral font-medium">
                {ALL_SERVICIOS.find(s => s.value === tipoProblema)?.emoji}{' '}
                {ALL_SERVICIOS.find(s => s.value === tipoProblema)?.label} seleccionado
              </span>
              <button
                type="button"
                onClick={() => setTipoProblema('general')}
                className="text-[10px] text-muted-foreground underline"
              >
                cambiar
              </button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label>Urgencia</Label>
            {prioridadIA && (
              <span className="text-[10px] font-medium text-finca-coral bg-finca-peach/30 px-1.5 py-0.5 rounded-full">
                Sugerida por IA
              </span>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {prioridades.map((p) => (
              <button key={p.value} type="button" onClick={() => setPrioridad(p.value)}
                className={cn('p-2.5 rounded-xl border text-center transition-all',
                  prioridad === p.value ? p.color + ' border-current' : 'border-border bg-white text-muted-foreground hover:border-finca-salmon'
                )}>
                <span className="text-lg block mb-0.5">{p.emoji}</span>
                <span className="text-xs font-medium">{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        <Button type="submit" className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-12 text-base font-medium" disabled={loading || !titulo.trim()}>
          {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Reportar incidencia'}
        </Button>
      </form>
    </div>
  );
}
