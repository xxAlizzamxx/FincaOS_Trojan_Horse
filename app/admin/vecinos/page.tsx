'use client';

import { useEffect, useState } from 'react';
import { Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/firebase/client';
import { collection, query, where, orderBy, getDocs, doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { Perfil } from '@/types/database';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

const rolLabel: Record<string, string> = { vecino: 'Vecino', presidente: 'Presidente', admin: 'Administrador' };
const rolColor: Record<string, string> = {
  vecino: 'bg-gray-100 text-gray-600 border-gray-200',
  presidente: 'bg-finca-peach/50 text-finca-coral border-finca-peach',
  admin: 'bg-finca-coral text-white border-finca-coral',
};

export default function AdminVecinosPage() {
  const { perfil } = useAuth();
  const [vecinos, setVecinos] = useState<Perfil[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (perfil?.comunidad_id) fetchVecinos();
  }, [perfil?.comunidad_id]);

  async function fetchVecinos() {
    const q = query(
      collection(db, 'perfiles'),
      where('comunidad_id', '==', perfil!.comunidad_id!),
      orderBy('nombre_completo')
    );
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Perfil);
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

  const filtrados = vecinos.filter((v) =>
    v.nombre_completo.toLowerCase().includes(busqueda.toLowerCase()) ||
    (v.numero_piso || '').toLowerCase().includes(busqueda.toLowerCase())
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
                <div className="w-10 h-10 rounded-full bg-finca-peach flex items-center justify-center shrink-0">
                  <span className="font-semibold text-finca-coral text-sm">
                    {v.nombre_completo.charAt(0)}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-finca-dark">{v.nombre_completo}</p>
                  <p className="text-xs text-muted-foreground">
                    {v.numero_piso ? `Piso ${v.numero_piso}` : 'Sin piso asignado'}
                  </p>
                </div>
                <Select value={v.rol} onValueChange={(val) => cambiarRol(v.id, val)}>
                  <SelectTrigger className="w-36 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vecino">Vecino</SelectItem>
                    <SelectItem value="presidente">Presidente</SelectItem>
                    <SelectItem value="admin">Administrador</SelectItem>
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
