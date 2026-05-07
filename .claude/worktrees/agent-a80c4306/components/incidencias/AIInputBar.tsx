'use client';

import { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getAuth } from 'firebase/auth';

export interface AIResultado {
  titulo: string;
  descripcion: string;
  categoria: string;
  prioridad: 'baja' | 'normal' | 'alta' | 'urgente';
  ubicacion: string | null;
  afectados_estimados: number;
  accion_sugerida: string;
  posible_duplicado_id: string | null;
  posible_duplicado_titulo: string | null;
  confianza: number;
}

interface Props {
  comunidadId: string;
  onResultado: (r: AIResultado) => void;
}

export function AIInputBar({ comunidadId, onResultado }: Props) {
  const [mensaje, setMensaje]       = useState('');
  const [procesando, setProcesando] = useState(false);

  async function analizar() {
    if (!mensaje.trim() || procesando) return;
    setProcesando(true);
    try {
      const token = await getAuth().currentUser?.getIdToken(false);
      const res = await fetch('/api/ai/classify-incidencia', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ mensaje, comunidadId }),
      });
      if (!res.ok) throw new Error('Error del servidor');
      const data: AIResultado = await res.json();
      onResultado(data);
      setMensaje('');
    } catch {
      toast.error('No se pudo analizar el mensaje. Inténtalo de nuevo.');
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div className="bg-gradient-to-br from-finca-peach/20 to-purple-50 rounded-2xl p-4 border border-finca-coral/20 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-finca-coral to-purple-500 flex items-center justify-center">
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </div>
        <p className="text-sm font-semibold text-finca-dark">Describe el problema con tus palabras</p>
      </div>

      <p className="text-xs text-muted-foreground">
        La IA detectará automáticamente la categoría, prioridad y zona del edificio.
      </p>

      <Textarea
        placeholder="Ej: el ascensor lleva 2 días parado, ya somos varios vecinos afectados y tenemos personas mayores en el edificio..."
        value={mensaje}
        onChange={(e) => setMensaje(e.target.value)}
        rows={3}
        className="resize-none text-sm bg-white border-finca-coral/20 focus:border-finca-coral"
        disabled={procesando}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) analizar();
        }}
      />

      <Button
        onClick={analizar}
        disabled={!mensaje.trim() || procesando}
        className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white"
      >
        {procesando ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analizando...</>
        ) : (
          <><Sparkles className="w-4 h-4 mr-2" />Analizar con IA</>
        )}
      </Button>
    </div>
  );
}
