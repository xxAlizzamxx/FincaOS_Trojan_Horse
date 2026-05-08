'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft, ChevronLeft, ChevronRight,
  Plus, Vote, Wallet, AlertCircle, X,
} from 'lucide-react';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
} from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface CalendarioEvent {
  id: string;
  titulo: string;
  tipo: 'votacion' | 'cuota' | 'incidencia';
  fecha: Date;
  color: string;
  url?: string;
}

export default function CalendarioPage() {
  const router = useRouter();
  const { perfil } = useAuth();
  const [mes, setMes] = useState(new Date());
  const [eventos, setEventos] = useState<CalendarioEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [diaSeleccionado, setDiaSeleccionado] = useState<Date | null>(null);
  const [showCrear, setShowCrear] = useState(false);

  const comunidadId = perfil?.comunidad_id;
  const esAdmin = perfil?.rol === 'admin' || perfil?.rol === 'presidente';

  useEffect(() => {
    if (!comunidadId) return;
    fetchEventos(comunidadId);
  }, [comunidadId, mes]);

  async function fetchEventos(cid: string) {
    setLoading(true);
    const mesInicio = startOfMonth(mes).toISOString();
    const mesFin   = endOfMonth(mes).toISOString();

    try {
      const [votSnap, cuotaSnap, incSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'votaciones'),
          where('comunidad_id', '==', cid),
          where('created_at', '>=', mesInicio),
          where('created_at', '<=', mesFin),
        )),
        // cuotas: usar fecha_limite (campo real del schema) + fallback a fecha_vencimiento
        getDocs(query(
          collection(db, 'cuotas'),
          where('comunidad_id', '==', cid),
          where('fecha_limite', '>=', mesInicio),
          where('fecha_limite', '<=', mesFin),
        )),
        getDocs(query(
          collection(db, 'incidencias'),
          where('comunidad_id', '==', cid),
          where('created_at', '>=', mesInicio),
          where('created_at', '<=', mesFin),
        )),
      ]);

      const evts: CalendarioEvent[] = [
        ...votSnap.docs.map(d => ({
          id:     d.id,
          titulo: d.data().titulo as string,
          tipo:   'votacion' as const,
          fecha:  new Date(d.data().created_at as string),
          color:  'bg-blue-500',
          url:    '/votos',
        })),
        ...cuotaSnap.docs.map(d => ({
          id:     d.id,
          titulo: (d.data().nombre as string) || 'Cuota',
          tipo:   'cuota' as const,
          fecha:  new Date(d.data().fecha_limite as string),
          color:  'bg-green-500',
          url:    '/cuotas',
        })),
        ...incSnap.docs.map(d => ({
          id:     d.id,
          titulo: d.data().titulo as string,
          tipo:   'incidencia' as const,
          fecha:  new Date(d.data().created_at as string),
          color:  'bg-finca-coral',
          url:    `/incidencias/${d.id}`,
        })),
      ];
      setEventos(evts);
    } catch (e) {
      console.error('[Calendario] fetchEventos error:', e);
    } finally {
      setLoading(false);
    }
  }

  const diasDelMes  = eachDayOfInterval({ start: startOfMonth(mes), end: endOfMonth(mes) });
  const primerDia   = getDay(startOfMonth(mes));
  const diasVacios  = (primerDia + 6) % 7; // lunes como primer día
  const eventosDelDia = diaSeleccionado
    ? eventos.filter(e => isSameDay(e.fecha, diaSeleccionado))
    : [];

  function seleccionarDia(dia: Date) {
    const yaSelec = diaSeleccionado && isSameDay(dia, diaSeleccionado);
    setDiaSeleccionado(yaSelec ? null : dia);
    setShowCrear(false);
  }

  // Navigate to new cuota/votación/incidencia pre-filling the date in query param
  function crearEvento(tipo: 'cuota' | 'votacion' | 'incidencia') {
    const fecha = diaSeleccionado ? format(diaSeleccionado, 'yyyy-MM-dd') : '';
    const paths: Record<string, string> = {
      cuota:      `/cuotas/nueva?fecha=${fecha}`,
      votacion:   `/votos/nueva?fecha=${fecha}`,
      incidencia: `/incidencias/nueva?fecha=${fecha}`,
    };
    router.push(paths[tipo]);
  }

  return (
    <div className="px-4 py-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="w-8 h-8 -ml-1" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-finca-dark">Calendario</h1>
          <p className="text-xs text-muted-foreground">Votaciones, cuotas e incidencias</p>
        </div>
      </div>

      {/* Month navigation */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <Button variant="ghost" size="icon" onClick={() => setMes(m => subMonths(m, 1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <h2 className="font-semibold text-finca-dark capitalize">
              {format(mes, 'MMMM yyyy', { locale: es })}
            </h2>
            <Button variant="ghost" size="icon" onClick={() => setMes(m => addMonths(m, 1))}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-2">
            {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => (
              <div key={d} className="text-center text-[10px] font-medium text-muted-foreground py-1">{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: diasVacios }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {diasDelMes.map(dia => {
              const evtsDia    = eventos.filter(e => isSameDay(e.fecha, dia));
              const seleccionado = diaSeleccionado && isSameDay(dia, diaSeleccionado);
              return (
                <button
                  key={dia.toISOString()}
                  onClick={() => seleccionarDia(dia)}
                  className={cn(
                    'relative flex flex-col items-center justify-start rounded-xl p-1 min-h-[40px] transition-all text-sm',
                    isToday(dia)     && 'bg-finca-coral text-white font-bold',
                    seleccionado && !isToday(dia) && 'bg-finca-peach/40 ring-2 ring-finca-coral',
                    !isToday(dia) && !seleccionado && 'hover:bg-muted',
                  )}
                >
                  <span className={cn('text-xs', isToday(dia) ? 'text-white' : 'text-finca-dark')}>
                    {format(dia, 'd')}
                  </span>
                  {evtsDia.length > 0 && (
                    <div className="flex gap-0.5 mt-0.5 flex-wrap justify-center">
                      {evtsDia.slice(0, 3).map((e, i) => (
                        <span
                          key={i}
                          className={cn('w-1.5 h-1.5 rounded-full', isToday(dia) ? 'bg-white' : e.color)}
                        />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Leyenda */}
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />Votación
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Cuota
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-finca-coral inline-block" />Incidencia
        </span>
      </div>

      {loading && (
        <p className="text-xs text-muted-foreground text-center py-2">Cargando eventos…</p>
      )}

      {/* Panel del día seleccionado */}
      {diaSeleccionado && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-finca-dark">
              {format(diaSeleccionado, "EEEE d 'de' MMMM", { locale: es })}
            </h3>
            <div className="flex items-center gap-2">
              {esAdmin && (
                <button
                  onClick={() => setShowCrear(v => !v)}
                  className="flex items-center gap-1 text-xs font-medium text-finca-coral bg-finca-peach/30 hover:bg-finca-peach/50 px-2.5 py-1 rounded-full transition-colors"
                >
                  {showCrear ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                  {showCrear ? 'Cancelar' : 'Crear'}
                </button>
              )}
              <button
                onClick={() => setDiaSeleccionado(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Panel crear evento */}
          {showCrear && esAdmin && (
            <Card className="border border-finca-coral/20 bg-finca-peach/10 shadow-none">
              <CardContent className="p-3 space-y-2">
                <p className="text-[10px] font-semibold text-finca-coral uppercase tracking-wide">
                  ¿Qué quieres crear para este día?
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => crearEvento('cuota')}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-green-50 hover:bg-green-100 border border-green-200 transition-colors"
                  >
                    <Wallet className="w-5 h-5 text-green-600" />
                    <span className="text-[11px] font-medium text-green-700">Cuota</span>
                  </button>
                  <button
                    onClick={() => crearEvento('votacion')}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors"
                  >
                    <Vote className="w-5 h-5 text-blue-600" />
                    <span className="text-[11px] font-medium text-blue-700">Votación</span>
                  </button>
                  <button
                    onClick={() => crearEvento('incidencia')}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-finca-peach/40 hover:bg-finca-peach/60 border border-finca-coral/20 transition-colors"
                  >
                    <AlertCircle className="w-5 h-5 text-finca-coral" />
                    <span className="text-[11px] font-medium text-finca-coral">Incidencia</span>
                  </button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Eventos del día */}
          {eventosDelDia.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Sin eventos este día
              {esAdmin && ' — pulsa Crear para añadir uno.'}
            </p>
          ) : (
            eventosDelDia.map(evt => (
              <Card
                key={evt.id}
                className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => evt.url && router.push(evt.url)}
              >
                <CardContent className="p-3 flex items-center gap-3">
                  <div className={cn('w-2 h-8 rounded-full shrink-0', evt.color)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-finca-dark truncate">{evt.titulo}</p>
                    <Badge className="text-[10px] mt-0.5 bg-muted text-muted-foreground border-0">
                      {evt.tipo === 'votacion'
                        ? '🗳️ Votación'
                        : evt.tipo === 'cuota'
                        ? '💰 Cuota — fecha límite'
                        : '🔧 Incidencia'}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
