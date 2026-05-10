'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection, query, where, orderBy, onSnapshot,
  doc, updateDoc, addDoc, getDocs, runTransaction,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DoorOpen, Package, CheckCircle2, XCircle, Clock,
  MessageSquare, Send, Loader2, ShieldCheck, ChevronRight, ArrowLeft,
  QrCode, Share2, Copy, Download, X, Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, addMinutes, addHours, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import { useSound } from '@/hooks/useSound';
import { useQR } from '@/hooks/useQR';

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

interface PaseAcceso {
  id: string;
  visitante_nombre: string;
  tipo: string;
  motivo?: string;
  token: string;
  expira_at: string;
  uso_unico: boolean;
  max_usos: number;
  usos: number;
  estado: 'activo' | 'usado' | 'expirado' | 'cancelado';
  created_at: string;
}

type Tab = 'visitas' | 'pases' | 'mensajes';

const DURACIONES = [
  { value: 30,    label: '30 min',  unit: 'min'  },
  { value: 60,    label: '1 hora',  unit: 'hour' },
  { value: 240,   label: '4 horas', unit: 'hour4' },
  { value: 1440,  label: '1 dia',   unit: 'day'  },
];

const tiposVisitante = [
  { value: 'visitante',  label: 'Visitante'  },
  { value: 'familiar',   label: 'Familiar'   },
  { value: 'repartidor', label: 'Repartidor' },
  { value: 'tecnico',    label: 'Tecnico'    },
  { value: 'proveedor',  label: 'Proveedor'  },
];

function QRImage({ data, className }: { data: string; className?: string }) {
  const { qrUrl, loading, error } = useQR(data);
  if (loading) return <div className={cn('flex items-center justify-center bg-muted rounded-xl', className)}><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (error || !qrUrl) return <div className={cn('flex flex-col items-center justify-center bg-muted rounded-xl gap-1', className)}><QrCode className="w-8 h-8 text-muted-foreground" /><span className="text-[10px] text-muted-foreground">QR no disponible</span></div>;
  return <img src={qrUrl} alt="Código QR" className={cn('rounded-xl', className)} />;
}

function generarToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

function calcExpira(minutosDesdeAhora: number): string {
  return addMinutes(new Date(), minutosDesdeAhora).toISOString();
}

export default function PorteriaPage() {
  const { perfil, user } = useAuth();
  const router = useRouter();
  const { play } = useSound();
  const [tab, setTab] = useState<Tab>('visitas');

  // Visitas pendientes
  const [accesos, setAccesos] = useState<Acceso[]>([]);
  const [loadingAccesos, setLoadingAccesos] = useState(true);

  // Pases QR
  const [pases, setPases] = useState<PaseAcceso[]>([]);
  const [loadingPases, setLoadingPases] = useState(true);
  const [showFormPase, setShowFormPase] = useState(false);
  const [creandoPase, setCreandoPase] = useState(false);
  const [paseGenerado, setPaseGenerado] = useState<PaseAcceso | null>(null);

  // Form pase
  const [paseNombre, setPaseNombre] = useState('');
  const [paseTipo, setPaseTipo] = useState('visitante');
  const [paseMotivo, setPaseMotivo] = useState('');
  const [paseDuracion, setPaseDuracion] = useState(60);
  const [paseUsoUnico, setPaseUsoUnico] = useState(true);

  // Chats
  const [chats, setChats] = useState<ChatResumen[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [chatAbierto, setChatAbierto] = useState<ChatResumen | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [sending, setSending] = useState(false);
  const [vigilanteTyping, setVigilanteTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const comunidadId = perfil?.comunidad_id;

  // Visitas en tiempo real
  useEffect(() => {
    if (!comunidadId || !user) return;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const q = query(
      collection(db, 'accesos'),
      where('comunidad_id', '==', comunidadId),
      where('vecino_id', '==', user.uid),
    );
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Acceso))
        .filter(a => new Date(a.hora_entrada) >= hoy)
        .sort((a, b) => new Date(b.hora_entrada).getTime() - new Date(a.hora_entrada).getTime());
      setAccesos(items);
      setLoadingAccesos(false);
    }, () => setLoadingAccesos(false));
    return () => unsub();
  }, [comunidadId, user]);

  // Pases QR en tiempo real
  useEffect(() => {
    if (!comunidadId || !user) return;
    const q = query(
      collection(db, 'pases_acceso'),
      where('comunidad_id', '==', comunidadId),
      where('vecino_id', '==', user.uid),
    );
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as PaseAcceso))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setPases(items);
      setLoadingPases(false);
    }, () => setLoadingPases(false));
    return () => unsub();
  }, [comunidadId, user]);

  // Chat portería — deterministic chatId: one chat per vecino per community
  const porteriaChat = comunidadId && user ? `${comunidadId}_vigilante_${user.uid}` : null;

  useEffect(() => {
    if (!porteriaChat) return;
    const unsub = onSnapshot(doc(db, 'chats_comunidad', porteriaChat), (snap) => {
      if (snap.exists()) {
        setChats([{ id: porteriaChat, ...snap.data() } as ChatResumen]);
      } else {
        setChats([]);
      }
      setLoadingChats(false);
    }, () => setLoadingChats(false));
    return () => unsub();
  }, [porteriaChat]);

  // Mensajes del chat abierto
  useEffect(() => {
    if (!chatAbierto) return;
    const q = query(
      collection(db, 'chats_comunidad', chatAbierto.id, 'mensajes'),
      orderBy('created_at', 'asc'),
    );
    let isFirst = true;
    const unsub = onSnapshot(q, (snap) => {
      if (!isFirst) {
        snap.docChanges().forEach((change) => {
          if (change.type === 'added' && change.doc.data().sender_id !== user?.uid) {
            play('mensaje_recibido');
          }
        });
      }
      isFirst = false;
      setMensajes(snap.docs.map(d => ({ id: d.id, ...d.data() } as Mensaje)));
      updateDoc(doc(db, 'chats_comunidad', chatAbierto.id), { no_leidos_vecino: 0 }).catch(() => {});
    });
    return () => unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatAbierto, user?.uid, play]);

  useEffect(() => {
    if (!chatAbierto) return;
    const unsub = onSnapshot(doc(db, 'chats_comunidad', chatAbierto.id), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.typing_contraparte && data.typing_contraparte_at) {
        setVigilanteTyping(Date.now() - new Date(data.typing_contraparte_at).getTime() < 5000);
      } else {
        setVigilanteTyping(false);
      }
    }, () => {});
    return () => unsub();
  }, [chatAbierto]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [mensajes, vigilanteTyping]);

  const notifyVecinoTyping = useCallback(() => {
    if (!chatAbierto || !user) return;
    const chatRef = doc(db, 'chats_comunidad', chatAbierto.id);
    updateDoc(chatRef, { typing_vecino: true, typing_vecino_at: new Date().toISOString() }).catch(() => {});
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      updateDoc(chatRef, { typing_vecino: false }).catch(() => {});
    }, 3000);
  }, [chatAbierto, user]);

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

  async function crearPase() {
    if (!paseNombre.trim()) { toast.error('Ingresa el nombre del visitante'); return; }
    if (!comunidadId || !user || !perfil) return;
    setCreandoPase(true);
    try {
      const token = generarToken();
      const expira_at = calcExpira(paseDuracion);
      const apto = [
        perfil.torre && `Torre ${perfil.torre}`,
        perfil.puerta && `Apto ${perfil.puerta}`,
      ].filter(Boolean).join(' - ') || perfil.numero_piso || 'Sin especificar';

      const paseData = {
        comunidad_id: comunidadId,
        vecino_id: user.uid,
        vecino_nombre: perfil.nombre_completo,
        vecino_apartamento: apto,
        visitante_nombre: paseNombre.trim(),
        tipo: paseTipo,
        motivo: paseMotivo.trim() || undefined,
        token,
        expira_at,
        uso_unico: paseUsoUnico,
        max_usos: paseUsoUnico ? 1 : 10,
        usos: 0,
        estado: 'activo' as const,
        created_at: new Date().toISOString(),
      };

      const ref = await addDoc(collection(db, 'pases_acceso'), paseData);
      const creado = { id: ref.id, ...paseData };
      setPaseGenerado(creado);
      setShowFormPase(false);
      resetFormPase();
      toast.success('Pase QR generado');
    } catch {
      toast.error('Error al crear el pase');
    } finally {
      setCreandoPase(false);
    }
  }

  async function cancelarPase(paseId: string) {
    try {
      await updateDoc(doc(db, 'pases_acceso', paseId), { estado: 'cancelado' });
      toast.success('Pase cancelado');
    } catch {
      toast.error('Error al cancelar');
    }
  }

  function resetFormPase() {
    setPaseNombre(''); setPaseTipo('visitante'); setPaseMotivo('');
    setPaseDuracion(60); setPaseUsoUnico(true);
  }

  function getPaseUrl(token: string): string {
    return `${typeof window !== 'undefined' ? window.location.origin : ''}/validar-pase?t=${token}`;
  }

  function compartirWhatsApp(pase: PaseAcceso) {
    const url = getPaseUrl(pase.token);
    const msg = encodeURIComponent(
      `Hola, soy ${perfil?.nombre_completo?.split(' ')[0]}. Te comparto mi pase de acceso para la comunidad:\n${url}\n\nExpira: ${format(new Date(pase.expira_at), "dd/MM HH:mm")}`
    );
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  }

  async function copiarEnlace(pase: PaseAcceso) {
    try {
      await navigator.clipboard.writeText(getPaseUrl(pase.token));
      toast.success('Enlace copiado');
    } catch {
      toast.error('Error al copiar');
    }
  }

  async function descargarQR(pase: PaseAcceso) {
    try {
      const QRCode = await import('qrcode');
      const dataUrl = await QRCode.default.toDataURL(getPaseUrl(pase.token), { width: 400, margin: 2 });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `pase-${pase.visitante_nombre.replace(/\s+/g, '-')}.png`;
      a.click();
    } catch {
      toast.error('Error al descargar el QR');
    }
  }

  async function enviarMensaje() {
    if (!texto.trim() || sending || !chatAbierto || !user) return;
    setSending(true);
    try {
      const now = new Date().toISOString();
      await addDoc(collection(db, 'chats_comunidad', chatAbierto.id, 'mensajes'), {
        sender_id: user.uid, sender_rol: 'vecino', tipo: 'texto', texto: texto.trim(),
        leido: false, created_at: now,
      });
      await updateDoc(doc(db, 'chats_comunidad', chatAbierto.id), {
        ultimo_mensaje:     texto.trim().slice(0, 100),
        no_leidos_contraparte: 1,
        updated_at:         now,
      });
      if (comunidadId && chatAbierto.vigilante_id) {
        fetch('/api/notificaciones/push', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            comunidad_id: comunidadId,
            title: `Vecino: ${perfil?.nombre_completo?.split(' ')[0] ?? 'Residente'}`,
            body: texto.trim().slice(0, 100), url: '/vigilante/chats',
            targetUserIds: [chatAbierto.vigilante_id],
          }),
        }).catch((err) => console.warn('[porteria] push notification failed:', err));
      }
      setTexto('');
    } catch { toast.error('Error al enviar'); } finally { setSending(false); }
  }

  const totalNoLeidos = chats.reduce((sum, c) => sum + (c.no_leidos_vecino || 0), 0);
  const visitasPendientes = accesos.filter(a => a.estado === 'esperando');
  const pasesActivos = pases.filter(p => p.estado === 'activo' && new Date(p.expira_at) > new Date());

  // Vista de chat abierto
  if (chatAbierto) {
    return (
      <div className="px-4 py-5 max-w-2xl mx-auto flex flex-col h-[calc(100vh-8rem)]">
        <button onClick={() => setChatAbierto(null)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-finca-dark mb-3 transition-colors">
          ← Volver a portería
        </button>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-finca-peach flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-finca-coral" />
          </div>
          <div>
            <p className="font-semibold text-finca-dark">Portería</p>
            <p className="text-xs text-muted-foreground">Vigilancia de la comunidad</p>
          </div>
        </div>
        <Card className="flex-1 border-0 shadow-sm flex flex-col overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50 dark:bg-gray-900">
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
                  {mio ? (
                    <div className="w-7 h-7 rounded-full bg-finca-peach flex items-center justify-center text-[10px] font-bold text-finca-coral shrink-0">
                      {perfil?.nombre_completo?.[0]?.toUpperCase()}
                    </div>
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-finca-coral flex items-center justify-center shrink-0">
                      <ShieldCheck className="w-3.5 h-3.5 text-white" />
                    </div>
                  )}
                  <div className={cn('max-w-[75%] rounded-2xl px-3 py-2', mio ? 'bg-finca-coral text-white rounded-br-md' : 'bg-white border border-border rounded-bl-md dark:bg-card')}>
                    <p className={cn('text-sm whitespace-pre-wrap', mio ? 'text-white' : 'text-finca-dark dark:text-white')}>{msg.texto}</p>
                    <span className={cn('text-[9px] block mt-0.5', mio ? 'text-white/60' : 'text-muted-foreground')}>
                      {msg.created_at ? format(new Date(msg.created_at), 'HH:mm', { locale: es }) : ''}
                    </span>
                  </div>
                </div>
              );
            })}
            {vigilanteTyping && (
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-finca-coral flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="bg-white border border-border rounded-2xl rounded-bl-md px-3 py-2.5 flex items-center gap-1">
                  {[0, 150, 300].map(delay => (
                    <span key={delay} className="w-1.5 h-1.5 bg-finca-coral/60 rounded-full animate-bounce" style={{ animationDelay: `${delay}ms` }} />
                  ))}
                </div>
                <span className="text-[10px] text-muted-foreground">Portería escribiendo...</span>
              </div>
            )}
          </div>
          <div className="p-3 border-t border-border flex gap-2">
            <Input
              placeholder="Escribe un mensaje..."
              value={texto}
              onChange={e => { setTexto(e.target.value); notifyVecinoTyping(); }}
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
        <button onClick={() => router.back()} className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-finca-dark hover:bg-gray-100 transition-colors shrink-0" aria-label="Volver">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-finca-dark dark:text-white">Portería</h1>
          <p className="text-sm text-muted-foreground">Visitas, pases QR y mensajes</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
        <button
          onClick={() => setTab('visitas')}
          className={cn('flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all', tab === 'visitas' ? 'bg-white dark:bg-card shadow-sm text-finca-dark dark:text-white' : 'text-muted-foreground')}
        >
          <DoorOpen className="w-3.5 h-3.5" />
          Visitas
          {visitasPendientes.length > 0 && (
            <span className="w-4 h-4 bg-yellow-500 text-white rounded-full text-[9px] flex items-center justify-center font-bold">{visitasPendientes.length}</span>
          )}
        </button>
        <button
          onClick={() => setTab('pases')}
          className={cn('flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all', tab === 'pases' ? 'bg-white dark:bg-card shadow-sm text-finca-dark dark:text-white' : 'text-muted-foreground')}
        >
          <QrCode className="w-3.5 h-3.5" />
          Pases QR
          {pasesActivos.length > 0 && (
            <span className="w-4 h-4 bg-finca-coral text-white rounded-full text-[9px] flex items-center justify-center font-bold">{pasesActivos.length}</span>
          )}
        </button>
        <button
          onClick={() => setTab('mensajes')}
          className={cn('flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all', tab === 'mensajes' ? 'bg-white dark:bg-card shadow-sm text-finca-dark dark:text-white' : 'text-muted-foreground')}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Mensajes
          {totalNoLeidos > 0 && (
            <span className="w-4 h-4 bg-finca-coral text-white rounded-full text-[9px] flex items-center justify-center font-bold">{totalNoLeidos}</span>
          )}
        </button>
      </div>

      {/* ── Tab Visitas ── */}
      {tab === 'visitas' && (
        <div className="space-y-3">
          {loadingAccesos ? (
            <div className="space-y-2">{[1,2].map(i => <Card key={i} className="border-0 shadow-sm"><CardContent className="p-3"><Skeleton className="h-14 w-full" /></CardContent></Card>)}</div>
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
                <Card key={a.id} className={cn('border-0 shadow-sm', isPendiente && 'border-l-4 border-l-yellow-400 bg-yellow-50/30')}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', isPendiente ? 'bg-yellow-100' : a.estado === 'autorizado' ? 'bg-green-100' : 'bg-red-100')}>
                        <DoorOpen className={cn('w-5 h-5', isPendiente ? 'text-yellow-600' : a.estado === 'autorizado' ? 'text-green-600' : 'text-red-600')} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-finca-dark dark:text-white">{a.visitante_nombre}</p>
                          <Badge className={cn('text-[10px] border shrink-0', isPendiente ? 'bg-yellow-100 text-yellow-700 border-yellow-200' : a.estado === 'autorizado' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-red-100 text-red-700 border-red-200')}>
                            {isPendiente ? 'Esperando' : a.estado === 'autorizado' ? 'Autorizado' : 'Rechazado'}
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
                        <Button className="flex-1 bg-green-600 hover:bg-green-700 h-9" onClick={() => responderAcceso(a.id, 'autorizado')}>
                          <CheckCircle2 className="w-4 h-4 mr-1.5" />Autorizar
                        </Button>
                        <Button variant="outline" className="flex-1 border-red-300 text-red-600 hover:bg-red-50 h-9" onClick={() => responderAcceso(a.id, 'rechazado')}>
                          <XCircle className="w-4 h-4 mr-1.5" />Rechazar
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

      {/* ── Tab Pases QR ── */}
      {tab === 'pases' && (
        <div className="space-y-3">
          <Button
            className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white gap-2"
            onClick={() => { setShowFormPase(!showFormPase); if (!showFormPase) resetFormPase(); }}
          >
            {showFormPase ? <X className="w-4 h-4" /> : <QrCode className="w-4 h-4" />}
            {showFormPase ? 'Cancelar' : 'Generar nuevo pase QR'}
          </Button>

          {/* Formulario nuevo pase */}
          {showFormPase && (
            <Card className="border-2 border-finca-coral/20 shadow-md">
              <CardContent className="p-4 space-y-4">
                <p className="text-xs font-semibold text-finca-coral uppercase tracking-wide">Nuevo pase de acceso</p>

                <div className="space-y-1.5">
                  <Label htmlFor="p-nombre">Nombre del visitante *</Label>
                  <Input id="p-nombre" placeholder="Ej: Juan García" value={paseNombre} onChange={e => setPaseNombre(e.target.value)} />
                </div>

                <div className="space-y-1.5">
                  <Label>Tipo de visitante</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {tiposVisitante.slice(0,3).map(t => (
                      <button key={t.value} type="button" onClick={() => setPaseTipo(t.value)}
                        className={cn('py-2 rounded-lg text-xs font-medium border transition-all', paseTipo === t.value ? 'bg-finca-coral text-white border-transparent' : 'bg-muted/50 border-transparent text-muted-foreground hover:bg-muted')}
                      >{t.label}</button>
                    ))}
                    {tiposVisitante.slice(3).map(t => (
                      <button key={t.value} type="button" onClick={() => setPaseTipo(t.value)}
                        className={cn('py-2 rounded-lg text-xs font-medium border transition-all', paseTipo === t.value ? 'bg-finca-coral text-white border-transparent' : 'bg-muted/50 border-transparent text-muted-foreground hover:bg-muted')}
                      >{t.label}</button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Duracion del pase</Label>
                  <div className="grid grid-cols-4 gap-2">
                    {DURACIONES.map(d => (
                      <button key={d.value} type="button" onClick={() => setPaseDuracion(d.value)}
                        className={cn('py-2 rounded-lg text-xs font-medium border transition-all', paseDuracion === d.value ? 'bg-finca-coral text-white border-transparent' : 'bg-muted/50 border-transparent text-muted-foreground hover:bg-muted')}
                      >{d.label}</button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between py-2 px-3 bg-muted/40 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-finca-dark dark:text-white">Uso unico</p>
                    <p className="text-[11px] text-muted-foreground">El pase se invalida tras el primer uso</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPaseUsoUnico(!paseUsoUnico)}
                    className={cn('w-10 h-6 rounded-full transition-colors relative', paseUsoUnico ? 'bg-finca-coral' : 'bg-gray-300')}
                  >
                    <span className={cn('w-4 h-4 bg-white rounded-full absolute top-1 transition-transform', paseUsoUnico ? 'translate-x-5' : 'translate-x-1')} />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="p-motivo">Motivo (opcional)</Label>
                  <Input id="p-motivo" placeholder="Ej: Visita familiar" value={paseMotivo} onChange={e => setPaseMotivo(e.target.value)} />
                </div>

                <Button className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white" onClick={crearPase} disabled={creandoPase || !paseNombre.trim()}>
                  {creandoPase ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <QrCode className="w-4 h-4 mr-2" />}
                  Generar pase y QR
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Modal pase generado con QR + opciones compartir */}
          {paseGenerado && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setPaseGenerado(null)}>
              <div className="bg-white dark:bg-card rounded-2xl p-5 w-full max-w-sm shadow-2xl space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <p className="font-bold text-finca-dark dark:text-white">Pase generado</p>
                  <button onClick={() => setPaseGenerado(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="text-center space-y-1">
                  <p className="font-semibold text-finca-dark dark:text-white">{paseGenerado.visitante_nombre}</p>
                  <p className="text-xs text-muted-foreground">
                    {tiposVisitante.find(t => t.value === paseGenerado.tipo)?.label} · Expira: {format(new Date(paseGenerado.expira_at), "dd/MM 'a las' HH:mm")}
                  </p>
                  <Badge className={cn('text-[10px]', paseGenerado.uso_unico ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700')}>
                    {paseGenerado.uso_unico ? 'Uso único' : `Hasta ${paseGenerado.max_usos} usos`}
                  </Badge>
                </div>

                <div className="flex justify-center">
                  <QRImage data={getPaseUrl(paseGenerado.token)} className="w-44 h-44" />
                </div>

                <p className="text-[11px] text-center text-muted-foreground">
                  El visitante muestra este QR en portería. El vigilante lo valida desde la app.
                </p>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => compartirWhatsApp(paseGenerado)}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-green-50 hover:bg-green-100 border border-green-200 transition-colors"
                  >
                    <Share2 className="w-5 h-5 text-green-600" />
                    <span className="text-[10px] font-medium text-green-700">WhatsApp</span>
                  </button>
                  <button
                    onClick={() => copiarEnlace(paseGenerado)}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors"
                  >
                    <Copy className="w-5 h-5 text-blue-600" />
                    <span className="text-[10px] font-medium text-blue-700">Copiar link</span>
                  </button>
                  <button
                    onClick={() => descargarQR(paseGenerado)}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-purple-50 hover:bg-purple-100 border border-purple-200 transition-colors"
                  >
                    <Download className="w-5 h-5 text-purple-600" />
                    <span className="text-[10px] font-medium text-purple-700">Descargar</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Lista de pases */}
          {loadingPases ? (
            <div className="space-y-2">{[1,2].map(i => <Card key={i} className="border-0 shadow-sm"><CardContent className="p-3"><Skeleton className="h-12 w-full" /></CardContent></Card>)}</div>
          ) : pases.length === 0 ? (
            <Card className="border-dashed border-2">
              <CardContent className="py-10 text-center">
                <QrCode className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm font-medium text-finca-dark dark:text-white">Sin pases generados</p>
                <p className="text-xs text-muted-foreground mt-1">Genera un pase QR y compartelo con tu visitante</p>
              </CardContent>
            </Card>
          ) : (
            pases.map(p => {
              const expirado = new Date(p.expira_at) < new Date();
              const activo = p.estado === 'activo' && !expirado;
              return (
                <Card key={p.id} className={cn('border-0 shadow-sm', activo ? 'border-l-4 border-l-finca-coral' : 'opacity-60')}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', activo ? 'bg-finca-peach' : 'bg-gray-100')}>
                      <QrCode className={cn('w-4 h-4', activo ? 'text-finca-coral' : 'text-gray-400')} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-finca-dark dark:text-white truncate">{p.visitante_nombre}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {tiposVisitante.find(t => t.value === p.tipo)?.label} · {p.usos}/{p.max_usos} usos
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge className={cn('text-[9px]', activo ? 'bg-green-100 text-green-700' : p.estado === 'usado' ? 'bg-gray-100 text-gray-500' : 'bg-red-100 text-red-500')}>
                        {expirado ? 'Expirado' : p.estado === 'activo' ? 'Activo' : p.estado === 'usado' ? 'Usado' : 'Cancelado'}
                      </Badge>
                      {activo && (
                        <div className="flex gap-1">
                          <button onClick={() => setPaseGenerado(p)} className="text-[10px] text-finca-coral hover:underline">Ver QR</button>
                          <span className="text-muted-foreground text-[10px]">·</span>
                          <button onClick={() => cancelarPase(p.id)} className="text-[10px] text-red-500 hover:underline">Cancelar</button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}

      {/* ── Tab Mensajes ── */}
      {tab === 'mensajes' && (
        <div className="space-y-2">
          {loadingChats ? (
            <div className="space-y-2">{[1,2].map(i => <Card key={i} className="border-0 shadow-sm"><CardContent className="p-3"><Skeleton className="h-12 w-full" /></CardContent></Card>)}</div>
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
                    <div className="w-10 h-10 rounded-full bg-finca-peach flex items-center justify-center shrink-0">
                      <ShieldCheck className="w-5 h-5 text-finca-coral" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-finca-dark dark:text-white">Portería</p>
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
