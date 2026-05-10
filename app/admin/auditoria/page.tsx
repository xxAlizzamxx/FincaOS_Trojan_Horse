'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, orderBy, getDocs, limit, startAfter, type QueryDocumentSnapshot, type DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronDown, Loader2, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 30;

interface AuditLog {
  id: string;
  accion: string;
  recurso_tipo: string;
  recurso_id: string;
  admin_id: string;
  comunidad_id: string;
  timestamp: string;
  detalles?: Record<string, unknown>;
}

const accionColors: Record<string, string> = {
  crear_cobro:    'bg-blue-100 text-blue-700',
  cancelar_cobro: 'bg-red-100 text-red-700',
  crear_evento:   'bg-purple-100 text-purple-700',
};

const accionLabels: Record<string, string> = {
  crear_cobro:    'Cobro creado',
  cancelar_cobro: 'Cobro cancelado',
  crear_evento:   'Evento creado',
};

export default function AdminAuditoriaPage() {
  const { perfil } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [filtroAccion, setFiltroAccion] = useState('todas');

  useEffect(() => {
    if (!perfil?.comunidad_id) return;
    loadLogs(perfil.comunidad_id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil?.comunidad_id]);

  async function loadLogs(cid: string, afterDoc?: QueryDocumentSnapshot<DocumentData> | null) {
    const baseQuery = afterDoc
      ? query(
          collection(db, 'admin_logs'),
          where('comunidad_id', '==', cid),
          orderBy('timestamp', 'desc'),
          startAfter(afterDoc),
          limit(PAGE_SIZE),
        )
      : query(
          collection(db, 'admin_logs'),
          where('comunidad_id', '==', cid),
          orderBy('timestamp', 'desc'),
          limit(PAGE_SIZE),
        );

    const snap = await getDocs(baseQuery);
    const docs = snap.docs;
    setHasMore(docs.length === PAGE_SIZE);
    setLastDoc(docs[docs.length - 1] ?? null);
    return docs.map(d => ({ id: d.id, ...d.data() } as AuditLog));
  }

  async function fetchFirst() {
    if (!perfil?.comunidad_id) return;
    setLoading(true);
    try {
      const list = await loadLogs(perfil.comunidad_id);
      setLogs(list);
    } catch (err) {
      console.error('[admin/auditoria]', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchFirst(); }, [perfil?.comunidad_id]); // eslint-disable-line

  async function cargarMas() {
    if (!perfil?.comunidad_id || !lastDoc || loadingMore) return;
    setLoadingMore(true);
    try {
      const more = await loadLogs(perfil.comunidad_id, lastDoc);
      setLogs(prev => [...prev, ...more]);
    } finally {
      setLoadingMore(false);
    }
  }

  const filtrados = logs.filter(l =>
    filtroAccion === 'todas' || l.accion === filtroAccion,
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-finca-dark">Auditoría</h1>
          <p className="text-sm text-muted-foreground">Registro de acciones administrativas</p>
        </div>
        <Select value={filtroAccion} onValueChange={setFiltroAccion}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las acciones</SelectItem>
            <SelectItem value="crear_cobro">Cobros creados</SelectItem>
            <SelectItem value="cancelar_cobro">Cobros cancelados</SelectItem>
            <SelectItem value="crear_evento">Eventos creados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-3 flex items-center gap-3">
                <Skeleton className="w-9 h-9 rounded-xl" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-5 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtrados.length === 0 ? (
        <div className="py-16 text-center space-y-2">
          <ShieldCheck className="w-12 h-12 text-muted-foreground/30 mx-auto" />
          <p className="font-medium text-finca-dark">Sin registros</p>
          <p className="text-sm text-muted-foreground">Las acciones administrativas aparecerán aquí</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {filtrados.map(log => {
              const color = accionColors[log.accion] ?? 'bg-gray-100 text-gray-600';
              const label = accionLabels[log.accion] ?? log.accion;
              return (
                <Card key={log.id} className="border-0 shadow-sm">
                  <CardContent className="p-3 flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-finca-peach/30 flex items-center justify-center shrink-0 mt-0.5">
                      <ShieldCheck className="w-4 h-4 text-finca-coral" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={cn('text-[10px] font-medium', color)}>{label}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(log.timestamp), "d MMM yyyy 'a las' HH:mm", { locale: es })}
                        </span>
                      </div>
                      {log.detalles && (
                        <p className="text-xs text-finca-dark/70 mt-1 truncate">
                          {Object.entries(log.detalles)
                            .filter(([, v]) => v !== undefined && v !== null && v !== '')
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(' · ')}
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5 font-mono truncate">
                        admin: {log.admin_id} · recurso: {log.recurso_id}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={cargarMas} disabled={loadingMore} className="gap-2">
                {loadingMore
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <ChevronDown className="w-4 h-4" />}
                Cargar más
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
