'use client';

import { useState, useCallback, useRef } from 'react';
import { collection, addDoc, setDoc, doc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { crearNotificacionComunidad } from '@/lib/firebase/notifications';

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

function extractIncidentDetails(message: string) {
  const lowerMsg = message.toLowerCase();

  let categoria_id = 'otros';
  let tipo_problema = 'general';
  let prioridad = 'normal';
  let zona = 'vivienda';

  // Determine category and type
  if (lowerMsg.match(/leak|filtracion|agua|humidity|humedad|flood|inundacion/)) {
    categoria_id = 'filtraciones';
    tipo_problema = 'fontaneria';
    prioridad = lowerMsg.includes('water') || lowerMsg.includes('flood') ? 'alta' : 'normal';
  } else if (lowerMsg.match(/noise|ruido|loud|ruidoso/)) {
    categoria_id = 'ruido';
    tipo_problema = 'ruido';
    prioridad = 'normal';
  } else if (lowerMsg.match(/smell|olor|gas/)) {
    categoria_id = 'otros';
    tipo_problema = 'general';
    prioridad = 'urgente';
  } else if (lowerMsg.match(/broken|rotura|damage|daño|electrical|electrico|fire|fuego/)) {
    categoria_id = 'daños';
    tipo_problema = 'general';
    prioridad = lowerMsg.includes('fire') || lowerMsg.includes('fuego') ? 'urgente' : 'alta';
  } else if (lowerMsg.match(/heating|calefaccion/)) {
    categoria_id = 'otros';
    tipo_problema = 'general';
    prioridad = 'normal';
  } else if (lowerMsg.match(/pest|plaga/)) {
    categoria_id = 'plagas';
    tipo_problema = 'general';
    prioridad = 'alta';
  }

  // Determine zone
  if (lowerMsg.match(/parking|garaje|garage/)) {
    zona = 'parking';
  } else if (lowerMsg.match(/hallway|pasillo|common|comun|garden|jardin|patio/)) {
    zona = 'zonas_comunes';
  } else if (lowerMsg.match(/basement|sotano|roof|tejado|attic|atico/)) {
    zona = 'zonas_comunes';
  } else if (lowerMsg.match(/apartment|piso|flat|home|house|casa|vivienda|room|habitacion/)) {
    zona = 'vivienda';
  }

  return { categoria_id, tipo_problema, prioridad, zona };
}

export function useAIChat() {
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastMessageIdRef = useRef(0);

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
        // Get user from localStorage
        const userStr = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
        const user = userStr ? JSON.parse(userStr) : null;

        if (!user?.id || !user?.comunidad_id) {
          throw new Error('User not authenticated');
        }

        const isIncident = isIncidentReport(content);

        if (isIncident) {
          // Extract incident details
          const { categoria_id, tipo_problema, prioridad, zona } =
            extractIncidentDetails(content);

          const titulo = content.substring(0, 100);
          const now = Timestamp.now();

          // Create incident in Firestore
          const incidenciaRef = await addDoc(collection(db, 'incidencias'), {
            comunidad_id: user.comunidad_id,
            autor_id: user.id,
            titulo,
            descripcion: content,
            categoria_id,
            tipo_problema,
            prioridad,
            zona,
            ubicacion: zona,
            estado: 'pendiente',
            estimacion_min: 0,
            estimacion_max: 0,
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
            content: `✅ Incident created successfully!\n\n📍 Location: ${zona}\n⚠️ Priority: ${prioridad}\n🆔 Incident ID: ${incidenciaId.slice(0, 12)}...`,
            isActionMessage: true,
            data: { id: incidenciaId },
          };

          setMessages((prev) => [...prev, actionMessage]);

          // Fire-and-forget secondary operations
          setDoc(
            doc(db, 'incidencias', incidenciaId, 'afectados', user.id),
            { coeficiente: 1, added_at: now, es_autor: true }
          ).catch((err) => {
            console.error('[FIRESTORE WRITE FAILED] afectados subcollection:', err?.code, err?.message);
          });

          crearNotificacionComunidad(user.comunidad_id, {
            tipo: 'incidencia',
            titulo: `New incident reported: ${titulo}`,
            mensaje: content.substring(0, 200),
            created_by: user.id,
            related_id: incidenciaId,
            link: `/incidencias/${incidenciaId}`,
          }).catch((err) => {
            console.error('[FIRESTORE WRITE FAILED] notification:', err?.message ?? err);
          });
        } else {
          // Generic helpful response
          const assistantMessageId = `msg-${++lastMessageIdRef.current}`;
          const assistantMessage: AIMessage = {
            id: assistantMessageId,
            role: 'assistant',
            content:
              '👋 Hi! I can help you report incidents in your community. Try describing a problem like: "water leak in bathroom", "strange noise in hallway", or "gas smell in kitchen".',
          };

          setMessages((prev) => [...prev, assistantMessage]);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
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
    []
  );

  return {
    messages,
    loading,
    error,
    sendMessage,
    clearMessages,
  };
}
