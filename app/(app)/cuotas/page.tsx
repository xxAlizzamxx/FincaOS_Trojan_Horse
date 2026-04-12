'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Wallet, Plus, Check, Clock, Loader2,
  CalendarDays, TrendingDown, Users,
} from 'lucide-react';
import { db } from '@/lib/firebase/client';
import {
  collection, query, where, getDocs, getDoc, doc,
  updateDoc, orderBy,
} from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import type { Cuota, PagoCuota, Perfil } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { format, isPast } from 'date-fns';
import { es } from 'date-fns/locale';

/* ─── Local types ─── */
type CuotaConPago = { cuota: Cuota; pago: PagoCuota | null };
type VecinoConPago = { perfil: Perfil; pago: PagoCuota | null };

/* ─── Helpers ─── */
function formatMonto(monto: number) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(monto);
}

function formatFecha(fecha: string) {
  try {
    return format(new Date(fecha), "d 'de' MMMM yyyy", { locale: es });
  } catch {
    return fecha;
  }
}

function lineaVivienda(p: Perfil): string {
  const parts = [
    p.torre && `Torre ${p.torre}`,
    p.piso && `${p.piso}º`,
    p.puerta,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : (p.numero_piso ?? '');
}

/* ═══════════════════════════════════════════════════════════ */
export default function CuotasPage() {
  const router = useRouter();
  const { user, perfil } = useAuth();
  const esAdmin = perfil?.rol === 'admin' || perfil?.rol === 'presidente';

  /* ── Main list ── */
  const [cuotasData, setCuotasData] = useState<CuotaConPago[]>([]);
  const [loading, setLoading] = useState(true);

  /* ── Admin management sheet ── */
  const [sheetCuota, setSheetCuota] = useState<Cuota | null>(null);
  const [vecinosConPago, setVecinosConPago] = useState<VecinoConPago[]>([]);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [marcando, setMarcando] = useState<string | null>(null); // userId being updated

  /* ── Fetch cuotas + current user's pago for each ── */
  useEffect(() => {
    if (perfil?.comunidad_id && user?.uid) fetchCuotas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil?.comunidad_id, user?.uid]);

  async function fetchCuotas() {
    setLoading(true);
    const cid = perfil!.comunidad_id!;
    const uid = user!.uid;
    try {
      const snap = await getDocs(
        query(
          collection(db, 'cuotas'),
          where('comunidad_id', '==', cid),
          orderBy('fecha_limite', 'desc'),
        ),
      );
      const items = await Promise.all(
        snap.docs.map(async (cuotaDoc) => {
          const cuota = { id: cuotaDoc.id, ...cuotaDoc.data() } as Cuota;
          const pagoSnap = await getDoc(doc(db, 'cuotas', cuota.id, 'pagos', uid));
          const pago = pagoSnap.exists() ? (pagoSnap.data() as PagoCuota) : null;
          return { cuota, pago };
        }),
      );
      setCuotasData(items);
    } catch (err) {
      console.error('Error fetching cuotas:', err);
    } finally {
      setLoading(false);
    }
  }

  /* ── Derived stats (vecino view) ── */
  const pendientesCount = useMemo(
    () => cuotasData.filter(({ pago }) => !pago || pago.estado === 'pendiente').length,
    [cuotasData],
  );
  const totalDeuda = useMemo(
    () =>
      cuotasData
        .filter(({ pago }) => !pago || pago.estado === 'pendiente')
        .reduce((acc, { cuota }) => acc + cuota.monto, 0),
    [cuotasData],
  );

  /* ── Open admin sheet: lazy-load all members + pagos ── */
  async function abrirSheet(cuota: Cuota) {
    setSheetCuota(cuota);
    setVecinosConPago([]);
    setSheetLoading(true);
    try {
      const cid = perfil!.comunidad_id!;

      const [perfilesSnap, pagosSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, 'perfiles'),
            where('comunidad_id', '==', cid),
            orderBy('nombre_completo', 'asc'),
          ),
        ),
        getDocs(collection(db, 'cuotas', cuota.id, 'pagos')),
      ]);

      const pagosMap = new Map<string, PagoCuota>();
      pagosSnap.docs.forEach((d) => pagosMap.set(d.id, d.data() as PagoCuota));

      const merged: VecinoConPago[] = perfilesSnap.docs
        .map((d) => ({
          perfil: { id: d.id, ...d.data() } as Perfil,
          pago: pagosMap.get(d.id) ?? null,
        }))
        // Pending first, then paid
        .sort((a, b) => {
          const ea = a.pago?.estado ?? 'pendiente';
          const eb = b.pago?.estado ?? 'pendiente';
          return ea === eb ? 0 : ea === 'pendiente' ? -1 : 1;
        });

      setVecinosConPago(merged);
    } catch (err) {
      console.error('Error loading sheet data:', err);
    } finally {
      setSheetLoading(false);
    }
  }

  /* ── Mark payment as paid ── */
  async function marcarPagado(cuotaId: string, userId: string) {
    setMarcando(userId);
    const fechaPago = new Date().toISOString();
    try {
      await updateDoc(doc(db, 'cuotas', cuotaId, 'pagos', userId), {
        estado: 'pagado',
        fecha_pago: fechaPago,
      });

      // Update sheet state
      setVecinosConPago((prev) =>
        prev.map((v) =>
          v.perfil.id === userId
            ? { ...v, pago: { usuario_id: userId, estado: 'pagado', fecha_pago: fechaPago } }
            : v,
        ),
      );

      // Update main list if it was the current user's own pago
      if (userId === user?.uid) {
        setCuotasData((prev) =>
          prev.map((cd) =>
            cd.cuota.id === cuotaId
              ? { ...cd, pago: { usuario_id: userId, estado: 'pagado', fecha_pago: fechaPago } }
              : cd,
          ),
        );
      }
    } catch (err) {
      console.error('Error marking as paid:', err);
    } finally {
      setMarcando(null);
    }
  }

  /* ── Sheet summary ── */
  const sheetStats = useMemo(() => {
    const pagados = vecinosConPago.filter((v) => v.pago?.estado === 'pagado').length;
    return { pagados, pendientes: vecinosConPago.length - pagados, total: vecinosConPago.length };
  }, [vecinosConPago]);

  /* ════════════════════════════════════════════════════════ */
  return (
    <>
      <div className="px-4 py-5 space-y-4 pb-28">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-finca-dark">Cuotas</h1>
            <p className="text-sm text-muted-foreground">Pagos de tu comunidad</p>
          </div>
          {esAdmin && (
            <Button
              size="sm"
              onClick={() => router.push('/cuotas/nueva')}
              className="bg-finca-coral hover:bg-finca-coral/90 text-white rounded-xl gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Nueva
            </Button>
          )}
        </div>

        {/* Stats cards — visible once loaded and there are cuotas */}
        {!loading && cuotasData.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <Card className="border-0 shadow-sm">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4 text-red-500" />
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Pendientes</p>
                  <p className="text-xl font-bold text-finca-dark leading-none mt-0.5">
                    {pendientesCount}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
                  <TrendingDown className="w-4 h-4 text-orange-500" />
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Total deuda</p>
                  <p className="text-lg font-bold text-finca-dark leading-none mt-0.5">
                    {formatMonto(totalDeuda)}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Loading skeletons */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="border-0 shadow-sm overflow-hidden">
                <div className="h-1 bg-muted" />
                <CardContent className="p-4 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-7 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>

        ) : cuotasData.length === 0 ? (
          /* Empty state */
          <div className="py-16 text-center space-y-3">
            <Wallet className="w-14 h-14 text-muted-foreground/20 mx-auto" />
            <p className="font-semibold text-finca-dark">No hay cuotas registradas</p>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              {esAdmin
                ? 'Crea la primera cuota y se asignará automáticamente a todos los vecinos'
                : 'Cuando el administrador registre una cuota, aparecerá aquí'}
            </p>
            {esAdmin && (
              <Button
                size="sm"
                onClick={() => router.push('/cuotas/nueva')}
                className="mt-2 bg-finca-coral hover:bg-finca-coral/90 text-white rounded-xl"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Crear primera cuota
              </Button>
            )}
          </div>

        ) : (
          /* Cuota list */
          <div className="space-y-3">
            {cuotasData.map(({ cuota, pago }) => {
              const pagado = pago?.estado === 'pagado';
              const vencida = isPast(new Date(cuota.fecha_limite)) && !pagado;

              return (
                <Card
                  key={cuota.id}
                  className={cn('border-0 shadow-sm overflow-hidden', pagado && 'opacity-75')}
                >
                  {/* Color stripe at top */}
                  <div
                    className={cn(
                      'h-1',
                      pagado ? 'bg-green-400' : vencida ? 'bg-red-500' : 'bg-finca-coral',
                    )}
                  />
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      {/* Left: info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-finca-dark truncate">{cuota.nombre}</p>
                        <p className="text-2xl font-bold text-finca-dark mt-0.5 tabular-nums">
                          {formatMonto(cuota.monto)}
                        </p>
                        <div className="flex items-center gap-1 mt-1.5">
                          <CalendarDays className="w-3 h-3 text-muted-foreground shrink-0" />
                          <span
                            className={cn(
                              'text-xs',
                              vencida ? 'text-red-500 font-medium' : 'text-muted-foreground',
                            )}
                          >
                            {vencida ? 'Venció el ' : 'Límite: '}
                            {formatFecha(cuota.fecha_limite)}
                          </span>
                        </div>
                        {pagado && pago?.fecha_pago && (
                          <p className="text-xs text-green-600 mt-1">
                            ✓ Pagado el {formatFecha(pago.fecha_pago)}
                          </p>
                        )}
                      </div>

                      {/* Right: status + admin action */}
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <Badge
                          className={cn(
                            'text-[10px] border gap-1',
                            pagado
                              ? 'bg-green-100 text-green-700 border-green-200'
                              : 'bg-red-100 text-red-700 border-red-200',
                          )}
                        >
                          {pagado ? (
                            <><Check className="w-2.5 h-2.5" /> Pagado</>
                          ) : (
                            <><Clock className="w-2.5 h-2.5" /> Pendiente</>
                          )}
                        </Badge>

                        {esAdmin && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => abrirSheet(cuota)}
                            className="h-7 text-xs px-2.5 rounded-lg border-finca-coral/30 text-finca-coral hover:bg-finca-peach/20"
                          >
                            <Users className="w-3 h-3 mr-1" />
                            Gestionar
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Admin Sheet: manage all members' payments ─── */}
      <Sheet open={!!sheetCuota} onOpenChange={(open) => !open && setSheetCuota(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[85vh] flex flex-col px-0 pb-0">
          <SheetHeader className="px-5 pt-5 pb-3 shrink-0">
            <SheetTitle className="text-left text-base">Gestionar pagos</SheetTitle>
            {sheetCuota && (
              <p className="text-sm text-muted-foreground text-left">
                {sheetCuota.nombre} · <span className="font-medium text-finca-dark">{formatMonto(sheetCuota.monto)}</span>
              </p>
            )}
          </SheetHeader>

          {/* Mini stats */}
          {!sheetLoading && vecinosConPago.length > 0 && (
            <div className="px-5 pb-3 shrink-0 flex items-center gap-4">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
                {sheetStats.pagados} pagados
              </span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
                {sheetStats.pendientes} pendientes
              </span>
              <span className="ml-auto text-xs font-medium text-finca-dark">
                {sheetStats.total} vecinos
              </span>
            </div>
          )}

          <Separator className="shrink-0" />

          {/* Scrollable list */}
          <div className="overflow-y-auto flex-1 pb-8">
            {sheetLoading ? (
              <div className="px-5 py-4 space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="w-10 h-10 rounded-full shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                    <Skeleton className="h-8 w-28 rounded-lg" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {vecinosConPago.map(({ perfil: v, pago }) => {
                  const pagado = pago?.estado === 'pagado';
                  const initials = v.nombre_completo
                    .split(' ')
                    .slice(0, 2)
                    .map((n) => n[0])
                    .join('')
                    .toUpperCase();

                  return (
                    <div key={v.id} className="px-5 py-3 flex items-center gap-3">
                      {/* Avatar with initials */}
                      <div
                        className={cn(
                          'w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                          pagado
                            ? 'bg-green-100 text-green-700'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {initials}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-finca-dark truncate">
                          {v.nombre_completo}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {lineaVivienda(v) || 'Sin vivienda asignada'}
                        </p>
                        {pagado && pago?.fecha_pago && (
                          <p className="text-[10px] text-green-600 mt-0.5">
                            Pagado {formatFecha(pago.fecha_pago)}
                          </p>
                        )}
                      </div>

                      {/* Action */}
                      {pagado ? (
                        <Check className="w-5 h-5 text-green-500 shrink-0" />
                      ) : (
                        <Button
                          size="sm"
                          disabled={marcando === v.id}
                          onClick={() => sheetCuota && marcarPagado(sheetCuota.id, v.id)}
                          className="h-8 text-xs px-3 rounded-lg bg-green-500 hover:bg-green-600 text-white shrink-0"
                        >
                          {marcando === v.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            'Marcar pagado'
                          )}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
