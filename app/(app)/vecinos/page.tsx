'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Search, Users, X, ArrowUpDown,
  ChevronRight, Check, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  collection, query, where, orderBy, getDocs,
  doc, updateDoc,
  QueryDocumentSnapshot, DocumentData,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button }    from '@/components/ui/button';
import { Input }     from '@/components/ui/input';
import { Badge }     from '@/components/ui/badge';
import { Skeleton }  from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { Perfil, Rol } from '@/types/database';

/* ─── Configuración visual de roles ────────────────────────────────────────── */
const ROL_CONFIG: Record<string, {
  label:       string;
  descripcion: string;
  bg:          string;
  text:        string;
  hover:       string;
  emoji:       string;
  ring:        string;   // ring de color en el avatar
}> = {
  vecino:     {
    label:       'Vecino',
    descripcion: 'Acceso estándar a la comunidad',
    bg:          'bg-gray-100',
    text:        'text-gray-600',
    hover:       'hover:bg-gray-400 hover:text-white',
    emoji:       '🏠',
    ring:        'ring-gray-300',
  },
  admin:      {
    label:       'Administrador',
    descripcion: 'Gestiona cuotas, docs y configuración',
    bg:          'bg-finca-coral',
    text:        'text-white',
    hover:       'hover:bg-finca-coral/80 hover:text-white',
    emoji:       '⚙️',
    ring:        'ring-finca-coral',
  },
  mediador:   {
    label:       'Mediador',
    descripcion: 'Gestiona y resuelve conflictos vecinales',
    bg:          'bg-violet-100',
    text:        'text-violet-700',
    hover:       'hover:bg-violet-500 hover:text-white',
    emoji:       '⚖️',
    ring:        'ring-violet-400',
  },
  presidente: {
    label:       'Presidente',
    descripcion: 'Máxima autoridad de la comunidad',
    bg:          'bg-finca-peach/70',
    text:        'text-finca-coral',
    hover:       'hover:bg-finca-coral hover:text-white',
    emoji:       '👑',
    ring:        'ring-finca-coral/70',
  },
};

/* Roles asignables por el presidente / admin */
const ROLES_ASIGNABLES: Rol[] = ['vecino', 'admin', 'mediador'];

/* Orden de aparición de roles para sort secundario */
const ROL_ORDER: Record<string, number> = {
  presidente: 0,
  admin:      1,
  mediador:   2,
  vecino:     3,
};

type OrdenTipo = 'nombre' | 'rol';

/* ─── Helpers ───────────────────────────────────────────────────────────────── */
function iniciales(nombre: string): string {
  return nombre
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? '')
    .join('');
}

function lineaVivienda(p: Perfil): string | null {
  const partes: string[] = [];
  if (p.torre)  partes.push(`Torre ${p.torre}`);
  if (p.piso)   partes.push(`Piso ${p.piso}`);
  if (p.puerta) partes.push(`Puerta ${p.puerta}`);
  if (partes.length) return partes.join(' · ');
  return p.numero_piso ?? null;
}

/* ─── Avatar ─────────────────────────────────────────────────────────────────
 * Muestra la foto de Google si está disponible; si no, muestra las iniciales
 * con el color del rol. El ring exterior indica siempre el rol actual.
 * ─────────────────────────────────────────────────────────────────────────── */
function AvatarVecino({
  perfil,
  size = 'md',
}: {
  perfil: Perfil;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [imgError, setImgError] = useState(false);
  const cfg = ROL_CONFIG[perfil.rol] ?? ROL_CONFIG.vecino;
  const ini = iniciales(perfil.nombre_completo);

  const sizeClasses = {
    sm: 'w-10 h-10 text-sm',
    md: 'w-11 h-11 text-sm',
    lg: 'w-14 h-14 text-base',
  }[size];

  const hasPhoto = !!perfil.avatar_url && !imgError;

  return (
    <div
      className={cn(
        'rounded-full shrink-0 ring-2 overflow-hidden flex items-center justify-center font-bold',
        sizeClasses,
        cfg.ring,
        // fondo solo si no hay foto
        !hasPhoto && perfil.rol === 'admin'      && 'bg-finca-coral text-white',
        !hasPhoto && perfil.rol === 'presidente' && 'bg-finca-peach/60 text-finca-coral',
        !hasPhoto && perfil.rol === 'mediador'   && 'bg-violet-100 text-violet-700',
        !hasPhoto && perfil.rol === 'vecino'     && 'bg-muted text-muted-foreground',
      )}
    >
      {hasPhoto ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={perfil.avatar_url!}
          alt={perfil.nombre_completo}
          referrerPolicy="no-referrer"   // necesario para URLs de Google
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <span>{ini}</span>
      )}
    </div>
  );
}

/* ─── Componente principal ──────────────────────────────────────────────────── */
export default function VecinosPage() {
  const router = useRouter();
  const { perfil: yo, loading: authLoading } = useAuth();

  const [vecinos,   setVecinos]   = useState<Perfil[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [busqueda,  setBusqueda]  = useState('');
  const [orden,     setOrden]     = useState<OrdenTipo>('nombre');

  /* ── Sheet de cambio de rol ── */
  const [vecinoSeleccionado, setVecinoSeleccionado] = useState<Perfil | null>(null);
  const [rolNuevo,           setRolNuevo]           = useState<Rol | null>(null);
  const [guardando,          setGuardando]          = useState(false);

  const esPresidente = yo?.rol === 'presidente' || yo?.rol === 'admin';

  /* ── Fetch ── */
  useEffect(() => {
    if (yo?.comunidad_id) fetchVecinos(yo.comunidad_id);
  }, [yo?.comunidad_id]);

  async function fetchVecinos(comunidadId: string) {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, 'perfiles'),
          where('comunidad_id', '==', comunidadId),
          orderBy('nombre_completo', 'asc'),
        ),
      );
      setVecinos(
        snap.docs.map(
          (d: QueryDocumentSnapshot<DocumentData>) =>
            ({ id: d.id, ...d.data() } as Perfil),
        ),
      );
    } catch {
      toast.error('Error al cargar los vecinos');
    } finally {
      setLoading(false);
    }
  }

  /* ── Abrir Sheet ── */
  function abrirCambioRol(vecino: Perfil) {
    setVecinoSeleccionado(vecino);
    setRolNuevo(vecino.rol);
  }

  /* ── Guardar nuevo rol ── */
  async function guardarRol() {
    if (!vecinoSeleccionado || !rolNuevo || rolNuevo === vecinoSeleccionado.rol) return;
    setGuardando(true);
    try {
      await updateDoc(doc(db, 'perfiles', vecinoSeleccionado.id), { rol: rolNuevo });
      setVecinos((prev) =>
        prev.map((v) =>
          v.id === vecinoSeleccionado.id ? { ...v, rol: rolNuevo } : v,
        ),
      );
      toast.success(`Rol actualizado a ${ROL_CONFIG[rolNuevo].label}`);
      setVecinoSeleccionado(null);
    } catch {
      toast.error('Error al actualizar el rol');
    } finally {
      setGuardando(false);
    }
  }

  /* ── Lista derivada ── */
  const listaFiltrada = useMemo(() => {
    const termino = busqueda.trim().toLowerCase();
    let resultado = termino
      ? vecinos.filter(
          (v) =>
            v.nombre_completo.toLowerCase().includes(termino) ||
            lineaVivienda(v)?.toLowerCase().includes(termino),
        )
      : [...vecinos];

    if (orden === 'rol') {
      resultado.sort(
        (a, b) =>
          (ROL_ORDER[a.rol] ?? 9) - (ROL_ORDER[b.rol] ?? 9) ||
          a.nombre_completo.localeCompare(b.nombre_completo),
      );
    }
    return resultado;
  }, [vecinos, busqueda, orden]);

  /* ── Contadores ── */
  const contadores = useMemo(
    () => ({
      total:        vecinos.length,
      admins:       vecinos.filter((v) => v.rol === 'admin').length,
      presidentes:  vecinos.filter((v) => v.rol === 'presidente').length,
      mediadores:   vecinos.filter((v) => v.rol === 'mediador').length,
      vecinosCount: vecinos.filter((v) => v.rol === 'vecino').length,
    }),
    [vecinos],
  );

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
    <>
      <div className="px-4 py-5 space-y-4 pb-24">

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
          <Button
            variant="outline" size="sm"
            className="text-xs gap-1.5 border-finca-coral/40 text-finca-coral hover:bg-finca-peach/20"
            onClick={() => setOrden((o) => (o === 'nombre' ? 'rol' : 'nombre'))}
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            {orden === 'nombre' ? 'Por nombre' : 'Por rol'}
          </Button>
        </div>

        {/* ── Chips resumen ── */}
        {contadores.total > 0 && (
          <div className="flex gap-2 flex-wrap">
            {contadores.presidentes > 0 && (
              <Badge className="bg-finca-peach/70 text-finca-coral border-0 text-[10px]">
                👑 {contadores.presidentes}{' '}
                {contadores.presidentes === 1 ? 'Presidente' : 'Presidentes'}
              </Badge>
            )}
            {contadores.admins > 0 && (
              <Badge className="bg-finca-coral text-white border-0 text-[10px]">
                ⚙️ {contadores.admins}{' '}
                {contadores.admins === 1 ? 'Admin' : 'Admins'}
              </Badge>
            )}
            {contadores.mediadores > 0 && (
              <Badge className="bg-violet-100 text-violet-700 border-0 text-[10px]">
                ⚖️ {contadores.mediadores}{' '}
                {contadores.mediadores === 1 ? 'Mediador' : 'Mediadores'}
              </Badge>
            )}
            {contadores.vecinosCount > 0 && (
              <Badge className="bg-gray-100 text-gray-600 border-0 text-[10px]">
                🏠 {contadores.vecinosCount}{' '}
                {contadores.vecinosCount === 1 ? 'Vecino' : 'Vecinos'}
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

        {/* ── Estado vacío ── */}
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
            const cfg         = ROL_CONFIG[vecino.rol] ?? ROL_CONFIG.vecino;
            const soyYo       = vecino.id === yo?.id;
            const vivienda    = lineaVivienda(vecino);
            const puedeEditar = esPresidente && !soyYo && vecino.rol !== 'presidente';

            return (
              <Card
                key={vecino.id}
                onClick={() => puedeEditar && abrirCambioRol(vecino)}
                className={cn(
                  'border-0 shadow-sm transition-all',
                  soyYo      && 'border-l-4 border-l-finca-coral bg-finca-peach/5',
                  puedeEditar && 'cursor-pointer hover:shadow-md active:scale-[0.99]',
                )}
              >
                <CardContent className="p-4 flex items-center gap-3">

                  {/* ── Avatar con foto de Google ── */}
                  <AvatarVecino perfil={vecino} size="md" />

                  {/* ── Información ── */}
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

                  {/* ── Badge de rol + chevron ── */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge
                      className={cn(
                        'text-[10px] border-0 px-2 transition-colors duration-150',
                        cfg.bg, cfg.text, cfg.hover,
                      )}
                    >
                      {cfg.label}
                    </Badge>
                    {puedeEditar && (
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
                    )}
                  </div>

                </CardContent>
              </Card>
            );
          })}
        </div>

        {busqueda && listaFiltrada.length > 0 && (
          <p className="text-center text-xs text-muted-foreground pb-2">
            {listaFiltrada.length} de {contadores.total} vecinos
          </p>
        )}
      </div>

      {/* ══ Sheet: gestión de rol ══════════════════════════════════════════════ */}
      <Sheet
        open={!!vecinoSeleccionado}
        onOpenChange={(open) => !open && setVecinoSeleccionado(null)}
      >
        <SheetContent side="bottom" className="rounded-t-3xl px-0 pb-0">
          <SheetHeader className="px-5 pt-5 pb-4">
            <SheetTitle className="text-left text-base">Cambiar rol</SheetTitle>

            {/* ── Cabecera del vecino seleccionado con foto ── */}
            {vecinoSeleccionado && (
              <div className="flex items-center gap-3 mt-2">
                <AvatarVecino perfil={vecinoSeleccionado} size="lg" />
                <div>
                  <p className="font-semibold text-sm text-finca-dark">
                    {vecinoSeleccionado.nombre_completo}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Rol actual:{' '}
                    <span className="font-medium">
                      {ROL_CONFIG[vecinoSeleccionado.rol]?.label}
                    </span>
                  </p>
                  {lineaVivienda(vecinoSeleccionado) && (
                    <p className="text-xs text-muted-foreground/70 mt-0.5">
                      {lineaVivienda(vecinoSeleccionado)}
                    </p>
                  )}
                </div>
              </div>
            )}
          </SheetHeader>

          <Separator />

          {/* ── Opciones de rol ── */}
          <div className="px-4 py-3 space-y-2">
            {ROLES_ASIGNABLES.map((rol) => {
              const cfg    = ROL_CONFIG[rol];
              const activo = rolNuevo === rol;
              return (
                <button
                  key={rol}
                  onClick={() => setRolNuevo(rol)}
                  className={cn(
                    'w-full flex items-center gap-4 p-3.5 rounded-2xl border-2 transition-all text-left',
                    activo
                      ? 'border-finca-coral bg-finca-peach/20'
                      : 'border-transparent bg-muted/40 hover:bg-muted/60',
                  )}
                >
                  <span className="text-2xl">{cfg.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        'font-semibold text-sm',
                        activo ? 'text-finca-coral' : 'text-finca-dark',
                      )}
                    >
                      {cfg.label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {cfg.descripcion}
                    </p>
                  </div>
                  {activo && (
                    <div className="w-5 h-5 rounded-full bg-finca-coral flex items-center justify-center shrink-0">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* ── Botón guardar ── */}
          <div className="px-5 pt-2 pb-8">
            <Button
              className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-12 rounded-2xl font-semibold"
              disabled={guardando || rolNuevo === vecinoSeleccionado?.rol}
              onClick={guardarRol}
            >
              {guardando ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando…</>
              ) : rolNuevo === vecinoSeleccionado?.rol ? (
                'Selecciona un rol diferente'
              ) : (
                `Asignar como ${ROL_CONFIG[rolNuevo ?? 'vecino']?.label}`
              )}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
