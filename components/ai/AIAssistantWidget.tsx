'use client';

/**
 * AIAssistantWidget
 *
 * Floating chat bubble that gives every user access to the community AI
 * assistant. Answers questions about incidencias, cuotas, votaciones, and
 * anuncios using REAL Firestore data via /api/ai/chat.
 *
 * - Positioned above the BottomTabBar (bottom-20)
 * - Opens as a slide-up panel
 * - Message history kept in local state (session only)
 * - Sends Firebase ID token with every request
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { BotMessageSquare, Send, Loader2, ChevronDown, CheckCircle2, ExternalLink, Receipt, Vote, Megaphone, AlertTriangle, Scale, BookOpen, Package, DoorOpen, ShieldAlert, Bell, CalendarDays } from 'lucide-react';
import Link from 'next/link';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  incidencia_id?: string; // set when IA auto-created an incidencia
}

const WELCOME: Message = {
  role: 'assistant',
  text: '¡Hola! Soy el Vecino Virtual de tu comunidad. Puedo informarte sobre incidencias, cuotas pendientes, votaciones activas y más. ¿En qué te puedo ayudar?',
};

export function AIAssistantWidget() {
  const { user, perfil } = useAuth();

  const [open,     setOpen]     = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input,    setInput]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);

  const comunidadId = perfil?.comunidad_id;
  const rol         = (perfil as any)?.rol ?? 'vecino';

  const QUICK_ACTIONS_VECINO = [
    { label: '¿Debo cuotas?',        icon: Receipt,       message: '¿Tengo cuotas pendientes?' },
    { label: '¿Hay votaciones?',      icon: Vote,          message: '¿Hay votaciones activas?' },
    { label: 'Anuncios',              icon: Megaphone,     message: '¿Cuáles son los últimos anuncios?' },
    { label: 'Mis incidencias',       icon: AlertTriangle, message: '¿Qué incidencias tengo abiertas?' },
    { label: 'Calendario',            icon: CalendarDays,  message: '¿Qué eventos hay en el calendario este mes? Incluye cuotas con fecha límite, votaciones activas y cualquier evento importante de la comunidad.' },
    { label: 'Normativa',             icon: Scale,         message: '¿Qué dice la normativa sobre ruidos y horarios?' },
    { label: 'Resumen comunidad',     icon: BookOpen,      message: 'Dame un resumen del estado de mi comunidad' },
    { label: 'Actividad en portería', icon: Bell,          message: '¿Qué hay pendiente en portería? Paquetes, visitas o recibos.' },
  ];

  const QUICK_ACTIONS_VIGILANTE = [
    { label: 'Actividad en portería', icon: Bell,          message: '¿Qué hay pendiente en portería? Paquetes, visitas o recibos.' },
    { label: '¿Alertas activas?',     icon: ShieldAlert,   message: '¿Qué alertas comunitarias están activas?' },
    { label: 'Incidencias abiertas',  icon: AlertTriangle, message: '¿Qué incidencias hay abiertas en la comunidad?' },
    { label: 'Resumen del turno',     icon: BookOpen,      message: 'Dame un resumen del estado de mi comunidad' },
    { label: 'Normativa de accesos',  icon: Scale,         message: '¿Cuál es la normativa para el control de accesos y visitantes?' },
  ];

  const QUICK_ACTIONS = rol === 'vigilante' ? QUICK_ACTIONS_VIGILANTE : QUICK_ACTIONS_VECINO;

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  // Don't render if user has no community
  if (!comunidadId) return null;

  const send = useCallback(async (directText?: string) => {
    const text = (directText ?? input).trim();
    if (!text || loading) return;

    if (!directText) setInput('');
    setMessages(prev => [...prev, { role: 'user', text }]);
    setLoading(true);

    try {
      const token = await user!.getIdToken();
      const res   = await fetch('/api/ai/chat', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ message: text, comunidadId, rol }),
      });

      const data = await res.json();
      setMessages(prev => [...prev, {
        role:         'assistant',
        text:         data.reply ?? 'No se pudo obtener respuesta. Inténtalo de nuevo.',
        incidencia_id: data.incidencia_creada ? data.incidencia_id : undefined,
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: 'Error de conexión. Comprueba tu internet e inténtalo de nuevo.',
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, user, comunidadId, rol]);

  const showQuickActions = !loading;

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  return (
    <>
      {/* ── Chat panel ── */}
      <div className={cn(
        'fixed bottom-20 right-3 z-50 w-[calc(100vw-24px)] max-w-sm',
        'transition-all duration-300 ease-in-out origin-bottom-right',
        open
          ? 'opacity-100 scale-100 pointer-events-auto'
          : 'opacity-0 scale-90 pointer-events-none',
      )}>
        <div className="bg-card rounded-2xl shadow-2xl border border-border/60 flex flex-col overflow-hidden"
             style={{ height: '420px' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-finca-coral to-finca-salmon shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
                <BotMessageSquare className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white leading-none">Vecino Virtual</p>
                <p className="text-[10px] text-white/80 mt-0.5">Tu asistente de comunidad</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors"
            >
              <ChevronDown className="w-4 h-4 text-white" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {messages.map((msg, i) => (
              <div key={i} className={cn(
                'flex',
                msg.role === 'user' ? 'justify-end' : 'justify-start',
              )}>
                {msg.role === 'assistant' && (
                  <div className="w-6 h-6 rounded-full bg-finca-peach flex items-center justify-center mr-1.5 shrink-0 mt-0.5">
                    <BotMessageSquare className="w-3.5 h-3.5 text-finca-coral" />
                  </div>
                )}
                <div className="flex flex-col gap-1.5 max-w-[80%]">
                  <div className={cn(
                    'rounded-2xl px-3 py-2 text-sm leading-snug',
                    msg.role === 'user'
                      ? 'bg-finca-coral text-white rounded-br-sm'
                      : 'bg-muted text-foreground rounded-bl-sm',
                  )}>
                    {msg.text}
                  </div>
                  {/* ── Incidencia created confirmation ── */}
                  {msg.incidencia_id && (
                    <Link
                      href={`/incidencias/${msg.incidencia_id}`}
                      onClick={() => setOpen(false)}
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1 hover:bg-emerald-100 transition-colors self-start"
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      Incidencia creada
                      <ExternalLink className="w-2.5 h-2.5" />
                    </Link>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="w-6 h-6 rounded-full bg-finca-peach flex items-center justify-center mr-1.5 shrink-0">
                  <BotMessageSquare className="w-3.5 h-3.5 text-finca-coral" />
                </div>
                <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2.5 flex items-center gap-1">
                  {[0, 150, 300].map(delay => (
                    <span
                      key={delay}
                      className="w-1.5 h-1.5 bg-finca-coral/60 rounded-full animate-bounce"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Quick action chips — always visible above input */}
          {showQuickActions && (
            <div className="px-3 pt-2 pb-1 border-t border-border/40 shrink-0">
              <div className="flex flex-wrap gap-1.5">
                {QUICK_ACTIONS.map(({ label, icon: Icon, message }) => (
                  <button
                    key={label}
                    onClick={() => send(message)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-finca-coral bg-finca-peach/40 hover:bg-finca-peach/70 border border-finca-coral/20 rounded-full px-2.5 py-1 transition-colors active:scale-95"
                  >
                    <Icon className="w-3 h-3" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="px-3 pb-3 pt-2 shrink-0">
            <div className="flex items-center gap-2 bg-muted/50 rounded-xl px-3 py-2 border border-border/60 focus-within:border-finca-coral/60 transition-colors">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Escribe tu pregunta…"
                disabled={loading}
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none min-w-0"
              />
              <button
                onClick={() => send()}
                disabled={loading || !input.trim()}
                className={cn(
                  'w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0',
                  input.trim() && !loading
                    ? 'bg-finca-coral text-white hover:bg-finca-salmon'
                    : 'bg-muted text-muted-foreground cursor-not-allowed',
                )}
              >
                {loading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Send className="w-3.5 h-3.5" />
                }
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Floating button — hidden when panel is open (header ChevronDown closes it) ── */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-3 z-50 flex items-center justify-center rounded-full shadow-lg bg-gradient-to-br from-finca-coral to-finca-salmon hover:scale-110 active:scale-95 transition-all duration-300"
          style={{ width: 52, height: 52 }}
          aria-label="Abrir Vecino Virtual"
        >
          <BotMessageSquare className="w-5 h-5 text-white" />
        </button>
      )}
    </>
  );
}
