'use client';

import { useEffect, useState } from 'react';
import { FileText, Users, Megaphone, Building2, Share2, Vote, ChevronRight, Wallet, CircleCheck as CheckCircle2, Clock, CircleAlert as AlertCircle } from 'lucide-react';
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
  addDoc,
  doc as firestoreDoc,
} from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { Perfil, Anuncio, Documento, Comunidad } from '@/types/database';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface Votacion {
  id: string;
  titulo: string;
  descripcion: string | null;
  estado: 'abierta' | 'cerrada';
  fecha_cierre: string | null;
  created_at: string;
  opciones?: { id: string; texto: string; orden: number }[];
  respuestas?: { opcion_id: string; vecino_id: string }[];
}

interface Cuota {
  id: string;
  vecino_id: string;
  mes_anio: string;
  importe: number;
  estado: 'al_dia' | 'pendiente' | 'moroso';
  pagado_at: string | null;
}

export default function ComunidadPage() {
  const { perfil } = useAuth();
  const [comunidad, setComunidad] = useState<Comunidad | null>(null);
  const [vecinos, setVecinos] = useState<Perfil[]>([]);
  const [anuncios, setAnuncios] = useState<Anuncio[]>([]);
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [votaciones, setVotaciones] = useState<Votacion[]>([]);
  const [cuotas, setCuotas] = useState<Cuota[]>([]);
  const [loading, setLoading] = useState(true);
  const [votando, setVotando] = useState<string | null>(null);

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
    setVecinos(vecSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Perfil)));

    // 3. Fetch anuncios, then resolve autor names
    const anuncSnap = await getDocs(
      query(
        collection(db, 'anuncios'),
        where('comunidad_id', '==', cid),
        orderBy('fijado', 'desc'),
        orderBy('publicado_at', 'desc')
      )
    );
    const anunciosRaw = anuncSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

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
    setDocumentos(docSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Documento)));

    // 5. Fetch votaciones, then for each fetch opciones and respuestas
    const votSnap = await getDocs(
      query(
        collection(db, 'votaciones'),
        where('comunidad_id', '==', cid),
        orderBy('created_at', 'desc')
      )
    );
    const votacionesRaw = votSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const votacionesCompletas: Votacion[] = await Promise.all(
      votacionesRaw.map(async (v: any) => {
        const [opcionesSnap, respuestasSnap] = await Promise.all([
          getDocs(
            query(
              collection(db, 'opciones_votacion'),
              where('votacion_id', '==', v.id)
            )
          ),
          getDocs(
            query(
              collection(db, 'respuestas_votacion'),
              where('votacion_id', '==', v.id)
            )
          ),
        ]);
        return {
          ...v,
          opciones: opcionesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
          respuestas: respuestasSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        } as Votacion;
      })
    );
    setVotaciones(votacionesCompletas);

    // 6. Fetch cuotas for this vecino
    const cuotaSnap = await getDocs(
      query(
        collection(db, 'cuotas_vecinos'),
        where('vecino_id', '==', perfil!.id),
        orderBy('mes_anio', 'desc'),
        limit(6)
      )
    );
    setCuotas(cuotaSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Cuota)));

    setLoading(false);
  }

  async function votar(votacionId: string, opcionId: string) {
    if (!perfil) return;
    setVotando(votacionId);

    try {
      // Check for duplicate vote since Firestore has no unique constraints
      const existingSnap = await getDocs(
        query(
          collection(db, 'respuestas_votacion'),
          where('votacion_id', '==', votacionId),
          where('vecino_id', '==', perfil.id)
        )
      );

      if (!existingSnap.empty) {
        toast.error('Ya has votado en esta votación');
      } else {
        await addDoc(collection(db, 'respuestas_votacion'), {
          votacion_id: votacionId,
          opcion_id: opcionId,
          vecino_id: perfil.id,
        });
        toast.success('Voto registrado correctamente');
        fetchData();
      }
    } catch (error) {
      toast.error('Error al registrar tu voto');
    }

    setVotando(null);
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

  const rolLabel: Record<string, string> = { vecino: 'Vecino', presidente: 'Presidente', admin: 'Administrador' };
  const rolColor: Record<string, string> = {
    vecino: 'bg-gray-100 text-gray-600',
    presidente: 'bg-finca-peach/50 text-finca-coral',
    admin: 'bg-finca-coral text-white',
  };

  const cuotaConfig = {
    al_dia: { label: 'Al día', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
    pendiente: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
    moroso: { label: 'Moroso', color: 'bg-red-100 text-red-700', icon: AlertCircle },
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
                  <p className="text-xl font-bold">{votaciones.filter((v) => v.estado === 'abierta').length}</p>
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
          {votaciones.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <Vote className="w-10 h-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm font-medium text-finca-dark">Sin votaciones</p>
              <p className="text-xs text-muted-foreground">El presidente o administrador puede crear una votación</p>
            </div>
          ) : (
            votaciones.map((votacion) => {
              const totalVotos = votacion.respuestas?.length || 0;
              const miVoto = votacion.respuestas?.find((r) => r.vecino_id === perfil?.id);
              const yaVote = !!miVoto;

              return (
                <Card key={votacion.id} className="border-0 shadow-sm">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={cn('text-[10px] border-0', votacion.estado === 'abierta' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                            {votacion.estado === 'abierta' ? 'Abierta' : 'Cerrada'}
                          </Badge>
                          {votacion.fecha_cierre && votacion.estado === 'abierta' && (
                            <span className="text-[11px] text-muted-foreground">
                              Cierra {formatDistanceToNow(new Date(votacion.fecha_cierre), { addSuffix: true, locale: es })}
                            </span>
                          )}
                        </div>
                        <p className="font-semibold text-sm text-finca-dark">{votacion.titulo}</p>
                        {votacion.descripcion && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{votacion.descripcion}</p>}
                      </div>
                    </div>

                    <div className="space-y-2">
                      {(votacion.opciones || []).sort((a, b) => a.orden - b.orden).map((opcion) => {
                        const votosOpcion = votacion.respuestas?.filter((r) => r.opcion_id === opcion.id).length || 0;
                        const porcentaje = totalVotos > 0 ? Math.round((votosOpcion / totalVotos) * 100) : 0;
                        const esMiOpcion = miVoto?.opcion_id === opcion.id;

                        return (
                          <div key={opcion.id} className="space-y-1">
                            {!yaVote && votacion.estado === 'abierta' ? (
                              <button
                                onClick={() => votar(votacion.id, opcion.id)}
                                disabled={votando === votacion.id}
                                className="w-full text-left px-3 py-2.5 rounded-xl border border-border hover:border-finca-coral hover:bg-finca-peach/10 transition-all text-sm font-medium text-finca-dark"
                              >
                                {opcion.texto}
                              </button>
                            ) : (
                              <div className={cn('rounded-xl overflow-hidden', esMiOpcion && 'ring-2 ring-finca-coral')}>
                                <div className="flex items-center justify-between px-3 py-2 bg-muted/50">
                                  <span className="text-sm font-medium text-finca-dark flex items-center gap-1.5">
                                    {esMiOpcion && <CheckCircle2 className="w-3.5 h-3.5 text-finca-coral" />}
                                    {opcion.texto}
                                  </span>
                                  <span className="text-xs font-semibold text-finca-dark">{porcentaje}%</span>
                                </div>
                                <div className="h-1.5 w-full bg-muted overflow-hidden rounded-none">
                                  <div className="h-full bg-finca-coral transition-all" style={{ width: `${porcentaje}%` }} />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {totalVotos} {totalVotos === 1 ? 'voto' : 'votos'} registrados
                      {yaVote && ' · Ya has votado'}
                    </p>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="finanzas" className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">Estado de tus cuotas comunitarias</p>
          {cuotas.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <Wallet className="w-10 h-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm font-medium text-finca-dark">Sin cuotas registradas</p>
              <p className="text-xs text-muted-foreground">El administrador registrará el estado de tus cuotas aquí</p>
            </div>
          ) : (
            <>
              <Card className={cn('border-0 shadow-sm', cuotas[0]?.estado === 'al_dia' ? 'border-l-4 border-l-green-500' : 'border-l-4 border-l-red-400')}>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground mb-1">Estado actual</p>
                  <div className="flex items-center gap-2">
                    {cuotas[0]?.estado === 'al_dia' ? (
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-red-500" />
                    )}
                    <p className={cn('font-bold text-lg', cuotas[0]?.estado === 'al_dia' ? 'text-green-700' : 'text-red-600')}>
                      {cuotas[0]?.estado === 'al_dia' ? 'Al corriente de pago' : cuotas[0]?.estado === 'moroso' ? 'Cuenta en mora' : 'Cuota pendiente'}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-2">
                {cuotas.map((cuota) => {
                  const config = cuotaConfig[cuota.estado];
                  const Icon = config.icon;
                  return (
                    <Card key={cuota.id} className="border-0 shadow-sm">
                      <CardContent className="p-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', cuota.estado === 'al_dia' ? 'bg-green-50' : cuota.estado === 'moroso' ? 'bg-red-50' : 'bg-yellow-50')}>
                            <Icon className={cn('w-4.5 h-4.5', cuota.estado === 'al_dia' ? 'text-green-600' : cuota.estado === 'moroso' ? 'text-red-500' : 'text-yellow-600')} />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-finca-dark">{cuota.mes_anio}</p>
                            {cuota.pagado_at && (
                              <p className="text-xs text-muted-foreground">Pagado {format(new Date(cuota.pagado_at), "d MMM", { locale: es })}</p>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-finca-dark">{cuota.importe.toFixed(2)}€</p>
                          <Badge className={cn('text-[10px] border-0', config.color)}>{config.label}</Badge>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="vecinos" className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground mb-3">{vecinos.length} vecinos en la comunidad</p>
          {vecinos.map((v) => (
            <Card key={v.id} className="border-0 shadow-sm">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-finca-peach flex items-center justify-center shrink-0">
                  <span className="font-semibold text-finca-coral text-sm">{v.nombre_completo.charAt(0)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-finca-dark truncate">{v.nombre_completo}</p>
                  {v.numero_piso && <p className="text-xs text-muted-foreground">Piso {v.numero_piso}</p>}
                </div>
                <Badge className={cn('text-[10px] border-0', rolColor[v.rol])}>{rolLabel[v.rol]}</Badge>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="docs" className="mt-4 space-y-2">
          {documentos.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm font-medium text-finca-dark">Sin documentos</p>
              <p className="text-xs text-muted-foreground">Pídele a tu administrador que suba los estatutos y actas</p>
            </div>
          ) : (
            documentos.map((doc) => (
              <Card key={doc.id} className="border-0 shadow-sm">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-finca-peach/50 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-finca-coral" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-finca-dark truncate">{doc.nombre}</p>
                    {doc.descripcion && <p className="text-xs text-muted-foreground truncate">{doc.descripcion}</p>}
                    <p className="text-[11px] text-muted-foreground mt-0.5">{format(new Date(doc.created_at), "d MMM yyyy", { locale: es })}</p>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
