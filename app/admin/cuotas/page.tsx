'use client';

/**
 * /admin/cuotas
 *
 * Tabla de cuotas de la comunidad con estado de pago por vecino.
 * Solo accesible para admin/presidente (garantizado por app/admin/layout.tsx).
 *
 * Colores de estado:
 *  🟢 pagado  → verde
 *  🟡 pendiente → amarillo
 *  🔴 overdue   → rojo
 */

import { useEffect, useState, useMemo } from 'react';
import {
  Wallet, ChevronDown, ChevronUp, Check, Clock,
  AlertTriangle, Users, CalendarDays, Search,
  CircleCheck as CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/firebase/client';
import {
  collection, query, where, orderBy, getDocs,
  doc, updateDoc,
} from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import type { Cuota, PagoCuota, Perfil, EstadoPago } from '@/types/database';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { format, isPast, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';

/* ── Types ── */
interface PagoRow {
  usuario_id: string;
  nombre:     string;
  vivienda:   string;
  estado:     EstadoPago;
  fecha_pago: string | null;
}

interface CuotaConPagos {
  cuota:  Cuota;
  pagos:  PagoRow[];
  expanded: boolean;
}

/* ── Helpers ── */
function formatMonto(n: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
}
function formatFecha(iso: string) {
  try { return format(new Date(iso), "d MMM yyyy", { locale: es }); } catch { return iso; }
}
function vivienda(p: Perfil) {
  const parts = [p.torre && `T${p.torre}`, p.piso && `${p.piso}º`, p.puerta].filter(Boolean);
  return parts.join(' ') || p.numero_piso || '—';
}

/* ── Estado config ── */
const ESTADO_CONFIG: Record<EstadoPago, {
  label: string; icon: typeof Check;
  badge: string; row: string;
}> = {
  pagado:   { label: 'Pagado',    icon: Check,         badge: 'bg-green-100 text-green-700 border-green-200',  row: 'bg-green-50/40' },
  pendiente:{ label: 'Pendiente', icon: Clock,         badge: 'bg-yellow-100 text-yellow-700 border-yellow-200', row: '' },
  overdue:  { label: 'Vencida',   icon: AlertTriangle, badge: 'bg-red-100 text-red-700 border-red-200',        row: 'bg-red-50/30' },
};

/* ══════════════════════════════════════════════════════════ */
export default function AdminCuotasPage() {
  const { perfil } = useAuth();
  const [rows, setRows]         = useState<CuotaConPagos[]>([]);
  const [loading, setLoading]   = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro]     = useState<'todas' | EstadoPago>('todas');
  const [marcando, setMarcando] = useState<string | null>(null); // `${cuotaId}:${userId}`

  useEffect(() => {
    if (perfil?.comunidad_id) fetchAll();
  }, [perfil?.comunidad_id]);

  /* ── Fetch cuotas + perfiles + pagos ── */
  async function fetchAll() {
    setLoading(true);
    const cid = perfil!.comunidad_id!;

    try {
      /* 1. Cuotas de la comunidad */
      const cuotasSnap = await getDocs(
        query(
          collection(db, 'cuotas'),
          where('comunidad_id', '==', cid),
          orderBy('fecha_limite', 'desc'),
        ),
      );

      /* 2. Perfiles para nombre + vivienda */
      const perfilesSnap = await getDocs(
        query(
          collection(db, 'perfiles'),
          where('comunidad_id', '==', cid),
          orderBy('nombre_completo'),
        ),
      );
      const perfilesMap = new Map<string, Perfil>();
      perfilesSnap.docs.forEach((d) =>
        perfilesMap.set(d.id, { id: d.id, ...d.data() } as Perfil),
      );

      /* 3. Para cada cuota, cargar subcollection de pagos */
      const result: CuotaConPagos[] = await Promise.all(
        cuotasSnap.docs.map(async (cuotaDoc) => {
          const cuota = { id: cuotaDoc.id, ...cuotaDoc.data() } as Cuota;

          const pagosSnap = await getDocs(
            collection(db, 'cuotas', cuota.id, 'pagos'),
          );
          const pagosMap = new Map<string, PagoCuota>();
          pagosSnap.docs.forEach((d) => pagosMap.set(d.id, d.data() as PagoCuota));

          /* Construir una fila por vecino — si no hay pago → 'pendiente' */
          const pagos: PagoRow[] = Array.from(perfilesMap.entries()).map(([uid, p]) => {
            const pago = pagosMap.get(uid);
            return {
              usuario_id: uid,
              nombre:     p.nombre_completo,
              vivienda:   vivienda(p),
              estado:     pago?.estado ?? 'pendiente',
              fecha_pago: pago?.fecha_pago ?? null,
            };
          });

          // Ordenar: overdue → pendiente → pagado
          pagos.sort((a, b) => {
            const ord: Record<EstadoPago, number> = { overdue: 0, pendiente: 1, pagado: 2 };
            return ord[a.estado] - ord[b.estado];
          });

          return { cuota, pagos, expanded: false };
        }),
      );

      setRows(result);
    } catch (err) {
      console.error('[admin/cuotas] fetchAll:', err);
      toast.error('Error al cargar las cuotas');
    } finally {
      setLoading(false);
    }
  }

  /* ── Toggle expand ── */
  function toggleExpand(cuotaId: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.cuota.id === cuotaId ? { ...r, expanded: !r.expanded } : r,
      ),
    );
  }

  /* ── Marcar pagado manualmente ── */
  async function marcarPagado(cuotaId: string, userId: string) {
    const key = `${cuotaId}:${userId}`;
    setMarcando(key);
    const fechaPago = new Date().toISOString();
    try {
      await updateDoc(doc(db, 'cuotas', cuotaId, 'pagos', userId), {
        estado: 'pagado', fecha_pago: fechaPago,
      });
      setRows((prev) =>
        prev.map((r) =>
          r.cuota.id !== cuotaId ? r : {
            ...r,
            pagos: r.pagos.map((p) =>
              p.usuario_id !== userId ? p : { ...p, estado: 'pagado', fecha_pago: fechaPago },
            ),
          },
        ),
      );
      toast.success('Pago marcado');
    } catch {
      toast.error('Error al actualizar el pago');
    } finally {
      setMarcando(null);
    }
  }

  /* ── KPIs globales ── */
  const kpis = useMemo(() => {
    let paid = 0, pending = 0, overdue = 0;
    rows.forEach(({ pagos }) =>
      pagos.forEach((p) => {
        if (p.estado === 'pagado')    paid++;
        else if (p.estado === 'pendiente') pending++;
        else                          overdue++;
      }),
    );
    return { paid, pending, overdue };
  }, [rows]);

  /* ── Filtrado por búsqueda de cuota ── */
  const filtered = useMemo(() => {
    const q = busqueda.toLowerCase();
    return rows.filter(({ cuota, pagos }) => {
      const matchQ = cuota.nombre.toLowerCase().includes(q);
      const matchEstado = filtro === 'todas' || pagos.some((p) => p.estado === filtro);
      return matchQ && matchEstado;
    });
  }, [rows, busqueda, filtro]);

  /* ════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-5 max-w-5xl">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-finca-dark">Cuotas</h1>
        <p className="text-sm text-muted-foreground">
          Estado de pagos de todas las cuotas de la comunidad
        </p>
      </div>

      {/* KPI cards */}
      {!loading && (
        <div className="grid grid-cols-3 gap-3">
          {([
            { label: 'Pagados',   value: kpis.paid,    icon: CheckCircle2,   bg: 'bg-green-50',  color: 'text-green-600' },
            { label: 'Pendientes',value: kpis.pending, icon: Clock,          bg: 'bg-yellow-50', color: 'text-yellow-600' },
            { label: 'Vencidos',  value: kpis.overdue, icon: AlertTriangle,  bg: 'bg-red-50',    color: 'text-red-600' },
          ] as const).map((k) => (
            <Card key={k.label} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center mb-2', k.bg)}>
                  <k.icon className={cn('w-4.5 h-4.5', k.color)} />
                </div>
                <p className="text-2xl font-bold text-finca-dark">{k.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{k.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filtros */}
      <div className="flex gap-3 flex-col sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar cuota..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filtro} onValueChange={(v) => setFiltro(v as typeof filtro)}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todos los estados</SelectItem>
            <SelectItem value="pagado">Pagado</SelectItem>
            <SelectItem value="pendiente">Pendiente</SelectItem>
            <SelectItem value="overdue">Vencida</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </CardContent>
            </Card>
          ))}
        </div>

      ) : filtered.length === 0 ? (
        <div className="py-16 text-center space-y-2">
          <Wallet className="w-12 h-12 text-muted-foreground/20 mx-auto" />
          <p className="font-medium text-finca-dark">Sin cuotas</p>
          <p className="text-sm text-muted-foreground">
            Crea cuotas desde la sección de vecinos o desde /cuotas/nueva
          </p>
        </div>

      ) : (
        <div className="space-y-3">
          {filtered.map(({ cuota, pagos, expanded }) => {
            const vencida    = isPast(new Date(cuota.fecha_limite));
            const diasRestantes = differenceInDays(new Date(cuota.fecha_limite), new Date());
            const paidCount   = pagos.filter((p) => p.estado === 'pagado').length;
            const overdueCount= pagos.filter((p) => p.estado === 'overdue').length;
            const pendingCount= pagos.filter((p) => p.estado === 'pendiente').length;

            return (
              <Card key={cuota.id} className="border-0 shadow-sm overflow-hidden">
                {/* Color stripe */}
                <div className={cn(
                  'h-1',
                  overdueCount > 0 ? 'bg-red-500' :
                  pendingCount > 0 ? 'bg-yellow-400' : 'bg-green-400',
                )} />

                {/* Cuota header */}
                <CardContent className="p-4">
                  <button
                    className="w-full flex items-start gap-3 text-left"
                    onClick={() => toggleExpand(cuota.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-finca-dark">{cuota.nombre}</p>
                        <span className="font-bold text-finca-coral tabular-nums">
                          {formatMonto(cuota.monto)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <CalendarDays className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className={cn(
                          'text-xs',
                          vencida ? 'text-red-500 font-medium' :
                          diasRestantes <= 3 ? 'text-yellow-600 font-medium' :
                          'text-muted-foreground',
                        )}>
                          {vencida
                            ? `Venció el ${formatFecha(cuota.fecha_limite)}`
                            : diasRestantes <= 3
                            ? `⏰ Vence en ${diasRestantes}d — ${formatFecha(cuota.fecha_limite)}`
                            : `Límite: ${formatFecha(cuota.fecha_limite)}`}
                        </span>
                      </div>
                      {/* Mini pills */}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {paidCount > 0 && (
                          <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
                            ✓ {paidCount} pagados
                          </span>
                        )}
                        {pendingCount > 0 && (
                          <span className="text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full font-medium">
                            ⏳ {pendingCount} pendientes
                          </span>
                        )}
                        {overdueCount > 0 && (
                          <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-medium">
                            ⚠ {overdueCount} vencidos
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-1 flex items-center gap-0.5">
                          <Users className="w-2.5 h-2.5" /> {pagos.length} vecinos
                        </span>
                      </div>
                    </div>
                    {expanded
                      ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                      : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                    }
                  </button>

                  {/* Tabla de vecinos — solo cuando expanded */}
                  {expanded && (
                    <div className="mt-4 border border-border rounded-xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/40 text-xs text-muted-foreground">
                            <th className="px-3 py-2 text-left font-medium">Vecino</th>
                            <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">
                              Vivienda
                            </th>
                            <th className="px-3 py-2 text-left font-medium">Estado</th>
                            <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">
                              Fecha pago
                            </th>
                            <th className="px-3 py-2 text-right font-medium">Acción</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                          {pagos.map((pago) => {
                            const cfg     = ESTADO_CONFIG[pago.estado];
                            const IconCfg = cfg.icon;
                            const rowKey  = `${cuota.id}:${pago.usuario_id}`;

                            return (
                              <tr key={pago.usuario_id} className={cn('transition-colors', cfg.row)}>
                                <td className="px-3 py-2.5">
                                  <p className="font-medium text-finca-dark text-xs leading-tight">
                                    {pago.nombre}
                                  </p>
                                </td>
                                <td className="px-3 py-2.5 hidden sm:table-cell">
                                  <p className="text-xs text-muted-foreground">{pago.vivienda}</p>
                                </td>
                                <td className="px-3 py-2.5">
                                  <Badge className={cn('text-[10px] border gap-1 font-medium', cfg.badge)}>
                                    <IconCfg className="w-2.5 h-2.5" />
                                    {cfg.label}
                                  </Badge>
                                </td>
                                <td className="px-3 py-2.5 hidden sm:table-cell">
                                  <p className="text-xs text-muted-foreground">
                                    {pago.fecha_pago ? formatFecha(pago.fecha_pago) : '—'}
                                  </p>
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                  {pago.estado !== 'pagado' && (
                                    <Button
                                      size="sm"
                                      disabled={marcando === rowKey}
                                      onClick={() => marcarPagado(cuota.id, pago.usuario_id)}
                                      className="h-6 text-[10px] px-2 rounded-lg bg-green-500 hover:bg-green-600 text-white"
                                    >
                                      {marcando === rowKey ? (
                                        <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                                      ) : (
                                        <><Check className="w-2.5 h-2.5 mr-0.5" />Pagado</>
                                      )}
                                    </Button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
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
