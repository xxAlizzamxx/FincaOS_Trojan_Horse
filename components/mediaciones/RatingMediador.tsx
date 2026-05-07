'use client';

import { useEffect, useState } from 'react';
import {
  doc, getDoc, setDoc, updateDoc, increment,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Star, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props {
  mediacionId: string;
  mediadorId: string;
  /** Only the solicitante can rate */
  soySolicitante: boolean;
}

export default function RatingMediador({ mediacionId, mediadorId, soySolicitante }: Props) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';

  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [yaValorado, setYaValorado] = useState(false);
  const [valoracionExistente, setValoracionExistente] = useState<{
    rating: number;
    comentario: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  /* ── Comprobar si ya existe una valoración ── */
  useEffect(() => {
    if (!mediacionId || !uid) { setLoading(false); return; }
    (async () => {
      try {
        const snap = await getDoc(
          doc(db, 'mediaciones', mediacionId, 'valoracion_mediador', uid),
        );
        if (snap.exists()) {
          const data = snap.data();
          setYaValorado(true);
          setValoracionExistente({
            rating: data.rating,
            comentario: data.comentario ?? '',
          });
        }
      } catch (err) {
        console.error('[RatingMediador] Error cargando valoración:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [mediacionId, uid]);

  /* ── Enviar valoración ── */
  async function enviarValoracion() {
    if (!rating || !uid || !mediadorId) return;
    setEnviando(true);
    try {
      // 1. Guardar valoración en la subcollection de la mediación
      await setDoc(
        doc(db, 'mediaciones', mediacionId, 'valoracion_mediador', uid),
        {
          rating,
          comentario: comentario.trim(),
          mediador_id: mediadorId,
          autor_id: uid,
          created_at: new Date().toISOString(),
        },
      );

      // 2. Actualizar el perfil del mediador con la nueva valoración
      // Usamos campos acumulativos para calcular el promedio
      const mediadorRef = doc(db, 'perfiles', mediadorId);
      const mediadorSnap = await getDoc(mediadorRef);

      if (mediadorSnap.exists()) {
        const data = mediadorSnap.data();
        const totalActual = data.mediador_total_valoraciones ?? 0;
        const sumaActual = data.mediador_suma_ratings ?? 0;
        const nuevoTotal = totalActual + 1;
        const nuevaSuma = sumaActual + rating;
        const nuevoPromedio = Number((nuevaSuma / nuevoTotal).toFixed(2));

        await updateDoc(mediadorRef, {
          mediador_total_valoraciones: nuevoTotal,
          mediador_suma_ratings: nuevaSuma,
          mediador_rating_promedio: nuevoPromedio,
        });
      }

      // 3. Guardar referencia en la mediación también
      await updateDoc(doc(db, 'mediaciones', mediacionId), {
        valoracion_rating: rating,
        valoracion_comentario: comentario.trim() || null,
      });

      setYaValorado(true);
      setValoracionExistente({ rating, comentario: comentario.trim() });
      toast.success('Valoración enviada. ¡Gracias!');
    } catch (err: any) {
      console.error('[RatingMediador] Error:', err);
      toast.error('Error al enviar la valoración');
    } finally {
      setEnviando(false);
    }
  }

  if (loading) return null;

  /* ── Ya valorado: mostrar resultado ── */
  if (yaValorado && valoracionExistente) {
    return (
      <Card className="border-0 shadow-sm bg-green-50/50 border-l-4 border-l-green-400">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">
              Mediador valorado
            </p>
          </div>
          <div className="flex items-center gap-1 mb-1">
            {[1, 2, 3, 4, 5].map((s) => (
              <Star
                key={s}
                className={cn(
                  'w-5 h-5',
                  s <= valoracionExistente.rating
                    ? 'fill-yellow-400 text-yellow-400'
                    : 'text-gray-200 fill-gray-200',
                )}
              />
            ))}
            <span className="ml-1 text-sm font-bold text-finca-dark">
              {valoracionExistente.rating}/5
            </span>
          </div>
          {valoracionExistente.comentario && (
            <p className="text-sm text-muted-foreground mt-1">
              &quot;{valoracionExistente.comentario}&quot;
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  /* ── Solo el solicitante puede valorar ── */
  if (!soySolicitante) return null;

  return (
    <Card className="border-0 shadow-sm border-l-4 border-l-yellow-400 bg-yellow-50/30">
      <CardContent className="p-4 space-y-3">
        <div>
          <p className="text-xs font-semibold text-yellow-700 uppercase tracking-wide">
            Valora al mediador
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tu opinión ayuda a mejorar el servicio de mediación
          </p>
        </div>

        {/* Estrellas */}
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              type="button"
              onMouseEnter={() => setHoverRating(s)}
              onMouseLeave={() => setHoverRating(0)}
              onClick={() => setRating(s)}
              className="p-0.5 transition-transform hover:scale-110"
            >
              <Star
                className={cn(
                  'w-8 h-8 transition-colors',
                  s <= (hoverRating || rating)
                    ? 'fill-yellow-400 text-yellow-400'
                    : 'text-gray-200 fill-gray-200',
                )}
              />
            </button>
          ))}
          {rating > 0 && (
            <span className="ml-2 text-sm font-bold text-finca-dark">{rating}/5</span>
          )}
        </div>

        {/* Comentario */}
        <Textarea
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          placeholder="¿Cómo fue tu experiencia con el mediador? (opcional)"
          rows={2}
          className="resize-none text-sm"
        />

        <Button
          className="w-full bg-yellow-500 hover:bg-yellow-600 text-white h-10 font-medium"
          onClick={enviarValoracion}
          disabled={!rating || enviando}
        >
          {enviando ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <Star className="w-4 h-4 mr-2" />
              Enviar valoración
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
