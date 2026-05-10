'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, addDoc, getDocs, onSnapshot, updateDoc, doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Package, Plus, X, Clock, CheckCircle2, Loader2, UserCheck,
  Flame, Zap, Droplets, FileText, Building2, Truck, Bell, Mail, Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';

interface Paquete {
  id: string;
  destinatario_nombre: string;
  apartamento: string;
  vecino_id?: string;
  remitente?: string;
  tipo: string;
  descripcion?: string;
  estado: string;
  created_at: string;
  recibo_tipo?: string;
}

const tiposPaquete = [
  { value: 'paquete',         label: 'Paquete',         icon: Package  },
  { value: 'sobre',           label: 'Sobre / Carta',   icon: Mail     },
  { value: 'domicilio',       label: 'Domicilio',       icon: Truck    },
  { value: 'recibo',          label: 'Recibo',          icon: FileText },
];

const tiposRecibo = [
  { value: 'gas',           label: 'Gas',             icon: Flame,     color: 'bg-orange-50 text-orange-600 border-orange-200' },
  { value: 'luz',           label: 'Luz',             icon: Zap,       color: 'bg-yellow-50 text-yellow-600 border-yellow-200' },
  { value: 'agua',          label: 'Agua',            icon: Droplets,  color: 'bg-blue-50 text-blue-600 border-blue-200'       },
  { value: 'administracion',label: 'Administracion',  icon: Building2, color: 'bg-purple-50 text-purple-600 border-purple-200' },
  { value: 'otro',          label: 'Otro',            icon: FileText,  color: 'bg-gray-50 text-gray-600 border-gray-200'       },
];

const estadoConfig: Record<string, { label: string; color: string }> = {
  recibido:   { label: 'En porteria',  color: 'bg-amber-100 text-amber-700 border-amber-200'  },
  notificado: { label: 'Notificado',   color: 'bg-blue-100 text-blue-700 border-blue-200'     },
  entregado:  { label: 'Entregado',    color: 'bg-green-100 text-green-700 border-green-200'   },
};

interface Vecino { id: string; nombre_completo: string; torre?: string | null; piso?: string | null; puerta?: string | null; }

export default function PaqueteriaPage() {
  const { perfil, user } = useAuth();
  const [paquetes, setPaquetes] = useState<Paquete[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Vecino search
  const [vecinos, setVecinos] = useState<Vecino[]>([]);
  const [busquedaVecino, setBusquedaVecino] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Form
  const [nombre, setNombre] = useState('');
  const [apartamento, setApartamento] = useState('');
  const [vecinoId, setVecinoId] = useState('');
  const [remitente, setRemitente] = useState('');
  const [tipo, setTipo] = useState('paquete');
  const [reciboTipo, setReciboTipo] = useState('');
  const [descripcion, setDescripcion] = useState('');

  const comunidadId = perfil?.comunidad_id;

  // Load vecinos once for autocomplete
  useEffect(() => {
    if (!comunidadId) return;
    getDocs(query(collection(db, 'perfiles'), where('comunidad_id', '==', comunidadId)))
      .then(snap => setVecinos(snap.docs.map(d => ({ id: d.id, ...d.data() } as Vecino)).filter(v => v.nombre_completo)))
      .catch(() => {});
  }, [comunidadId]);

  const sugerencias = vecinos.filter(v =>
    busquedaVecino.length >= 2 &&
    v.nombre_completo.toLowerCase().includes(busquedaVecino.toLowerCase())
  ).slice(0, 6);

  function seleccionarVecino(v: Vecino) {
    setNombre(v.nombre_completo);
    setVecinoId(v.id);
    const apto = [v.torre && `Torre ${v.torre}`, v.piso && `Piso ${v.piso}`, v.puerta && `Apto ${v.puerta}`].filter(Boolean).join(' - ');
    setApartamento(apto || v.puerta || '');
    setBusquedaVecino(v.nombre_completo);
    setShowSuggestions(false);
  }

  useEffect(() => {
    if (!comunidadId) return;

    const q = query(
      collection(db, 'paqueteria'),
      where('comunidad_id', '==', comunidadId),
    );

    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Paquete))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setPaquetes(items);
      setLoading(false);
    }, (err) => { console.error('[Paqueteria] onSnapshot error:', err); setLoading(false); });

    return () => unsub();
  }, [comunidadId]);

  async function handleRegistrar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre || !apartamento || !comunidadId || !user) return;
    setSaving(true);

    try {
      const paqueteRef = await addDoc(collection(db, 'paqueteria'), {
        comunidad_id:        comunidadId,
        vigilante_id:        user.uid,
        destinatario_nombre: nombre,
        apartamento,
        ...(vecinoId ? { vecino_id: vecinoId } : {}),
        ...(remitente  ? { remitente }           : {}),
        tipo,
        ...(tipo === 'recibo' && reciboTipo ? { recibo_tipo: reciboTipo } : {}),
        descripcion:  descripcion || null,
        estado:       'recibido',
        created_at:   new Date().toISOString(),
        entregado_at: null,
      });

      // Push notification al vecino si está vinculado
      if (vecinoId) {
        const tipoLabel  = tipo === 'recibo' ? 'Recibo' : tipo === 'sobre' ? 'Carta / Sobre' : tipo === 'domicilio' ? 'Pedido a domicilio' : 'Paquete';
        const pushTitle  = `${tipoLabel} en portería`;
        const pushBody   = remitente ? `De: ${remitente}` : `Apdo. ${apartamento} — pasa a recogerlo`;
        fetch('/api/notificaciones/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            comunidad_id:  comunidadId,
            title:         pushTitle,
            body:          pushBody,
            url:           '/porteria',
            targetUserIds: [vecinoId],
          }),
        }).catch(() => {/* fire-and-forget */});
      }

      toast.success(tipo === 'recibo' ? 'Recibo registrado' : 'Paquete registrado');
      setShowForm(false);
      setNombre(''); setApartamento(''); setVecinoId(''); setRemitente(''); setTipo('paquete'); setReciboTipo(''); setDescripcion('');
    } catch (err) {
      console.error('[Paqueteria] Error:', err);
      toast.error('Error al registrar');
    } finally {
      setSaving(false);
    }
  }

  async function marcarEntregado(paqueteId: string) {
    try {
      await updateDoc(doc(db, 'paqueteria', paqueteId), {
        estado: 'entregado',
        entregado_at: new Date().toISOString(),
      });
      toast.success('Marcado como entregado');
    } catch (err) {
      console.error('[Paqueteria] Error:', err);
      toast.error('Error al actualizar');
    }
  }

  async function notificarVecino(p: Paquete) {
    if (!user || !comunidadId) return;

    // Buscar vecino por nombre del destinatario
    try {
      const snap = await getDocs(query(
        collection(db, 'perfiles'),
        where('comunidad_id', '==', comunidadId),
      ));
      const coincidencia = snap.docs.find((d: import('firebase/firestore').QueryDocumentSnapshot) => {
        const nombre = (d.data().nombre_completo || '').toLowerCase();
        return nombre.includes(p.destinatario_nombre.toLowerCase().split(' ')[0]);
      });

      if (!coincidencia) {
        toast.error('No se encontró el residente en el sistema');
        return;
      }

      const vecinoId     = coincidencia.id;
      const vecinoNombre = coincidencia.data().nombre_completo as string;
      const chatId  = `${comunidadId}_vigilante_${vecinoId}`;
      const chatRef = doc(db, 'chats_comunidad', chatId);
      const now = new Date().toISOString();

      await setDoc(chatRef, {
        comunidad_id:    comunidadId,
        tipo:            'vigilante',
        contraparte_id:  user.uid,
        contraparte_rol: 'vigilante',
        vecino_id:       vecinoId,
        updated_at:      now,
        created_at:      now,
      }, { merge: true });

      const reciboInfo = p.tipo === 'recibo' && p.recibo_tipo
        ? tiposRecibo.find(r => r.value === p.recibo_tipo)
        : null;

      const texto = p.tipo === 'recibo'
        ? `📄 Llego un recibo${reciboInfo ? ` de ${reciboInfo.label}` : ''} para su apartamento. Puede recogerlo en portería.`
        : `📦 Llego un paquete para su apartamento. Puede recogerlo en portería.`;

      await addDoc(collection(db, 'chats_comunidad', chatId, 'mensajes'), {
        sender_id:      user.uid,
        sender_rol:     'vigilante',
        texto,
        tipo:           'plantilla',
        plantilla_tipo: p.tipo === 'recibo' ? 'recibo' : 'paquete',
        paquete_id:     p.id,
        leido:          false,
        created_at:     now,
      });

      await updateDoc(chatRef, {
        ultimo_mensaje:   texto,
        no_leidos_vecino: 1,
        updated_at:       now,
      });

      await updateDoc(doc(db, 'paqueteria', p.id), { estado: 'notificado' });

      toast.success(`${vecinoNombre} notificado`);
    } catch (err) {
      console.error('[Paqueteria] Error notificando:', err);
      toast.error('Error al notificar al residente');
    }
  }

  const pendientes = paquetes.filter(p => p.estado !== 'entregado');
  const entregados = paquetes.filter(p => p.estado === 'entregado');

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-finca-dark">Paqueteria y recibos</h1>
          <p className="text-sm text-muted-foreground">Registro de paquetes, sobres y recibos</p>
        </div>
        <Button
          onClick={() => setShowForm(!showForm)}
          className={showForm ? 'bg-gray-500 hover:bg-gray-600' : 'bg-amber-600 hover:bg-amber-700'}
        >
          {showForm ? <><X className="w-4 h-4 mr-1" />Cancelar</> : <><Plus className="w-4 h-4 mr-1" />Registrar</>}
        </Button>
      </div>

      {/* Formulario */}
      {showForm && (
        <Card className="border-2 border-amber-200 shadow-md">
          <CardContent className="p-4">
            <form onSubmit={handleRegistrar} className="space-y-3">
              {/* Busqueda de vecino */}
              <div className="space-y-1.5">
                <Label>Destinatario *</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar residente por nombre..."
                    value={busquedaVecino}
                    onChange={e => { setBusquedaVecino(e.target.value); setNombre(e.target.value); setVecinoId(''); setShowSuggestions(true); }}
                    onFocus={() => setShowSuggestions(true)}
                    className="pl-9"
                    required
                  />
                  {showSuggestions && sugerencias.length > 0 && (
                    <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-white border border-border rounded-xl shadow-lg overflow-hidden">
                      {sugerencias.map(v => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => seleccionarVecino(v)}
                          className="w-full text-left px-3 py-2.5 hover:bg-finca-peach/30 transition-colors border-b last:border-0 border-border/40"
                        >
                          <p className="text-sm font-medium text-finca-dark">{v.nombre_completo}</p>
                          <p className="text-xs text-muted-foreground">
                            {[v.torre && `Torre ${v.torre}`, v.piso && `Piso ${v.piso}`, v.puerta && `Apto ${v.puerta}`].filter(Boolean).join(' · ') || 'Sin ubicacion'}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-apto">Apartamento / Ubicacion *</Label>
                <Input id="p-apto" placeholder="Se rellena al seleccionar residente" value={apartamento} onChange={e => setApartamento(e.target.value)} required />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="p-remitente">Remitente / Transportadora (opcional)</Label>
                <Input id="p-remitente" placeholder="Ej: Coordinadora, Servientrega, Amazon..." value={remitente} onChange={e => setRemitente(e.target.value)} />
              </div>

              {/* Tipo selector */}
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <div className="flex flex-wrap gap-2">
                  {tiposPaquete.map(t => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => { setTipo(t.value); if (t.value !== 'recibo') setReciboTipo(''); }}
                      className={cn(
                        'inline-flex items-center gap-1.5 text-xs font-medium border rounded-full px-3 py-1.5 transition-colors',
                        tipo === t.value
                          ? 'bg-amber-600 text-white border-amber-600'
                          : 'bg-white text-finca-dark border-border hover:bg-amber-50',
                      )}
                    >
                      <t.icon className="w-3 h-3" />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Recibo sub-tipo */}
              {tipo === 'recibo' && (
                <div className="space-y-1.5">
                  <Label>Tipo de recibo</Label>
                  <div className="flex flex-wrap gap-2">
                    {tiposRecibo.map(r => (
                      <button
                        key={r.value}
                        type="button"
                        onClick={() => setReciboTipo(r.value)}
                        className={cn(
                          'inline-flex items-center gap-1.5 text-xs font-medium border rounded-lg px-3 py-2 transition-all',
                          reciboTipo === r.value
                            ? r.color + ' ring-2 ring-offset-1 ring-amber-400'
                            : 'bg-white text-finca-dark border-border hover:bg-gray-50',
                        )}
                      >
                        <r.icon className="w-4 h-4" />
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="p-desc">Descripcion (opcional)</Label>
                <Input id="p-desc" placeholder="Detalles del paquete o recibo" value={descripcion} onChange={e => setDescripcion(e.target.value)} />
              </div>

              <Button type="submit" className="w-full bg-amber-600 hover:bg-amber-700" disabled={saving || !nombre || !apartamento}>
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserCheck className="w-4 h-4 mr-2" />}
                Registrar {tipo === 'recibo' ? 'recibo' : 'paquete'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Pendientes */}
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Card key={i} className="border-0 shadow-sm"><CardContent className="p-3"><Skeleton className="h-12 w-full" /></CardContent></Card>)}</div>
      ) : pendientes.length === 0 && entregados.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="py-8 text-center">
            <Package className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No hay paquetes ni recibos registrados</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {pendientes.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-finca-dark mb-2">
                Pendientes ({pendientes.length})
              </h2>
              <div className="space-y-2">
                {pendientes.map(p => {
                  const est = estadoConfig[p.estado] || estadoConfig.recibido;
                  const reciboInfo = p.recibo_tipo ? tiposRecibo.find(r => r.value === p.recibo_tipo) : null;
                  const TipoIcon = p.tipo === 'recibo' && reciboInfo ? reciboInfo.icon : Package;

                  return (
                    <Card key={p.id} className="border-0 shadow-sm">
                      <CardContent className="p-3 flex items-center gap-3">
                        <div className={cn(
                          'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                          p.tipo === 'recibo' && reciboInfo ? reciboInfo.color.split(' ')[0] : 'bg-amber-50',
                        )}>
                          <TipoIcon className={cn(
                            'w-5 h-5',
                            p.tipo === 'recibo' && reciboInfo ? reciboInfo.color.split(' ')[1] : 'text-amber-600',
                          )} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-finca-dark truncate">{p.destinatario_nombre}</p>
                          <p className="text-xs text-muted-foreground">
                            Apto {p.apartamento} - {p.tipo === 'recibo' && reciboInfo ? `Recibo ${reciboInfo.label}` : p.tipo} - {format(new Date(p.created_at), 'dd/MM HH:mm', { locale: es })}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                          <Badge className={cn('text-[10px] border', est.color)}>{est.label}</Badge>
                          {p.estado === 'recibido' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                              onClick={() => notificarVecino(p)}
                            >
                              <Bell className="w-3 h-3 mr-1" />
                              Notificar
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-green-300 text-green-700 hover:bg-green-50"
                            onClick={() => marcarEntregado(p.id)}
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Entregar
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}

          {entregados.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground mb-2">
                Entregados ({entregados.length})
              </h2>
              <div className="space-y-1.5">
                {entregados.slice(0, 10).map(p => (
                  <Card key={p.id} className="border-0 shadow-sm opacity-60">
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-finca-dark truncate">{p.destinatario_nombre}</p>
                        <p className="text-xs text-muted-foreground">Apto {p.apartamento} - {p.tipo}</p>
                      </div>
                      <Badge className="text-[10px] border bg-green-100 text-green-700 border-green-200">Entregado</Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
