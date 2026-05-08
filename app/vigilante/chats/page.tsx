'use client';

import { useEffect, useState, useMemo } from 'react';
import { collection, query, where, getDocs, doc, getDoc, setDoc, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, MessageSquare, ArrowLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import ChatVigilante from '@/components/vigilante/ChatVigilante';

interface Vecino {
  id: string;
  nombre_completo: string;
  torre?: string | null;
  piso?: string | null;
  puerta?: string | null;
  avatar_url?: string | null;
}

export default function ChatsVigilantePage() {
  const { perfil, user } = useAuth();
  const [vecinos, setVecinos] = useState<Vecino[]>([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [filtroTorre, setFiltroTorre] = useState('');
  const [selectedVecino, setSelectedVecino] = useState<Vecino | null>(null);

  const comunidadId = perfil?.comunidad_id;

  useEffect(() => {
    if (!comunidadId) return;
    fetchVecinos();
  }, [comunidadId]);

  async function fetchVecinos() {
    try {
      const snap = await getDocs(query(
        collection(db, 'perfiles'),
        where('comunidad_id', '==', comunidadId),
      ));
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Vecino))
        .filter(v => v.id !== user?.uid && v.nombre_completo)
        .sort((a, b) => (a.nombre_completo || '').localeCompare(b.nombre_completo || ''));
      setVecinos(list);
    } catch (err) {
      console.error('[Chats] Error cargando vecinos:', err);
    } finally {
      setLoading(false);
    }
  }

  const torres = useMemo(() => {
    const set = new Set<string>();
    vecinos.forEach(v => { if (v.torre) set.add(v.torre); });
    return Array.from(set).sort();
  }, [vecinos]);

  const filtrados = useMemo(() => {
    return vecinos.filter(v => {
      const matchBusqueda = !busqueda ||
        v.nombre_completo.toLowerCase().includes(busqueda.toLowerCase()) ||
        v.puerta?.toLowerCase().includes(busqueda.toLowerCase());
      const matchTorre = !filtroTorre || v.torre === filtroTorre;
      return matchBusqueda && matchTorre;
    });
  }, [vecinos, busqueda, filtroTorre]);

  // Chat individual
  if (selectedVecino) {
    return (
      <div className="max-w-3xl space-y-4">
        <button
          onClick={() => setSelectedVecino(null)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-finca-dark transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver a la lista
        </button>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-full bg-finca-peach flex items-center justify-center text-finca-coral font-bold text-sm">
            {selectedVecino.nombre_completo[0]?.toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-finca-dark">{selectedVecino.nombre_completo}</p>
            <p className="text-xs text-muted-foreground">
              {[selectedVecino.torre && `Torre ${selectedVecino.torre}`, selectedVecino.piso && `Piso ${selectedVecino.piso}`, selectedVecino.puerta && `Apto ${selectedVecino.puerta}`].filter(Boolean).join(' - ') || 'Sin ubicacion'}
            </p>
          </div>
        </div>

        <ChatVigilante
          comunidadId={comunidadId!}
          vigilanteId={user!.uid}
          vecinoId={selectedVecino.id}
          vecinoNombre={selectedVecino.nombre_completo}
          vecinoAvatar={selectedVecino.avatar_url}
        />
      </div>
    );
  }

  // Lista de vecinos
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-finca-dark">Chats con residentes</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Selecciona un residente para enviarle un mensaje
        </p>
      </div>

      {/* Barra de busqueda */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o apartamento..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-9"
          />
        </div>
        {torres.length > 0 && (
          <select
            value={filtroTorre}
            onChange={(e) => setFiltroTorre(e.target.value)}
            className="h-10 px-3 rounded-md border border-input bg-background text-sm"
          >
            <option value="">Todas las torres</option>
            {torres.map(t => (
              <option key={t} value={t}>Torre {t}</option>
            ))}
          </select>
        )}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-2">
          {[1,2,3,4,5].map(i => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-3 flex items-center gap-3">
                <Skeleton className="w-10 h-10 rounded-full" />
                <div className="flex-1"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-28 mt-1" /></div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtrados.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="py-8 text-center">
            <MessageSquare className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {busqueda || filtroTorre ? 'No se encontraron residentes con ese filtro' : 'No hay residentes en la comunidad'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1.5">
          {filtrados.map(v => (
            <button
              key={v.id}
              onClick={() => setSelectedVecino(v)}
              className="w-full text-left"
            >
              <Card className="border-0 shadow-sm hover:shadow-md transition-all active:scale-[0.99]">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-finca-peach flex items-center justify-center text-finca-coral font-bold text-sm shrink-0 overflow-hidden">
                    {v.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.avatar_url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      v.nombre_completo[0]?.toUpperCase()
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-finca-dark truncate">{v.nombre_completo}</p>
                    <p className="text-xs text-muted-foreground">
                      {[v.torre && `Torre ${v.torre}`, v.piso && `Piso ${v.piso}`, v.puerta && `Apto ${v.puerta}`].filter(Boolean).join(' - ') || 'Sin ubicacion'}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-center text-muted-foreground">
        {filtrados.length} residente{filtrados.length !== 1 ? 's' : ''}
      </p>
    </div>
  );
}
