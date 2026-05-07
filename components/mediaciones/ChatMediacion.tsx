'use client';

import { useEffect, useRef, useState } from 'react';
import { collection, addDoc, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Send, Paperclip, Image as ImageIcon, FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface ChatMediacionProps {
  mediacionId: string;
  esAnonimo: boolean;
  participantes: {
    denunciante_id: string;
    mediador_id: string | null;
  };
}

interface Mensaje {
  id: string;
  autor_id: string;
  autor_nombre: string;
  texto: string;
  tipo: 'texto' | 'sistema' | 'evidencia';
  es_anonimo: boolean;
  archivo_url?: string;
  archivo_nombre?: string;
  archivo_tipo?: string;
  created_at: string;
}

/* SVG incognito avatar for anonymous users */
const IncognitoAvatar = () => (
  <svg viewBox="0 0 40 40" className="w-8 h-8" xmlns="http://www.w3.org/2000/svg">
    <circle cx="20" cy="20" r="20" fill="#E5E7EB" />
    <ellipse cx="20" cy="14" rx="10" ry="4" fill="#6B7280" />
    <rect x="10" y="12" width="20" height="3" rx="1.5" fill="#4B5563" />
    <circle cx="14" cy="22" r="4" fill="white" stroke="#4B5563" strokeWidth="1.5" />
    <circle cx="26" cy="22" r="4" fill="white" stroke="#4B5563" strokeWidth="1.5" />
    <circle cx="14" cy="22" r="2" fill="#4B5563" />
    <circle cx="26" cy="22" r="2" fill="#4B5563" />
    <path d="M18 22 Q20 20 22 22" stroke="#4B5563" strokeWidth="1.5" fill="none" />
    <path d="M14 30 Q20 34 26 30" stroke="#4B5563" strokeWidth="1.5" fill="none" />
  </svg>
);

export default function ChatMediacion({ mediacionId, esAnonimo, participantes }: ChatMediacionProps) {
  const { user, perfil } = useAuth();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uid = user?.uid;

  /* Real-time listener */
  useEffect(() => {
    if (!mediacionId) return;

    const q = query(
      collection(db, 'mediaciones', mediacionId, 'mensajes'),
      orderBy('created_at', 'asc'),
    );

    const unsub = onSnapshot(q, (snap) => {
      const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Mensaje));
      setMensajes(msgs);
    });

    return () => unsub();
  }, [mediacionId]);

  /* Auto-scroll */
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [mensajes]);

  /* Send text message */
  async function handleSend() {
    if (!texto.trim() || !uid || !perfil) return;

    setSending(true);
    try {
      const nombre = esAnonimo ? 'Anónimo' : (perfil.nombre_completo || 'Usuario');
      await addDoc(collection(db, 'mediaciones', mediacionId, 'mensajes'), {
        autor_id: uid,
        autor_nombre: nombre,
        texto: texto.trim(),
        tipo: 'texto',
        es_anonimo: esAnonimo,
        created_at: new Date().toISOString(),
      });
      setTexto('');
    } catch (err) {
      console.error('Error enviando mensaje:', err);
    } finally {
      setSending(false);
    }
  }

  /* Upload evidence */
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !uid || !perfil) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/upload-photo', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();

      const nombre = esAnonimo ? 'Anónimo' : (perfil.nombre_completo || 'Usuario');
      await addDoc(collection(db, 'mediaciones', mediacionId, 'mensajes'), {
        autor_id: uid,
        autor_nombre: nombre,
        texto: `Evidencia: ${file.name}`,
        tipo: 'evidencia',
        es_anonimo: esAnonimo,
        archivo_url: data.url || data.secure_url,
        archivo_nombre: file.name,
        archivo_tipo: file.type,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error subiendo evidencia:', err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function getRolLabel(autorId: string): string {
    if (autorId === participantes.mediador_id) return 'Mediador';
    if (autorId === participantes.denunciante_id) return 'Solicitante';
    return 'Participante';
  }

  function getDisplayName(msg: Mensaje): string {
    if (msg.tipo === 'sistema') return 'Sistema';
    if (esAnonimo && msg.autor_id !== uid) return 'Anónimo';
    return msg.autor_nombre;
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4 space-y-3">
        <h3 className="text-sm font-semibold text-finca-dark flex items-center gap-2">
          <Send className="w-4 h-4 text-finca-coral" />
          Chat de mediación
        </h3>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="h-64 overflow-y-auto space-y-2 rounded-xl bg-gray-50 p-3"
        >
          {mensajes.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">
              No hay mensajes aún. Inicia la conversación.
            </p>
          )}

          {mensajes.map((msg) => {
            const isMine = msg.autor_id === uid;
            const isSistema = msg.tipo === 'sistema';

            if (isSistema) {
              return (
                <div key={msg.id} className="text-center">
                  <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded-full">
                    {msg.texto}
                  </span>
                </div>
              );
            }

            return (
              <div key={msg.id} className={cn('flex gap-2', isMine ? 'flex-row-reverse' : 'flex-row')}>
                {/* Avatar */}
                <div className="shrink-0">
                  {esAnonimo && !isMine ? (
                    <IncognitoAvatar />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-finca-peach text-finca-coral flex items-center justify-center text-xs font-bold">
                      {getDisplayName(msg)[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                </div>

                {/* Bubble */}
                <div className={cn(
                  'max-w-[70%] rounded-2xl px-3 py-2',
                  isMine
                    ? 'bg-finca-coral text-white rounded-br-md'
                    : 'bg-white border border-border rounded-bl-md',
                )}>
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className={cn('text-[10px] font-medium', isMine ? 'text-white/80' : 'text-finca-coral')}>
                      {getDisplayName(msg)} · {getRolLabel(msg.autor_id)}
                    </span>
                  </div>

                  {msg.tipo === 'evidencia' && msg.archivo_url ? (
                    <div className="space-y-1">
                      {msg.archivo_tipo?.startsWith('image/') ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={msg.archivo_url}
                          alt={msg.archivo_nombre || 'Evidencia'}
                          className="max-w-full rounded-lg max-h-40 object-cover"
                        />
                      ) : (
                        <a
                          href={msg.archivo_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            'flex items-center gap-1 text-xs underline',
                            isMine ? 'text-white/90' : 'text-finca-coral',
                          )}
                        >
                          <FileText className="w-3 h-3" />
                          {msg.archivo_nombre || 'Archivo'}
                        </a>
                      )}
                      <p className={cn('text-xs', isMine ? 'text-white/90' : 'text-finca-dark/80')}>
                        {msg.texto}
                      </p>
                    </div>
                  ) : (
                    <p className={cn('text-sm', isMine ? 'text-white' : 'text-finca-dark')}>
                      {msg.texto}
                    </p>
                  )}

                  <span className={cn('text-[9px] block mt-1', isMine ? 'text-white/60' : 'text-muted-foreground')}>
                    {msg.created_at ? format(new Date(msg.created_at), 'HH:mm', { locale: es }) : ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Input area */}
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,.pdf,.doc,.docx"
            onChange={handleFileUpload}
          />
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Paperclip className="w-4 h-4 text-muted-foreground" />
            )}
          </Button>
          <Input
            placeholder="Escribe un mensaje..."
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            className="flex-1 text-sm"
          />
          <Button
            size="icon"
            className="bg-finca-coral hover:bg-finca-coral/90 shrink-0"
            onClick={handleSend}
            disabled={!texto.trim() || sending}
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
