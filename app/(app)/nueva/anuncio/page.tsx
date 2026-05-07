'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CircleCheck as CheckCircle2, Pin } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/firebase/client';
import { collection, addDoc } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { useSound } from '@/hooks/useSound';
import { FX } from '@/lib/sound/gsapEffects';
import { crearNotificacionComunidad } from '@/lib/firebase/notifications';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';

export default function NuevoAnuncioPage() {
  const router = useRouter();
  const { perfil } = useAuth();
  const { playWithEffect } = useSound();
  const submitBtnRef = useRef<HTMLButtonElement>(null);
  const [titulo, setTitulo] = useState('');
  const [contenido, setContenido] = useState('');
  const [fijado, setFijado] = useState(false);
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);

  const esAdmin = perfil?.rol === 'admin' || perfil?.rol === 'presidente';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo.trim() || !contenido.trim()) return;
    if (!perfil?.comunidad_id) { toast.error('No perteneces a ninguna comunidad'); return; }
    setLoading(true);

    try {
      const ref = await addDoc(collection(db, 'anuncios'), {
        comunidad_id: perfil.comunidad_id,
        autor_id: perfil.id,
        titulo: titulo.trim(),
        contenido: contenido.trim(),
        fijado,
        publicado_at: new Date().toISOString(),
      });
      void crearNotificacionComunidad(perfil.comunidad_id, {
        tipo:       'anuncio',
        titulo:     titulo.trim(),
        mensaje:    `Publicado por ${perfil.nombre_completo}`,
        created_by: perfil.id,
        related_id: ref.id,
        link:       '/comunidad',
      });
      playWithEffect('publicacion_tablon', FX.tablon, submitBtnRef.current);
      setEnviado(true);
    } catch {
      toast.error('Error al publicar el anuncio');
    }

    setLoading(false);
  }

  if (!esAdmin) {
    return (
      <div className="px-4 py-12 text-center space-y-3">
        <p className="text-lg font-semibold text-finca-dark">Acceso restringido</p>
        <p className="text-sm text-muted-foreground">Solo administradores y presidentes pueden publicar anuncios</p>
        <Button onClick={() => router.back()} variant="outline">Volver</Button>
      </div>
    );
  }

  if (enviado) {
    return (
      <div className="px-4 py-12 flex flex-col items-center text-center space-y-4">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
          <CheckCircle2 className="w-10 h-10 text-green-600" />
        </div>
        <h2 className="text-xl font-semibold text-finca-dark">Anuncio publicado</h2>
        <p className="text-sm text-muted-foreground">Todos los vecinos de tu comunidad pueden verlo en el tablón</p>
        <div className="flex gap-3 pt-2">
          <Button variant="outline" onClick={() => router.push('/comunidad')}>Ver tablón</Button>
          <Button className="bg-finca-coral hover:bg-finca-coral/90 text-white" onClick={() => { setEnviado(false); setTitulo(''); setContenido(''); }}>
            Otro anuncio
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-6">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-border px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()} className="w-8 h-8 -ml-1">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="font-semibold text-finca-dark">Publicar anuncio</h1>
      </div>

      <form onSubmit={handleSubmit} className="px-4 py-4 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="titulo-anuncio">Título <span className="text-finca-coral">*</span></Label>
          <Input id="titulo-anuncio" placeholder="Ej: Junta ordinaria el 15 de mayo" value={titulo} onChange={(e) => setTitulo(e.target.value)} required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="contenido-anuncio">Contenido <span className="text-finca-coral">*</span></Label>
          <Textarea id="contenido-anuncio" placeholder="Escribe el anuncio completo aquí. Se mostrará a todos los vecinos de la comunidad..." value={contenido} onChange={(e) => setContenido(e.target.value)} rows={6} className="resize-none" required />
        </div>

        <Card className="border-0 bg-muted/40">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Pin className="w-4 h-4 text-finca-coral" />
              <div>
                <p className="text-sm font-medium text-finca-dark">Fijar en el tablón</p>
                <p className="text-xs text-muted-foreground">Aparecerá siempre al principio</p>
              </div>
            </div>
            <Switch checked={fijado} onCheckedChange={setFijado} />
          </CardContent>
        </Card>

        <Button ref={submitBtnRef} type="submit" className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-12 font-medium" disabled={loading || !titulo.trim() || !contenido.trim()}>
          {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Publicar anuncio'}
        </Button>
      </form>
    </div>
  );
}
