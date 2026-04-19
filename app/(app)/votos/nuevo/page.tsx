'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { crearNotificacionComunidad } from '@/lib/firebase/notifications';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

function uuid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function NuevaVotacionPage() {
  const router = useRouter();
  // Solo presidentes y admins pueden crear votaciones
  const { perfil, loading } = useAuthGuard(['presidente', 'admin'], '/votos');

  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [usarCoeficientes, setUsarCoeficientes] = useState(false);
  const [quorumRequerido, setQuorumRequerido] = useState('');
  const [opciones, setOpciones] = useState([
    { id: uuid(), texto: '' },
    { id: uuid(), texto: '' },
  ]);
  const [enviado, setEnviado] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function addOpcion() {
    if (opciones.length >= 8) return;
    setOpciones((prev) => [...prev, { id: uuid(), texto: '' }]);
  }

  function removeOpcion(id: string) {
    if (opciones.length <= 2) return;
    setOpciones((prev) => prev.filter((o) => o.id !== id));
  }

  function updateOpcion(id: string, texto: string) {
    setOpciones((prev) => prev.map((o) => (o.id === id ? { ...o, texto } : o)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo.trim()) { toast.error('Añade un título a la votación'); return; }
    const opcionesValidas = opciones.filter((o) => o.texto.trim());
    if (opcionesValidas.length < 2) { toast.error('Añade al menos 2 opciones'); return; }
    if (!perfil?.comunidad_id) { toast.error('No perteneces a ninguna comunidad'); return; }

    setSubmitting(true);
    try {
      const ref = await addDoc(collection(db, 'votaciones'), {
        comunidad_id: perfil.comunidad_id,
        created_by: perfil.id,
        titulo: titulo.trim(),
        descripcion: descripcion.trim() || null,
        opciones: opcionesValidas.map((o) => ({ id: o.id, texto: o.texto.trim(), votos: 0, peso_total: 0 })),
        activa: true,
        usar_coeficientes: usarCoeficientes,
        quorum_requerido: quorumRequerido ? parseFloat(quorumRequerido) : null,
        created_at: new Date().toISOString(),
        cierre_at: null,
      });
      void crearNotificacionComunidad(perfil.comunidad_id, {
        tipo:       'votacion',
        titulo:     titulo.trim(),
        mensaje:    `Nueva votación abierta — participa ahora`,
        created_by: perfil.id,
        related_id: ref.id,
        link:       `/votos`,
      });
      fetch('/api/notificaciones/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comunidad_id: perfil.comunidad_id,
          title: '🗳️ Nueva votación abierta',
          body: titulo.trim(),
          url: '/votos',
        }),
      }).catch(() => {});
      setEnviado(true);
    } catch {
      toast.error('Error al crear la votación');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return null;

  if (enviado) {
    return (
      <div className="px-4 py-12 flex flex-col items-center text-center space-y-4">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
          <CheckCircle2 className="w-10 h-10 text-green-600" />
        </div>
        <h2 className="text-xl font-semibold text-finca-dark">Votación creada</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          Los vecinos ya pueden ver y participar en la votación.
        </p>
        <div className="flex gap-3 pt-2 w-full max-w-xs">
          <Button variant="outline" className="flex-1" onClick={() => router.push('/votos')}>
            Ver votaciones
          </Button>
          <Button
            className="flex-1 bg-finca-coral hover:bg-finca-coral/90 text-white"
            onClick={() => {
              setTitulo('');
              setDescripcion('');
              setOpciones([{ id: uuid(), texto: '' }, { id: uuid(), texto: '' }]);
              setEnviado(false);
            }}
          >
            Crear otra
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-8">
      {/* Header sticky */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-border px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()} className="w-8 h-8 -ml-1">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="font-semibold text-finca-dark">Nueva votación</h1>
      </div>

      <form onSubmit={handleSubmit} className="px-4 py-5 space-y-5">
        {/* Título */}
        <div className="space-y-2">
          <Label htmlFor="titulo">
            Pregunta o título <span className="text-finca-coral">*</span>
          </Label>
          <Input
            id="titulo"
            placeholder="Ej: ¿Aprobáis la derrama para el ascensor?"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            required
          />
        </div>

        {/* Descripción */}
        <div className="space-y-2">
          <Label htmlFor="descripcion">Descripción (opcional)</Label>
          <Textarea
            id="descripcion"
            placeholder="Añade contexto o información adicional..."
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={3}
            className="resize-none"
          />
        </div>

        {/* Opciones */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Opciones de voto <span className="text-finca-coral">*</span></Label>
            <span className="text-xs text-muted-foreground">{opciones.length}/8</span>
          </div>

          <div className="space-y-2">
            {opciones.map((opcion, idx) => (
              <div key={opcion.id} className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-finca-peach/40 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-finca-coral">{idx + 1}</span>
                </div>
                <Input
                  placeholder={`Opción ${idx + 1}`}
                  value={opcion.texto}
                  onChange={(e) => updateOpcion(opcion.id, e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8 text-muted-foreground hover:text-red-500 shrink-0"
                  onClick={() => removeOpcion(opcion.id)}
                  disabled={opciones.length <= 2}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>

          {opciones.length < 8 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full border-dashed border-finca-coral/40 text-finca-coral hover:bg-finca-peach/10"
              onClick={addOpcion}
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Añadir opción
            </Button>
          )}
        </div>

        {/* Opciones avanzadas */}
        <div className="space-y-4 border-t pt-4">
          <p className="text-sm font-medium text-finca-dark">Opciones avanzadas</p>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={usarCoeficientes}
              onChange={(e) => setUsarCoeficientes(e.target.checked)}
              className="w-4 h-4 rounded border-border text-finca-coral focus:ring-finca-coral"
            />
            <div>
              <p className="text-sm font-medium text-finca-dark">Ponderar por coeficiente (LPH)</p>
              <p className="text-xs text-muted-foreground">El voto vale según el % de participación de cada propietario</p>
            </div>
          </label>

          <div className="space-y-1.5">
            <Label htmlFor="quorum">Quórum mínimo (%)</Label>
            <Input
              id="quorum"
              type="number"
              min="0"
              max="100"
              step="1"
              placeholder="Ej: 50 (dejar vacío = sin mínimo)"
              value={quorumRequerido}
              onChange={(e) => setQuorumRequerido(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {usarCoeficientes
                ? 'Porcentaje mínimo de coeficientes que deben votar'
                : 'Porcentaje mínimo de vecinos que deben votar'}
            </p>
          </div>
        </div>

        {/* Info */}
        <Card className="bg-finca-peach/20 border-finca-peach/50">
          <CardContent className="p-3">
            <p className="text-xs text-finca-dark font-medium mb-0.5">Sobre las votaciones</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {usarCoeficientes
                ? 'Cada voto se pondera por el coeficiente de participación del propietario según la LPH.'
                : 'Cada vecino puede votar una sola vez. Un vecino = un voto.'}
              {' '}Los resultados son visibles en tiempo real.
            </p>
          </CardContent>
        </Card>

        {/* Submit */}
        <Button
          type="submit"
          className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-12 text-base font-medium"
          disabled={submitting || !titulo.trim()}
        >
          {submitting ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            'Publicar votación'
          )}
        </Button>
      </form>
    </div>
  );
}
