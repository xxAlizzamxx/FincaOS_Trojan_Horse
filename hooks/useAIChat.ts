'use client';

import { useState, useCallback, useRef } from 'react';
import { collection, addDoc, setDoc, doc, getDocs, query, where } from 'firebase/firestore';
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

// Single source of truth for incident type — all other functions consume this
function detectTipo(text: string): string {
  const t = text.toLowerCase();
  if (t.match(/gas|fuga de gas|huele a gas/)) return 'gas';
  if (t.match(/agua|fuga|filtración|filtracion|humedad|inundacion|flood|leak/)) return 'agua';
  if (t.match(/ruido|sonido|bulla|noise|loud/)) return 'ruido';
  if (t.match(/electri[ck]|luz|corto|sobrecarga/)) return 'electricidad';
  if (t.match(/plaga|insecto|rata|cucaracha|pest/)) return 'plaga';
  return 'general';
}

function getPriority(tipo: string): string {
  switch (tipo) {
    case 'gas':          return 'urgente';
    case 'agua':         return 'alta';
    case 'electricidad': return 'alta';
    case 'plaga':        return 'alta';
    case 'ruido':        return 'normal';
    default:             return 'normal';
  }
}

function estimateCost(tipo: string): number {
  switch (tipo) {
    case 'gas':          return 500000;
    case 'agua':         return 150000;
    case 'electricidad': return 200000;
    case 'plaga':        return 80000;
    case 'ruido':        return 50000;
    default:             return 100000;
  }
}

function extractIncidentDetails(message: string) {
  const lowerMsg = message.toLowerCase();
  const tipo_problema = detectTipo(message);

  const CATEGORIA_MAP: Record<string, string> = {
    gas:          'otros',
    agua:         'filtraciones',
    ruido:        'ruido',
    electricidad: 'daños',
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

async function analyzePatterns(
  comunidadId: string,
  tipo: string,
  zona?: string
): Promise<{ detected: boolean; count: number; level: 'medium' | 'high' | null }> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const constraints = [
      where('comunidad_id', '==', comunidadId),
      where('tipo_problema', '==', tipo),
    ];
    if (zona) constraints.push(where('zona', '==', zona));

    const snap = await getDocs(query(collection(db, 'incidencias'), ...constraints));

    // Filter by last 24h manually (avoids composite index requirement)
    const recent = snap.docs.filter((d) => {
      const ca = d.data().created_at;
      const dateStr = ca?.toDate ? ca.toDate().toISOString() : ca;
      return typeof dateStr === 'string' && dateStr >= since;
    });

    const count = recent.length;
    if (count >= 5) return { detected: true, count, level: 'high' };
    if (count >= 3) return { detected: true, count, level: 'medium' };
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
          const costoEstimado = estimateCost(tipo_problema);

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
            content: `✅ ¡Incidencia registrada!\n\n📍 Zona: ${zona}\n⚠️ Prioridad: ${prioridad}\n💰 Costo estimado: $${costoEstimado.toLocaleString('es-CO')}\n🆔 ID: ${incidenciaId.slice(0, 12)}...`,
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
          const patternKey = `${tipo_problema}:${zona}`;
          if (!triggeredPatternsRef.current.has(patternKey)) {
            analyzePatterns(perfil.comunidad_id, tipo_problema, zona).then((pattern) => {
              if (!pattern.detected) return;
              triggeredPatternsRef.current.add(patternKey);
              const cause = getSuggestedCause(tipo_problema);
              const levelEmoji = pattern.level === 'high' ? '🔴' : '🟡';
              const proactiveId = `msg-${++lastMessageIdRef.current}`;
              setMessages((prev) => [
                ...prev,
                {
                  id: proactiveId,
                  role: 'assistant',
                  content: `${levelEmoji} He detectado ${pattern.count} incidencias similares en las últimas 24h.\nPosible causa: ${cause}.\nRecomendación: revisar infraestructura o contactar mantenimiento en ${zona || 'la comunidad'}.`,
                  isProactive: true,
                },
              ]);
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
