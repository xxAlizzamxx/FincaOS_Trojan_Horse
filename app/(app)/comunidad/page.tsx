'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Users, Megaphone, Building2, Share2, Vote, ChevronRight, Wallet, CircleCheck as CheckCircle2, Clock, CircleAlert as AlertCircle, Plus, Check } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/firebase/client';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getDoc,
  doc as firestoreDoc,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { Perfil, Anuncio, Documento, Comunidad } from '@/types/database';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { format, isPast } from 'date-fns';
import { es } from 'date-fns/locale';

interface Votacion {
  id: string;
  titulo: string;
  descripcion: string | null;
  activa: boolean;
  created_at: string;
  opciones: { id: string; texto: string; votos: number }[];
}

interface CuotaItem {
  id: string;
  nombre: string;
  monto: number;
  fecha_limite: string;
  pagado: boolean;
  fecha_pago: string | null;
}

export default function ComunidadPage() {
  const { perfil } = useAuth();
  const router = useRouter();
  const [comunidad, setComunidad] = useState<Comunidad | null>(null);
  const [vecinos, setVecinos] = useState<Perfil[]>([]);
  const [anuncios, setAnuncios] = useState<Anuncio[]>([]);
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [votaciones, setVotaciones] = useState<Votacion[]>([]);
  const [cuotas, setCuotas] = useState<CuotaItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (perfil?.comunidad_id) fetchData();
  }, [perfil?.comunidad_id]);

  async function fetchData() {
    const cid = perfil!.comunidad_id!;

    // 1. Fetch comunidad by document id
    const comSnap = await getDoc(firestoreDoc(db, 'comunidades', cid));
    if (comSnap.exists()) {
      setComunidad({ id: comSnap.id, ...comSnap.data() } as Comunidad);
    }

    // 2. Fetch vecinos
    const vecSnap = await getDocs(
      query(
        collection(db, 'perfiles'),
        where('comunidad_id', '==', cid),
        orderBy('nombre_completo')
      )
    );
    setVecinos(vecSnap.docs.map((d: QueryDocumentSnapshot<DocumentData>) => ({ id: d.id, ...d.data() } as Perfil)));

    // 3. Fetch anuncios, then resolve autor names
    const anuncSnap = await getDocs(
      query(
        collection(db, 'anuncios'),
        where('comunidad_id', '==', cid),
        orderBy('fijado', 'desc'),
        orderBy('publicado_at', 'desc')
      )
    );
    const anunciosRaw = anuncSnap.docs.map((d: QueryDocumentSnapshot<DocumentData>) => ({ id: d.id, ...d.data() }));

    // Collect unique autor_id values and batch-fetch their profiles
    const autorIds = Array.from(new Set(anunciosRaw.map((a: any) => a.autor_id).filter(Boolean))) as string[];
    const autorMap: Record<string, string> = {};
    await Promise.all(
      autorIds.map(async (autorId) => {
        const autorSnap = await getDoc(firestoreDoc(db, 'perfiles', autorId));
        if (autorSnap.exists()) {
          autorMap[autorId] = (autorSnap.data() as any).nombre_completo;
        }
      })
    );
    const anunciosConAutor = anunciosRaw.map((a: any) => ({
      ...a,
      autor: a.autor_id ? { nombre_completo: autorMap[a.autor_id] || '' } : null,
    }));
    setAnuncios(anunciosConAutor as Anuncio[]);

    // 4. Fetch documentos
    const docSnap = await getDocs(
      query(
        collection(db, 'documentos'),
        where('comunidad_id', '==', cid),
        orderBy('created_at', 'desc')
      )
    );
    setDocumentos(docSnap.docs.map((d: QueryDocumentSnapshot<DocumentData>) => ({ id: d.id, ...d.data() } as Documento)));

    // 5. Fetch votaciones (new structure: opciones embedded, activa boolean)
    const votSnap = await getDocs(
      query(
        collection(db, 'votaciones'),
        where('comunidad_id', '==', cid),
        orderBy('created_at', 'desc')
      )
    );
    setVotaciones(votSnap.docs.map((d: QueryDocumentSnapshot<DocumentData>) => ({ id: d.id, ...d.data() } as Votacion)));

    // 6. Fetch cuotas de la comunidad + pago del vecino actual
    const cuotaSnap = await getDocs(
      query(
        collection(db, 'cuotas'),
        where('comunidad_id', '==', cid),
        orderBy('fecha_limite', 'desc'),
        limit(6)
      )
    );
    const cuotasItems: CuotaItem[] = await Promise.all(
      cuotaSnap.docs.map(async (cuotaDoc) => {
        const data = cuotaDoc.data();
        const pagoSnap = await getDoc(firestoreDoc(db, 'cuotas', cuotaDoc.id, 'pagos', perfil!.id));
        const pagado = pagoSnap.exists() && pagoSnap.data()?.estado === 'pagado';
        return {
          id: cuotaDoc.id,
          nombre: data.nombre ?? '',
          monto: data.monto ?? 0,
          fecha_limite: data.fecha_limite ?? '',
          pagado,
          fecha_pago: pagoSnap.data()?.fecha_pago ?? null,
        };
      })
    );
    setCuotas(cuotasItems);

    setLoading(false);
  }

  async function compartirLink() {
    if (!comunidad?.codigo) return;
    const url = `${process.env.NEXT_PUBLIC_APP_URL || window.location.origin}/invite/${comunidad.codigo}`;
    if (navigator.share) {
      navigator.share({ title: 'Únete a mi comunidad en FincaOS', text: 'Únete a nuestra comunidad con este enlace:', url });
    } else {
      navigator.clipboard.writeText(url);
      toast.success('Link de invitación copiado');
    }
  }

  const esAdmin = perfil?.rol === 'admin' || perfil?.rol === 'presidente';
  const rolLabel: Record<string, string> = { vecino: 'Vecino', presidente: 'Presidente', admin: 'Administrador' };
  const rolColor: Record<string, string> = {
    vecino: 'bg-gray-100 text-gray-600',
    presidente: 'bg-finca-peach/50 text-finca-coral',
    admin: 'bg-finca-coral text-white',
  };

  if (loading) {
    return (
      <div className="px-4 py-5 space-y-4">
        <div className="space-y-1">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <div className="space-y-3 pt-2">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-5 space-y-4">
      <div className="space-y-0.5">
        <h1 className="text-2xl font-semibold text-finca-dark">Comunidad</h1>
        {comunidad && <p className="text-sm text-muted-foreground">{comunidad.nombre}</p>}
      </div>

      {comunidad && (
        <Card className="bg-gradient-to-r from-finca-coral to-finca-salmon text-white border-0 overflow-hidden">
          <CardContent className="p-4 flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 opacity-80" />
                <p className="font-semibold">{comunidad.nombre}</p>
              </div>
              {comunidad.direccion && <p className="text-sm opacity-80">{comunidad.direccion}</p>}
              <div className="flex items-center gap-4 pt-1">
                <div className="text-center">
                  <p className="text-xl font-bold">{vecinos.length}</p>
                  <p className="text-xs opacity-70">Vecinos</p>
                </div>
                {comunidad.num_viviendas > 0 && (
                  <div className="text-center">
                    <p className="text-xl font-bold">{comunidad.num_viviendas}</p>
                    <p className="text-xs opacity-70">Viviendas</p>
                  </div>
                )}
                <div className="text-center">
                  <p className="text-xl font-bold">{votaciones.filter((v) => v.activa).length}</p>
                  <p className="text-xs opacity-70">Votaciones</p>
                </div>
              </div>
            </div>
            <Button size="sm" variant="secondary" className="bg-white/20 text-white border-0 hover:bg-white/30 shrink-0" onClick={compartirLink}>
              <Share2 className="w-3.5 h-3.5 mr-1.5" />
              Invitar
            </Button>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="tablón">
        <TabsList className="w-full grid grid-cols-5 text-[11px]">
          <TabsTrigger value="tablón">Tablón</TabsTrigger>
          <TabsTrigger value="votaciones">Votos</TabsTrigger>
          <TabsTrigger value="finanzas">Cuotas</TabsTrigger>
          <TabsTrigger value="vecinos">Vecinos</TabsTrigger>
          <TabsTrigger value="docs">Docs</TabsTrigger>
        </TabsList>

        <TabsContent value="tablón" className="mt-4 space-y-3">
          {anuncios.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <Megaphone className="w-10 h-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm font-medium text-finca-dark">Sin anuncios</p>
              <p className="text-xs text-muted-foreground">El administrador publicará los anuncios aquí</p>
            </div>
          ) : (
            anuncios.map((anuncio) => (
              <Card key={anuncio.id} className={cn('border-0 shadow-sm', anuncio.fijado && 'border-l-4 border-l-finca-coral')}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      {anuncio.fijado && <span className="text-[10px] font-semibold text-finca-coral uppercase tracking-wide block mb-0.5">Fijado</span>}
                      <p className="font-semibold text-sm text-finca-dark">{anuncio.titulo}</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{anuncio.contenido}</p>
                  <div className="flex items-center justify-between pt-1">
                    <p className="text-[11px] text-muted-foreground">{(anuncio.autor as any)?.nombre_completo?.split(' ')[0]}</p>
                    <p className="text-[11px] text-muted-foreground">{format(new Date(anuncio.publicado_at), "d MMM", { locale: es })}</p>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="votaciones" className="mt-4 space-y-3">
          {/* Resumen rápido */}
          {votaciones.slice(0, 2).map((votacion) => {
            const totalVotos = votacion.opciones.reduce((s, o) => s + o.votos, 0);
            return (
              <Card key={votacion.id} className="border-0 shadow-sm">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Badge className={cn('text-[10px] border-0', votacion.activa ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                      {votacion.activa ? 'Activa' : 'Cerrada'}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">{totalVotos} votos</span>
                  </div>
                  <p className="font-semibold text-sm text-finca-dark leading-snug">{votacion.titulo}</p>
                  {votacion.descripcion && (
                    <p className="text-xs text-muted-foreground line-clamp-1">{votacion.descripcion}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {votaciones.length === 0 && (
            <div className="py-8 text-center space-y-2">
              <Vote className="w-10 h-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm font-medium text-finca-dark">Sin votaciones</p>
              <p className="text-xs text-muted-foreground">El presidente puede crear votaciones comunitarias</p>
            </div>
          )}

          <Button
            className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white"
            onClick={() => router.push('/votos')}
          >
            <Vote className="w-4 h-4 mr-2" />
            {votaciones.length > 0 ? 'Ver todas las votaciones' : 'Ir a votaciones'}
          </Button>
        </TabsContent>

        <TabsContent value="finanzas" className="mt-4 space-y-3">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {esAdmin ? 'Cuotas de tu comunidad' : 'Estado de tus cuotas comunitarias'}
            </p>
            {esAdmin && (
              <button
                onClick={() => router.push('/cuotas/nueva')}
                className="flex items-center gap-1 text-xs font-medium text-finca-coral bg-finca-peach/30 hover:bg-finca-peach/50 px-2.5 py-1 rounded-full transition-colors"
              >
                <Plus className="w-3 h-3" />
                Nueva cuota
              </button>
            )}
          </div>

          {cuotas.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <Wallet className="w-10 h-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm font-medium text-finca-dark">Sin cuotas registradas</p>
              <p className="text-xs text-muted-foreground">
                {esAdmin
                  ? 'Crea una cuota y se asignará a todos los vecinos'
                  : 'El administrador registrará el estado de tus cuotas aquí'}
              </p>
              {esAdmin && (
                <button
                  onClick={() => router.push('/cuotas/nueva')}
                  className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-finca-coral bg-finca-peach/30 hover:bg-finca-peach/50 px-3 py-1.5 rounded-full transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Crear primera cuota
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Resumen estado */}
              {(() => {
                const pendientes = cuotas.filter((c) => !c.pagado).length;
                const alDia = pendientes === 0;
                return (
                  <Card className={cn('border-0 shadow-sm border-l-4', alDia ? 'border-l-green-500' : 'border-l-red-400')}>
                    <CardContent className="p-3 flex items-center gap-2">
                      {alDia ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                      )}
                      <p className={cn('font-semibold text-sm', alDia ? 'text-green-700' : 'text-red-600')}>
                        {alDia ? 'Al corriente de pago' : `${pendientes} cuota${pendientes > 1 ? 's' : ''} pendiente${pendientes > 1 ? 's' : ''}`}
                      </p>
                    </CardContent>
                  </Card>
                );
              })()}

              <div className="space-y-2">
                {cuotas.map((cuota) => {
                  const vencida = !cuota.pagado && cuota.fecha_limite && isPast(new Date(cuota.fecha_limite));
                  return (
                    <Card key={cuota.id} className={cn('border-0 shadow-sm overflow-hidden', cuota.pagado && 'opacity-70')}>
                      <div className={cn('h-1', cuota.pagado ? 'bg-green-400' : vencida ? 'bg-red-500' : 'bg-finca-coral')} />
                      <CardContent className="p-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-finca-dark truncate">{cuota.nombre}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {cuota.pagado && cuota.fecha_pago
                              ? `✓ Pagado ${format(new Date(cuota.fecha_pago), "d MMM", { locale: es })}`
                              : cuota.fecha_limite
                              ? `Límite: ${format(new Date(cuota.fecha_limite), "d MMM yyyy", { locale: es })}`
                              : ''}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-bold text-finca-dark">
                            {new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cuota.monto)}
                          </p>
                          <Badge className={cn('text-[10px] border gap-1 mt-0.5',
                            cuota.pagado
                              ? 'bg-green-100 text-green-700 border-green-200'
                              : 'bg-red-100 text-red-700 border-red-200'
                          )}>
                            {cuota.pagado ? <><Check className="w-2.5 h-2.5" />Pagado</> : <><Clock className="w-2.5 h-2.5" />Pendiente</>}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <Button
                className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white"
                onClick={() => router.push('/cuotas')}
              >
                <Wallet className="w-4 h-4 mr-2" />
                Ver todas las cuotas
              </Button>
            </>
          )}
        </TabsContent>

        <TabsContent value="vecinos" className="mt-4 space-y-3">
          {/* Vista previa: primeros 3 vecinos */}
          {vecinos.slice(0, 3).map((v) => (
            <Card key={v.id} className="border-0 shadow-sm">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-finca-peach flex items-center justify-center shrink-0">
                  <span className="font-semibold text-finca-coral text-sm">
                    {v.nombre_completo.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-finca-dark truncate">{v.nombre_completo}</p>
                  {v.numero_piso && (
                    <p className="text-xs text-muted-foreground">{v.numero_piso}</p>
                  )}
                </div>
                <Badge className={cn('text-[10px] border-0', rolColor[v.rol])}>{rolLabel[v.rol]}</Badge>
              </CardContent>
            </Card>
          ))}

          <Button
            className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white"
            onClick={() => router.push('/vecinos')}
          >
            <Users className="w-4 h-4 mr-2" />
            Ver todos los vecinos ({vecinos.length})
          </Button>
        </TabsContent>

        <TabsContent value="docs" className="mt-4 space-y-3">
          {/* Vista previa de últimos 2 documentos */}
          {documentos.slice(0, 2).map((documento) => (
            <Card key={documento.id} className="border-0 shadow-sm">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-finca-peach/50 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-finca-coral" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-finca-dark truncate">{documento.nombre}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {format(new Date(documento.created_at), "d MMM yyyy", { locale: es })}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}

          {documentos.length === 0 && (
            <div className="py-8 text-center space-y-2">
              <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm font-medium text-finca-dark">Sin documentos</p>
              <p className="text-xs text-muted-foreground">El administrador subirá estatutos y actas aquí</p>
            </div>
          )}

          <Button
            className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white"
            onClick={() => router.push('/docs')}
          >
            <FileText className="w-4 h-4 mr-2" />
            {documentos.length > 0 ? 'Ver todos los documentos' : 'Ir a documentos'}
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}
