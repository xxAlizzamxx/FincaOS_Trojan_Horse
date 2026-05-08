'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, MessageCircle, Plus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { Skeleton } from '@/components/ui/skeleton';

interface ChatVecino {
  id: string;
  participantes: string[];
  participantes_info?: Record<string, { nombre: string; avatar?: string }>;
  ultimo_mensaje?: string;
  ultimo_mensaje_at?: string;
}

export default function ChatsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [chats, setChats] = useState<ChatVecino[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(
      collection(db, 'chats_vecinos'),
      where('participantes', 'array-contains', user.uid),
      orderBy('ultimo_mensaje_at', 'desc'),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setChats(snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatVecino)));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, [user?.uid]);

  return (
    <div className="px-4 py-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="w-8 h-8 -ml-1" onClick={() => router.back()}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold text-finca-dark">Mensajes</h1>
            <p className="text-xs text-muted-foreground">Chat con vecinos</p>
          </div>
        </div>
        <Button
          size="sm"
          className="bg-finca-coral text-white hover:bg-finca-coral/90"
          onClick={() => router.push('/vecinos')}
        >
          <Plus className="w-4 h-4 mr-1" />
          Nuevo
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-3 flex items-center gap-3">
                <Skeleton className="w-10 h-10 rounded-full" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : chats.length === 0 ? (
        <div className="py-16 text-center space-y-3">
          <MessageCircle className="w-12 h-12 text-muted-foreground/30 mx-auto" />
          <p className="font-medium text-finca-dark">Sin conversaciones</p>
          <p className="text-sm text-muted-foreground">
            Toca &quot;Nuevo&quot; para enviar un mensaje a un vecino
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {chats.map(chat => {
            const otroId = chat.participantes.find(p => p !== user?.uid) ?? '';
            const otroInfo = chat.participantes_info?.[otroId];
            return (
              <Card
                key={chat.id}
                className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => router.push(`/chats/${chat.id}`)}
              >
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-finca-peach/40 flex items-center justify-center shrink-0 text-sm font-bold text-finca-coral">
                    {otroInfo?.nombre?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-finca-dark">
                      {otroInfo?.nombre ?? 'Vecino'}
                    </p>
                    {chat.ultimo_mensaje && (
                      <p className="text-xs text-muted-foreground truncate">{chat.ultimo_mensaje}</p>
                    )}
                  </div>
                  {chat.ultimo_mensaje_at && (
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatDistanceToNow(new Date(chat.ultimo_mensaje_at), {
                        locale: es,
                        addSuffix: false,
                      })}
                    </span>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
