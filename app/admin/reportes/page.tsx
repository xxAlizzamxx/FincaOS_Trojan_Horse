'use client';

import { useState } from 'react';
import {
  collection, query, where, orderBy, getDocs, limit,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Download, FileSpreadsheet, Navigation, DoorOpen, Loader2, CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { subDays, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import type { Perfil } from '@/types/database';

/* ── CSV helper ──────────────────────────────────────────────────────────── */
function downloadCSV(filename: string, rows: string[][]): void {
  const BOM  = '﻿';                              // UTF-8 BOM — Excel lo lee bien
  const body = rows.map(r =>
    r.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','),
  ).join('\r\n');
  const blob = new Blob([BOM + body], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatFecha(iso: string | null | undefined) {
  if (!iso) return '';
  try { return format(new Date(iso), "dd/MM/yyyy HH:mm", { locale: es }); } catch { return iso ?? ''; }
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function AdminReportesPage() {
  const { perfil } = useAuth();
  const comunidadId = perfil?.comunidad_id;

  const [loadingCuotas,  setLoadingCuotas]  = useState(false);
  const [loadingAccesos, setLoadingAccesos] = useState(false);
  const [loadingRondas,  setLoadingRondas]  = useState(false);
  const [periodoAccesos, setPeriodoAccesos] = useState<'7' | '30' | '90'>('30');
  const [periodoRondas,  setPeriodoRondas]  = useState<'7' | '30' | '90'>('30');

  /* ── EXPORT: Cuotas ──────────────────────────────────────────────────── */
  async function exportarCuotas() {
    if (!comunidadId) return;
    setLoadingCuotas(true);
    try {
      // Perfiles
      const perfilesSnap = await getDocs(
        query(collection(db, 'perfiles'), where('comunidad_id', '==', comunidadId)),
      );
      const perfilesMap = new Map<string, Perfil>();
      perfilesSnap.docs.forEach(d => perfilesMap.set(d.id, { ...(d.data() as Perfil), id: d.id }));

      // Cuotas
      const cuotasSnap = await getDocs(
        query(
          collection(db, 'cuotas'),
          where('comunidad_id', '==', comunidadId),
          orderBy('fecha_limite', 'desc'),
        ),
      );

      const header = ['Cuota', 'Monto (€)', 'Vencimiento', 'Vecino', 'Piso', 'Estado', 'Fecha pago'];
      const dataRows: string[][] = [];

      await Promise.all(
        cuotasSnap.docs.map(async cuotaDoc => {
          const cuota = { id: cuotaDoc.id, ...cuotaDoc.data() } as any;
          const pagosSnap = await getDocs(collection(db, 'cuotas', cuota.id, 'pagos'));
          const pagosMap = new Map<string, any>();
          pagosSnap.docs.forEach(d => pagosMap.set(d.id, d.data()));

          for (const [uid, p] of Array.from(perfilesMap.entries())) {
            const pago  = pagosMap.get(uid);
            const estado = pago?.estado ?? 'pendiente';
            dataRows.push([
              cuota.nombre,
              String(cuota.monto ?? ''),
              formatFecha(cuota.fecha_limite),
              p.nombre_completo ?? '',
              p.numero_piso ?? '',
              estado,
              formatFecha(pago?.fecha_pago ?? null),
            ]);
          }
        }),
      );

      if (dataRows.length === 0) { toast.info('No hay datos de cuotas'); return; }
      downloadCSV(`cuotas_${format(new Date(), 'yyyy-MM-dd')}.csv`, [header, ...dataRows]);
      toast.success(`${dataRows.length} registros exportados`);
    } catch (err) {
      console.error(err);
      toast.error('Error al exportar cuotas');
    } finally {
      setLoadingCuotas(false);
    }
  }

  /* ── EXPORT: Accesos ─────────────────────────────────────────────────── */
  async function exportarAccesos() {
    if (!comunidadId) return;
    setLoadingAccesos(true);
    try {
      const desde = subDays(new Date(), Number(periodoAccesos)).toISOString();

      const snap = await getDocs(
        query(
          collection(db, 'accesos'),
          where('comunidad_id', '==', comunidadId),
          orderBy('hora_entrada', 'desc'),
          limit(2000),
        ),
      );

      const rows = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .filter(a => a.hora_entrada && a.hora_entrada >= desde);

      if (rows.length === 0) { toast.info('No hay accesos en ese período'); return; }

      const header = [
        'Visitante', 'Tipo doc.', 'N° doc.', 'Vecino / Destino',
        'Entrada', 'Salida', 'Estado', 'Autorizado por', 'Notas',
      ];
      const dataRows = rows.map(a => [
        a.nombre_visitante ?? '',
        a.tipo_documento ?? '',
        a.numero_documento ?? '',
        a.vecino_nombre ?? a.vecino_id ?? '',
        formatFecha(a.hora_entrada),
        formatFecha(a.hora_salida),
        a.estado ?? '',
        a.autorizado_por ?? '',
        a.notas ?? '',
      ]);

      downloadCSV(`accesos_${periodoAccesos}d_${format(new Date(), 'yyyy-MM-dd')}.csv`, [header, ...dataRows]);
      toast.success(`${dataRows.length} registros exportados`);
    } catch (err) {
      console.error(err);
      toast.error('Error al exportar accesos');
    } finally {
      setLoadingAccesos(false);
    }
  }

  /* ── EXPORT: Rondas ──────────────────────────────────────────────────── */
  async function exportarRondas() {
    if (!comunidadId) return;
    setLoadingRondas(true);
    try {
      const desde = subDays(new Date(), Number(periodoRondas)).toISOString();

      const snap = await getDocs(
        query(
          collection(db, 'rondas_vigilancia'),
          where('comunidad_id', '==', comunidadId),
          orderBy('iniciada_at', 'desc'),
          limit(500),
        ),
      );

      const rondas = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .filter(r => r.iniciada_at && r.iniciada_at >= desde);

      if (rondas.length === 0) { toast.info('No hay rondas en ese período'); return; }

      // Fetch checkpoints for each ronda
      const header = [
        'Vigilante', 'Estado', 'Inicio', 'Fin', 'Duración (min)',
        'Checkpoints', 'Checkpoint — Nombre', 'Checkpoint — Hora', 'Checkpoint — Nota',
      ];
      const dataRows: string[][] = [];

      await Promise.all(
        rondas.map(async ronda => {
          try {
            const cpSnap = await getDocs(
              query(collection(db, 'rondas_vigilancia', ronda.id, 'checkpoints'), orderBy('orden', 'asc')),
            );
            const cps = cpSnap.docs.map(d => d.data() as any);

            if (cps.length === 0) {
              dataRows.push([
                ronda.vigilante_nombre ?? '',
                ronda.estado ?? '',
                formatFecha(ronda.iniciada_at),
                formatFecha(ronda.completada_at),
                String(ronda.duracion_min ?? ''),
                '0',
                '', '', '',
              ]);
            } else {
              cps.forEach((cp, i) => {
                dataRows.push([
                  i === 0 ? (ronda.vigilante_nombre ?? '') : '',
                  i === 0 ? (ronda.estado ?? '') : '',
                  i === 0 ? formatFecha(ronda.iniciada_at) : '',
                  i === 0 ? formatFecha(ronda.completada_at) : '',
                  i === 0 ? String(ronda.duracion_min ?? '') : '',
                  i === 0 ? String(cps.length) : '',
                  cp.nombre ?? '',
                  formatFecha(cp.registrado_at ?? cp.created_at),
                  cp.nota ?? '',
                ]);
              });
            }
          } catch {
            dataRows.push([
              ronda.vigilante_nombre ?? '', ronda.estado ?? '',
              formatFecha(ronda.iniciada_at), '', '', '', '', '', '',
            ]);
          }
        }),
      );

      downloadCSV(`rondas_${periodoRondas}d_${format(new Date(), 'yyyy-MM-dd')}.csv`, [header, ...dataRows]);
      toast.success(`${rondas.length} rondas exportadas`);
    } catch (err) {
      console.error(err);
      toast.error('Error al exportar rondas');
    } finally {
      setLoadingRondas(false);
    }
  }

  /* ── UI ─────────────────────────────────────────────────────────────────── */
  const ReporteCard = ({
    icon: Icon,
    title,
    description,
    onExport,
    loading,
    accentColor,
    iconBg,
    iconColor,
    children,
  }: {
    icon: typeof Download;
    title: string;
    description: string;
    onExport: () => void;
    loading: boolean;
    accentColor: string;
    iconBg: string;
    iconColor: string;
    children?: React.ReactNode;
  }) => (
    <Card className="border-0 shadow-sm overflow-hidden">
      <div className={cn('h-1', accentColor)} />
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', iconBg)}>
            <Icon className={cn('w-5 h-5', iconColor)} />
          </div>
          <div>
            <CardTitle className="text-base font-semibold text-finca-dark">{title}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {children}
        <Button
          className="w-full bg-finca-coral hover:bg-finca-salmon text-white rounded-xl"
          onClick={onExport}
          disabled={loading}
        >
          {loading
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generando...</>
            : <><Download className="w-4 h-4 mr-2" />Descargar CSV</>
          }
        </Button>
      </CardContent>
    </Card>
  );

  const PeriodoSelect = ({
    value,
    onChange,
  }: {
    value: '7' | '30' | '90';
    onChange: (v: '7' | '30' | '90') => void;
  }) => (
    <Select value={value} onValueChange={v => onChange(v as '7' | '30' | '90')}>
      <SelectTrigger className="h-8 text-xs w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="7">Últimos 7 días</SelectItem>
        <SelectItem value="30">Últimos 30 días</SelectItem>
        <SelectItem value="90">Últimos 90 días</SelectItem>
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-finca-dark">Reportes y exportaciones</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Descarga datos en CSV — compatible con Excel y Google Sheets
        </p>
      </div>

      {/* Info */}
      <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
        <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
        <p className="text-xs text-blue-700">
          Los archivos incluyen BOM UTF-8 para que los caracteres especiales (tildes, ñ) se vean correctamente en Excel.
        </p>
      </div>

      {/* Reporte: Cuotas */}
      <ReporteCard
        icon={FileSpreadsheet}
        title="Estado de cuotas"
        description="Todas las cuotas con el estado de pago de cada vecino"
        onExport={exportarCuotas}
        loading={loadingCuotas}
        accentColor="bg-green-500"
        iconBg="bg-green-50"
        iconColor="text-green-600"
      >
        <p className="text-xs text-muted-foreground">
          Columnas: cuota · monto · vencimiento · vecino · piso · estado · fecha pago
        </p>
      </ReporteCard>

      {/* Reporte: Accesos */}
      <ReporteCard
        icon={DoorOpen}
        title="Registro de accesos"
        description="Visitas registradas por el vigilante en la portería"
        onExport={exportarAccesos}
        loading={loadingAccesos}
        accentColor="bg-blue-500"
        iconBg="bg-blue-50"
        iconColor="text-blue-600"
      >
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Período:</p>
          <PeriodoSelect value={periodoAccesos} onChange={setPeriodoAccesos} />
        </div>
        <p className="text-xs text-muted-foreground">
          Columnas: visitante · doc. · vecino destino · entrada · salida · estado · notas
        </p>
      </ReporteCard>

      {/* Reporte: Rondas */}
      <ReporteCard
        icon={Navigation}
        title="Historial de rondas"
        description="Rondas de vigilancia con sus checkpoints detallados"
        onExport={exportarRondas}
        loading={loadingRondas}
        accentColor="bg-orange-500"
        iconBg="bg-orange-50"
        iconColor="text-orange-600"
      >
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Período:</p>
          <PeriodoSelect value={periodoRondas} onChange={setPeriodoRondas} />
        </div>
        <p className="text-xs text-muted-foreground">
          Columnas: vigilante · estado · inicio · fin · duración · checkpoints con hora y nota
        </p>
      </ReporteCard>

    </div>
  );
}
