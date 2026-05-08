'use client';

import { useEffect, useRef, useState } from 'react';
import {
  collection, addDoc, onSnapshot, query, orderBy, doc, getDoc, setDoc, updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Send, Loader2, Package, DoorOpen, FileText, AlertTriangle,
  Car, Mail, Wrench, Mic, Phone, Video, ChevronDown, ChevronUp, ShoppingBag,
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
  texto: string;
  tipo: 'texto' | 'plantilla' | 'imagen' | 'audio' | 'sistema';
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
  { icon: ShoppingBag,  label: 'Domicilio',       tipo: 'domicilio',       texto: 'Tiene un domicilio esperando en la porteria. Por favor bajar a recogerlo.' },
  { icon: Mail,          label: 'Correspondencia', tipo: 'correspondencia', texto: 'Llego correspondencia para su apartamento. Puede recogerla en la porteria.' },
  { icon: Wrench,        label: 'Tecnico',         tipo: 'tecnico',         texto: 'Un tecnico autorizado esta en la porteria para realizar un servicio en su apartamento. Autoriza el ingreso?' },
];

function getChatId(vigilanteId: string, vecinoId: string): string {
  return `${vigilanteId}_${vecinoId}`;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const chatId = getChatId(vigilanteId, vecinoId);

  // Realtime listener — subcollection orderBy sin where, no necesita índice compuesto
  useEffect(() => {
    const q = query(
      collection(db, 'chats_vigilancia', chatId, 'mensajes'),
      orderBy('created_at', 'asc'),
    );

    const unsub = onSnapshot(q, (snap) => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Mensaje));
      setMensajes(msgs);
    }, (err) => {
      console.error('[Chat] onSnapshot error:', err);
      toast.error('Error cargando mensajes — verifica las reglas de Firestore');
    });

    return () => unsub();
  }, [chatId]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [mensajes]);

  // Ensure chat doc exists
  async function ensureChatDoc() {
    const chatRef  = doc(db, 'chats_vigilancia', chatId);
    const chatSnap = await getDoc(chatRef);
    if (!chatSnap.exists()) {
      await setDoc(chatRef, {
        comunidad_id:        comunidadId,
        vigilante_id:        vigilanteId,
        vecino_id:           vecinoId,
        vecino_nombre:       vecinoNombre,
        ultimo_mensaje:      '',
        no_leidos_vigilante: 0,
        no_leidos_vecino:    0,
        updated_at:          new Date().toISOString(),
      });
    }
  }

  async function sendMessage(text: string, tipo: 'texto' | 'plantilla' = 'texto', plantillaTipo?: string) {
    if (!text.trim() || sending) return;
    setSending(true);

    try {
      await ensureChatDoc();

      const chatRef = doc(db, 'chats_vigilancia', chatId);

      await addDoc(collection(db, 'chats_vigilancia', chatId, 'mensajes'), {
        sender_id:  vigilanteId,
        texto:      text.trim(),
        tipo,
        ...(plantillaTipo ? { plantilla_tipo: plantillaTipo } : {}),
        leido:      false,
        created_at: new Date().toISOString(),
      });

      await updateDoc(chatRef, {
        ultimo_mensaje:   text.trim().slice(0, 100),
        no_leidos_vecino: (mensajes.filter(m => m.sender_id === vigilanteId && !m.leido).length + 1),
        updated_at:       new Date().toISOString(),
      });

      setTexto('');
      setShowPlantillas(false);
    } catch (err) {
      console.error('[Chat] Error enviando mensaje:', err);
      toast.error('Error al enviar — despliega las reglas de Firestore (firebase deploy --only firestore:rules)');
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
    emergencia: AlertTriangle, vehiculo: Car, correspondencia: Mail, tecnico: Wrench, domicilio: ShoppingBag,
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
            Mensajes rapidos
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
        <div ref={scrollRef} className="h-80 overflow-y-auto space-y-2 rounded-xl bg-gray-50 p-3">
          {mensajes.length === 0 && (
            <div className="text-center py-12 space-y-2">
              <Send className="w-8 h-8 text-muted-foreground mx-auto opacity-40" />
              <p className="text-xs text-muted-foreground">No hay mensajes con este residente.</p>
              <p className="text-xs text-muted-foreground">Usa los mensajes rapidos o escribe directamente.</p>
            </div>
          )}

          {mensajes.map((msg) => {
            const mine        = isMine(msg);
            const PlantillaIcon = msg.plantilla_tipo ? plantillaIconMap[msg.plantilla_tipo] : null;

            return (
              <div key={msg.id} className={cn('flex gap-2', mine ? 'flex-row-reverse' : 'flex-row')}>
                {/* Avatar */}
                <div className="shrink-0">
                  {!mine && hasVecinoPhoto ? (
                    // Foto real del vecino
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
                    <div className={cn(
                      'w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold',
                      mine ? 'bg-finca-peach/40 text-finca-coral' : 'bg-finca-peach text-finca-coral',
                    )}>
                      {mine ? (perfil?.nombre_completo?.[0]?.toUpperCase() ?? 'V') : vecinoNombre[0]?.toUpperCase()}
                    </div>
                  )}
                </div>

                {/* Burbuja */}
                <div className={cn(
                  'max-w-[75%] rounded-2xl px-3 py-2',
                  mine
                    ? 'bg-finca-coral text-white rounded-br-md'
                    : 'bg-white border border-border rounded-bl-md',
                )}>
                  {/* Plantilla badge */}
                  {msg.tipo === 'plantilla' && PlantillaIcon && (
                    <div className={cn(
                      'flex items-center gap-1 mb-1 text-[10px] font-medium',
                      mine ? 'text-white/70' : 'text-finca-coral',
                    )}>
                      <PlantillaIcon className="w-3 h-3" />
                      {msg.plantilla_tipo}
                    </div>
                  )}

                  <p className={cn('text-sm', mine ? 'text-white' : 'text-finca-dark')}>
                    {msg.texto}
                  </p>

                  <span className={cn('text-[9px] block mt-1', mine ? 'text-white/60' : 'text-muted-foreground')}>
                    {msg.created_at ? format(new Date(msg.created_at), 'HH:mm', { locale: es }) : ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Input */}
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="w-8 h-8 opacity-40 cursor-not-allowed" disabled title="Proximamente">
              <Mic className="w-4 h-4 text-muted-foreground" />
            </Button>
            <Button variant="ghost" size="icon" className="w-8 h-8 opacity-40 cursor-not-allowed" disabled title="Proximamente">
              <Phone className="w-4 h-4 text-muted-foreground" />
            </Button>
            <Button variant="ghost" size="icon" className="w-8 h-8 opacity-40 cursor-not-allowed" disabled title="Proximamente">
              <Video className="w-4 h-4 text-muted-foreground" />
            </Button>
            <span className="text-[10px] text-muted-foreground ml-1">Proximamente</span>
          </div>

          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              placeholder="Escribe un mensaje..."
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
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
