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
import { BotMessageSquare, X, Send, Loader2, ChevronDown } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

const WELCOME: Message = {
  role: 'assistant',
  text: '¡Hola! Soy el asistente de tu comunidad. Puedo informarte sobre incidencias, cuotas pendientes, votaciones activas y más. ¿En qué te puedo ayudar?',
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

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
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
        role: 'assistant',
        text: data.reply ?? 'No se pudo obtener respuesta. Inténtalo de nuevo.',
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

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
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
        <div className="bg-white rounded-2xl shadow-2xl border border-border/60 flex flex-col overflow-hidden"
             style={{ height: '420px' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-finca-coral to-finca-salmon shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
                <BotMessageSquare className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white leading-none">Asistente IA</p>
                <p className="text-[10px] text-white/80 mt-0.5">Datos en tiempo real</p>
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
                <div className={cn(
                  'max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-snug',
                  msg.role === 'user'
                    ? 'bg-finca-coral text-white rounded-br-sm'
                    : 'bg-gray-100 text-finca-dark rounded-bl-sm',
                )}>
                  {msg.text}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="w-6 h-6 rounded-full bg-finca-peach flex items-center justify-center mr-1.5 shrink-0">
                  <BotMessageSquare className="w-3.5 h-3.5 text-finca-coral" />
                </div>
                <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-3 py-2.5 flex items-center gap-1">
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

          {/* Input */}
          <div className="px-3 pb-3 pt-2 border-t border-border/40 shrink-0">
            <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2 border border-border/60 focus-within:border-finca-coral/60 transition-colors">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Escribe tu pregunta…"
                disabled={loading}
                className="flex-1 bg-transparent text-sm text-finca-dark placeholder:text-muted-foreground outline-none min-w-0"
              />
              <button
                onClick={send}
                disabled={loading || !input.trim()}
                className={cn(
                  'w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0',
                  input.trim() && !loading
                    ? 'bg-finca-coral text-white hover:bg-finca-salmon'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed',
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

      {/* ── Floating button ── */}
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'fixed bottom-20 right-3 z-50 w-13 h-13 rounded-full shadow-lg',
          'flex items-center justify-center transition-all duration-300',
          open
            ? 'bg-gray-800 scale-90'
            : 'bg-gradient-to-br from-finca-coral to-finca-salmon hover:scale-110 active:scale-95',
        )}
        style={{ width: 52, height: 52 }}
        aria-label="Abrir asistente IA"
      >
        {open
          ? <X className="w-5 h-5 text-white" />
          : <BotMessageSquare className="w-5 h-5 text-white" />
        }
      </button>
    </>
  );
}
