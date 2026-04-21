'use client';

import { useState, useCallback, useRef } from 'react';
import { collection, addDoc, setDoc, doc, getDocs, query, where, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { crearNotificacionComunidad } from '@/lib/firebase/notifications';
import { useAuth } from '@/hooks/useAuth';

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  isActionMessage?: boolean;
  isProactive?: boolean;
  data?: { id?: string; [key: string]: any };
}

const INCIDENT_KEYWORDS = /leak|filtracion|agua|noise|ruido|smell|olor|gas|broken|rotura|damage|daño|fire|fuego|flood|inundacion|problem|problema|issue|error|fault|fallo|not working|loud|ruidoso|scary|strange|weird|extraño|humedad|humidity|pest|plaga|electrical|electrico|heating|calefaccion/i;

function isIncidentReport(message: string): boolean {
  return INCIDENT_KEYWORDS.test(message);
}

const COST_TABLE: Record<string, number> = {
  gas:          120000,
  agua:          80000,
  electricidad: 150000,
  ascensor:     250000,
  ruido:         30000,
  seguridad:    100000,
  tuberia:       80000,
  puerta:        60000,
  ventana:       60000,
  plaga:         60000,
  general:       60000,
};

const MULTIPLIER: Record<string, number> = {
  baja:    1,
  media:   1,
  normal:  1,
  alta:    1.1,
  urgente: 1.2,
};

// Single source of truth for incident type — all other functions consume this
function detectTipo(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('gas'))                                          return 'gas';
  if (t.includes('ascensor'))                                     return 'ascensor';
  if (t.includes('electric') || t.includes('luz') || t.includes('corto')) return 'electricidad';
  if (t.includes('seguridad') || t.includes('robo') || t.includes('cerradura')) return 'seguridad';
  if (t.includes('puerta'))                                       return 'puerta';
  if (t.includes('ventana'))                                      return 'ventana';
  if (t.includes('tuberia') || t.includes('tubería'))             return 'tuberia';
  if (t.includes('agua') || t.includes('fuga') || t.includes('filtración') || t.includes('filtracion') || t.includes('humedad') || t.includes('inundacion') || t.includes('leak')) return 'agua';
  if (t.includes('ruido') || t.includes('sonido') || t.includes('bulla') || t.includes('noise')) return 'ruido';
  if (t.includes('plaga') || t.includes('insecto') || t.includes('rata') || t.includes('cucaracha')) return 'plaga';
  return 'general';
}

function getPriority(tipo: string): string {
  switch (tipo) {
    case 'gas':          return 'urgente';
    case 'electricidad': return 'alta';
    case 'seguridad':    return 'alta';
    case 'ascensor':     return 'alta';
    case 'agua':         return 'alta';
    case 'tuberia':      return 'alta';
    case 'plaga':        return 'alta';
    case 'ruido':        return 'normal';
    case 'puerta':       return 'normal';
    case 'ventana':      return 'normal';
    default:             return 'normal';
  }
}

function estimateCost(tipo: string, prioridad: string): number {
  const base = COST_TABLE[tipo] ?? COST_TABLE.general;
  return Math.round(base * (MULTIPLIER[prioridad] ?? 1));
}

function getRecommendation(tipo: string): string {
  switch (tipo) {
    case 'gas':
      return 'Evacuar la zona y evitar el uso de interruptores eléctricos. Llamar a la empresa de gas de inmediato.';
    case 'agua':
    case 'tuberia':
      return 'Cerrar la llave principal si es posible y evitar contacto con zonas mojadas.';
    case 'electricidad':
      return 'No manipular cables y cortar la energía desde el panel principal.';
    case 'ascensor':
      return 'Evitar el uso del ascensor hasta revisión técnica. Colocar aviso visible.';
    case 'ruido':
      return 'Registrar horarios del ruido y contactar al responsable o administración.';
    case 'seguridad':
      return 'Informar al administrador y no manipular la cerradura o área afectada.';
    case 'puerta':
      return 'No forzar el mecanismo. Esperar revisión del personal técnico.';
    case 'ventana':
      return 'Si hay riesgo de caída de vidrios, acordonar el área por seguridad.';
    case 'plaga':
      return 'Evitar contacto directo y no usar pesticidas sin autorización del administrador.';
    default:
      return 'Reportado a administración para revisión técnica.';
  }
}

function extractIncidentDetails(message: string) {
  const lowerMsg = message.toLowerCase();
  const tipo_problema = detectTipo(message);

  const CATEGORIA_MAP: Record<string, string> = {
    gas:          'otros',
    agua:         'filtraciones',
    tuberia:      'filtraciones',
    ruido:        'ruido',
    electricidad: 'daños',
    ascensor:     'otros',
    seguridad:    'otros',
    puerta:       'daños',
    ventana:      'daños',
    plaga:        'plagas',
    general:      'otros',
  };

  let zona = 'vivienda';
  if (lowerMsg.match(/parking|garaje|garage/)) zona = 'parking';
  else if (lowerMsg.match(/pasillo|common|comun|garden|jardin|patio|hallway/)) zona = 'zonas_comunes';
  else if (lowerMsg.match(/sotano|tejado|atico|basement|roof|attic/)) zona = 'zonas_comunes';

  return {
    categoria_id: CATEGORIA_MAP[tipo_problema] ?? 'otros',
    tipo_problema,
    prioridad: getPriority(tipo_problema),
    zona,
  };
}

function getSuggestedCause(tipo: string): string {
  switch (tipo) {
    case 'gas':       return 'posible fuga en tubería o válvula';
    case 'agua':      return 'posible daño en tuberías o presión';
    case 'ruido':     return 'posible falla mecánica o vibración';
    case 'electricidad': return 'posible sobrecarga o corto circuito';
    case 'fontaneria': return 'posible daño en tuberías o presión';
    default:          return 'problema recurrente en infraestructura';
  }
}

function getThreshold(categoria_id: string): number {
  return categoria_id === 'gas' ? 2 : 3;
}

async function analyzePatterns(
  comunidadId: string,
  categoria_id: string,
  zona: string
): Promise<{ detected: boolean; count: number; level: 'medium' | 'high' | null }> {
  try {
    const now = Date.now();
    const last24h = now - 24 * 60 * 60 * 1000;

    const snap = await getDocs(
      query(
        collection(db, 'incidencias'),
        where('comunidad_id', '==', comunidadId),
        where('categoria_id', '==', categoria_id),
        where('zona', '==', zona),
        orderBy('created_at', 'desc'),
        limit(20),
      )
    );

    const filtered = snap.docs.filter((d) => {
      const data = d.data();
      if (!data.created_at) return false;
      // Handle both Firestore Timestamp and ISO string
      const time: number = typeof data.created_at.toDate === 'function'
        ? data.created_at.toDate().getTime()
        : new Date(data.created_at).getTime();
      return (
        data.categoria_id === categoria_id &&
        data.zona === zona &&
        data.comunidad_id === comunidadId &&
        time >= last24h
      );
    });

    const count = filtered.length;
    const threshold = getThreshold(categoria_id);
    console.log('Pattern count:', count);
    console.log('Threshold:', threshold);

    if (count >= threshold + 1) return { detected: true, count, level: 'high' };
    if (count >= threshold)     return { detected: true, count, level: 'medium' };
    return { detected: false, count, level: null };
  } catch {
    return { detected: false, count: 0, level: null };
  }
}

export function useAIChat() {
  const { perfil } = useAuth();
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastMessageIdRef = useRef(0);
  const triggeredPatternsRef = useRef<Set<string>>(new Set());

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return;

      const userMessageId = `msg-${++lastMessageIdRef.current}`;
      const userMessage: AIMessage = {
        id: userMessageId,
        role: 'user',
        content: content.trim(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setLoading(true);
      setError(null);

      try {
        if (!perfil?.id || !perfil?.comunidad_id) {
          throw new Error('No has iniciado sesión');
        }

        const isIncident = isIncidentReport(content);

        if (isIncident) {
          // Extract incident details
          const { categoria_id, tipo_problema, prioridad, zona } =
            extractIncidentDetails(content);

          const titulo = content.substring(0, 100);
          const now = new Date().toISOString();
          const costoEstimado = estimateCost(tipo_problema, prioridad);
          const recomendacion = getRecommendation(tipo_problema);

          // Create incident in Firestore
          const incidenciaRef = await addDoc(collection(db, 'incidencias'), {
            comunidad_id: perfil.comunidad_id,
            autor_id: perfil.id,
            titulo,
            descripcion: content,
            categoria_id,
            tipo_problema,
            prioridad,
            zona,
            ubicacion: zona,
            estado: 'pendiente',
            estimacion_min: 0,
            estimacion_max: costoEstimado,
            recomendacion,
            created_at: now,
            updated_at: now,
            resuelta_at: null,
            created_via_ai: true,
            quorum: {
              tipo: 'simple',
              umbral: 30,
              afectados_count: 1,
              peso_afectados: 1,
              alcanzado: false,
            },
          });

          const incidenciaId = incidenciaRef.id;

          const actionMessageId = `msg-${++lastMessageIdRef.current}`;
          const actionMessage: AIMessage = {
            id: actionMessageId,
            role: 'assistant',
            content: `✅ Incidencia creada\n\n💰 Costo estimado: $${costoEstimado.toLocaleString('es-CO')}\n⚠️ Prioridad: ${prioridad}\n\n💡 Recomendación:\n${recomendacion}`,
            isActionMessage: true,
            data: { id: incidenciaId },
          };

          setMessages((prev) => [...prev, actionMessage]);

          // Fire-and-forget secondary operations
          setDoc(
            doc(db, 'incidencias', incidenciaId, 'afectados', perfil.id),
            { coeficiente: 1, added_at: now, es_autor: true }
          ).catch((err) => {
            console.error('[FIRESTORE WRITE FAILED] afectados subcollection:', err?.code, err?.message);
          });

          crearNotificacionComunidad(perfil.comunidad_id, {
            tipo: 'incidencia',
            titulo: `Nueva incidencia reportada: ${titulo}`,
            mensaje: content.substring(0, 200),
            created_by: perfil.id,
            related_id: incidenciaId,
            link: `/incidencias/${incidenciaId}`,
          }).catch((err) => {
            console.error('[FIRESTORE WRITE FAILED] notification:', err?.message ?? err);
          });

          // Proactive pattern analysis (fire-and-forget, never blocks chat)
          const patternKey = `${categoria_id}-${zona}`;
          if (!triggeredPatternsRef.current.has(patternKey)) {
            analyzePatterns(perfil.comunidad_id, categoria_id, zona).then(async (pattern) => {
              if (!pattern.detected) return;
              triggeredPatternsRef.current.add(patternKey);

              const levelEmoji = pattern.level === 'high' ? '🔴' : '🟡';
              const cause = getSuggestedCause(tipo_problema);
              const alertMsg = `⚠️ Se han detectado múltiples incidencias de ${categoria_id} en ${zona}. Posible problema recurrente. Se recomienda revisión preventiva.`;

              // Show proactive chat message
              const proactiveId = `msg-${++lastMessageIdRef.current}`;
              setMessages((prev) => [
                ...prev,
                {
                  id: proactiveId,
                  role: 'assistant',
                  content: `${levelEmoji} He detectado ${pattern.count} incidencias similares (${categoria_id}) en ${zona} en las últimas 24h.\nPosible causa: ${cause}.\n${alertMsg}`,
                  isProactive: true,
                },
              ]);

              // Persist global alert in Firestore (skip if active duplicate exists)
              getDocs(
                query(
                  collection(db, 'alertas_globales'),
                  where('categoria_id', '==', categoria_id),
                  where('zona', '==', zona),
                  where('activa', '==', true),
                  where('comunidad_id', '==', perfil.comunidad_id),
                )
              ).then((existing) => {
                if (!existing.empty) return;
                return addDoc(collection(db, 'alertas_globales'), {
                  categoria_id,
                  zona,
                  comunidad_id: perfil.comunidad_id,
                  mensaje: alertMsg,
                  activa: true,
                  created_at: serverTimestamp(),
                });
              }).catch(() => {});

              // Send email notification (fire-and-forget)
              fetch('/api/alerta-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categoria: categoria_id, zona, mensaje: alertMsg }),
              }).catch(() => {});
            }).catch(() => {});
          }
        } else {
          // Generic helpful response
          const assistantMessageId = `msg-${++lastMessageIdRef.current}`;
          const assistantMessage: AIMessage = {
            id: assistantMessageId,
            role: 'assistant',
            content:
              '👋 ¡Hola! Puedo ayudarte a reportar incidencias en tu comunidad. Describe el problema, por ejemplo: "hay una fuga de agua en el baño", "huele a gas en el pasillo" o "ruido extraño en el parking".',
          };

          setMessages((prev) => [...prev, assistantMessage]);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Error desconocido';
        setError(errorMessage);

        const errorMessageId = `msg-${++lastMessageIdRef.current}`;
        const errorMsg: AIMessage = {
          id: errorMessageId,
          role: 'system',
          content: `❌ Error: ${errorMessage}`,
        };

        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setLoading(false);
      }
    },
    [perfil]
  );

  return {
    messages,
    loading,
    error,
    sendMessage,
    clearMessages,
  };
}
