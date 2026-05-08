'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  doc,
  getDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface Mensaje {
  id: string;
  de: string;
  texto: string;
  created_at: string;
}

export default function ChatDetallesPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const { user } = useAuth();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [nombreOtro, setNombreOtro] = useState('Vecino');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;

    // Load chat info (other participant name)
    getDoc(doc(db, 'chats_vecinos', id)).then(snap => {
      if (!snap.exists()) return;
      const data = snap.data();
      const otroId = (data.participantes as string[])?.find(p => p !== user?.uid);
      if (otroId && data.participantes_info?.[otroId]) {
        setNombreOtro((data.participantes_info[otroId] as { nombre: string }).nombre);
      }
    });

    const q = query(
      collection(db, 'chats_vecinos', id, 'mensajes'),
      orderBy('created_at', 'asc'),
    );
    const unsub = onSnapshot(q, snap => {
      setMensajes(snap.docs.map(d => ({ id: d.id, ...d.data() } as Mensaje)));
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    });
    return () => unsub();
  }, [id, user?.uid]);

  async function enviar() {
    if (!texto.trim() || !user?.uid || enviando) return;
    const msg = texto.trim();
    setTexto('');
    setEnviando(true);
    try {
      const now = new Date().toISOString();
      await addDoc(collection(db, 'chats_vecinos', id, 'mensajes'), {
        de: user.uid,
        texto: msg,
        created_at: now,
      });
      await updateDoc(doc(db, 'chats_vecinos', id), {
        ultimo_mensaje: msg,
        ultimo_mensaje_at: now,
      });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col h-[100dvh]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="w-8 h-8 -ml-1" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="w-8 h-8 rounded-full bg-finca-peach/40 flex items-center justify-center text-sm font-bold text-finca-coral shrink-0">
          {nombreOtro[0]?.toUpperCase()}
        </div>
        <p className="font-semibold text-finca-dark text-sm">{nombreOtro}</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {mensajes.map(msg => {
          const esMio = msg.de === user?.uid;
          return (
            <div key={msg.id} className={cn('flex', esMio ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[75%] rounded-2xl px-3 py-2',
                  esMio
                    ? 'bg-finca-coral text-white rounded-br-sm'
                    : 'bg-muted text-finca-dark rounded-bl-sm',
                )}
              >
                <p className="text-sm leading-relaxed">{msg.texto}</p>
                <p
                  className={cn(
                    'text-[10px] mt-0.5',
                    esMio ? 'text-white/70 text-right' : 'text-muted-foreground',
                  )}
                >
                  {msg.created_at
                    ? format(new Date(msg.created_at), 'HH:mm', { locale: es })
                    : ''}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t px-4 py-3 flex gap-2 bg-white">
        <Input
          placeholder="Escribe un mensaje..."
          value={texto}
          onChange={e => setTexto(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && enviar()}
          className="flex-1 rounded-xl"
        />
        <Button
          size="icon"
          className="w-10 h-10 bg-finca-coral text-white rounded-xl hover:bg-finca-coral/90"
          onClick={enviar}
          disabled={!texto.trim() || enviando}
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
