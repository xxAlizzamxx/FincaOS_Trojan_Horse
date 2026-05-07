'use client';

import { useEffect, useRef, useState } from 'react';
import {
  collection, addDoc, onSnapshot, query, orderBy,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Send, Image as ImageIcon, Loader2, Paperclip, X, Shield,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface Mensaje {
  id: string;
  autor_id: string;
  autor_nombre: string;
  texto: string;
  tipo: 'texto' | 'evidencia' | 'sistema';
  es_anonimo: boolean;
  evidencia_url?: string;
  evidencia_tipo?: 'imagen' | 'documento';
  created_at: string;
}

interface Props {
  mediacionId: string;
  esAnonimo: boolean;
  /** IDs of the parties involved for display purposes */
  participantes: {
    denunciante_id?: string;
    mediador_id?: string | null;
  };
}

export default function ChatMediacion({ mediacionId, esAnonimo, participantes }: Props) {
  const { perfil, user } = useAuth();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [archivoSeleccionado, setArchivoSeleccionado] = useState<File | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uid = user?.uid ?? '';

  /* ── Listener en tiempo real ── */
  useEffect(() => {
    if (!mediacionId) return;
    const q = query(
      collection(db, 'mediaciones', mediacionId, 'mensajes'),
      orderBy('created_at', 'asc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as Mensaje[];
      setMensajes(data);
    }, (err) => {
      console.error('[ChatMediacion] Error:', err);
    });
    return () => unsub();
  }, [mediacionId]);

  /* ── Auto-scroll al último mensaje ── */
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [mensajes]);

  /* ── Enviar mensaje de texto ── */
  async function enviarMensaje(e: React.FormEvent) {
    e.preventDefault();
    if (!texto.trim() && !archivoSeleccionado) return;
    if (!perfil || !uid) return;

    setEnviando(true);
    try {
      let evidenciaUrl: string | undefined;
      let evidenciaTipo: 'imagen' | 'documento' | undefined;

      // Si hay archivo, subirlo primero
      if (archivoSeleccionado) {
        setSubiendo(true);
        const formData = new FormData();
        formData.append('file', archivoSeleccionado);
        formData.append('comunidad_id', perfil.comunidad_id ?? 'general');
        formData.append('incidencia_id', `mediacion_${mediacionId}`);

        const res = await fetch('/api/upload-photo', {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) throw new Error('Error al subir archivo');
        const data = await res.json();
        evidenciaUrl = data.url;
        evidenciaTipo = archivoSeleccionado.type.startsWith('image/') ? 'imagen' : 'documento';
        setSubiendo(false);
      }

      const nombreMostrado = esAnonimo && uid !== participantes.mediador_id
        ? 'Anónimo'
        : perfil.nombre_completo ?? 'Usuario';

      await addDoc(collection(db, 'mediaciones', mediacionId, 'mensajes'), {
        autor_id: uid,
        autor_nombre: nombreMostrado,
        texto: texto.trim() || (evidenciaUrl ? 'Evidencia adjunta' : ''),
        tipo: evidenciaUrl ? 'evidencia' : 'texto',
        es_anonimo: esAnonimo && uid !== participantes.mediador_id,
        evidencia_url: evidenciaUrl ?? null,
        evidencia_tipo: evidenciaTipo ?? null,
        created_at: new Date().toISOString(),
      });

      setTexto('');
      setArchivoSeleccionado(null);
      setPreviewUrl(null);
    } catch (err: any) {
      console.error('[ChatMediacion] Error enviando:', err);
      toast.error('Error al enviar mensaje');
    } finally {
      setEnviando(false);
      setSubiendo(false);
    }
  }

  /* ── Seleccionar archivo ── */
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error('El archivo supera 10 MB');
      return;
    }

    setArchivoSeleccionado(file);
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  }

  function cancelarArchivo() {
    setArchivoSeleccionado(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  /* ── Rol del autor ── */
  function getRolLabel(autorId: string): string {
    if (autorId === participantes.mediador_id) return 'Mediador';
    if (autorId === participantes.denunciante_id) return esAnonimo ? 'Anónimo' : 'Solicitante';
    return 'Participante';
  }

  function getRolColor(autorId: string): string {
    if (autorId === participantes.mediador_id) return 'text-blue-600';
    if (autorId === participantes.denunciante_id) return 'text-finca-coral';
    return 'text-purple-600';
  }

  const esMiMensaje = (autorId: string) => autorId === uid;

  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      <CardContent className="p-0">
        {/* Header */}
        <div className="px-4 py-3 bg-gradient-to-r from-finca-coral/10 to-blue-50 border-b flex items-center gap-2">
          <Send className="w-4 h-4 text-finca-coral" />
          <p className="text-sm font-semibold text-finca-dark">Chat de mediación</p>
          {esAnonimo && (
            <span className="ml-auto flex items-center gap-1 text-[10px] text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
              <Shield className="w-3 h-3" /> Modo anónimo
            </span>
          )}
        </div>

        {/* Mensajes */}
        <div
          ref={scrollRef}
          className="h-[320px] overflow-y-auto px-4 py-3 space-y-3 bg-gray-50/50"
        >
          {mensajes.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground">
              <AlertCircle className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm font-medium">Sin mensajes aún</p>
              <p className="text-xs">Escribe el primer mensaje para iniciar la conversación</p>
            </div>
          )}

          {mensajes.map((msg) => {
            const mine = esMiMensaje(msg.autor_id);
            const isSistema = msg.tipo === 'sistema';

            if (isSistema) {
              return (
                <div key={msg.id} className="flex justify-center">
                  <span className="text-[10px] text-muted-foreground bg-muted px-3 py-1 rounded-full">
                    {msg.texto}
                  </span>
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className={cn('flex flex-col max-w-[80%]', mine ? 'ml-auto items-end' : 'items-start')}
              >
                {/* Nombre + rol */}
                <div className="flex items-center gap-1.5 mb-0.5 px-1">
                  {msg.es_anonimo ? (
                    <span className="text-[10px] font-semibold text-slate-500 flex items-center gap-0.5">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M4 11c0 0 2-6 8-6s8 6 8 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                        <circle cx="9" cy="15" r="2" stroke="currentColor" strokeWidth="2"/>
                        <circle cx="15" cy="15" r="2" stroke="currentColor" strokeWidth="2"/>
                        <path d="M11 15h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                      Anónimo
                    </span>
                  ) : (
                    <span className={cn('text-[10px] font-semibold', getRolColor(msg.autor_id))}>
                      {mine ? 'Tú' : msg.autor_nombre}
                    </span>
                  )}
                  <span className="text-[9px] text-muted-foreground">
                    · {getRolLabel(msg.autor_id)}
                  </span>
                </div>

                {/* Burbuja */}
                <div
                  className={cn(
                    'rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm',
                    mine
                      ? 'bg-finca-coral text-white rounded-tr-md'
                      : 'bg-white text-finca-dark border border-gray-100 rounded-tl-md',
                  )}
                >
                  {/* Evidencia imagen */}
                  {msg.tipo === 'evidencia' && msg.evidencia_url && msg.evidencia_tipo === 'imagen' && (
                    <a href={msg.evidencia_url} target="_blank" rel="noopener noreferrer" className="block mb-1.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={msg.evidencia_url}
                        alt="Evidencia"
                        className="max-w-full rounded-lg max-h-48 object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    </a>
                  )}

                  {/* Evidencia documento */}
                  {msg.tipo === 'evidencia' && msg.evidencia_url && msg.evidencia_tipo === 'documento' && (
                    <a
                      href={msg.evidencia_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        'flex items-center gap-1.5 text-xs mb-1 underline',
                        mine ? 'text-white/90' : 'text-blue-600',
                      )}
                    >
                      <Paperclip className="w-3 h-3" />
                      Ver documento adjunto
                    </a>
                  )}

                  {msg.texto && msg.texto !== 'Evidencia adjunta' && (
                    <p>{msg.texto}</p>
                  )}
                  {msg.texto === 'Evidencia adjunta' && !msg.evidencia_url && (
                    <p>{msg.texto}</p>
                  )}
                </div>

                {/* Timestamp */}
                <span className="text-[9px] text-muted-foreground mt-0.5 px-1">
                  {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true, locale: es })}
                </span>
              </div>
            );
          })}
        </div>

        {/* Preview de archivo seleccionado */}
        {archivoSeleccionado && (
          <div className="px-4 py-2 bg-blue-50 border-t flex items-center gap-2">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Preview" className="w-12 h-12 rounded-lg object-cover" />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center">
                <Paperclip className="w-5 h-5 text-blue-500" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-finca-dark truncate">{archivoSeleccionado.name}</p>
              <p className="text-[10px] text-muted-foreground">
                {(archivoSeleccionado.size / 1024).toFixed(0)} KB
              </p>
            </div>
            <button onClick={cancelarArchivo} className="p-1 hover:bg-blue-100 rounded-full">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        )}

        {/* Input */}
        <form onSubmit={enviarMensaje} className="px-3 py-2.5 border-t bg-white flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,.pdf,.doc,.docx"
            className="hidden"
            onChange={handleFileSelect}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-9 h-9 rounded-full bg-muted hover:bg-muted/80 flex items-center justify-center shrink-0 transition-colors"
            disabled={enviando}
          >
            <ImageIcon className="w-4 h-4 text-muted-foreground" />
          </button>

          <Input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={esAnonimo ? 'Mensaje anónimo...' : 'Escribe un mensaje...'}
            className="flex-1 h-9 text-sm rounded-full bg-gray-50 border-gray-200"
            disabled={enviando}
          />

          <Button
            type="submit"
            size="icon"
            className="w-9 h-9 rounded-full bg-finca-coral hover:bg-finca-coral/90 shrink-0"
            disabled={enviando || (!texto.trim() && !archivoSeleccionado)}
          >
            {enviando || subiendo ? (
              <Loader2 className="w-4 h-4 animate-spin text-white" />
            ) : (
              <Send className="w-4 h-4 text-white" />
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
