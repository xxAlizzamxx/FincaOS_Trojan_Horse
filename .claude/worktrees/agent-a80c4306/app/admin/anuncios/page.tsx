'use client';

import { useEffect, useState } from 'react';
import { Plus, Pin, Trash2, Megaphone } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { db } from '@/lib/firebase/client';
import { collection, query, where, orderBy, getDocs, doc, getDoc, addDoc, deleteDoc } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { Anuncio } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

export default function AdminAnunciosPage() {
  const { perfil } = useAuth();
  const [anuncios, setAnuncios] = useState<Anuncio[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const [titulo, setTitulo] = useState('');
  const [contenido, setContenido] = useState('');
  const [fijado, setFijado] = useState(false);

  useEffect(() => {
    if (perfil?.comunidad_id) fetchAnuncios();
  }, [perfil?.comunidad_id]);

  async function fetchAnuncios() {
    const q = query(
      collection(db, 'anuncios'),
      where('comunidad_id', '==', perfil!.comunidad_id!),
      orderBy('fijado', 'desc'),
      orderBy('publicado_at', 'desc')
    );
    const snap = await getDocs(q);
    const list: Anuncio[] = [];
    for (const d of snap.docs) {
      const data = { id: d.id, ...d.data() } as Anuncio;
      // Fetch autor
      if (data.autor_id) {
        const autorSnap = await getDoc(doc(db, 'perfiles', data.autor_id));
        if (autorSnap.exists()) {
          data.autor = { id: autorSnap.id, ...autorSnap.data() } as any;
        }
      }
      list.push(data);
    }
    setAnuncios(list);
    setLoading(false);
  }

  async function publicar(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo.trim() || !contenido.trim()) return;
    setEnviando(true);

    try {
      await addDoc(collection(db, 'anuncios'), {
        comunidad_id: perfil!.comunidad_id!,
        autor_id: perfil!.id,
        titulo: titulo.trim(),
        contenido: contenido.trim(),
        fijado,
        publicado_at: new Date().toISOString(),
      });
      toast.success('Anuncio publicado');
      setTitulo('');
      setContenido('');
      setFijado(false);
      setDialogOpen(false);
      fetchAnuncios();
    } catch {
      toast.error('Error al publicar el anuncio');
    }
    setEnviando(false);
  }

  async function eliminar(id: string) {
    try {
      await deleteDoc(doc(db, 'anuncios', id));
      toast.success('Anuncio eliminado');
      fetchAnuncios();
    } catch {
      toast.error('Error al eliminar');
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-finca-dark">Tablón de anuncios</h1>
          <p className="text-sm text-muted-foreground">{anuncios.length} anuncios publicados</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-finca-coral hover:bg-finca-coral/90 text-white">
              <Plus className="w-4 h-4 mr-1.5" />
              Nuevo anuncio
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Nuevo anuncio</DialogTitle>
            </DialogHeader>
            <form onSubmit={publicar} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="titulo-anuncio">Título</Label>
                <Input
                  id="titulo-anuncio"
                  placeholder="Ej: Junta ordinaria el 15 de mayo"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contenido-anuncio">Contenido</Label>
                <Textarea
                  id="contenido-anuncio"
                  placeholder="Escribe el anuncio completo aquí..."
                  value={contenido}
                  onChange={(e) => setContenido(e.target.value)}
                  rows={4}
                  className="resize-none"
                  required
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch id="fijar" checked={fijado} onCheckedChange={setFijado} />
                <Label htmlFor="fijar" className="flex items-center gap-1.5 cursor-pointer">
                  <Pin className="w-3.5 h-3.5 text-finca-coral" />
                  Fijar en el tablón
                </Label>
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" className="flex-1 bg-finca-coral hover:bg-finca-coral/90 text-white" disabled={enviando}>
                  {enviando ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Publicar'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-28" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : anuncios.length === 0 ? (
        <div className="py-16 text-center space-y-3">
          <Megaphone className="w-12 h-12 text-muted-foreground/30 mx-auto" />
          <p className="font-medium text-finca-dark">Sin anuncios</p>
          <p className="text-sm text-muted-foreground">Crea el primer anuncio para tu comunidad</p>
        </div>
      ) : (
        <div className="space-y-3">
          {anuncios.map((anuncio) => (
            <Card key={anuncio.id} className={cn('border-0 shadow-sm', anuncio.fijado && 'border-l-4 border-l-finca-coral')}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    {anuncio.fijado && (
                      <div className="flex items-center gap-1 mb-1">
                        <Pin className="w-3 h-3 text-finca-coral" />
                        <span className="text-[10px] font-semibold text-finca-coral uppercase tracking-wide">Fijado</span>
                      </div>
                    )}
                    <p className="font-semibold text-sm text-finca-dark">{anuncio.titulo}</p>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed line-clamp-3">{anuncio.contenido}</p>
                    <p className="text-[11px] text-muted-foreground mt-2">
                      {format(new Date(anuncio.publicado_at), "d 'de' MMMM, HH:mm", { locale: es })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-8 h-8 text-muted-foreground hover:text-red-500 shrink-0"
                    onClick={() => eliminar(anuncio.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
