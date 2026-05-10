'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  collection, addDoc, onSnapshot, query, orderBy, doc, setDoc, updateDoc, increment,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Send, Loader2, Package, DoorOpen, FileText, AlertTriangle,
  Car, Mail, Wrench, Mic, Phone, Video, ChevronDown, ChevronUp, ShoppingBag, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';

interface ChatVigilanteProps {
  comunidadId: string;
  vigilanteId: string;
  vecinoId: string;
  vecinoNombre: string;
  vecinoAvatar?: string | null;
}

interface Mensaje {
  id: string;
  sender_id: string;
  sender_rol: 'vecino' | 'vigilante' | 'admin' | 'presidente';
  tipo: 'texto' | 'plantilla';
  texto: string;
  plantilla_tipo?: string;
  leido: boolean;
  created_at: string;
}

const PLANTILLAS = [
  { icon: Package,       label: 'Paquete',         tipo: 'paquete',         texto: 'Llego un paquete para su apartamento. Puede recogerlo en la porteria.' },
  { icon: DoorOpen,      label: 'Visita',          tipo: 'visita',          texto: 'Tiene una visita esperando en la entrada. Por favor confirme si autoriza el ingreso.' },
  { icon: FileText,      label: 'Recibo',          tipo: 'recibo',          texto: 'Llego un recibo para su apartamento. Esta disponible en la porteria.' },
  { icon: AlertTriangle, label: 'Emergencia',      tipo: 'emergencia',      texto: 'AVISO URGENTE: Se presenta una situacion de emergencia en el edificio. Por favor siga las indicaciones de seguridad.' },
  { icon: Car,           label: 'Vehiculo',        tipo: 'vehiculo',        texto: 'Su vehiculo esta bloqueando el paso en el parqueadero. Por favor muevalo lo antes posible.' },
  { icon: ShoppingBag,   label: 'Domicilio',       tipo: 'domicilio',       texto: 'Tiene un domicilio esperando en la porteria. Por favor bajar a recogerlo.' },
  { icon: Mail,          label: 'Correspondencia', tipo: 'correspondencia', texto: 'Llego correspondencia para su apartamento. Puede recogerla en la porteria.' },
  { icon: Wrench,        label: 'Tecnico',         tipo: 'tecnico',         texto: 'Un tecnico autorizado esta en la porteria para realizar un servicio en su apartamento. Autoriza el ingreso?' },
];

/** Unified chatId: one chat per community per type per vecino */
function getChatId(comunidadId: string, vecinoId: string): string {
  return `${comunidadId}_vigilante_${vecinoId}`;
}

export default function ChatVigilante({
  comunidadId, vigilanteId, vecinoId, vecinoNombre, vecinoAvatar,
}: ChatVigilanteProps) {
  const { perfil } = useAuth();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [sending, setSending] = useState(false);
  const [showPlantillas, setShowPlantillas] = useState(true);
  const [imgError, setImgError] = useState(false);
  const [vecinoTyping, setVecinoTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const chatId = getChatId(comunidadId, vecinoId);

  // Real-time messages listener
  useEffect(() => {
    const q = query(
      collection(db, 'chats_comunidad', chatId, 'mensajes'),
      orderBy('created_at', 'asc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      setMensajes(snap.docs.map(d => ({ id: d.id, ...d.data() } as Mensaje)));
    }, (err) => {
      console.error('[ChatVigilante] onSnapshot error:', err);
      toast.error('Error cargando mensajes');
    });
    return () => unsub();
  }, [chatId]);

  // Typing indicator — detect vecino is typing
  useEffect(() => {
    const chatRef = doc(db, 'chats_comunidad', chatId);
    const unsub = onSnapshot(chatRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.typing_vecino && data.typing_vecino_at) {
        const age = Date.now() - new Date(data.typing_vecino_at).getTime();
        setVecinoTyping(age < 5000);
      } else {
        setVecinoTyping(false);
      }
    }, () => {});
    return () => unsub();
  }, [chatId]);

  const notifyTyping = useCallback(() => {
    const chatRef = doc(db, 'chats_comunidad', chatId);
    updateDoc(chatRef, { typing_contraparte: true, typing_contraparte_at: new Date().toISOString() }).catch(() => {});
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      updateDoc(chatRef, { typing_contraparte: false }).catch(() => {});
    }, 3000);
  }, [chatId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [mensajes, vecinoTyping]);

  async function ensureChatDoc() {
    const chatRef = doc(db, 'chats_comunidad', chatId);
    await setDoc(chatRef, {
      comunidad_id:       comunidadId,
      tipo:               'vigilante',
      vecino_id:          vecinoId,
      contraparte_id:     vigilanteId,
      contraparte_rol:    'vigilante',
      updated_at:         new Date().toISOString(),
    }, { merge: true });
  }

  async function sendMessage(text: string, tipo: 'texto' | 'plantilla' = 'texto', plantillaTipo?: string) {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await ensureChatDoc();
      const chatRef = doc(db, 'chats_comunidad', chatId);
      const now = new Date().toISOString();

      await addDoc(collection(db, 'chats_comunidad', chatId, 'mensajes'), {
        sender_id:    vigilanteId,
        sender_rol:   'vigilante',
        tipo,
        texto:        text.trim(),
        ...(plantillaTipo ? { plantilla_tipo: plantillaTipo } : {}),
        leido:        false,
        created_at:   now,
      });

      await updateDoc(chatRef, {
        ultimo_mensaje:    text.trim().slice(0, 100),
        no_leidos_vecino:  increment(1),
        updated_at:        now,
      });

      // Push notification al vecino (fire-and-forget)
      fetch('/api/notificaciones/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comunidad_id:  comunidadId,
          title:         'Mensaje de portería',
          body:          text.trim().slice(0, 100),
          url:           '/porteria',
          targetUserIds: [vecinoId],
        }),
      }).catch(() => {});

      setTexto('');
      setShowPlantillas(false);
    } catch (err) {
      console.error('[ChatVigilante] Error enviando:', err);
      toast.error('Error al enviar mensaje');
    } finally {
      setSending(false);
    }
  }

  function handlePlantilla(plantilla: typeof PLANTILLAS[0]) {
    sendMessage(plantilla.texto, 'plantilla', plantilla.tipo);
  }

  const isMine = (msg: Mensaje) => msg.sender_id === vigilanteId;

  const plantillaIconMap: Record<string, typeof Package> = {
    paquete: Package, visita: DoorOpen, recibo: FileText,
    emergencia: AlertTriangle, vehiculo: Car, correspondencia: Mail,
    tecnico: Wrench, domicilio: ShoppingBag,
  };

  const hasVecinoPhoto = !!vecinoAvatar && !imgError;

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4 space-y-3">

        {/* Plantillas rápidas */}
        <div>
          <button
            onClick={() => setShowPlantillas(!showPlantillas)}
            className="flex items-center gap-1.5 text-xs font-medium text-finca-coral hover:text-finca-salmon mb-2"
          >
            {showPlantillas ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Mensajes rápidos
          </button>
          {showPlantillas && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {PLANTILLAS.map((p) => (
                <button
                  key={p.tipo}
                  onClick={() => handlePlantilla(p)}
                  disabled={sending}
                  className="inline-flex items-center gap-1.5 text-xs font-medium bg-finca-peach/20 text-finca-coral border border-finca-peach rounded-full px-3 py-1.5 hover:bg-finca-peach/50 transition-colors active:scale-95 disabled:opacity-50"
                >
                  <p.icon className="w-3 h-3" />
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Mensajes */}
        <div ref={scrollRef} className="h-80 overflow-y-auto space-y-2 rounded-xl bg-gray-50 p-3 scroll-smooth">
          {mensajes.length === 0 && (
            <div className="text-center py-12 space-y-2">
              <Send className="w-8 h-8 text-muted-foreground mx-auto opacity-40" />
              <p className="text-xs text-muted-foreground">No hay mensajes con este residente.</p>
              <p className="text-xs text-muted-foreground">Usa los mensajes rápidos o escribe directamente.</p>
            </div>
          )}

          {mensajes.map((msg) => {
            const mine = isMine(msg);
            const PlantillaIcon = msg.plantilla_tipo ? plantillaIconMap[msg.plantilla_tipo] : null;

            return (
              <div key={msg.id} className={cn('flex gap-2', mine ? 'flex-row-reverse' : 'flex-row')}>
                <div className="shrink-0">
                  {mine ? (
                    <div className="w-7 h-7 rounded-full bg-finca-coral flex items-center justify-center shrink-0">
                      <ShieldCheck className="w-4 h-4 text-white" />
                    </div>
                  ) : hasVecinoPhoto ? (
                    <div className="w-7 h-7 rounded-full overflow-hidden ring-1 ring-finca-peach">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={vecinoAvatar!}
                        alt={vecinoNombre}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                        onError={() => setImgError(true)}
                      />
                    </div>
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-finca-peach flex items-center justify-center text-[10px] font-bold text-finca-coral">
                      {vecinoNombre[0]?.toUpperCase()}
                    </div>
                  )}
                </div>

                <div className={cn(
                  'max-w-[75%] rounded-2xl px-3 py-2',
                  mine ? 'bg-finca-coral text-white rounded-br-md' : 'bg-white border border-border rounded-bl-md',
                )}>
                  {msg.tipo === 'plantilla' && PlantillaIcon && (
                    <div className={cn('flex items-center gap-1 mb-1 text-[10px] font-medium', mine ? 'text-white/70' : 'text-finca-coral')}>
                      <PlantillaIcon className="w-3 h-3" />
                      {msg.plantilla_tipo}
                    </div>
                  )}
                  <p className={cn('text-sm', mine ? 'text-white' : 'text-finca-dark')}>{msg.texto}</p>
                  <span className={cn('text-[9px] block mt-1', mine ? 'text-white/60' : 'text-muted-foreground')}>
                    {msg.created_at ? format(new Date(msg.created_at), 'HH:mm', { locale: es }) : ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {vecinoTyping && (
          <div className="flex items-center gap-2 px-1">
            <div className="w-6 h-6 rounded-full bg-finca-peach flex items-center justify-center text-[10px] font-bold text-finca-coral">
              {vecinoNombre[0]?.toUpperCase()}
            </div>
            <div className="bg-white border border-border rounded-2xl rounded-bl-md px-3 py-2 flex items-center gap-1">
              {[0, 150, 300].map(delay => (
                <span key={delay} className="w-1.5 h-1.5 bg-finca-coral/60 rounded-full animate-bounce" style={{ animationDelay: `${delay}ms` }} />
              ))}
            </div>
            <span className="text-[10px] text-muted-foreground">escribiendo...</span>
          </div>
        )}

        {/* Input */}
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="w-8 h-8 opacity-40 cursor-not-allowed" disabled title="Próximamente">
              <Mic className="w-4 h-4 text-muted-foreground" />
            </Button>
            <Button variant="ghost" size="icon" className="w-8 h-8 opacity-40 cursor-not-allowed" disabled title="Próximamente">
              <Phone className="w-4 h-4 text-muted-foreground" />
            </Button>
            <Button variant="ghost" size="icon" className="w-8 h-8 opacity-40 cursor-not-allowed" disabled title="Próximamente">
              <Video className="w-4 h-4 text-muted-foreground" />
            </Button>
            <span className="text-[10px] text-muted-foreground ml-1">Próximamente</span>
          </div>
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              placeholder="Escribe un mensaje..."
              value={texto}
              onChange={(e) => { setTexto(e.target.value); notifyTyping(); }}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage(texto)}
              className="flex-1 text-sm"
              disabled={sending}
            />
            <Button
              size="icon"
              className="bg-finca-coral hover:bg-finca-salmon shrink-0"
              onClick={() => sendMessage(texto)}
              disabled={!texto.trim() || sending}
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
