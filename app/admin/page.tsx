'use client';

import { useEffect, useState } from 'react';
import { CircleAlert as AlertCircle, CircleCheck as CheckCircle2, Users, TrendingUp, Clock, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { db } from '@/lib/firebase/client';
import { collection, query, where, orderBy, getDocs, doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { Incidencia } from '@/types/database';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { PatternAlertWidget }       from '@/components/ai/PatternAlertWidget';
import { ZonaMetricsWidget }        from '@/components/ai/ZonaMetricsWidget';
import { ProveedorRankingWidget }   from '@/components/ai/ProveedorRankingWidget';

const estadoConfig: Record<string, { label: string; color: string }> = {
  pendiente:    { label: 'Pendiente',    color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  en_revision:  { label: 'En revisión',  color: 'bg-blue-100 text-blue-700 border-blue-200' },
  presupuestada:{ label: 'Presupuestada', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  aprobada:     { label: 'Aprobada',     color: 'bg-teal-100 text-teal-700 border-teal-200' },
  en_ejecucion: { label: 'En ejecución', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  resuelta:     { label: 'Resuelta',     color: 'bg-green-100 text-green-700 border-green-200' },
  cerrada:      { label: 'Cerrada',      color: 'bg-gray-100 text-gray-500 border-gray-200' },
};

export default function AdminDashboard() {
  const { perfil } = useAuth();
  const [incidencias, setIncidencias] = useState<Incidencia[]>([]);
  const [vecinos, setVecinos] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (perfil?.comunidad_id) fetchData();
  }, [perfil?.comunidad_id]);

  async function fetchData() {
    const cid = perfil!.comunidad_id!;

    // ── Step 1: fetch incidencias + vecino count in parallel ─────────────────
    const [incSnap, vecSnap] = await Promise.all([
      getDocs(query(
        collection(db, 'incidencias'),
        where('comunidad_id', '==', cid),
        orderBy('created_at', 'desc'),
      )),
      getDocs(query(
        collection(db, 'perfiles'),
        where('comunidad_id', '==', cid),
      )),
    ]);

    // ── Step 2: build raw list (no author data yet) ───────────────────────────
    const rawList = incSnap.docs.map(d => ({ id: d.id, ...d.data() } as Incidencia));

    // ── Step 3: collect author IDs that are NOT already denormalized ──────────
    // New incidencias have autor_nombre written at creation time → zero extra reads.
    // Legacy docs without autor_nombre need a profile fetch.
    const missingAutorIds = Array.from(
      new Set(
        rawList
          .filter(inc => !inc.autor_nombre && inc.autor_id)
          .map(inc => inc.autor_id as string),
      ),
    );

    // ── Step 4: fetch missing profiles in parallel (one read per unique author) ─
    const perfilMap = new Map<string, Record<string, unknown>>();

    if (missingAutorIds.length > 0) {
      const perfilSnaps = await Promise.all(
        missingAutorIds.map(id => getDoc(doc(db, 'perfiles', id))),
      );
      perfilSnaps.forEach(snap => {
        if (snap.exists()) perfilMap.set(snap.id, snap.data() as Record<string, unknown>);
      });
    }

    // ── Step 5: inject author data without any extra queries ──────────────────
    const incList: Incidencia[] = rawList.map(inc => {
      // Prefer denormalized name (no extra read), fall back to fetched profile
      if (inc.autor_nombre) return inc;

      const perfilData = inc.autor_id ? perfilMap.get(inc.autor_id) : undefined;
      if (perfilData) {
        return {
          ...inc,
          autor: { id: inc.autor_id, ...perfilData } as any,
        };
      }
      return inc;
    });

    setIncidencias(incList);
    setVecinos(vecSnap.size);
    setLoading(false);
  }

  const abiertas = incidencias.filter((i) => !['resuelta', 'cerrada'].includes(i.estado)).length;
  const resueltas = incidencias.filter((i) => i.estado === 'resuelta').length;
  const urgentes = incidencias.filter((i) => i.prioridad === 'urgente' && !['resuelta', 'cerrada'].includes(i.estado)).length;

  const chartData = [
    { name: 'Pend.', value: incidencias.filter((i) => i.estado === 'pendiente').length, fill: '#f59e0b' },
    { name: 'Revisión', value: incidencias.filter((i) => i.estado === 'en_revision').length, fill: '#3b82f6' },
    { name: 'Ejecución', value: incidencias.filter((i) => i.estado === 'en_ejecucion').length, fill: '#8b5cf6' },
    { name: 'Resueltas', value: resueltas, fill: '#22c55e' },
  ];

  const kpis = [
    { icon: AlertCircle, label: 'Abiertas', value: abiertas, color: 'text-yellow-600', bg: 'bg-yellow-50' },
    { icon: CheckCircle2, label: 'Resueltas', value: resueltas, color: 'text-green-600', bg: 'bg-green-50' },
    { icon: Users, label: 'Vecinos', value: vecinos, color: 'text-blue-600', bg: 'bg-blue-50' },
    { icon: TrendingUp, label: 'Urgentes', value: urgentes, color: 'text-red-600', bg: 'bg-red-50' },
  ];

  if (loading) {
    return (
      <div className="space-y-6 max-w-5xl">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32 mt-1" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-3">
                <Skeleton className="w-9 h-9 rounded-lg" />
                <Skeleton className="h-7 w-12" />
                <Skeleton className="h-3 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-6">
            <Skeleton className="h-[180px] w-full rounded-lg" />
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="px-4 py-3 flex items-center gap-3 border-b border-border/50 last:border-0">
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-finca-dark">Panel de control</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {(perfil?.comunidad as any)?.nombre || 'Tu comunidad'}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center mb-3', kpi.bg)}>
                <kpi.icon className={cn('w-5 h-5', kpi.color)} />
              </div>
              <p className="text-2xl font-bold text-finca-dark">{kpi.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{kpi.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <PatternAlertWidget />

      <ZonaMetricsWidget />

      <ProveedorRankingWidget />

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-finca-dark">Estado de incidencias</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} barSize={32}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#888' }} />
              <YAxis tick={{ fontSize: 11, fill: '#888' }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: 12 }}
              />
              <Bar dataKey="value" name="Incidencias" fill="#FF6157" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold text-finca-dark">Incidencias recientes</CardTitle>
          <Button variant="ghost" size="sm" asChild className="text-finca-coral">
            <Link href="/admin/incidencias">
              Ver todas <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {incidencias.slice(0, 8).map((inc, idx) => {
            const estado = estadoConfig[inc.estado] || estadoConfig.pendiente;
            return (
              <div key={inc.id} className={cn('px-4 py-3 flex items-center gap-3', idx < 7 && 'border-b border-border/50')}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-finca-dark truncate">{inc.titulo}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">
                      {(inc.autor_nombre ?? (inc.autor as any)?.nombre_completo ?? '').split(' ')[0]}
                    </span>
                    <span className="text-muted-foreground text-xs">•</span>
                    <span className="text-xs text-muted-foreground">{format(new Date(inc.created_at), 'd MMM', { locale: es })}</span>
                  </div>
                </div>
                <Badge className={cn('text-[10px] border shrink-0', estado.color)}>{estado.label}</Badge>
              </div>
            );
          })}
          {incidencias.length === 0 && (
            <div className="py-8 text-center text-muted-foreground text-sm">No hay incidencias registradas</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
