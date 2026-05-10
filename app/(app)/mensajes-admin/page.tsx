'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection, query, where, orderBy, onSnapshot,
  doc, updateDoc, addDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowLeft, Send, Loader2,
  Wallet, CheckCircle2, CreditCard, UserCog,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';

interface ChatAdmin {
  id: string;
  comunidad_id: string;
  admin_id: string;
  vecino_id: string;
  ultimo_mensaje: string;
  no_leidos_vecino: number;
  updated_at: string;
}

interface Mensaje {
  id: string;
  sender_id: string;
  tipo: 'texto' | 'cobro' | 'cuota';
  texto?: string;
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
  const [chats, setChats] = useState<ChatAdmin[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [chatAbierto, setChatAbierto] = useState<ChatAdmin | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [sending, setSending] = useState(false);
  const [pagando, setPagando] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const comunidadId = perfil?.comunidad_id;

  // Chats del vecino con admin
  useEffect(() => {
    if (!comunidadId || !user) return;
    const q = query(
      collection(db, 'chats_admin'),
      where('comunidad_id', '==', comunidadId),
      where('vecino_id', '==', user.uid),
    );
    const unsub = onSnapshot(q, snap => {
      const items = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as ChatAdmin))
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      setChats(items);
      setLoadingChats(false);
    }, () => setLoadingChats(false));
    return () => unsub();
  }, [comunidadId, user?.uid]);

  // Mensajes del chat abierto
  useEffect(() => {
    if (!chatAbierto) return;
    const q = query(
      collection(db, 'chats_admin', chatAbierto.id, 'mensajes'),
      orderBy('created_at', 'asc'),
    );
    const unsub = onSnapshot(q, snap => {
      setMensajes(snap.docs.map(d => ({ id: d.id, ...d.data() } as Mensaje)));
      updateDoc(doc(db, 'chats_admin', chatAbierto.id), { no_leidos_vecino: 0 }).catch(() => {});
    });
    return () => unsub();
  }, [chatAbierto?.id]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [mensajes]);

  async function enviarMensaje() {
    if (!texto.trim() || sending || !chatAbierto || !user) return;
    setSending(true);
    try {
      const now = new Date().toISOString();
      await addDoc(collection(db, 'chats_admin', chatAbierto.id, 'mensajes'), {
        sender_id: user.uid, tipo: 'texto', texto: texto.trim(),
        leido: false, created_at: now,
      });
      await updateDoc(doc(db, 'chats_admin', chatAbierto.id), {
        ultimo_mensaje: texto.trim().slice(0, 100),
        no_leidos_admin: 1,
        updated_at: now,
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
          monto:        msg.monto,
          tipo:         'cobro',
          referencia_id: msg.cobro_id,
          usuario_id:   user.uid,
          comunidad_id: comunidadId,
          descripcion:  `Cobro: ${msg.concepto}`,
          email:        user.email ?? undefined,
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

  const totalNoLeidos = chats.reduce((sum, c) => sum + (c.no_leidos_vecino || 0), 0);

  // Vista de chat abierto
  if (chatAbierto) {
    return (
      <div className="px-4 py-5 max-w-2xl mx-auto flex flex-col h-[calc(100vh-8rem)]">
        <button onClick={() => setChatAbierto(null)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-finca-dark mb-3 transition-colors">
          ← Volver
        </button>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-finca-coral flex items-center justify-center">
            <UserCog className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-semibold text-finca-dark">Administración</p>
            <p className="text-xs text-muted-foreground">Mensajes y cobros de tu comunidad</p>
          </div>
        </div>

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

              // ── Mensaje tipo cobro ──
              if (msg.tipo === 'cobro') {
                const pagado = msg.estado === 'pagado';
                return (
                  <div key={msg.id} className="flex justify-start">
                    <div className="max-w-[85%] bg-white border border-border rounded-2xl rounded-bl-md p-3 shadow-sm space-y-2">
                      <div className="flex items-center gap-2">
                        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', pagado ? 'bg-green-100' : 'bg-yellow-100')}>
                          <Wallet className={cn('w-4 h-4', pagado ? 'text-green-600' : 'text-yellow-600')} />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-finca-dark">Cobro pendiente</p>
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
                );
              }

              // ── Mensaje texto normal ──
              return (
                <div key={msg.id} className={cn('flex gap-2', mio ? 'flex-row-reverse' : 'flex-row')}>
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
      </div>
    );
  }

  return (
    <div className="px-4 py-5 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={() => router.back()} className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-finca-dark hover:bg-gray-100 transition-colors shrink-0">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-finca-dark">
            Mensajes de administración
            {totalNoLeidos > 0 && (
              <span className="ml-2 inline-flex w-5 h-5 bg-finca-coral text-white rounded-full text-[10px] items-center justify-center font-bold">{totalNoLeidos}</span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">Cobros y comunicaciones del admin</p>
        </div>
      </div>

      {loadingChats ? (
        <div className="space-y-2">{[1,2].map(i => <Card key={i} className="border-0 shadow-sm"><CardContent className="p-3"><Skeleton className="h-12 w-full" /></CardContent></Card>)}</div>
      ) : chats.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="py-12 text-center">
            <MessageSquare className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-medium text-finca-dark">Sin mensajes del admin</p>
            <p className="text-xs text-muted-foreground mt-1">Aquí aparecerán los cobros y comunicaciones</p>
          </CardContent>
        </Card>
      ) : (
        chats.map(c => (
          <button key={c.id} onClick={() => setChatAbierto(c)} className="w-full text-left">
            <Card className="border-0 shadow-sm hover:shadow-md transition-all active:scale-[0.99]">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-finca-coral flex items-center justify-center shrink-0">
                  <UserCog className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-finca-dark">Administración</p>
                  <p className="text-xs text-muted-foreground truncate">{c.ultimo_mensaje || 'Sin mensajes'}</p>
                </div>
                {c.no_leidos_vecino > 0 && (
                  <span className="w-5 h-5 bg-finca-coral text-white rounded-full text-[10px] flex items-center justify-center font-bold shrink-0">
                    {c.no_leidos_vecino > 9 ? '9+' : c.no_leidos_vecino}
                  </span>
                )}
              </CardContent>
            </Card>
          </button>
        ))
      )}
    </div>
  );
}
