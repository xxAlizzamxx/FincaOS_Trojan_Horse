'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, query, where, getDocs, getDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, AlertCircle, Vote, Receipt, MessageSquare, Scale } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Stats {
  incidenciasCreadas: number;
  incidenciasResueltas: number;
  votosEmitidos: number;
  cuotasPagadas: number;
  cuotasPendientes: number;
  mediacionesIniciadas: number;
  comentariosEscritos: number;
}

export default function EstadisticasPage() {
  const router = useRouter();
  const { user, perfil } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.uid && perfil?.comunidad_id) fetchStats();
  }, [user?.uid, perfil?.comunidad_id]);

  async function fetchStats() {
    const uid = user!.uid;
    const cid = perfil!.comunidad_id!;
    try {
      const [incSnap, votSnap, cuotasSnap, mediSnap, commSnap] = await Promise.all([
        getDocs(query(collection(db, 'incidencias'), where('autor_id', '==', uid), where('comunidad_id', '==', cid))),
        getDocs(query(collection(db, 'votaciones'), where('comunidad_id', '==', cid))),
        getDocs(query(collection(db, 'cuotas'), where('comunidad_id', '==', cid))),
        getDocs(query(collection(db, 'mediaciones'), where('denunciante_id', '==', uid), where('comunidad_id', '==', cid))),
        getDocs(query(collection(db, 'comentarios'), where('autor_id', '==', uid))),
      ]);

      // Count personal votes from subcollections — use getDoc (not where/__name__)
      let votosEmitidos = 0;
      await Promise.all(
        votSnap.docs.map(async d => {
          const votoSnap = await getDoc(doc(db, 'votaciones', d.id, 'votos', uid));
          if (votoSnap.exists()) votosEmitidos++;
        }),
      );

      // Count cuotas pagadas for this user — read individual doc from /pagos subcollection
      let cuotasPagadas = 0;
      let cuotasPendientes = 0;
      await Promise.all(
        cuotasSnap.docs.map(async d => {
          const miPago = await getDoc(doc(db, 'cuotas', d.id, 'pagos', uid));
          if (miPago.exists()) {
            if (miPago.data().estado === 'pagado') cuotasPagadas++;
            else cuotasPendientes++;
          }
        }),
      );

      setStats({
        incidenciasCreadas: incSnap.size,
        incidenciasResueltas: incSnap.docs.filter(d =>
          ['resuelta', 'cerrada'].includes(d.data().estado as string),
        ).length,
        votosEmitidos,
        cuotasPagadas,
        cuotasPendientes,
        mediacionesIniciadas: mediSnap.size,
        comentariosEscritos: commSnap.size,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  const statItems = stats
    ? [
        {
          icon: AlertCircle,
          label: 'Incidencias reportadas',
          value: stats.incidenciasCreadas,
          sub: `${stats.incidenciasResueltas} resueltas`,
          color: 'text-finca-coral',
          bg: 'bg-finca-peach/30',
        },
        {
          icon: Vote,
          label: 'Votos emitidos',
          value: stats.votosEmitidos,
          sub: 'participación activa',
          color: 'text-blue-600',
          bg: 'bg-blue-50',
        },
        {
          icon: Receipt,
          label: 'Cuotas pagadas',
          value: stats.cuotasPagadas,
          sub: `${stats.cuotasPendientes} pendientes`,
          color: 'text-green-600',
          bg: 'bg-green-50',
        },
        {
          icon: Scale,
          label: 'Mediaciones',
          value: stats.mediacionesIniciadas,
          sub: 'conflictos gestionados',
          color: 'text-violet-600',
          bg: 'bg-violet-50',
        },
        {
          icon: MessageSquare,
          label: 'Comentarios',
          value: stats.comentariosEscritos,
          sub: 'en incidencias',
          color: 'text-orange-600',
          bg: 'bg-orange-50',
        },
      ]
    : [];

  return (
    <div className="px-4 py-5 space-y-5 max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="w-8 h-8 -ml-1" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold text-finca-dark">Mis estadísticas</h1>
          <p className="text-xs text-muted-foreground">Tu actividad en la comunidad</p>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {statItems.map(item => (
            <Card key={item.label} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center mb-3', item.bg)}>
                  <item.icon className={cn('w-4 h-4', item.color)} />
                </div>
                <p className="text-2xl font-bold text-finca-dark">{item.value}</p>
                <p className="text-xs font-medium text-finca-dark mt-0.5">{item.label}</p>
                <p className="text-[10px] text-muted-foreground">{item.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
