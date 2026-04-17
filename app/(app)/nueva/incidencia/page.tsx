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
import { notificarAdmins, crearNotificacionComunidad } from '@/lib/firebase/notifications';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const CATEGORIAS = [
  { id: 'filtraciones', nombre: 'Filtraciones', emoji: '💧' },
  { id: 'altavoces',   nombre: 'Altavoces',    emoji: '🔊' },
  { id: 'mascotas',    nombre: 'Mascotas',      emoji: '🐾' },
  { id: 'parking',     nombre: 'Parking',       emoji: '🚗' },
  { id: 'obras',       nombre: 'Obras',         emoji: '🏗️' },
  { id: 'otros',       nombre: 'Otros',         emoji: '📦' },
];

const prioridades = [
  { value: 'baja',    label: 'Baja',    emoji: '🟢', color: 'border-green-300 bg-green-50 text-green-700'   },
  { value: 'normal',  label: 'Normal',  emoji: '🔵', color: 'border-blue-300 bg-blue-50 text-blue-700'     },
  { value: 'alta',    label: 'Alta',    emoji: '⚠️', color: 'border-orange-300 bg-orange-50 text-orange-700' },
  { value: 'urgente', label: 'Urgente', emoji: '🚨', color: 'border-red-300 bg-red-50 text-red-700'         },
];

const ubicaciones = [
  { label: 'Mi vivienda', emoji: '🏠' },
  { label: 'Zona común',  emoji: '🏢' },
  { label: 'Garaje',      emoji: '🅿️' },
  { label: 'Jardín',      emoji: '🌳' },
  { label: 'Otro',        emoji: '📍' },
];

export default function NuevaIncidenciaPage() {
  const router = useRouter();
  const { perfil } = useAuth();
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
  const [ubicacion, setUbicacion] = useState('Zona común');

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

      const ref = await addDoc(collection(db, 'incidencias'), {
        comunidad_id: perfil.comunidad_id,
        autor_id: perfil.id,
        titulo: titulo.trim(),
        descripcion: descripcion.trim() || null,
        categoria_id: categoriaId,
        estado: 'pendiente',
        prioridad,
        ubicacion,
        estimacion_min: est.min,
        estimacion_max: est.max,
        created_at: ahora,
        updated_at: ahora,
        resuelta_at: null,
        // Quórum inicial: el creador ya cuenta como afectado
        quorum: {
          tipo:             'simple',
          umbral:           30,
          afectados_count:  1,
          peso_afectados:   coef,
          alcanzado:        false,
        },
      });

      // Escribir al creador en la subcollección afectados
      await setDoc(
        doc(db, 'incidencias', ref.id, 'afectados', perfil.id),
        { coeficiente: coef, added_at: ahora, es_autor: true },
      );
      console.log('[QUORUM REAL] incidencia creada — afectados_count inicial: 1, autor:', perfil.id);

      if (fotos.length > 0) {
        await uploadFotos(ref.id, perfil.comunidad_id);
      }
      notificarAdmins(
        perfil.comunidad_id,
        'incidencia',
        titulo.trim(),
        `Reportado por ${perfil.nombre_completo}`,
        `/incidencias/${ref.id}`
      );
      // Notificación comunidad (tiempo real para todos los vecinos)
      void crearNotificacionComunidad(perfil.comunidad_id, {
        tipo:       'incidencia',
        titulo:     titulo.trim(),
        mensaje:    `Reportado por ${perfil.nombre_completo}`,
        created_by: perfil.id,
        related_id: ref.id,
        link:       `/incidencias/${ref.id}`,
      });
      play('incidencia_creada');
      setEnviado(true);
    } catch {
      toast.error('Error al crear la incidencia');
    }

    setLoading(false);
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
            {ubicaciones.map((u) => (
              <button key={u.label} type="button" onClick={() => setUbicacion(u.label)}
                className={cn('p-2.5 rounded-xl border text-center transition-all',
                  u.label === 'Otro' && 'col-span-2',
                  ubicacion === u.label ? 'border-finca-coral bg-finca-peach/30 text-finca-coral' : 'border-border bg-white text-muted-foreground hover:border-finca-salmon'
                )}>
                <span className="text-xl block mb-1">{u.emoji}</span>
                <span className="text-xs font-medium">{u.label}</span>
              </button>
            ))}
          </div>
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
