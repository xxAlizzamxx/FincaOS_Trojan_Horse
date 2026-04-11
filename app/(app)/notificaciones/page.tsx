'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Bell, CircleAlert as AlertCircle, MessageSquare, Megaphone, Scale, Vote, Check } from 'lucide-react';
import { collection, query, where, orderBy, getDocs, updateDoc, doc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface Notificacion {
  id: string;
  tipo: string;
  titulo: string;
  mensaje: string;
  leida: boolean;
  link?: string;
  created_at: string;
}

const tipoConfig: Record<string, { icon: any; color: string }> = {
  incidencia: { icon: AlertCircle, color: 'bg-yellow-100 text-yellow-600' },
  estado: { icon: AlertCircle, color: 'bg-blue-100 text-blue-600' },
  comentario: { icon: MessageSquare, color: 'bg-purple-100 text-purple-600' },
  anuncio: { icon: Megaphone, color: 'bg-green-100 text-green-600' },
  mediacion: { icon: Scale, color: 'bg-orange-100 text-orange-600' },
  votacion: { icon: Vote, color: 'bg-teal-100 text-teal-600' },
};

export default function NotificacionesPage() {
  const router = useRouter();
  const { perfil } = useAuth();
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (perfil?.id) fetchNotificaciones();
  }, [perfil?.id]);

  async function fetchNotificaciones() {
    const q = query(
      collection(db, 'notificaciones'),
      where('usuario_id', '==', perfil!.id),
      orderBy('created_at', 'desc')
    );
    const snap = await getDocs(q);
    setNotificaciones(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Notificacion)));
    setLoading(false);
  }

  async function marcarTodasLeidas() {
    const noLeidas = notificaciones.filter((n) => !n.leida);
    const batch = writeBatch(db);
    noLeidas.forEach((n) => batch.update(doc(db, 'notificaciones', n.id), { leida: true }));
    await batch.commit();
    setNotificaciones((prev) => prev.map((n) => ({ ...n, leida: true })));
  }

  async function handleClick(notif: Notificacion) {
    if (!notif.leida) {
      await updateDoc(doc(db, 'notificaciones', notif.id), { leida: true });
      setNotificaciones((prev) => prev.map((n) => n.id === notif.id ? { ...n, leida: true } : n));
    }
    if (notif.link) router.push(notif.link);
  }

  const noLeidas = notificaciones.filter((n) => !n.leida).length;

  if (loading) {
    return (
      <div className="px-4 py-5 space-y-4">
        <Skeleton className="h-8 w-40" />
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="border-0 shadow-sm">
            <CardContent className="p-4 flex gap-3">
              <Skeleton className="w-10 h-10 rounded-xl" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-20" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="px-4 py-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()} className="w-8 h-8 -ml-1">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-finca-dark">Notificaciones</h1>
            {noLeidas > 0 && <p className="text-xs text-muted-foreground">{noLeidas} sin leer</p>}
          </div>
        </div>
        {noLeidas > 0 && (
          <Button variant="ghost" size="sm" className="text-finca-coral text-xs" onClick={marcarTodasLeidas}>
            <Check className="w-3.5 h-3.5 mr-1" />
            Marcar todas
          </Button>
        )}
      </div>

      {notificaciones.length === 0 ? (
        <div className="py-16 text-center space-y-3">
          <Bell className="w-12 h-12 text-muted-foreground/30 mx-auto" />
          <p className="font-medium text-finca-dark">Sin notificaciones</p>
          <p className="text-sm text-muted-foreground">Aquí aparecerán las actualizaciones de tu comunidad</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notificaciones.map((notif) => {
            const config = tipoConfig[notif.tipo] || tipoConfig.incidencia;
            const Icon = config.icon;
            return (
              <button key={notif.id} onClick={() => handleClick(notif)} className="w-full text-left">
                <Card className={cn('border-0 shadow-sm transition-all hover:shadow-md', !notif.leida && 'border-l-4 border-l-finca-coral bg-finca-peach/5')}>
                  <CardContent className="p-3 flex gap-3">
                    <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', config.color)}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-sm truncate', !notif.leida ? 'font-semibold text-finca-dark' : 'font-medium text-muted-foreground')}>{notif.titulo}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{notif.mensaje}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true, locale: es })}
                      </p>
                    </div>
                    {!notif.leida && <div className="w-2 h-2 bg-finca-coral rounded-full shrink-0 mt-2" />}
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
