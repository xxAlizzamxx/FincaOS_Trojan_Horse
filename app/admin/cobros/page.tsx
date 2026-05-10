'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Wallet, Search, Plus, CheckCircle2, AlertCircle, Clock,
  Send, X, Loader2, MessageSquare, ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { db } from '@/lib/firebase/client';
import {
  collection, query, where, orderBy, getDocs, limit, startAfter,
  type QueryDocumentSnapshot, type DocumentData,
} from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Perfil } from '@/types/database';

const PAGE_SIZE = 20;

interface Cobro {
  id: string;
  vecino_id: string;
  concepto: string;
  descripcion?: string | null;
  monto: number;
  estado: 'pendiente' | 'pagado' | 'cancelado';
  created_at: string;
  vecino?: { nombre_completo: string };
}

const estadoConfig = {
  pendiente: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
  pagado:    { label: 'Pagado',    color: 'bg-green-100 text-green-700',   icon: CheckCircle2 },
  cancelado: { label: 'Cancelado', color: 'bg-gray-100 text-gray-500',     icon: X },
};

export default function AdminCobrosPage() {
  const { perfil, user } = useAuth();
  const [cobros, setCobros] = useState<Cobro[]>([]);
  const [vecinos, setVecinos] = useState<Perfil[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [enviando, setEnviando] = useState(false);

  // Form nuevo cobro
  const [formVecinoId, setFormVecinoId] = useState('');
  const [formConcepto, setFormConcepto] = useState('');
  const [formMonto, setFormMonto] = useState('');
  const [formDesc, setFormDesc] = useState('');

  const vecinosMap = useState<Map<string, Perfil>>(() => new Map())[0];

  const fetchVecinos = useCallback(async (cid: string) => {
    const snap = await getDocs(
      query(collection(db, 'perfiles'), where('comunidad_id', '==', cid)),
    );
    snap.docs.forEach(d => vecinosMap.set(d.id, { id: d.id, ...d.data() } as Perfil));
    setVecinos(
      snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Perfil))
        .sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo)),
    );
  }, [vecinosMap]);

  const fetchCobros = useCallback(async (cid: string, afterDoc?: QueryDocumentSnapshot<DocumentData> | null) => {
    const q = afterDoc
      ? query(
          collection(db, 'cobros'),
          where('comunidad_id', '==', cid),
          orderBy('created_at', 'desc'),
          startAfter(afterDoc),
          limit(PAGE_SIZE),
        )
      : query(
          collection(db, 'cobros'),
          where('comunidad_id', '==', cid),
          orderBy('created_at', 'desc'),
          limit(PAGE_SIZE),
        );

    const snap = await getDocs(q);
    const newDocs = snap.docs;
    setHasMore(newDocs.length === PAGE_SIZE);
    setLastDoc(newDocs[newDocs.length - 1] ?? null);

    const list: Cobro[] = newDocs.map(d => {
      const data = { id: d.id, ...d.data() } as Cobro;
      const v = vecinosMap.get(data.vecino_id);
      if (v) data.vecino = { nombre_completo: v.nombre_completo };
      return data;
    });

    return list;
  }, [vecinosMap]);

  useEffect(() => {
    if (!perfil?.comunidad_id) return;
    const cid = perfil.comunidad_id;

    setLoading(true);
    Promise.all([fetchVecinos(cid), fetchCobros(cid)])
      .then(([, list]) => setCobros(list))
      .catch(err => {
        console.error('[admin/cobros] fetchData:', err);
        toast.error('Error al cargar cobros');
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil?.comunidad_id]);

  async function cargarMas() {
    if (!perfil?.comunidad_id || !lastDoc || loadingMore) return;
    setLoadingMore(true);
    try {
      const more = await fetchCobros(perfil.comunidad_id, lastDoc);
      setCobros(prev => [...prev, ...more]);
    } catch {
      toast.error('Error al cargar más cobros');
    } finally {
      setLoadingMore(false);
    }
  }

  async function crearCobro(e: React.FormEvent) {
    e.preventDefault();
    if (!formVecinoId || !formConcepto.trim() || !formMonto) {
      toast.error('Completa todos los campos obligatorios');
      return;
    }
    const montoNum = parseFloat(formMonto.replace(',', '.'));
    if (isNaN(montoNum) || montoNum <= 0) { toast.error('Importe inválido'); return; }
    if (!user) return;

    setEnviando(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/cobros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          comunidad_id: perfil!.comunidad_id,
          vecino_id: formVecinoId,
          concepto: formConcepto.trim(),
          monto: montoNum,
          descripcion: formDesc.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error');
      toast.success('Cobro enviado al vecino');
      setDialogOpen(false);
      setFormVecinoId(''); setFormConcepto(''); setFormMonto(''); setFormDesc('');
      // Refresh first page
      setLoading(true);
      fetchCobros(perfil!.comunidad_id!)
        .then(list => { setCobros(list); })
        .finally(() => setLoading(false));
    } catch (err: any) {
      toast.error(err.message ?? 'Error al crear el cobro');
    } finally {
      setEnviando(false);
    }
  }

  async function cancelarCobro(id: string) {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/cobros/cancelar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cobro_id: id }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? 'Error');
      }
      toast.success('Cobro cancelado');
      setCobros(prev => prev.map(c => c.id === id ? { ...c, estado: 'cancelado' } : c));
    } catch (err: any) {
      toast.error(err.message ?? 'Error al cancelar');
    }
  }

  const filtrados = cobros.filter(c => {
    const nombre = c.vecino?.nombre_completo?.toLowerCase() ?? '';
    const matchBusqueda = nombre.includes(busqueda.toLowerCase()) || c.concepto.toLowerCase().includes(busqueda.toLowerCase());
    const matchEstado = filtroEstado === 'todos' || c.estado === filtroEstado;
    return matchBusqueda && matchEstado;
  });

  const pendientes = cobros.filter(c => c.estado === 'pendiente').length;
  const pagados    = cobros.filter(c => c.estado === 'pagado').length;
  const totalPend  = cobros.filter(c => c.estado === 'pendiente').reduce((s, c) => s + c.monto, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-finca-dark">Cobros</h1>
          <p className="text-sm text-muted-foreground">Envía cobros individuales a vecinos via chat</p>
        </div>
        <Button
          className="bg-finca-coral hover:bg-finca-coral/90 text-white"
          onClick={() => setDialogOpen(true)}
        >
          <Plus className="w-4 h-4 mr-1.5" />
          Nuevo cobro
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { icon: Clock,        label: 'Pendientes', value: pendientes, color: 'text-yellow-600', bg: 'bg-yellow-50' },
          { icon: CheckCircle2, label: 'Pagados',    value: pagados,    color: 'text-green-600',  bg: 'bg-green-50'  },
          { icon: Wallet,       label: 'Por cobrar', value: `${totalPend.toFixed(0)}€`, color: 'text-finca-coral', bg: 'bg-finca-peach/30', isText: true },
        ].map(kpi => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center mb-3', kpi.bg)}>
                <kpi.icon className={cn('w-5 h-5', kpi.color)} />
              </div>
              <p className="text-2xl font-bold text-finca-dark">{kpi.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{kpi.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-col sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar vecino o concepto..." value={busqueda} onChange={e => setBusqueda(e.target.value)} className="pl-9" />
        </div>
        <Select value={filtroEstado} onValueChange={setFiltroEstado}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="pendiente">Pendiente</SelectItem>
            <SelectItem value="pagado">Pagado</SelectItem>
            <SelectItem value="cancelado">Cancelado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-3 flex items-center gap-3">
                <Skeleton className="w-9 h-9 rounded-xl" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-5 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtrados.length === 0 ? (
        <div className="py-12 text-center space-y-2">
          <MessageSquare className="w-12 h-12 text-muted-foreground/30 mx-auto" />
          <p className="font-medium text-finca-dark">Sin cobros</p>
          <p className="text-sm text-muted-foreground">Crea un cobro para enviárselo a un vecino por chat</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {filtrados.map(cobro => {
              const cfg = estadoConfig[cobro.estado] ?? estadoConfig.pendiente;
              const Icon = cfg.icon;
              return (
                <Card key={cobro.id} className="border-0 shadow-sm">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
                      cobro.estado === 'pagado' ? 'bg-green-50' : cobro.estado === 'cancelado' ? 'bg-gray-100' : 'bg-yellow-50'
                    )}>
                      <Icon className={cn('w-4 h-4',
                        cobro.estado === 'pagado' ? 'text-green-600' : cobro.estado === 'cancelado' ? 'text-gray-400' : 'text-yellow-600'
                      )} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-finca-dark truncate">{cobro.vecino?.nombre_completo ?? cobro.vecino_id}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {cobro.concepto} · {format(new Date(cobro.created_at), 'd MMM yyyy', { locale: es })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-semibold text-finca-dark">{cobro.monto.toFixed(2)}€</span>
                      <Badge className={cn('text-[10px]', cfg.color)}>{cfg.label}</Badge>
                      {cobro.estado === 'pendiente' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 text-red-400 hover:text-red-600 hover:bg-red-50"
                          onClick={() => cancelarCobro(cobro.id)}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Load more */}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={cargarMas}
                disabled={loadingMore}
                className="gap-2"
              >
                {loadingMore
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <ChevronDown className="w-4 h-4" />}
                Cargar más
              </Button>
            </div>
          )}
        </>
      )}

      {/* Dialog nuevo cobro */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nuevo cobro</DialogTitle>
          </DialogHeader>
          <form onSubmit={crearCobro} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label>Vecino *</Label>
              <Select value={formVecinoId} onValueChange={setFormVecinoId}>
                <SelectTrigger><SelectValue placeholder="Selecciona un vecino" /></SelectTrigger>
                <SelectContent>
                  {vecinos.map(v => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.nombre_completo}{v.numero_piso ? ` (${v.numero_piso})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Concepto *</Label>
              <Input placeholder="Ej: Derramas ascensor mayo" value={formConcepto} onChange={e => setFormConcepto(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Importe (€) *</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">€</span>
                <Input type="number" step="0.01" min="0.01" placeholder="0,00" value={formMonto} onChange={e => setFormMonto(e.target.value)} className="pl-7" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Descripción (opcional)</Label>
              <Textarea placeholder="Detalles adicionales..." value={formDesc} onChange={e => setFormDesc(e.target.value)} rows={2} />
            </div>
            <p className="text-xs text-muted-foreground bg-blue-50 p-2 rounded-lg flex items-start gap-1.5">
              <Send className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" />
              El cobro se enviará al chat del vecino con un botón de pago directo.
            </p>
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" className="flex-1 bg-finca-coral hover:bg-finca-coral/90 text-white" disabled={enviando || !formVecinoId}>
                {enviando ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}
                Enviar cobro
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
