'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Bell, BellOff, CheckCheck, Eye, CircleCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  collection, query, where, orderBy, getDocs, getDoc,
  updateDoc, doc, writeBatch,
  QueryDocumentSnapshot, DocumentData,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

function parseNotif(notif: Notificacion): { reporter: string; incTitle: string } {
  const isOld = notif.titulo === 'Nueva incidencia';
  if (isOld && notif.mensaje) {
    const sepIdx = notif.mensaje.indexOf(' reportó: ');
    if (sepIdx !== -1) {
      return {
        reporter: notif.mensaje.slice(0, sepIdx).trim(),
        incTitle: notif.mensaje.slice(sepIdx + ' reportó: '.length).trim(),
      };
    }
    return { reporter: '', incTitle: notif.mensaje };
  }
  const reporter = notif.mensaje?.replace('Reportado por ', '').trim() ?? '';
  return { reporter, incTitle: notif.titulo };
}

/* ─── Categorías hardcodeadas (mismas que en crear incidencia) ─── */
const CATEGORIAS: Record<string, string> = {
  filtraciones: 'Filtraciones',
  altavoces:    'Altavoces',
  mascotas:     'Mascotas',
  parking:      'Parking',
  obras:        'Obras',
  otros:        'Otros',
};

const PRIORIDAD_COLOR: Record<string, string> = {
  baja:    'bg-gray-100 text-gray-600',
  normal:  'bg-blue-100 text-blue-700',
  alta:    'bg-orange-100 text-orange-700',
  urgente: 'bg-red-100 text-red-700',
};

const PRIORIDAD_LABEL: Record<string, string> = {
  baja: 'Baja', normal: 'Normal', alta: 'Alta', urgente: 'Urgente',
};

const TIPO_COLOR: Record<string, string> = {
  incidencia: 'bg-orange-100 text-orange-700',
  estado:     'bg-blue-100 text-blue-700',
  comentario: 'bg-green-100 text-green-700',
  anuncio:    'bg-blue-100 text-blue-700',
  mediacion:  'bg-purple-100 text-purple-700',
  votacion:   'bg-violet-100 text-violet-700',
};

const TIPO_LABEL: Record<string, string> = {
  incidencia: 'Nueva incidencia',
  estado:     'Cambio de estado',
  comentario: 'Nuevo comentario',
  anuncio:    'Anuncio',
  mediacion:  'Mediación',
  votacion:   'Votación',
};

interface Notificacion {
  id: string;
  usuario_id: string;
  tipo: string | null;
  titulo: string;       // título real de la incidencia
  mensaje: string | null; // "Reportado por X"
  link: string | null;
  leida: boolean;
  created_at: string;
}

interface DetalleIncidencia {
  id: string;
  titulo: string;
  descripcion: string | null;
  categoria_id: string | null;
  ubicacion: string | null;
  prioridad: string;
  estado: string;
}

function getIncidenciaId(link: string | null): string | null {
  if (!link) return null;
  const parts = link.split('/');
  const idx = parts.indexOf('incidencias');
  return idx !== -1 && parts[idx + 1] ? parts[idx + 1] : null;
}

export default function NotificacionesPage() {
  const { perfil } = useAuth();
  const router = useRouter();

  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [marcandoTodas, setMarcandoTodas] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [notifActiva, setNotifActiva] = useState<Notificacion | null>(null);
  const [detalle, setDetalle] = useState<DetalleIncidencia | null>(null);
  const [loadingDetalle, setLoadingDetalle] = useState(false);

  useEffect(() => {
    if (perfil?.id) fetchNotificaciones();
  }, [perfil?.id]);

  async function fetchNotificaciones() {
    try {
      const q = query(
        collection(db, 'notificaciones'),
        where('usuario_id', '==', perfil!.id),
        orderBy('created_at', 'desc')
      );
      const snap = await getDocs(q);
      setNotificaciones(snap.docs.map((d: QueryDocumentSnapshot<DocumentData>) => ({ id: d.id, ...d.data() } as Notificacion)));
    } catch {
      toast.error('Error al cargar las notificaciones');
    } finally {
      setLoading(false);
    }
  }

  async function marcarLeida(id: string) {
    try {
      await updateDoc(doc(db, 'notificaciones', id), { leida: true });
      setNotificaciones((prev) => prev.map((n) => n.id === id ? { ...n, leida: true } : n));
    } catch {
      toast.error('Error al marcar como leída');
    }
  }

  async function marcarTodasLeidas() {
    const noLeidas = notificaciones.filter((n) => !n.leida);
    if (!noLeidas.length) return;
    setMarcandoTodas(true);
    try {
      const batch = writeBatch(db);
      noLeidas.forEach((n) => batch.update(doc(db, 'notificaciones', n.id), { leida: true }));
      await batch.commit();
      setNotificaciones((prev) => prev.map((n) => ({ ...n, leida: true })));
      toast.success('Todas marcadas como leídas');
    } catch {
      toast.error('Error al actualizar');
    } finally {
      setMarcandoTodas(false);
    }
  }

  async function verDetalle(notif: Notificacion) {
    setNotifActiva(notif);
    setDetalle(null);
    setSheetOpen(true);
    if (!notif.leida) marcarLeida(notif.id);

    const incidenciaId = getIncidenciaId(notif.link);
    if (!incidenciaId) return;

    setLoadingDetalle(true);
    try {
      const snap = await getDoc(doc(db, 'incidencias', incidenciaId));
      if (snap.exists()) setDetalle({ id: snap.id, ...snap.data() } as DetalleIncidencia);
    } catch {
      toast.error('No se pudo cargar el detalle');
    } finally {
      setLoadingDetalle(false);
    }
  }

  const noLeidas = notificaciones.filter((n) => !n.leida).length;

  if (loading) {
    return (
      <div className="px-4 py-5 space-y-4">
        <Skeleton className="h-8 w-40" />
        {[1, 2, 3].map((i) => (
          <Card key={i} className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-7 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="px-4 py-5 space-y-4">
      {/* Header */}
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
          <Button
            variant="outline" size="sm" onClick={marcarTodasLeidas} disabled={marcandoTodas}
            className="text-xs border-finca-coral text-finca-coral hover:bg-finca-coral hover:text-white"
          >
            {marcandoTodas
              ? <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-1.5" />
              : <CheckCheck className="w-3.5 h-3.5 mr-1.5" />}
            Leer todas
          </Button>
        )}
      </div>

      {/* Lista */}
      {notificaciones.length === 0 ? (
        <div className="py-16 text-center space-y-3">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <BellOff className="w-7 h-7 text-muted-foreground/50" />
          </div>
          <p className="font-medium text-finca-dark">Sin notificaciones</p>
          <p className="text-sm text-muted-foreground">Aquí aparecerán las actualizaciones de tu comunidad</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notificaciones.map((notif) => {
            const { reporter, incTitle } = parseNotif(notif);
            return (
              <Card
                key={notif.id}
                className={cn('border-0 shadow-sm', !notif.leida && 'border-l-4 border-l-finca-coral bg-finca-peach/5')}
              >
                <CardContent className="p-4 space-y-2">
                  {/* Tipo + tiempo */}
                  <div className="flex items-center justify-between gap-2">
                    <Badge className={cn('text-[10px] border-0', TIPO_COLOR[notif.tipo ?? ''] ?? 'bg-gray-100 text-gray-600')}>
                      {TIPO_LABEL[notif.tipo ?? ''] ?? 'Notificación'}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true, locale: es })}
                    </span>
                  </div>

                  {/* Quién reportó */}
                  {reporter && (
                    <p className="text-xs text-muted-foreground">Reportado por {reporter}</p>
                  )}

                  {/* Título de la incidencia */}
                  <p className={cn('text-sm leading-snug', notif.leida ? 'text-muted-foreground' : 'font-semibold text-finca-dark')}>
                    {incTitle}
                  </p>

                  {/* Acciones */}
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-finca-coral hover:bg-finca-coral/90 text-white px-3"
                      onClick={() => verDetalle(notif)}
                    >
                      <Eye className="w-3 h-3 mr-1.5" />
                      Ver
                    </Button>
                    {!notif.leida && (
                      <Button
                        size="sm" variant="outline"
                        className="h-7 text-xs px-3 border-finca-coral text-finca-coral hover:bg-finca-coral hover:text-white"
                        onClick={() => marcarLeida(notif.id)}
                      >
                        <CircleCheck className="w-3 h-3 mr-1.5" />
                        Leída
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Sheet detalle */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[80vh] overflow-y-auto">
          <SheetHeader className="pb-3">
            <SheetTitle className="text-left text-finca-dark">Detalle de incidencia</SheetTitle>
          </SheetHeader>

          {(() => {
            const parsed = notifActiva ? parseNotif(notifActiva) : null;
            return loadingDetalle ? (
              <div className="space-y-3 py-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : (
              <div className="space-y-4 pb-6">
                <p className="font-bold text-lg text-finca-dark leading-snug">
                  {detalle?.titulo ?? parsed?.incTitle}
                </p>

                {parsed?.reporter && (
                  <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-xl">
                    <div className="w-8 h-8 rounded-full bg-finca-peach/60 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-finca-coral">
                        {parsed.reporter.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Reportado por</p>
                      <p className="text-sm font-medium text-finca-dark">{parsed.reporter}</p>
                    </div>
                  </div>
                )}

                <Separator />

                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Descripción</p>
                  <p className="text-sm text-finca-dark leading-relaxed">
                    {detalle?.descripcion ?? 'Sin descripción'}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-muted/50 rounded-xl p-3">
                    <p className="text-xs text-muted-foreground mb-1">Categoría</p>
                    <p className="text-sm font-medium text-finca-dark">
                      {detalle?.categoria_id ? (CATEGORIAS[detalle.categoria_id] ?? detalle.categoria_id) : '—'}
                    </p>
                  </div>
                  <div className="bg-muted/50 rounded-xl p-3">
                    <p className="text-xs text-muted-foreground mb-1">Urgencia</p>
                    {detalle ? (
                      <Badge className={cn('text-xs border-0', PRIORIDAD_COLOR[detalle.prioridad] ?? 'bg-gray-100 text-gray-600')}>
                        {PRIORIDAD_LABEL[detalle.prioridad] ?? detalle.prioridad}
                      </Badge>
                    ) : <p className="text-sm text-finca-dark">—</p>}
                  </div>
                </div>

                <div className="bg-muted/50 rounded-xl p-3">
                  <p className="text-xs text-muted-foreground mb-1">Dónde</p>
                  <p className="text-sm font-medium text-finca-dark">{detalle?.ubicacion ?? '—'}</p>
                </div>

                {detalle && (
                  <Button
                    className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white"
                    onClick={() => { setSheetOpen(false); router.push(`/incidencias/${detalle.id}`); }}
                  >
                    Ver incidencia completa
                  </Button>
                )}
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}
