'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DoorOpen, Package, AlertTriangle, CheckCircle2, TrendingUp, BarChart2,
} from 'lucide-react';
import { subDays, startOfDay, getHours, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  coral:  '#F97150',
  peach:  '#FDBA8C',
  green:  '#22C55E',
  blue:   '#3B82F6',
  red:    '#EF4444',
  amber:  '#F59E0B',
  purple: '#8B5CF6',
  cyan:   '#06B6D4',
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────
type Periodo = 7 | 30 | 90;

interface AccesoRaw {
  estado: string;
  hora_entrada: string;
  tipo?: string;
}
interface PaqueteRaw {
  tipo: string;
  estado: string;
  created_at: string;
}
interface AlertaRaw {
  prioridad: string;
  tipo?: string;
  activa: boolean;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** Build an array of N day-labels (dd/MM) counting back from today */
function buildDayBuckets(n: number): Record<string, number> {
  const map: Record<string, number> = {};
  for (let i = n - 1; i >= 0; i--) {
    map[format(subDays(new Date(), i), 'dd/MM')] = 0;
  }
  return map;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function EstadisticasPage() {
  const { perfil } = useAuth();
  const comunidadId = perfil?.comunidad_id;

  const [periodo, setPeriodo] = useState<Periodo>(7);
  const [loading, setLoading]   = useState(true);
  const [accesos,  setAccesos]  = useState<AccesoRaw[]>([]);
  const [paquetes, setPaquetes] = useState<PaqueteRaw[]>([]);
  const [alertas,  setAlertas]  = useState<AlertaRaw[]>([]);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!comunidadId) return;

    const desde = subDays(startOfDay(new Date()), periodo - 1).toISOString();
    setLoading(true);

    Promise.all([
      getDocs(query(
        collection(db, 'accesos'),
        where('comunidad_id', '==', comunidadId),
        where('hora_entrada', '>=', desde),
      )),
      getDocs(query(
        collection(db, 'paqueteria'),
        where('comunidad_id', '==', comunidadId),
        where('created_at', '>=', desde),
      )),
      getDocs(query(
        collection(db, 'alertas_comunidad'),
        where('comunidad_id', '==', comunidadId),
        where('created_at', '>=', desde),
      )),
    ])
      .then(([accSnap, paqSnap, altSnap]) => {
        setAccesos(accSnap.docs.map(d => d.data() as AccesoRaw));
        setPaquetes(paqSnap.docs.map(d => d.data() as PaqueteRaw));
        setAlertas(altSnap.docs.map(d => d.data() as AlertaRaw));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [comunidadId, periodo]);

  // ── Computed: Accesos ─────────────────────────────────────────────────────
  const accesosXDia = (() => {
    const map = buildDayBuckets(periodo);
    accesos.forEach(a => {
      const key = format(new Date(a.hora_entrada), 'dd/MM');
      if (key in map) map[key]++;
    });
    return Object.entries(map).map(([dia, total]) => ({ dia, total }));
  })();

  const accesosXEstado = (() => {
    const map: Record<string, number> = { autorizado: 0, rechazado: 0, esperando: 0 };
    accesos.forEach(a => { if (a.estado in map) map[a.estado]++; });
    return [
      { name: 'Autorizado', value: map.autorizado, color: C.green  },
      { name: 'Rechazado',  value: map.rechazado,  color: C.red    },
      { name: 'Esperando',  value: map.esperando,  color: C.amber  },
    ].filter(e => e.value > 0);
  })();

  const accesosXHora = (() => {
    const map: Record<number, number> = {};
    for (let h = 0; h < 24; h++) map[h] = 0;
    accesos.forEach(a => { map[getHours(new Date(a.hora_entrada))]++; });
    return Array.from({ length: 24 }, (_, h) => ({ hora: `${pad(h)}h`, total: map[h] }));
  })();

  const maxHora = Math.max(...accesosXHora.map(x => x.total), 1);

  const accesosXTipo = (() => {
    const map: Record<string, number> = {};
    accesos.forEach(a => {
      const t = a.tipo ?? 'otro';
      map[t] = (map[t] || 0) + 1;
    });
    return Object.entries(map)
      .map(([tipo, total]) => ({ tipo: tipo.charAt(0).toUpperCase() + tipo.slice(1), total }))
      .sort((a, b) => b.total - a.total);
  })();

  // ── Computed: Paquetes ────────────────────────────────────────────────────
  const paquetesXDia = (() => {
    const map = buildDayBuckets(periodo);
    paquetes.forEach(p => {
      const key = format(new Date(p.created_at), 'dd/MM');
      if (key in map) map[key]++;
    });
    return Object.entries(map).map(([dia, total]) => ({ dia, total }));
  })();

  const paquetesXTipo = (() => {
    const map: Record<string, number> = {};
    paquetes.forEach(p => { map[p.tipo] = (map[p.tipo] || 0) + 1; });
    const colors: Record<string, string> = {
      paquete:  C.coral,
      domicilio: C.blue,
      recibo:   C.amber,
    };
    return Object.entries(map).map(([name, value]) => ({
      name:  name.charAt(0).toUpperCase() + name.slice(1),
      value,
      color: colors[name] ?? C.purple,
    }));
  })();

  // ── Computed: Alertas ─────────────────────────────────────────────────────
  const alertasXPrioridad = (() => {
    const map: Record<string, number> = { urgente: 0, alta: 0, media: 0, baja: 0 };
    alertas.forEach(a => { if (a.prioridad in map) map[a.prioridad]++; });
    const colors: Record<string, string> = {
      urgente: C.red,
      alta:    C.amber,
      media:   C.coral,
      baja:    C.blue,
    };
    return Object.entries(map)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({
        name:  name.charAt(0).toUpperCase() + name.slice(1),
        value,
        color: colors[name],
      }));
  })();

  const alertasXTipo = (() => {
    const map: Record<string, number> = {};
    alertas.forEach(a => {
      const t = a.tipo ?? 'otro';
      map[t] = (map[t] || 0) + 1;
    });
    return Object.entries(map)
      .map(([tipo, total]) => ({ tipo: tipo.charAt(0).toUpperCase() + tipo.slice(1), total }))
      .sort((a, b) => b.total - a.total);
  })();

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const tasaAuth = accesos.length
    ? Math.round((accesos.filter(a => a.estado === 'autorizado').length / accesos.length) * 100)
    : 0;

  const paquetesPendientes = paquetes.filter(p => p.estado !== 'entregado').length;

  const kpis = [
    { icon: DoorOpen,      label: 'Total accesos',      value: accesos.length,    bg: 'bg-blue-50',   color: 'text-blue-600'   },
    { icon: CheckCircle2,  label: 'Tasa autorización',  value: `${tasaAuth}%`,    bg: 'bg-green-50',  color: 'text-green-600'  },
    { icon: Package,       label: 'Paquetes pendientes', value: paquetesPendientes, bg: 'bg-amber-50', color: 'text-amber-600'  },
    { icon: AlertTriangle, label: 'Alertas emitidas',   value: alertas.length,    bg: 'bg-red-50',    color: 'text-red-600'    },
  ];

  // XAxis label density
  const xInterval = periodo === 7 ? 0 : periodo === 30 ? 4 : 12;

  // ── Empty state helper ────────────────────────────────────────────────────
  function NoData({ label }: { label: string }) {
    return (
      <div className="h-48 flex flex-col items-center justify-center gap-2 text-muted-foreground">
        <BarChart2 className="w-8 h-8 opacity-30" />
        <p className="text-sm">Sin datos de {label} en este periodo</p>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6 max-w-5xl">
        <div className="flex justify-between items-start">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-36 rounded-xl" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-3">
                <Skeleton className="w-9 h-9 rounded-lg" />
                <Skeleton className="h-7 w-12" />
                <Skeleton className="h-3 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <Skeleton className="h-52" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-5xl">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-finca-dark">Estadísticas</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Análisis de actividad · últimos {periodo} días
          </p>
        </div>

        {/* Period tabs */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
          {([7, 30, 90] as Periodo[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriodo(p)}
              className={cn(
                'text-xs font-semibold px-3 py-1.5 rounded-lg transition-all',
                periodo === p
                  ? 'bg-white text-finca-coral shadow-sm'
                  : 'text-muted-foreground hover:text-finca-dark',
              )}
            >
              {p}d
            </button>
          ))}
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map(k => (
          <Card key={k.label} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center mb-3', k.bg)}>
                <k.icon className={cn('w-5 h-5', k.color)} />
              </div>
              <p className="text-2xl font-bold text-finca-dark">{k.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{k.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── 1. Accesos por día (full-width BarChart) ── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-finca-dark flex items-center gap-2">
            <DoorOpen className="w-4 h-4 text-finca-coral" />
            Accesos por día
          </CardTitle>
        </CardHeader>
        <CardContent>
          {accesos.length === 0
            ? <NoData label="accesos" />
            : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={accesosXDia} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="dia" tick={{ fontSize: 11 }} interval={xInterval} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #f0f0f0' }}
                    cursor={{ fill: '#f9f5f4' }}
                  />
                  <Bar dataKey="total" fill={C.coral} radius={[4, 4, 0, 0]} name="Accesos" />
                </BarChart>
              </ResponsiveContainer>
            )}
        </CardContent>
      </Card>

      {/* ── 2. Estado accesos (Pie) | Tipos de visitante (HorizontalBar) ── */}
      <div className="grid md:grid-cols-2 gap-4">

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-finca-dark flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              Estado de accesos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {accesosXEstado.length === 0
              ? <NoData label="estados" />
              : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={accesosXEstado}
                      cx="50%" cy="50%"
                      innerRadius={52} outerRadius={78}
                      dataKey="value"
                      paddingAngle={3}
                    >
                      {accesosXEstado.map(e => <Cell key={e.name} fill={e.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-finca-dark flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              Tipos de visitante
            </CardTitle>
          </CardHeader>
          <CardContent>
            {accesosXTipo.length === 0
              ? <NoData label="visitantes" />
              : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart
                    data={accesosXTipo}
                    layout="vertical"
                    margin={{ top: 4, right: 16, bottom: 0, left: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="tipo" tick={{ fontSize: 11 }} width={76} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Bar dataKey="total" fill={C.blue} radius={[0, 4, 4, 0]} name="Visitas" />
                  </BarChart>
                </ResponsiveContainer>
              )}
          </CardContent>
        </Card>

      </div>

      {/* ── 3. Horas pico (full-width BarChart con colores dinámicos) ── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-finca-dark flex items-center gap-2">
            <DoorOpen className="w-4 h-4 text-finca-coral" />
            Horas pico de accesos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {accesos.length === 0
            ? <NoData label="horas" />
            : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={accesosXHora} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="hora" tick={{ fontSize: 10 }} interval={1} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} cursor={{ fill: '#f9f5f4' }} />
                  <Bar dataKey="total" radius={[3, 3, 0, 0]} name="Accesos">
                    {accesosXHora.map(e => (
                      <Cell
                        key={e.hora}
                        fill={e.total >= maxHora * 0.65 ? C.coral : C.peach}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
        </CardContent>
      </Card>

      {/* ── 4. Paquetes por día (AreaChart) | Tipos de paquete (Pie) ── */}
      <div className="grid md:grid-cols-2 gap-4">

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-finca-dark flex items-center gap-2">
              <Package className="w-4 h-4 text-amber-500" />
              Paquetes recibidos por día
            </CardTitle>
          </CardHeader>
          <CardContent>
            {paquetes.length === 0
              ? <NoData label="paquetes" />
              : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={paquetesXDia} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <defs>
                      <linearGradient id="gradPaq" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={C.amber} stopOpacity={0.35} />
                        <stop offset="95%" stopColor={C.amber} stopOpacity={0}    />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="dia" tick={{ fontSize: 11 }} interval={xInterval} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Area
                      type="monotone"
                      dataKey="total"
                      stroke={C.amber}
                      fill="url(#gradPaq)"
                      strokeWidth={2}
                      name="Paquetes"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-finca-dark flex items-center gap-2">
              <Package className="w-4 h-4 text-amber-500" />
              Distribución de paquetes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {paquetesXTipo.length === 0
              ? <NoData label="paquetes" />
              : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={paquetesXTipo}
                      cx="50%" cy="50%"
                      outerRadius={78}
                      dataKey="value"
                      paddingAngle={3}
                    >
                      {paquetesXTipo.map(e => <Cell key={e.name} fill={e.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
          </CardContent>
        </Card>

      </div>

      {/* ── 5. Alertas ── */}
      {(alertasXPrioridad.length > 0 || alertasXTipo.length > 0) && (
        <div className="grid md:grid-cols-2 gap-4">

          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-finca-dark flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                Alertas por prioridad
              </CardTitle>
            </CardHeader>
            <CardContent>
              {alertasXPrioridad.length === 0
                ? <NoData label="prioridades" />
                : (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={alertasXPrioridad}
                        cx="50%" cy="50%"
                        innerRadius={52} outerRadius={78}
                        dataKey="value"
                        paddingAngle={3}
                      >
                        {alertasXPrioridad.map(e => <Cell key={e.name} fill={e.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-finca-dark flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-400" />
                Alertas por tipo
              </CardTitle>
            </CardHeader>
            <CardContent>
              {alertasXTipo.length === 0
                ? <NoData label="tipos" />
                : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart
                      data={alertasXTipo}
                      layout="vertical"
                      margin={{ top: 4, right: 16, bottom: 0, left: 24 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                      <YAxis type="category" dataKey="tipo" tick={{ fontSize: 11 }} width={90} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <Bar dataKey="total" fill={C.red} radius={[0, 4, 4, 0]} name="Alertas" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
            </CardContent>
          </Card>

        </div>
      )}

      {/* ── Footer note ── */}
      <p className="text-[11px] text-muted-foreground text-center pb-2">
        Datos de los últimos {periodo} días · actualizados al abrir la página
      </p>

    </div>
  );
}
