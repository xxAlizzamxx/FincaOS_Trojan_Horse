'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection, query, orderBy, onSnapshot,
  doc, updateDoc, addDoc, setDoc, increment,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, Send, Loader2,
  Wallet, CheckCircle2, CreditCard, UserCog, MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';

interface Mensaje {
  id: string;
  sender_id: string;
  sender_rol: 'vecino' | 'admin' | 'presidente';
  tipo: 'texto' | 'payment_request';
  texto?: string;
  // payment_request fields (top-level for easy querying)
  cobro_id?: string;
  concepto?: string;
  descripcion?: string | null;
  monto?: number;
  estado?: string;
  leido: boolean;
  created_at: string;
}

export default function MensajesAdminPage() {
  const router = useRouter();
  const { user, perfil } = useAuth();
  const [chatExists, setChatExists] = useState<boolean | null>(null); // null = loading
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [sending, setSending] = useState(false);
  const [pagando, setPagando] = useState<string | null>(null);
  const [noLeidos, setNoLeidos] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const comunidadId = perfil?.comunidad_id;

  // Deterministic chatId — one admin chat per vecino per community
  const chatId = comunidadId && user ? `${comunidadId}_admin_${user.uid}` : null;

  // Subscribe to chat doc (for existence + unread count)
  useEffect(() => {
    if (!chatId) return;
    const unsub = onSnapshot(doc(db, 'chats_comunidad', chatId), (snap) => {
      setChatExists(snap.exists());
      setNoLeidos(snap.exists() ? (snap.data()?.no_leidos_vecino || 0) : 0);
    }, () => setChatExists(false));
    return () => unsub();
  }, [chatId]);

  // Subscribe to messages
  useEffect(() => {
    if (!chatId) return;
    const q = query(
      collection(db, 'chats_comunidad', chatId, 'mensajes'),
      orderBy('created_at', 'asc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      setMensajes(snap.docs.map(d => ({ id: d.id, ...d.data() } as Mensaje)));
      // Mark as read
      updateDoc(doc(db, 'chats_comunidad', chatId), { no_leidos_vecino: 0 }).catch(() => {});
    });
    return () => unsub();
  }, [chatId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [mensajes]);

  async function ensureChatDoc() {
    if (!chatId || !comunidadId || !user) return;
    await setDoc(doc(db, 'chats_comunidad', chatId), {
      comunidad_id:    comunidadId,
      tipo:            'admin',
      vecino_id:       user.uid,
      updated_at:      new Date().toISOString(),
    }, { merge: true });
  }

  async function enviarMensaje() {
    if (!texto.trim() || sending || !chatId || !user) return;
    setSending(true);
    try {
      await ensureChatDoc();
      const now = new Date().toISOString();
      await addDoc(collection(db, 'chats_comunidad', chatId, 'mensajes'), {
        sender_id: user.uid, sender_rol: 'vecino', tipo: 'texto',
        texto: texto.trim(), leido: false, created_at: now,
      });
      await updateDoc(doc(db, 'chats_comunidad', chatId), {
        ultimo_mensaje:       texto.trim().slice(0, 100),
        no_leidos_contraparte: increment(1),
        updated_at:           now,
      });
      setTexto('');
    } catch { toast.error('Error al enviar'); }
    finally { setSending(false); }
  }

  async function pagarCobro(msg: Mensaje) {
    if (!user || !perfil || !msg.cobro_id || !msg.monto) return;
    setPagando(msg.id);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          monto:         msg.monto,
          tipo:          'cobro',
          referencia_id: msg.cobro_id,
          usuario_id:    user.uid,
          comunidad_id:  comunidadId,
          descripcion:   `Cobro: ${msg.concepto}`,
          email:         user.email ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error');
      if (data.url) window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message ?? 'No se pudo iniciar el pago');
    } finally {
      setPagando(null);
    }
  }

  return (
    <div className="px-4 py-5 max-w-2xl mx-auto flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={() => router.back()}
          className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-finca-dark hover:bg-gray-100 transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="w-10 h-10 rounded-full bg-finca-coral flex items-center justify-center shrink-0">
          <UserCog className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-finca-dark">Administración</p>
          <p className="text-xs text-muted-foreground">Cobros y comunicaciones de tu comunidad</p>
        </div>
        {noLeidos > 0 && (
          <span className="w-5 h-5 bg-finca-coral text-white rounded-full text-[10px] flex items-center justify-center font-bold shrink-0">
            {noLeidos > 9 ? '9+' : noLeidos}
          </span>
        )}
      </div>

      {/* Chat area */}
      {chatExists === null ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : !chatExists && mensajes.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
          <div className="w-16 h-16 rounded-full bg-finca-peach/30 flex items-center justify-center">
            <MessageSquare className="w-8 h-8 text-finca-coral/50" />
          </div>
          <div>
            <p className="font-medium text-finca-dark">Sin mensajes del admin</p>
            <p className="text-sm text-muted-foreground mt-1">Aquí aparecerán los cobros y comunicaciones de tu comunidad</p>
          </div>
        </div>
      ) : (
        <Card className="flex-1 border-0 shadow-sm flex flex-col overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50">
            {mensajes.length === 0 && (
              <div className="text-center py-10">
                <MessageSquare className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
                <p className="text-xs text-muted-foreground">No hay mensajes aún</p>
              </div>
            )}

            {mensajes.map(msg => {
              const mio = msg.sender_id === user?.uid;

              // ── Mensaje tipo payment_request (cobro) ──
              if (msg.tipo === 'payment_request') {
                const pagado = msg.estado === 'pagado';
                return (
                  <div key={msg.id} className="flex justify-start">
                    <div className="flex gap-2 items-end max-w-[90%]">
                      <div className="w-7 h-7 rounded-full bg-finca-coral flex items-center justify-center shrink-0 mb-0.5">
                        <UserCog className="w-3.5 h-3.5 text-white" />
                      </div>
                      <div className="bg-white border border-border rounded-2xl rounded-bl-md p-3 shadow-sm space-y-2">
                        <div className="flex items-center gap-2">
                          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', pagado ? 'bg-green-100' : 'bg-yellow-100')}>
                            <Wallet className={cn('w-4 h-4', pagado ? 'text-green-600' : 'text-yellow-600')} />
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-finca-dark">Solicitud de pago</p>
                            <p className="text-[11px] text-muted-foreground">Administración</p>
                          </div>
                          <Badge className={cn('ml-auto text-[9px]', pagado ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700')}>
                            {pagado ? 'Pagado' : 'Pendiente'}
                          </Badge>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-finca-dark">{msg.concepto}</p>
                          {msg.descripcion && <p className="text-xs text-muted-foreground mt-0.5">{msg.descripcion}</p>}
                          <p className="text-lg font-bold text-finca-coral mt-1">{msg.monto?.toFixed(2)}€</p>
                        </div>
                        {!pagado && (
                          <Button
                            className="w-full h-9 bg-finca-coral hover:bg-finca-coral/90 text-white text-sm"
                            onClick={() => pagarCobro(msg)}
                            disabled={pagando === msg.id}
                          >
                            {pagando === msg.id ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CreditCard className="w-4 h-4 mr-1" />}
                            Pagar ahora
                          </Button>
                        )}
                        {pagado && (
                          <div className="flex items-center gap-1.5 text-green-600 text-xs font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Pagado correctamente
                          </div>
                        )}
                        <span className="text-[9px] text-muted-foreground block">
                          {format(new Date(msg.created_at), 'HH:mm', { locale: es })}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              }

              // ── Mensaje texto normal ──
              return (
                <div key={msg.id} className={cn('flex gap-2 items-end', mio ? 'flex-row-reverse' : 'flex-row')}>
                  {mio ? (
                    <div className="w-7 h-7 rounded-full bg-finca-peach flex items-center justify-center text-[10px] font-bold text-finca-coral shrink-0">
                      {perfil?.nombre_completo?.[0]?.toUpperCase()}
                    </div>
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-finca-coral flex items-center justify-center shrink-0">
                      <UserCog className="w-3.5 h-3.5 text-white" />
                    </div>
                  )}
                  <div className={cn('max-w-[75%] rounded-2xl px-3 py-2', mio ? 'bg-finca-coral text-white rounded-br-md' : 'bg-white border border-border rounded-bl-md')}>
                    <p className={cn('text-sm whitespace-pre-wrap', mio ? 'text-white' : 'text-finca-dark')}>{msg.texto}</p>
                    <span className={cn('text-[9px] block mt-0.5', mio ? 'text-white/60' : 'text-muted-foreground')}>
                      {format(new Date(msg.created_at), 'HH:mm', { locale: es })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-3 border-t border-border flex gap-2">
            <Input
              placeholder="Escribe un mensaje..."
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && enviarMensaje()}
              className="flex-1 text-sm"
              disabled={sending}
            />
            <Button size="icon" className="bg-finca-coral hover:bg-finca-coral/90 shrink-0" onClick={enviarMensaje} disabled={!texto.trim() || sending}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
