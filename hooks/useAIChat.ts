'use client';

import { useState, useCallback, useRef } from 'react';
import { collection, addDoc, setDoc, doc, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
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

function detectTipo(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('gas'))                                                                             return 'gas';
  if (t.includes('ascensor'))                                                                        return 'ascensor';
  if (t.includes('electric') || t.includes('luz') || t.includes('corto'))                          return 'electricidad';
  if (t.includes('seguridad') || t.includes('robo') || t.includes('cerradura'))                    return 'seguridad';
  if (t.includes('puerta'))                                                                          return 'puerta';
  if (t.includes('ventana'))                                                                         return 'ventana';
  if (t.includes('tuberia') || t.includes('tubería'))                                               return 'tuberia';
  if (t.includes('agua') || t.includes('fuga') || t.includes('filtración') || t.includes('filtracion') || t.includes('humedad') || t.includes('inundacion') || t.includes('leak')) return 'agua';
  if (t.includes('ruido') || t.includes('sonido') || t.includes('bulla') || t.includes('noise'))  return 'ruido';
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

  // categoria_id maps to the coarse Firestore category used by the rest of the app
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
    case 'gas':          return 'posible fuga en tubería o válvula';
    case 'agua':         return 'posible daño en tuberías o presión';
    case 'ruido':        return 'posible falla mecánica o vibración';
    case 'electricidad': return 'posible sobrecarga o corto circuito';
    default:             return 'problema recurrente en infraestructura';
  }
}

// Use tipo_problema (fine-grained) for threshold — gas-specific incidents need lower bar
function getThreshold(tipo_problema: string): number {
  return tipo_problema === 'gas' ? 2 : 4;
}

async function analyzePatterns(
  comunidadId: string,
  categoria_id: string,
  zona: string,
  tipo_problema: string,
): Promise<{ detected: boolean; count: number; level: 'medium' | 'high' | null }> {
  try {
    const last24h = Date.now() - 24 * 60 * 60 * 1000;

    console.log(`[AI PATTERN] Querying: categoria=${categoria_id} zona=${zona} comunidad=${comunidadId}`);

    // Only basic where clauses — no orderBy, no composite index required
    const snap = await getDocs(
      query(
        collection(db, 'incidencias'),
        where('comunidad_id', '==', comunidadId),
        where('categoria_id', '==', categoria_id),
        where('zona', '==', zona),
      )
    );

    console.log(`[AI PATTERN] Raw docs fetched: ${snap.size}`);

    const filtered = snap.docs.filter((d) => {
      const data = d.data();
      if (!data.created_at) return false;
      let time: number;
      if (typeof data.created_at.toDate === 'function') {
        time = data.created_at.toDate().getTime();
      } else if (typeof data.created_at === 'string') {
        time = new Date(data.created_at).getTime();
      } else {
        return false;
      }
      return time >= last24h;
    });

    const count = filtered.length;
    const threshold = getThreshold(tipo_problema);

    console.log(`[AI PATTERN] categoria: ${categoria_id} zona: ${zona} count: ${count} threshold: ${threshold}`);

    if (count >= threshold + 1) return { detected: true, count, level: 'high' };
    if (count >= threshold)     return { detected: true, count, level: 'medium' };
    return { detected: false, count, level: null };
  } catch (err) {
    console.error('[AI PATTERN] analyzePatterns failed:', err);
    return { detected: false, count: 0, level: null };
  }
}

async function createAlertIfNeeded(
  comunidadId: string,
  categoria_id: string,
  zona: string,
  mensaje: string,
  nivel: 'medium' | 'high',
): Promise<void> {
  // Step 1: check for existing active alert (fail-safe — if check fails, still attempt creation)
  let duplicateExists = false;
  try {
    const existing = await getDocs(
      query(
        collection(db, 'alertas_globales'),
        where('comunidad_id', '==', comunidadId),
        where('categoria_id', '==', categoria_id),
        where('zona', '==', zona),
        where('activa', '==', true),
      )
    );
    duplicateExists = !existing.empty;
    console.log(`[AI ALERT] Duplicate check: ${duplicateExists ? 'DUPLICATE FOUND, skipping' : 'no duplicate'}`);
  } catch (err) {
    console.warn('[AI ALERT] Duplicate check failed (will attempt creation anyway):', err);
  }

  if (duplicateExists) return;

  // Step 2: create the alert
  try {
    console.log('[AI ALERT] Creating alert in alertas_globales...');
    await addDoc(collection(db, 'alertas_globales'), {
      comunidad_id: comunidadId,
      categoria_id,
      zona,
      mensaje,
      nivel,
      activa: true,
      created_at: serverTimestamp(),
    });
    console.log('[AI ALERT] Alert created successfully');
  } catch (err) {
    console.error('[ALERTA CREATE ERROR]', err);
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
      setMessages((prev) => [...prev, { id: userMessageId, role: 'user', content: content.trim() }]);
      setLoading(true);
      setError(null);

      try {
        if (!perfil?.id || !perfil?.comunidad_id) {
          throw new Error('No has iniciado sesión');
        }

        const isIncident = isIncidentReport(content);

        if (isIncident) {
          const { categoria_id, tipo_problema, prioridad, zona } = extractIncidentDetails(content);
          const titulo = content.substring(0, 100);
          const now = new Date().toISOString();
          const costoEstimado = estimateCost(tipo_problema, prioridad);
          const recomendacion = getRecommendation(tipo_problema);

          // Create incident
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

          setMessages((prev) => [
            ...prev,
            {
              id: `msg-${++lastMessageIdRef.current}`,
              role: 'assistant',
              content: `✅ Incidencia creada\n\n💰 Costo estimado: $${costoEstimado.toLocaleString('es-CO')}\n⚠️ Prioridad: ${prioridad}\n\n💡 Recomendación:\n${recomendacion}`,
              isActionMessage: true,
              data: { id: incidenciaId },
            },
          ]);

          // Fire-and-forget: afectados + community notification
          setDoc(
            doc(db, 'incidencias', incidenciaId, 'afectados', perfil.id),
            { coeficiente: 1, added_at: now, es_autor: true },
          ).catch((err) => {
            console.error('[FIRESTORE WRITE FAILED] afectados:', err?.code, err?.message);
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

          // Pattern analysis — fire-and-forget, never blocks chat
          const patternKey = `${categoria_id}-${zona}`;
          if (!triggeredPatternsRef.current.has(patternKey)) {
            console.log(`[AI PATTERN] Starting analysis for key: ${patternKey}`);

            analyzePatterns(perfil.comunidad_id, categoria_id, zona, tipo_problema)
              .then(async (pattern) => {
                console.log('[AI PATTERN] Result:', pattern);

                if (!pattern.detected) return;

                // Mark as triggered to avoid re-triggering in same session
                triggeredPatternsRef.current.add(patternKey);

                const levelEmoji = pattern.level === 'high' ? '🔴' : '🟡';
                const cause = getSuggestedCause(tipo_problema);
                const alertMsg = `Se han detectado ${pattern.count} incidencias de ${categoria_id} en zona "${zona}" en las últimas 24h. Posible causa: ${cause}. Se recomienda revisión preventiva.`;

                // Show proactive chat message
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `msg-${++lastMessageIdRef.current}`,
                    role: 'assistant',
                    content: `${levelEmoji} Patrón detectado: ${pattern.count} incidencias de ${categoria_id} en ${zona} (últimas 24h).\nPosible causa: ${cause}.\n💡 ${getRecommendation(tipo_problema)}`,
                    isProactive: true,
                  },
                ]);

                // Persist alert (with duplicate check)
                if (perfil?.comunidad_id) {
                  await createAlertIfNeeded(
                    perfil.comunidad_id,
                    categoria_id,
                    zona,
                    alertMsg,
                    pattern.level!,
                  );
                }

                // Email — non-blocking
                console.log('[EMAIL ALERT TRIGGERED]', { categoria_id, zona });
                fetch('/api/alerta-email', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ categoria: categoria_id, zona, mensaje: alertMsg }),
                }).catch((err) => {
                  console.error('[EMAIL ALERT ERROR]', err);
                });
              })
              .catch((err) => {
                console.error('[AI PATTERN] Unexpected error in pattern chain:', err);
              });
          }
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: `msg-${++lastMessageIdRef.current}`,
              role: 'assistant',
              content: '👋 ¡Hola! Puedo ayudarte a reportar incidencias en tu comunidad. Describe el problema, por ejemplo: "hay una fuga de agua en el baño", "huele a gas en el pasillo" o "ruido extraño en el parking".',
            },
          ]);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Error desconocido';
        setError(errorMessage);
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${++lastMessageIdRef.current}`,
            role: 'system',
            content: `❌ Error: ${errorMessage}`,
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [perfil],
  );

  return { messages, loading, error, sendMessage, clearMessages };
}
