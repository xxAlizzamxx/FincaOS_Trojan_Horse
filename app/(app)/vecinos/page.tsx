'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Search, Users, X, ArrowUpDown } from 'lucide-react';
import { toast } from 'sonner';
import {
  collection, query, where, orderBy, getDocs,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Perfil, Rol } from '@/types/database';

/* ─── Configuración visual de roles ─── */
const ROL_CONFIG: Record<Rol, { label: string; bg: string; text: string }> = {
  admin:      { label: 'Administrador', bg: 'bg-finca-coral',      text: 'text-white'         },
  presidente: { label: 'Presidente',    bg: 'bg-finca-peach/70',   text: 'text-finca-coral'   },
  vecino:     { label: 'Vecino',        bg: 'bg-gray-100',         text: 'text-gray-600'      },
};

/* Orden de aparición de roles para el sort secundario */
const ROL_ORDER: Record<Rol, number> = { admin: 0, presidente: 1, vecino: 2 };

type OrdenTipo = 'nombre' | 'rol';

/* ─── Helpers ─── */
function iniciales(nombre: string): string {
  return nombre
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? '')
    .join('');
}

function lineaVivienda(p: Perfil): string | null {
  // Prioriza campos individuales; si no existen, usa numero_piso legacy
  const partes: string[] = [];
  if (p.torre)  partes.push(`Torre ${p.torre}`);
  if (p.piso)   partes.push(`Piso ${p.piso}`);
  if (p.puerta) partes.push(`Puerta ${p.puerta}`);
  if (partes.length) return partes.join(' · ');
  return p.numero_piso ?? null;   // fallback al campo combinado antiguo
}

/* ─── Componente ─── */
export default function VecinosPage() {
  const router = useRouter();
  const { perfil: yo, loading: authLoading } = useAuth();

  const [vecinos, setVecinos] = useState<Perfil[]>([]);
  const [loading, setLoading]   = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [orden, setOrden]       = useState<OrdenTipo>('nombre');

  /* ── Fetch único, indexado ── */
  useEffect(() => {
    if (yo?.comunidad_id) fetchVecinos(yo.comunidad_id);
  }, [yo?.comunidad_id]);

  async function fetchVecinos(comunidadId: string) {
    setLoading(true);
    try {
      const q = query(
        collection(db, 'perfiles'),
        where('comunidad_id', '==', comunidadId),
        orderBy('nombre_completo', 'asc')          // usa el índice compuesto existente
      );
      const snap = await getDocs(q);
      setVecinos(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Perfil)));
    } catch {
      toast.error('Error al cargar los vecinos');
    } finally {
      setLoading(false);
    }
  }

  /* ── Lista derivada: búsqueda + orden (sin queries extra) ── */
  const listaFiltrada = useMemo(() => {
    const termino = busqueda.trim().toLowerCase();

    let resultado = termino
      ? vecinos.filter((v) =>
          v.nombre_completo.toLowerCase().includes(termino) ||
          lineaVivienda(v)?.toLowerCase().includes(termino)
        )
      : [...vecinos];

    if (orden === 'rol') {
      resultado.sort((a, b) =>
        ROL_ORDER[a.rol] - ROL_ORDER[b.rol] ||
        a.nombre_completo.localeCompare(b.nombre_completo)
      );
    }
    // orden === 'nombre' ya viene de Firestore en orden ascendente

    return resultado;
  }, [vecinos, busqueda, orden]);

  /* ── Contadores de roles ── */
  const contadores = useMemo(() => ({
    total:      vecinos.length,
    admins:     vecinos.filter((v) => v.rol === 'admin').length,
    presidentes:vecinos.filter((v) => v.rol === 'presidente').length,
    vecinos:    vecinos.filter((v) => v.rol === 'vecino').length,
  }), [vecinos]);

  /* ── Loading ── */
  if (authLoading || loading) {
    return (
      <div className="px-4 py-5 space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="w-8 h-8 rounded-full" />
          <Skeleton className="h-7 w-40" />
        </div>
        <Skeleton className="h-10 w-full rounded-xl" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <Skeleton className="w-11 h-11 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-5 w-20 rounded-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-5 space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost" size="icon"
            className="w-8 h-8 -ml-1"
            onClick={() => router.back()}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-finca-dark">Vecinos</h1>
            <p className="text-xs text-muted-foreground">
              {contadores.total} en tu comunidad
            </p>
          </div>
        </div>

        {/* Toggle orden */}
        <Button
          variant="outline"
          size="sm"
          className="text-xs gap-1.5 border-finca-coral/40 text-finca-coral hover:bg-finca-peach/20"
          onClick={() => setOrden((o) => o === 'nombre' ? 'rol' : 'nombre')}
        >
          <ArrowUpDown className="w-3.5 h-3.5" />
          {orden === 'nombre' ? 'Por nombre' : 'Por rol'}
        </Button>
      </div>

      {/* ── Chips resumen ── */}
      {contadores.total > 0 && (
        <div className="flex gap-2 flex-wrap">
          {contadores.admins > 0 && (
            <Badge className="bg-finca-coral text-white border-0 text-[10px]">
              {contadores.admins} {contadores.admins === 1 ? 'Admin' : 'Admins'}
            </Badge>
          )}
          {contadores.presidentes > 0 && (
            <Badge className="bg-finca-peach/70 text-finca-coral border-0 text-[10px]">
              {contadores.presidentes} {contadores.presidentes === 1 ? 'Presidente' : 'Presidentes'}
            </Badge>
          )}
          {contadores.vecinos > 0 && (
            <Badge className="bg-gray-100 text-gray-600 border-0 text-[10px]">
              {contadores.vecinos} {contadores.vecinos === 1 ? 'Vecino' : 'Vecinos'}
            </Badge>
          )}
        </div>
      )}

      {/* ── Buscador ── */}
      {vecinos.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Buscar por nombre o vivienda..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-9 pr-9 rounded-xl bg-muted/40 border-0 focus-visible:ring-1 focus-visible:ring-finca-coral"
          />
          {busqueda && (
            <button
              onClick={() => setBusqueda('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-finca-dark transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* ── Estado vacío (comunidad sin vecinos) ── */}
      {vecinos.length === 0 && (
        <div className="py-16 text-center space-y-3">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <Users className="w-7 h-7 text-muted-foreground/50" />
          </div>
          <p className="font-medium text-finca-dark">Sin vecinos registrados</p>
          <p className="text-sm text-muted-foreground">
            Comparte el link de invitación para que se unan
          </p>
        </div>
      )}

      {/* ── Estado vacío (sin resultados de búsqueda) ── */}
      {vecinos.length > 0 && listaFiltrada.length === 0 && (
        <div className="py-10 text-center space-y-2">
          <Search className="w-8 h-8 text-muted-foreground/30 mx-auto" />
          <p className="text-sm font-medium text-finca-dark">Sin resultados</p>
          <p className="text-xs text-muted-foreground">
            No hay vecinos que coincidan con «{busqueda}»
          </p>
        </div>
      )}

      {/* ── Lista de vecinos ── */}
      <div className="space-y-2">
        {listaFiltrada.map((vecino) => {
          const cfg      = ROL_CONFIG[vecino.rol] ?? ROL_CONFIG.vecino;
          const soyYo    = vecino.id === yo?.id;
          const vivienda = lineaVivienda(vecino);
          const ini      = iniciales(vecino.nombre_completo);

          return (
            <Card
              key={vecino.id}
              className={cn(
                'border-0 shadow-sm transition-colors',
                soyYo && 'border-l-4 border-l-finca-coral bg-finca-peach/5'
              )}
            >
              <CardContent className="p-4 flex items-center gap-3">

                {/* Avatar inicial */}
                <div
                  className={cn(
                    'w-11 h-11 rounded-full flex items-center justify-center shrink-0 font-bold text-sm',
                    vecino.rol === 'admin'      && 'bg-finca-coral text-white',
                    vecino.rol === 'presidente' && 'bg-finca-peach/60 text-finca-coral',
                    vecino.rol === 'vecino'     && 'bg-muted text-muted-foreground'
                  )}
                >
                  {ini}
                </div>

                {/* Info principal */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="font-medium text-sm text-finca-dark truncate leading-snug">
                      {vecino.nombre_completo}
                    </p>
                    {soyYo && (
                      <span className="text-[10px] text-finca-coral font-semibold shrink-0">
                        (tú)
                      </span>
                    )}
                  </div>
                  {vivienda ? (
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {vivienda}
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground/50 mt-0.5 italic">
                      Sin vivienda asignada
                    </p>
                  )}
                </div>

                {/* Badge de rol */}
                <Badge
                  className={cn(
                    'text-[10px] border-0 shrink-0 px-2',
                    cfg.bg, cfg.text
                  )}
                >
                  {cfg.label}
                </Badge>

              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Contador cuando hay búsqueda activa */}
      {busqueda && listaFiltrada.length > 0 && (
        <p className="text-center text-xs text-muted-foreground pb-2">
          {listaFiltrada.length} de {contadores.total} vecinos
        </p>
      )}

    </div>
  );
}
