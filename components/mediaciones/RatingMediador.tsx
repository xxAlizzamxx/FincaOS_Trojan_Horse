'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Star, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface RatingMediadorProps {
  mediacionId: string;
  mediadorId: string;
  soySolicitante: boolean;
}

export default function RatingMediador({ mediacionId, mediadorId, soySolicitante }: RatingMediadorProps) {
  const { user } = useAuth();
  const uid = user?.uid;

  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comentario, setComentario] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [yaValorado, setYaValorado] = useState(false);
  const [valoracionExistente, setValoracionExistente] = useState<{ rating: number; comentario?: string } | null>(null);

  /* Check if already rated */
  useEffect(() => {
    if (!uid || !mediacionId) return;

    async function checkExisting() {
      try {
        const snap = await getDoc(doc(db, 'mediaciones', mediacionId, 'valoracion_mediador', uid!));
        if (snap.exists()) {
          const data = snap.data();
          setYaValorado(true);
          setValoracionExistente({ rating: data.rating, comentario: data.comentario });
          setRating(data.rating);
        }
      } catch (err) {
        console.error('Error checking valoracion:', err);
      } finally {
        setLoading(false);
      }
    }

    checkExisting();
  }, [uid, mediacionId]);

  /* Only show to the solicitante */
  if (!soySolicitante) return null;

  async function handleSubmit() {
    if (!uid || rating === 0) return;

    setSubmitting(true);
    try {
      /* Save rating in subcollection */
      await setDoc(doc(db, 'mediaciones', mediacionId, 'valoracion_mediador', uid), {
        rating,
        comentario: comentario.trim() || null,
        created_at: new Date().toISOString(),
      });

      /* Update mediador profile with cumulative average */
      const mediadorRef = doc(db, 'perfiles', mediadorId);
      const mediadorSnap = await getDoc(mediadorRef);

      if (mediadorSnap.exists()) {
        const data = mediadorSnap.data();
        const totalActual = data.mediador_total_valoraciones || 0;
        const sumaActual = data.mediador_suma_ratings || 0;

        const nuevoTotal = totalActual + 1;
        const nuevaSuma = sumaActual + rating;
        const nuevoPromedio = nuevaSuma / nuevoTotal;

        await updateDoc(mediadorRef, {
          mediador_total_valoraciones: nuevoTotal,
          mediador_suma_ratings: nuevaSuma,
          mediador_rating_promedio: Math.round(nuevoPromedio * 100) / 100,
        });
      }

      setYaValorado(true);
      setValoracionExistente({ rating, comentario: comentario.trim() || undefined });
      toast.success('Valoración enviada');
    } catch (err) {
      console.error('Error enviando valoración:', err);
      toast.error('Error al enviar la valoración');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 flex items-center justify-center h-20">
          <Loader2 className="w-5 h-5 animate-spin text-finca-coral" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4 space-y-3">
        <h3 className="text-sm font-semibold text-finca-dark flex items-center gap-2">
          <Star className="w-4 h-4 text-finca-coral" />
          Valorar al mediador
        </h3>

        {yaValorado ? (
          <div className="text-center space-y-2 py-2">
            <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto" />
            <p className="text-sm text-muted-foreground">Ya valoraste esta mediación</p>
            <div className="flex justify-center gap-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star
                  key={s}
                  className={cn(
                    'w-5 h-5',
                    s <= (valoracionExistente?.rating || 0)
                      ? 'fill-yellow-400 text-yellow-400'
                      : 'text-gray-300',
                  )}
                />
              ))}
            </div>
            {valoracionExistente?.comentario && (
              <p className="text-xs text-muted-foreground italic">
                &ldquo;{valoracionExistente.comentario}&rdquo;
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Stars */}
            <div className="flex justify-center gap-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  onClick={() => setRating(s)}
                  onMouseEnter={() => setHover(s)}
                  onMouseLeave={() => setHover(0)}
                  className="p-0.5 transition-transform hover:scale-110"
                >
                  <Star
                    className={cn(
                      'w-7 h-7 transition-colors',
                      s <= (hover || rating)
                        ? 'fill-yellow-400 text-yellow-400'
                        : 'text-gray-300',
                    )}
                  />
                </button>
              ))}
            </div>

            {rating > 0 && (
              <p className="text-center text-xs text-muted-foreground">
                {rating === 1 && 'Muy malo'}
                {rating === 2 && 'Malo'}
                {rating === 3 && 'Regular'}
                {rating === 4 && 'Bueno'}
                {rating === 5 && 'Excelente'}
              </p>
            )}

            {/* Comment */}
            <Textarea
              placeholder="Comentario opcional..."
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              rows={2}
              className="text-sm resize-none"
            />

            {/* Submit */}
            <Button
              className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white"
              disabled={rating === 0 || submitting}
              onClick={handleSubmit}
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Star className="w-4 h-4 mr-2" />
              )}
              Enviar valoración
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
