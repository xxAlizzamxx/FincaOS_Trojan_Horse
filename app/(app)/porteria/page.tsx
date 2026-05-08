'use client';

import { useEffect, useState, useRef } from 'react';
import {
  collection, query, where, onSnapshot, orderBy,
  doc, updateDoc, addDoc, getDocs, getDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DoorOpen, Package, CheckCircle2, XCircle, Clock,
  MessageSquare, Send, Loader2, ShieldCheck, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';

interface Acceso {
  id: string;
  visitante_nombre: string;
  visitante_cedula?: string;
  tipo: string;
  apartamento_destino: string;
  motivo?: string;
  estado: string;
  hora_entrada: string;
  vecino_id: string;
}

interface ChatResumen {
  id: string;
  vigilante_id: string;
  vecino_id: string;
  ultimo_mensaje: string;
  no_leidos_vecino: number;
  updated_at: string;
}

interface Mensaje {
  id: string;
  sender_id: string;
  texto: string;
  tipo: string;
  leido: boolean;
  created_at: string;
}

type Tab = 'visitas' | 'mensajes';

export default function PorteriaPage() {
  const { perfil, user } = useAuth();
  const [tab, setTab] = useState<Tab>('visitas');

  // Visitas pendientes
  const [accesos, setAccesos] = useState<Acceso[]>([]);
  const [loadingAccesos, setLoadingAccesos] = useState(true);

  // Chats
  const [chats, setChats] = useState<ChatResumen[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [chatAbierto, setChatAbierto] = useState<ChatResumen | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const comunidadId = perfil?.comunidad_id;

  // Visitas en tiempo real (las del vecino)
  useEffect(() => {
    if (!comunidadId || !user) return;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const q = query(
      collection(db, 'accesos'),
      where('comunidad_id', '==', comunidadId),
      where('vecino_id', '==', user.uid),
      orderBy('hora_entrada', 'desc'),
    );

    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Acceso))
        .filter(a => new Date(a.hora_entrada) >= hoy);
      setAccesos(items);
      setLoadingAccesos(false);
    }, () => setLoadingAccesos(false));

    return () => unsub();
  }, [comunidadId, user]);

  // Chats con vigilancia en tiempo real
  useEffect(() => {
    if (!comunidadId || !user) return;

    const q = query(
      collection(db, 'chats_vigilancia'),
      where('comunidad_id', '==', comunidadId),
      where('vecino_id', '==', user.uid),
      orderBy('updated_at', 'desc'),
    );

    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatResumen));
      setChats(items);
      setLoadingChats(false);
    }, () => setLoadingChats(false));

    return () => unsub();
  }, [comunidadId, user]);

  // Mensajes del chat abierto
  useEffect(() => {
    if (!chatAbierto) return;

    const q = query(
      collection(db, 'chats_vigilancia', chatAbierto.id, 'mensajes'),
      orderBy('created_at', 'asc'),
    );

    const unsub = onSnapshot(q, (snap) => {
      setMensajes(snap.docs.map(d => ({ id: d.id, ...d.data() } as Mensaje)));
      // Marcar como leídos
      updateDoc(doc(db, 'chats_vigilancia', chatAbierto.id), {
        no_leidos_vecino: 0,
      }).catch(() => {});
    });

    return () => unsub();
  }, [chatAbierto]);

  // Auto-scroll mensajes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [mensajes]);

  async function responderAcceso(accesoId: string, decision: 'autorizado' | 'rechazado') {
    try {
      await updateDoc(doc(db, 'accesos', accesoId), {
        estado: decision,
        respondido_at: new Date().toISOString(),
      });
      toast.success(decision === 'autorizado' ? '✅ Visita autorizada' : '❌ Visita rechazada');
    } catch {
      toast.error('Error al responder');
    }
  }

  async function enviarMensaje() {
    if (!texto.trim() || sending || !chatAbierto || !user) return;
    setSending(true);
    try {
      await addDoc(collection(db, 'chats_vigilancia', chatAbierto.id, 'mensajes'), {
        sender_id:  user.uid,
        texto:      texto.trim(),
        tipo:       'texto',
        leido:      false,
        created_at: new Date().toISOString(),
      });
      await updateDoc(doc(db, 'chats_vigilancia', chatAbierto.id), {
        ultimo_mensaje:      texto.trim().slice(0, 100),
        no_leidos_vigilante: 1,
        updated_at:          new Date().toISOString(),
      });
      setTexto('');
    } catch {
      toast.error('Error al enviar');
    } finally {
      setSending(false);
    }
  }

  const totalNoLeidos = chats.reduce((sum, c) => sum + (c.no_leidos_vecino || 0), 0);
  const visitasPendientes = accesos.filter(a => a.estado === 'esperando');

  // Vista de chat abierto
  if (chatAbierto) {
    return (
      <div className="max-w-2xl flex flex-col h-[calc(100vh-8rem)]">
        <button
          onClick={() => setChatAbierto(null)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-finca-dark mb-3 transition-colors"
        >
          ← Volver a portería
        </button>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <p className="font-semibold text-finca-dark">Portería</p>
            <p className="text-xs text-muted-foreground">Vigilancia de la comunidad</p>
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
              return (
                <div key={msg.id} className={cn('flex gap-2', mio ? 'flex-row-reverse' : 'flex-row')}>
                  <div className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0',
                    mio ? 'bg-finca-peach text-finca-coral' : 'bg-emerald-100 text-emerald-700',
                  )}>
                    {mio ? perfil?.nombre_completo?.[0]?.toUpperCase() : '🛡️'}
                  </div>
                  <div className={cn(
                    'max-w-[75%] rounded-2xl px-3 py-2',
                    mio ? 'bg-finca-coral text-white rounded-br-md' : 'bg-white border border-border rounded-bl-md',
                  )}>
                    <p className={cn('text-sm whitespace-pre-wrap', mio ? 'text-white' : 'text-finca-dark')}>{msg.texto}</p>
                    <span className={cn('text-[9px] block mt-0.5', mio ? 'text-white/60' : 'text-muted-foreground')}>
                      {msg.created_at ? format(new Date(msg.created_at), 'HH:mm', { locale: es }) : ''}
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
            <Button
              size="icon"
              className="bg-emerald-600 hover:bg-emerald-700 shrink-0"
              onClick={enviarMensaje}
              disabled={!texto.trim() || sending}
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-finca-dark">Portería</h1>
        <p className="text-sm text-muted-foreground">Visitas y mensajes de vigilancia</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        <button
          onClick={() => setTab('visitas')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all',
            tab === 'visitas' ? 'bg-white shadow-sm text-finca-dark' : 'text-muted-foreground',
          )}
        >
          <DoorOpen className="w-4 h-4" />
          Visitas
          {visitasPendientes.length > 0 && (
            <span className="w-5 h-5 bg-yellow-500 text-white rounded-full text-[10px] flex items-center justify-center font-bold">
              {visitasPendientes.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('mensajes')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all',
            tab === 'mensajes' ? 'bg-white shadow-sm text-finca-dark' : 'text-muted-foreground',
          )}
        >
          <MessageSquare className="w-4 h-4" />
          Mensajes
          {totalNoLeidos > 0 && (
            <span className="w-5 h-5 bg-finca-coral text-white rounded-full text-[10px] flex items-center justify-center font-bold">
              {totalNoLeidos}
            </span>
          )}
        </button>
      </div>

      {/* Tab Visitas */}
      {tab === 'visitas' && (
        <div className="space-y-3">
          {loadingAccesos ? (
            <div className="space-y-2">{[1,2].map(i =>
              <Card key={i} className="border-0 shadow-sm"><CardContent className="p-3"><Skeleton className="h-14 w-full" /></CardContent></Card>
            )}</div>
          ) : accesos.length === 0 ? (
            <Card className="border-dashed border-2">
              <CardContent className="py-10 text-center">
                <DoorOpen className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No tienes visitas registradas hoy</p>
              </CardContent>
            </Card>
          ) : (
            accesos.map(a => {
              const isPendiente = a.estado === 'esperando';
              return (
                <Card key={a.id} className={cn(
                  'border-0 shadow-sm',
                  isPendiente && 'border-l-4 border-l-yellow-400 bg-yellow-50/30',
                )}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                        isPendiente ? 'bg-yellow-100' : a.estado === 'autorizado' ? 'bg-green-100' : 'bg-red-100',
                      )}>
                        <DoorOpen className={cn('w-5 h-5', isPendiente ? 'text-yellow-600' : a.estado === 'autorizado' ? 'text-green-600' : 'text-red-600')} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-finca-dark">{a.visitante_nombre}</p>
                          <Badge className={cn('text-[10px] border shrink-0',
                            isPendiente ? 'bg-yellow-100 text-yellow-700 border-yellow-200' :
                            a.estado === 'autorizado' ? 'bg-green-100 text-green-700 border-green-200' :
                            'bg-red-100 text-red-700 border-red-200'
                          )}>
                            {isPendiente ? 'Esperando tu respuesta' : a.estado === 'autorizado' ? 'Autorizado' : 'Rechazado'}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {a.tipo} · {format(new Date(a.hora_entrada), 'HH:mm', { locale: es })}
                          {a.motivo && ` · ${a.motivo}`}
                        </p>
                      </div>
                    </div>

                    {isPendiente && (
                      <div className="flex gap-2 pt-1">
                        <Button
                          className="flex-1 bg-green-600 hover:bg-green-700 h-9"
                          onClick={() => responderAcceso(a.id, 'autorizado')}
                        >
                          <CheckCircle2 className="w-4 h-4 mr-1.5" />
                          Autorizar
                        </Button>
                        <Button
                          variant="outline"
                          className="flex-1 border-red-300 text-red-600 hover:bg-red-50 h-9"
                          onClick={() => responderAcceso(a.id, 'rechazado')}
                        >
                          <XCircle className="w-4 h-4 mr-1.5" />
                          Rechazar
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}

      {/* Tab Mensajes */}
      {tab === 'mensajes' && (
        <div className="space-y-2">
          {loadingChats ? (
            <div className="space-y-2">{[1,2].map(i =>
              <Card key={i} className="border-0 shadow-sm"><CardContent className="p-3"><Skeleton className="h-12 w-full" /></CardContent></Card>
            )}</div>
          ) : chats.length === 0 ? (
            <Card className="border-dashed border-2">
              <CardContent className="py-10 text-center">
                <MessageSquare className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No tienes mensajes de portería</p>
              </CardContent>
            </Card>
          ) : (
            chats.map(c => (
              <button key={c.id} onClick={() => setChatAbierto(c)} className="w-full text-left">
                <Card className="border-0 shadow-sm hover:shadow-md transition-all active:scale-[0.99]">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                      <ShieldCheck className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-finca-dark">Portería</p>
                      <p className="text-xs text-muted-foreground truncate">{c.ultimo_mensaje || 'Sin mensajes'}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {c.no_leidos_vecino > 0 && (
                        <span className="w-5 h-5 bg-finca-coral text-white rounded-full text-[10px] flex items-center justify-center font-bold">
                          {c.no_leidos_vecino}
                        </span>
                      )}
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
