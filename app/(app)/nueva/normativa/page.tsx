'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send, ThumbsUp, ThumbsDown, Bot, BookOpen } from 'lucide-react';
import { addDoc, collection, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface Consulta {
  id?: string;
  pregunta: string;
  respuesta: string;
  util?: boolean | null;
}

/** Elimina formato markdown que la IA incluye en sus respuestas */
function limpiarMarkdown(texto: string): string {
  return texto
    .replace(/\*\*(.+?)\*\*/g, '$1')  // **negrita** → negrita
    .replace(/\*(.+?)\*/g, '$1')       // *cursiva*   → cursiva
    .replace(/^#{1,6}\s+/gm, '')       // ## Título   → Título
    .replace(/`(.+?)`/g, '$1');        // `código`    → código
}

const preguntas_frecuentes = [
  '¿Puedo cerrar mi terraza?',
  '¿Pueden prohibir las mascotas?',
  '¿Qué hacer con un vecino ruidoso?',
  '¿Cómo funciona una derrama?',
  '¿Cuándo se celebra la Junta Ordinaria?',
];

export default function NormativaPage() {
  const router = useRouter();
  const { perfil } = useAuth();
  const [consultas, setConsultas] = useState<Consulta[]>([]);
  const [pregunta, setPregunta] = useState('');
  const [cargando, setCargando] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consultas]);

  async function enviarPregunta(texto?: string) {
    const p = (texto || pregunta).trim();
    if (!p) return;
    setPregunta('');
    setCargando(true);

    const consulta: Consulta = { pregunta: p, respuesta: '' };
    setConsultas((prev) => [...prev, consulta]);

    const res = await fetch('/api/ai/normative', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pregunta: p }),
    });
    const data = await res.json();
    const respuesta = data.respuesta;

    let insertId: string | undefined;
    if (perfil?.comunidad_id) {
      const ref = await addDoc(collection(db, 'consultas_normativas'), {
        comunidad_id: perfil.comunidad_id,
        vecino_id: perfil.id,
        pregunta: p,
        respuesta,
        created_at: new Date().toISOString(),
      });
      insertId = ref.id;
    }

    setConsultas((prev) =>
      prev.map((c, i) => i === prev.length - 1 ? { ...c, respuesta, id: insertId } : c)
    );
    setCargando(false);
  }

  async function valorar(id: string | undefined, util: boolean) {
    if (!id) return;
    await updateDoc(doc(db, 'consultas_normativas', id), { util });
    setConsultas((prev) => prev.map((c) => c.id === id ? { ...c, util } : c));
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-border px-4 py-3 flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="icon" onClick={() => router.back()} className="w-8 h-8 -ml-1">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="font-semibold text-finca-dark">Asistente normativo</h1>
          <p className="text-xs text-muted-foreground">Basado en LPH, estatutos y ordenanzas</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {consultas.length === 0 && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-finca-coral flex items-center justify-center shrink-0">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%]">
                <p className="text-sm text-foreground leading-relaxed">
                  Hola, soy el asistente normativo de FincaOS. Puedo responder preguntas sobre la <strong>Ley de Propiedad Horizontal</strong>, estatutos de tu comunidad y normativa municipal.
                </p>
                <p className="text-xs text-muted-foreground mt-2">¿Sobre qué te puedo ayudar?</p>
              </div>
            </div>

            <div className="ml-12 space-y-2">
              <p className="text-xs text-muted-foreground font-medium">Preguntas frecuentes:</p>
              {preguntas_frecuentes.map((pf) => (
                <button
                  key={pf}
                  onClick={() => enviarPregunta(pf)}
                  className="block w-full text-left text-sm bg-white border border-border rounded-xl px-3 py-2.5 hover:border-finca-salmon hover:text-finca-coral transition-colors"
                >
                  {pf}
                </button>
              ))}
            </div>
          </div>
        )}

        {consultas.map((c, idx) => (
          <div key={idx} className="space-y-3">
            <div className="flex justify-end">
              <div className="bg-finca-coral text-white rounded-2xl rounded-tr-sm px-4 py-3 max-w-[85%]">
                <p className="text-sm leading-relaxed">{c.pregunta}</p>
              </div>
            </div>

            {c.respuesta ? (
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-finca-coral flex items-center justify-center shrink-0">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1">
                  <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <BookOpen className="w-3.5 h-3.5 text-finca-coral" />
                      <span className="text-[10px] font-semibold text-finca-coral uppercase tracking-wide">Basado en LPH</span>
                    </div>
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{limpiarMarkdown(c.respuesta)}</p>
                  </div>
                  {c.util === undefined || c.util === null ? (
                    <div className="flex items-center gap-2 mt-2 ml-1">
                      <p className="text-xs text-muted-foreground">¿Te fue útil?</p>
                      <button onClick={() => valorar(c.id, true)} className="p-1.5 rounded-lg hover:bg-green-50 transition-colors">
                        <ThumbsUp className="w-3.5 h-3.5 text-muted-foreground hover:text-green-600" />
                      </button>
                      <button onClick={() => valorar(c.id, false)} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                        <ThumbsDown className="w-3.5 h-3.5 text-muted-foreground hover:text-red-500" />
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-2 ml-1">
                      {c.util ? '👍 Gracias por tu valoración' : '👎 Gracias, mejoraremos la respuesta'}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-finca-coral flex items-center justify-center shrink-0">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3">
                  <div className="flex gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="w-2 h-2 rounded-full bg-finca-coral animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-border bg-white px-4 py-3 safe-bottom">
        <div className="flex gap-2">
          <Input
            placeholder="Escribe tu pregunta..."
            value={pregunta}
            onChange={(e) => setPregunta(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && enviarPregunta()}
            className="flex-1 text-sm"
            disabled={cargando}
          />
          <Button
            onClick={() => enviarPregunta()}
            disabled={!pregunta.trim() || cargando}
            size="icon"
            className="bg-finca-coral hover:bg-finca-coral/90 text-white w-10 h-10 shrink-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground text-center mt-2">Respuestas orientativas. Consulta a un profesional para casos complejos.</p>
      </div>
    </div>
  );
}
