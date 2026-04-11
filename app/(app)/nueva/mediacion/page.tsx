'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Scale, Bot, UserCheck, FileText, ChevronRight, CircleCheck as CheckCircle2, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { addDoc, collection, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const tipos = [
  { value: 'ruido', label: 'Ruidos', emoji: '🔊' },
  { value: 'parking', label: 'Parking', emoji: '🚗' },
  { value: 'mascotas', label: 'Mascotas', emoji: '🐕' },
  { value: 'obras', label: 'Obras', emoji: '🏗️' },
  { value: 'filtraciones', label: 'Filtraciones', emoji: '💧' },
  { value: 'otro', label: 'Otro', emoji: '📦' },
];

type Fase = 'formulario' | 'procesando' | 'propuesta' | 'mediador' | 'resuelto';

export default function MediacionPage() {
  const router = useRouter();
  const { perfil } = useAuth();
  const [fase, setFase] = useState<Fase>('formulario');
  const [tipo, setTipo] = useState('ruido');
  const [descripcion, setDescripcion] = useState('');
  const [esRecurrente, setEsRecurrente] = useState(false);
  const [esAnonimo, setEsAnonimo] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [mediacionId, setMediacionId] = useState<string | null>(null);
  const [propuestaIA, setPropuestaIA] = useState('');

  async function iniciarMediacion(e: React.FormEvent) {
    e.preventDefault();
    if (!descripcion.trim()) { toast.error('Describe el conflicto'); return; }
    if (!perfil?.comunidad_id) { toast.error('No perteneces a ninguna comunidad'); return; }
    setEnviando(true);
    setFase('procesando');

    try {
      const ref = await addDoc(collection(db, 'mediaciones'), {
        comunidad_id: perfil.comunidad_id,
        denunciante_id: perfil.id,
        tipo,
        descripcion: descripcion.trim(),
        es_recurrente: esRecurrente,
        es_anonimo: esAnonimo,
        estado: 'ia_procesando',
        created_at: new Date().toISOString(),
      });

      setMediacionId(ref.id);

      const res = await fetch('/api/ai/mediate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, descripcion: descripcion.trim(), es_recurrente: esRecurrente }),
      });
      const data = await res.json();
      setPropuestaIA(data.propuesta);

      await updateDoc(doc(db, 'mediaciones', ref.id), {
        estado: 'ia_propuesta',
        propuesta_ia: data.propuesta,
      });

      setFase('propuesta');
    } catch (err: any) {
      console.error('Mediacion error:', err);
      toast.error(err?.message || 'Error al iniciar la mediación');
      setFase('formulario');
    }
    setEnviando(false);
  }

  async function solicitarMediadorHumano() {
    if (mediacionId) {
      await updateDoc(doc(db, 'mediaciones', mediacionId), { estado: 'mediador_requerido' });
    }
    setFase('mediador');
  }

  async function marcarResuelto() {
    if (mediacionId) {
      await updateDoc(doc(db, 'mediaciones', mediacionId), { estado: 'resuelto' });
    }
    setFase('resuelto');
  }

  return (
    <div className="pb-6">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-border px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()} className="w-8 h-8 -ml-1">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="font-semibold text-finca-dark">Mediación vecinal</h1>
      </div>

      {fase === 'formulario' && (
        <form onSubmit={iniciarMediacion} className="px-4 py-4 space-y-5">
          <Card className="bg-finca-peach/20 border-finca-peach/50">
            <CardContent className="p-4 flex gap-3">
              <Scale className="w-5 h-5 text-finca-coral shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-finca-dark">Mediación IA (gratuita)</p>
                <p className="text-xs text-muted-foreground mt-0.5">FincaOS analiza tu conflicto según la LPH y genera una propuesta neutral. Absorbe el 60% de los casos.</p>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            <Label>Tipo de conflicto</Label>
            <div className="grid grid-cols-3 gap-2">
              {tipos.map((t) => (
                <button key={t.value} type="button" onClick={() => setTipo(t.value)}
                  className={cn('p-3 rounded-xl border text-center transition-all',
                    tipo === t.value ? 'border-finca-coral bg-finca-peach/30' : 'border-border bg-white hover:border-finca-salmon'
                  )}>
                  <span className="text-xl block mb-1">{t.emoji}</span>
                  <span className={cn('text-xs font-medium', tipo === t.value ? 'text-finca-coral' : 'text-muted-foreground')}>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="desc-mediacion">Describe el conflicto <span className="text-finca-coral">*</span></Label>
            <Textarea id="desc-mediacion" placeholder="Describe la situación con detalle. Puedes adjuntar evidencias..." value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={4} className="resize-none" required />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between py-3 border-b border-border">
              <div>
                <p className="text-sm font-medium text-finca-dark">Ha ocurrido antes</p>
                <p className="text-xs text-muted-foreground">El conflicto es recurrente</p>
              </div>
              <Switch checked={esRecurrente} onCheckedChange={setEsRecurrente} />
            </div>
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-finca-dark flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-finca-coral" />
                  Mantener anonimato
                </p>
                <p className="text-xs text-muted-foreground">No se revelará tu identidad al afectado</p>
              </div>
              <Switch checked={esAnonimo} onCheckedChange={setEsAnonimo} />
            </div>
          </div>

          <Button type="submit" className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-12 font-medium" disabled={!descripcion.trim()}>
            <Bot className="w-4 h-4 mr-2" />
            Analizar con IA (gratis)
          </Button>
        </form>
      )}

      {fase === 'procesando' && (
        <div className="px-4 py-16 flex flex-col items-center text-center space-y-4">
          <div className="w-20 h-20 rounded-full bg-finca-peach/30 flex items-center justify-center">
            <Bot className="w-10 h-10 text-finca-coral animate-pulse" />
          </div>
          <h2 className="text-xl font-semibold text-finca-dark">Analizando conflicto</h2>
          <p className="text-sm text-muted-foreground max-w-xs">La IA está revisando la LPH, estatutos de tu comunidad y normativa municipal...</p>
          <div className="flex gap-1.5 mt-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-2 h-2 rounded-full bg-finca-coral animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        </div>
      )}

      {fase === 'propuesta' && (
        <div className="px-4 py-4 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-finca-coral flex items-center justify-center">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-finca-dark">FincaOS IA</p>
              <p className="text-xs text-muted-foreground">Propuesta basada en LPH y estatutos</p>
            </div>
          </div>

          <Card className="border-finca-coral/30 bg-finca-peach/10">
            <CardContent className="p-4">
              <p className="text-sm text-finca-dark leading-relaxed whitespace-pre-line">
                {propuestaIA}
              </p>
            </CardContent>
          </Card>

          {esAnonimo && (
            <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 rounded-xl p-3">
              <Shield className="w-4 h-4 shrink-0" />
              <span>La comunicación se enviará de forma anónima. Tu identidad no será revelada.</span>
            </div>
          )}

          <div className="space-y-2 pt-2">
            <Button className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-11" onClick={marcarResuelto}>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Enviar propuesta{esAnonimo ? ' (anónima)' : ''}
            </Button>
            <Button variant="outline" className="w-full h-11 border-finca-coral text-finca-coral hover:bg-finca-peach/20" onClick={solicitarMediadorHumano}>
              No me convence — Mediador humano (49-79€)
              <ChevronRight className="w-4 h-4 ml-auto" />
            </Button>
          </div>
        </div>
      )}

      {fase === 'mediador' && (
        <div className="px-4 py-8 space-y-5">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center mx-auto">
              <UserCheck className="w-8 h-8 text-orange-500" />
            </div>
            <h2 className="text-xl font-semibold text-finca-dark">Mediador profesional</h2>
            <p className="text-sm text-muted-foreground">Fase 2: Mediación con profesional certificado</p>
          </div>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">Coste</span>
                <span className="font-semibold text-finca-dark">49€ – 79€</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">Tiempo estimado</span>
                <span className="font-semibold text-finca-dark">3-7 días</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted-foreground">Certificación</span>
                <span className="font-semibold text-finca-dark">Ley 5/2012</span>
              </div>
            </CardContent>
          </Card>

          <p className="text-sm text-muted-foreground text-center">Un mediador certificado contactará contigo en las próximas 24h para iniciar el proceso.</p>

          <Button className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-11">
            Solicitar mediador (49-79€)
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => router.push('/inicio')}>Volver al inicio</Button>
        </div>
      )}

      {fase === 'resuelto' && (
        <div className="px-4 py-12 flex flex-col items-center text-center space-y-4">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>
          <h2 className="text-xl font-semibold text-finca-dark">Propuesta enviada</h2>
          <p className="text-sm text-muted-foreground max-w-xs">La propuesta ha sido enviada{esAnonimo ? ' de forma anónima' : ''}. Recibirás una notificación con la respuesta.</p>
          <Button className="bg-finca-coral hover:bg-finca-coral/90 text-white mt-4" onClick={() => router.push('/inicio')}>
            Volver al inicio
          </Button>
        </div>
      )}
    </div>
  );
}
