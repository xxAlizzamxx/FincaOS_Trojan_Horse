'use client';

import { useEffect, useState } from 'react';
import { Search, Users, Trash2, Loader2, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/firebase/client';
import { collection, query, where, orderBy, getDocs, doc, updateDoc, QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { Perfil } from '@/types/database';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

export default function AdminVecinosPage() {
  const { perfil, user } = useAuth();
  const [vecinos, setVecinos]             = useState<Perfil[]>([]);
  const [busqueda, setBusqueda]           = useState('');
  const [loading, setLoading]             = useState(true);
  const [vecinoAEliminar, setVecinoAEliminar] = useState<Perfil | null>(null);
  const [eliminando, setEliminando]       = useState(false);

  useEffect(() => {
    if (perfil?.comunidad_id) fetchVecinos();
  }, [perfil?.comunidad_id]);

  async function fetchVecinos() {
    const q = query(
      collection(db, 'perfiles'),
      where('comunidad_id', '==', perfil!.comunidad_id!),
      orderBy('nombre_completo'),
    );
    const snap = await getDocs(q);
    const list = snap.docs.map((d: QueryDocumentSnapshot<DocumentData>) => ({ id: d.id, ...d.data() }) as Perfil);
    setVecinos(list);
    setLoading(false);
  }

  async function cambiarRol(id: string, nuevoRol: string) {
    try {
      await updateDoc(doc(db, 'perfiles', id), { rol: nuevoRol });
      toast.success('Rol actualizado');
      fetchVecinos();
    } catch {
      toast.error('Error al actualizar el rol');
    }
  }

  async function confirmarEliminar() {
    if (!vecinoAEliminar || !user) return;
    setEliminando(true);
    try {
      const token = await user.getIdToken();
      const res   = await fetch('/api/comunidad/remove-user', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ userId: vecinoAEliminar.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Error del servidor');
      }
      toast.success(`${vecinoAEliminar.nombre_completo} eliminado de la comunidad`);
      setVecinoAEliminar(null);
      fetchVecinos();
    } catch (err: any) {
      toast.error(err?.message ?? 'Error al eliminar el vecino');
    } finally {
      setEliminando(false);
    }
  }

  const filtrados = vecinos.filter((v) =>
    v.nombre_completo.toLowerCase().includes(busqueda.toLowerCase()) ||
    (v.numero_piso || '').toLowerCase().includes(busqueda.toLowerCase()),
  );

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-finca-dark">Vecinos</h1>
        <p className="text-sm text-muted-foreground">{vecinos.length} vecinos registrados</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar vecino o piso..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-3 flex items-center gap-3">
                <Skeleton className="w-10 h-10 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-8 w-36 rounded-md" />
              </CardContent>
            </Card>
          ))}
        </div>

      ) : filtrados.length === 0 ? (
        <div className="py-16 text-center space-y-2">
          <Users className="w-12 h-12 text-muted-foreground/30 mx-auto" />
          <p className="font-medium text-finca-dark">Sin vecinos</p>
        </div>

      ) : (
        <div className="space-y-2">
          {filtrados.map((v) => (
            <Card key={v.id} className="border-0 shadow-sm">
              <CardContent className="p-3 flex items-center gap-3">
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-finca-peach flex items-center justify-center shrink-0">
                  <span className="font-semibold text-finca-coral text-sm">
                    {v.nombre_completo.charAt(0)}
                  </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-finca-dark">{v.nombre_completo}</p>
                  <p className="text-xs text-muted-foreground">
                    {v.numero_piso ? `Piso ${v.numero_piso}` : 'Sin piso asignado'}
                  </p>
                </div>

                {/* Cambiar rol */}
                <Select value={v.rol} onValueChange={(val) => cambiarRol(v.id, val)}>
                  <SelectTrigger className="w-32 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vecino">Vecino</SelectItem>
                    <SelectItem value="presidente">Presidente</SelectItem>
                    <SelectItem value="admin">Administrador</SelectItem>
                  </SelectContent>
                </Select>

                {/* Eliminar — solo si no es el propio admin */}
                {v.id !== perfil?.id && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-8 h-8 text-muted-foreground hover:text-red-500 hover:bg-red-50 shrink-0"
                    onClick={() => setVecinoAEliminar(v)}
                    title="Eliminar de la comunidad"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Modal de confirmación ── */}
      {vecinoAEliminar && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={(e) => { if (!eliminando && e.target === e.currentTarget) setVecinoAEliminar(null); }}
        >
          <div className="bg-background rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">

            {/* Icono */}
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <UserX className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="font-semibold text-finca-dark">Eliminar vecino</p>
                <p className="text-xs text-muted-foreground">Esta acción no se puede deshacer</p>
              </div>
            </div>

            {/* Mensaje */}
            <p className="text-sm text-muted-foreground leading-relaxed">
              ¿Estás seguro de que quieres eliminar a{' '}
              <span className="font-semibold text-foreground">{vecinoAEliminar.nombre_completo}</span>{' '}
              de la comunidad?
              <br />
              <span className="text-xs">Sus datos históricos (incidencias, pagos) se conservarán.</span>
            </p>

            {/* Botones */}
            <div className="flex gap-3 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                disabled={eliminando}
                onClick={() => setVecinoAEliminar(null)}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 bg-red-500 hover:bg-red-600 text-white"
                disabled={eliminando}
                onClick={confirmarEliminar}
              >
                {eliminando
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <><Trash2 className="w-4 h-4 mr-1.5" />Eliminar</>
                }
              </Button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
