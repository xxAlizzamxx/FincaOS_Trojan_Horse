/**
 * POST /api/ai/chat
 *
 * Unified AI assistant — combines conversational chat AND autonomous action.
 *
 * TWO modes, selected by lightweight keyword intent detection:
 *
 *   INCIDENT mode  (user describes a real problem):
 *     1. Single Gemini call → structured JSON {titulo, zona, descripcion, prioridad, respuesta}
 *     2. Creates incidencia in Firestore with IA metadata
 *     3. Writes community notification
 *     4. Returns {reply, incidencia_creada: true, incidencia_id}
 *
 *   CHAT mode (user asks a question):
 *     1. Builds Firestore context (incidencias, cuotas, votaciones, anuncios, insights)
 *     2. Single Gemini call → natural language answer
 *     3. Returns {reply}
 *
 * Security:
 *   - Auth: Firebase ID token
 *   - Data: filtered to user's comunidad_id
 *   - Role-aware: admin sees aggregate data, vecino sees only own cuotas
 *   - Rate limit: 20 req / 60 s per IP
 */

import { NextRequest, NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth }       from 'firebase-admin/auth';
import { getAdminDb }    from '@/lib/firebase/admin';
import { askGemini }     from '@/lib/gemini';
import { normalizeZona } from '@/lib/incidencias/mapZona';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { createLogger }  from '@/lib/logger';
import { detectPatterns, saveInsights } from '@/lib/ai/patternEngine';

// ── Firebase Admin bootstrap ─────────────────────────────────────────────────
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

// ── Intent detection — keyword set ───────────────────────────────────────────
// Fast O(1) check before making any API call. Conservative: only clear
// problem descriptions trigger auto-creation. Questions never do.

const INCIDENT_KEYWORDS = new Set([
  // Water / leaks
  'fuga', 'gotea', 'goteo', 'gotera', 'goteras', 'inundaci', 'inundado',
  'agua', 'humedad', 'húmedo', 'mojado', 'mojada',
  // Gas / odours
  'gas', 'huele', 'olor', 'olfato', 'escape',
  // Structural
  'grieta', 'fisura', 'rotura', 'roto', 'rota', 'agrietado',
  'daño', 'daños', 'dañado', 'dañada', 'desprendimiento', 'desprendido',
  // Electricity
  'electricidad', 'cortocircuito', 'apagón', 'cable', 'enchufe',
  // Lift / access
  'ascensor', 'atrapado', 'atascado', 'puerta rota', 'cerradura',
  // Noise / nuisance
  'ruido', 'ruidos', 'molest',
  // Maintenance / repair
  'avería', 'averiado', 'averiada', 'avería', 'arreglar', 'reparar', 'reparación',
  // Emergencies
  'urgente', 'urgencia', 'emergencia', 'peligro', 'peligroso',
  // Generic problem
  'problema', 'problemas',
]);

/**
 * Returns true only when the message describes a real problem (not a question).
 * Any form of question mark (trailing ? or leading ¿) is treated as chat mode.
 */
function isIncidentMessage(msg: string): boolean {
  const lower    = msg.toLowerCase().trim();
  const stripped = lower.trimEnd();

  // Trailing ? — standard question in any language
  if (stripped.endsWith('?')) return false;
  // Leading ¿ — Spanish opening question mark
  if (stripped.startsWith('¿')) return false;
  // Interrogative openers
  if (/^(hay|tengo|debo|cuánto|cuanto|qué|que|cómo|como|cuándo|cuando|quién|quien|puedo|tiene|están|esta|sabes|existe|funciona|cuál|cual)\b/i.test(lower)) return false;

  // Keyword scan — Array.from avoids downlevelIteration requirement on es5 target
  return Array.from(INCIDENT_KEYWORDS).some(kw => lower.includes(kw));
}

// ── System prompts ────────────────────────────────────────────────────────────

/** Used in INCIDENT mode — asks Gemini to return structured JSON */
const INCIDENT_SYSTEM_PROMPT = `Eres el asistente de FincaOS para comunidades de propietarios en España.
El usuario ha reportado un problema. Analiza el mensaje y responde EXCLUSIVAMENTE con JSON válido (sin markdown, sin texto adicional):

{
  "titulo": "Título breve del problema (máximo 60 caracteres)",
  "zona": "vivienda | jardin | zonas_comunes | parking | otro",
  "descripcion": "Descripción clara y útil del problema (máximo 200 caracteres)",
  "prioridad": "normal | alta | urgente",
  "respuesta": "Mensaje al usuario confirmando que se ha creado la incidencia (1-2 frases, español, tono cercano)"
}

Criterios de prioridad:
- urgente: gas, inundación activa, electricidad peligrosa, ascensor con personas bloqueadas, riesgo inmediato
- alta:    agua corriente cortada, daño que empeora rápido, afecta a múltiples vecinos
- normal:  todo lo demás (goteras leves, ruidos, cerraduras, grietas estéticas, etc.)

Criterios de zona:
- vivienda:      problema en el interior de un piso (cocina, baño, salón, habitación)
- jardin:        jardín, patio, terraza comunitaria
- zonas_comunes: portal, escalera, ascensor, piscina, zona comunitaria
- parking:       garaje, parking, sótano
- otro:          no encaja en ninguna anterior`;

/** Used in CHAT mode — conversational answers using Firestore context */
const CHAT_SYSTEM_PROMPT = `Eres el asistente virtual de FincaOS, una aplicación para gestión de comunidades de propietarios en España.

REGLAS ESTRICTAS:
1. Responde SOLO usando los datos del contexto proporcionado. NUNCA inventes información.
2. Si no encuentras los datos para responder, di exactamente: "No tengo datos suficientes en el sistema para responder eso."
3. Responde siempre en español, de forma clara y concisa (máximo 3-4 oraciones salvo que sea necesario más).
4. No reveles datos de otros vecinos a usuarios sin rol admin/presidente.
5. No des consejos legales ni médicos — redirige a profesionales para esos temas.
6. Si la pregunta es sobre algo externo (tiempo, noticias, etc.), indícalo amablemente.
7. Usa un tono profesional pero cercano, como un administrador de fincas experimentado.
8. FORMATO: Responde siempre en texto plano. NO uses markdown: sin asteriscos (*), sin almohadillas (#), sin guiones como viñetas (-), sin negritas (**texto**), sin cursivas. Si necesitas enumerar, usa números seguidos de punto (1. 2. 3.) o escribe los elementos separados por comas o punto y coma.`;

// ── Markdown → plain text (safety net for Gemini responses) ─────────────────
// Gemini sometimes ignores the "no markdown" instruction.  Strip common
// formatting tokens before sending the reply to the client so asterisks,
// hash signs, and bullet hyphens never reach the plain-text chat bubble.

function stripMarkdown(text: string): string {
  return text
    // Bold / italic
    .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    // Headings
    .replace(/^#{1,6}\s+/gm, '')
    // Bullets (- item  /  * item)
    .replace(/^[-*+]\s+/gm, '• ')
    // Numbered list cleanup (keep the number)
    .replace(/^(\d+)\.\s+/gm, '$1. ')
    // Inline code
    .replace(/`([^`]+)`/g, '$1')
    // Code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Excessive blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Intent detection (no AI, O(1) keyword scan) ─────────────────────────────
//
// Covers ~80% of common user queries without touching Gemini.
// Normalise: lowercase + strip Spanish diacritics before matching.

type Intent = 'cuotas' | 'votaciones' | 'anuncios' | 'incidencias' | null;

function detectIntent(msg: string): Intent {
  const m = msg
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // strip accents → "votación" → "votacion"

  if (/cuota|debo|pago pendiente|deuda|vencimiento|mora|adeudo/.test(m)) return 'cuotas';
  if (/votac|votar|referend|referendum/.test(m))                          return 'votaciones';
  if (/anuncio|comunicado|aviso|novedad|noticias|tablon/.test(m))         return 'anuncios';
  if (/incidencia|averia|reparac|reporte|averias/.test(m))                return 'incidencias';
  return null;
}

// ── Direct Firestore responders (zero Gemini calls) ───────────────────────────

async function directCuotas(comunidadId: string, uid: string): Promise<string | null> {
  const db = getAdminDb();
  const snap = await db.collection('cuotas').where('comunidad_id', '==', comunidadId).get();
  if (snap.empty) return 'No hay cuotas registradas en tu comunidad.';

  const results = await Promise.allSettled(
    snap.docs.map(async (cuotaDoc) => {
      const pagoSnap = await db
        .collection('cuotas').doc(cuotaDoc.id)
        .collection('pagos').doc(uid).get();
      const pagado = pagoSnap.exists && pagoSnap.data()?.estado === 'pagado';
      if (pagado) return null;
      const c = cuotaDoc.data();
      return {
        nombre:       (c.nombre       as string | undefined) ?? 'Cuota',
        monto:        (c.monto        as number | undefined) ?? 0,
        fecha_limite: (c.fecha_limite as string | undefined),
      };
    }),
  );

  interface CuotaItem { nombre: string; monto: number; fecha_limite?: string }
  const pendientes: CuotaItem[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value !== null) pendientes.push(r.value as CuotaItem);
  }

  if (pendientes.length === 0) {
    return '¡Estás al día con todas tus cuotas! No tienes ningún pago pendiente.';
  }

  const total = pendientes.reduce((s, c) => s + c.monto, 0);
  const proxima = pendientes
    .filter(c => c.fecha_limite)
    .sort((a, b) => (a.fecha_limite! < b.fecha_limite! ? -1 : 1))[0];

  const s = pendientes.length > 1;
  const lines: string[] = [
    `Tienes ${pendientes.length} cuota${s ? 's' : ''} pendiente${s ? 's' : ''} por un total de ${total}€:`,
    ...pendientes.slice(0, 4).map(c => {
      const fecha = c.fecha_limite
        ? new Date(c.fecha_limite).toLocaleDateString('es-ES', { day: '2-digit', month: 'long' })
        : 'sin fecha';
      return `• ${c.nombre} — ${c.monto}€ (vence el ${fecha})`;
    }),
  ];
  if (pendientes.length > 4) lines.push(`... y ${pendientes.length - 4} más.`);
  if (proxima?.fecha_limite) {
    const d = new Date(proxima.fecha_limite).toLocaleDateString('es-ES', { day: '2-digit', month: 'long' });
    lines.push(`La próxima a vencer es "${proxima.nombre}" el ${d}.`);
  }
  return lines.join('\n');
}

async function directVotaciones(comunidadId: string): Promise<string | null> {
  const db = getAdminDb();
  const snap = await db.collection('votaciones')
    .where('comunidad_id', '==', comunidadId)
    .where('activa', '==', true)
    .get();

  if (snap.empty) return 'No hay votaciones activas en este momento.';

  const s = snap.size > 1;
  const lines: string[] = [
    `Hay ${snap.size} votación${s ? 'es' : ''} activa${s ? 's' : ''} en tu comunidad:`,
    ...snap.docs.slice(0, 4).map(d => {
      const v = d.data();
      const fecha = v.fecha_fin
        ? ` — cierra el ${new Date(v.fecha_fin as string).toLocaleDateString('es-ES', { day: '2-digit', month: 'long' })}`
        : '';
      return `• "${v.titulo}"${fecha}`;
    }),
    'Puedes votar desde la sección de Votaciones.',
  ];
  return lines.join('\n');
}

async function directAnuncios(comunidadId: string): Promise<string | null> {
  const db = getAdminDb();
  const snap = await db.collection('anuncios')
    .where('comunidad_id', '==', comunidadId)
    .limit(10)
    .get();

  if (snap.empty) return 'No hay anuncios recientes en tu comunidad.';

  const recientes = snap.docs
    .map(d => d.data())
    .sort((a, b) => ((b.created_at as string) ?? '') > ((a.created_at as string) ?? '') ? 1 : -1)
    .slice(0, 3);

  const lines: string[] = ['Últimos anuncios de tu comunidad:'];
  for (const a of recientes) {
    const resumen = a.contenido ? ': ' + String(a.contenido).slice(0, 100) : '';
    lines.push(`• ${a.titulo}${resumen}`);
  }
  return lines.join('\n');
}

async function directIncidencias(comunidadId: string, uid: string, rol: string): Promise<string | null> {
  const db  = getAdminDb();
  const isAdmin = rol === 'admin' || rol === 'presidente';

  const snap = isAdmin
    ? await db.collection('incidencias')
        .where('comunidad_id', '==', comunidadId)
        .limit(30)
        .get()
    : await db.collection('incidencias')
        .where('comunidad_id', '==', comunidadId)
        .where('autor_id',     '==', uid)
        .limit(30)
        .get();

  const abiertas = snap.docs
    .map(d => d.data())
    .filter(d => !['resuelta', 'cerrada'].includes(d.estado ?? ''));

  if (abiertas.length === 0) {
    return isAdmin
      ? 'No hay incidencias abiertas en la comunidad en este momento.'
      : 'No tienes incidencias abiertas en este momento.';
  }

  const s = abiertas.length > 1;
  const prefix = isAdmin
    ? `Hay ${abiertas.length} incidencia${s ? 's' : ''} abierta${s ? 's' : ''} en la comunidad:`
    : `Tienes ${abiertas.length} incidencia${s ? 's' : ''} abierta${s ? 's' : ''}:`;

  const lines: string[] = [
    prefix,
    ...abiertas.slice(0, 4).map(inc => {
      const estado = (inc.estado as string).replace(/_/g, ' ');
      return `• "${inc.titulo}" — ${estado}`;
    }),
  ];
  if (abiertas.length > 4) lines.push(`... y ${abiertas.length - 4} más.`);
  return lines.join('\n');
}

/** Orchestrates direct Firestore responses for known intents. Returns null to fall through to Gemini. */
async function buildDirectFirestoreResponse(
  intent: NonNullable<Intent>,
  comunidadId: string,
  uid: string,
  rol: string,
): Promise<string | null> {
  switch (intent) {
    case 'cuotas':      return directCuotas(comunidadId, uid);
    case 'votaciones':  return directVotaciones(comunidadId);
    case 'anuncios':    return directAnuncios(comunidadId);
    case 'incidencias': return directIncidencias(comunidadId, uid, rol);
  }
}

// ── Firestore context builder (CHAT mode only) ───────────────────────────────

async function buildContext(comunidadId: string, uid: string, rol: string) {
  const db = getAdminDb();

  const [incSnap, cuotasSnap, votSnap, anunciosSnap, insightsSnap, perfilSnap] =
    await Promise.allSettled([
      db.collection('incidencias').where('comunidad_id', '==', comunidadId).limit(50).get(),
      db.collection('cuotas').where('comunidad_id', '==', comunidadId).get(),
      db.collection('votaciones').where('comunidad_id', '==', comunidadId).where('activa', '==', true).get(),
      db.collection('anuncios').where('comunidad_id', '==', comunidadId).limit(5).get(),
      db.collection('ai_insights').doc(comunidadId).get(),
      db.collection('perfiles').doc(uid).get(),
    ]);

  const isAdmin = rol === 'admin' || rol === 'presidente';

  const incidencias =
    incSnap.status === 'fulfilled'
      ? incSnap.value.docs
          .map(d => d.data())
          .filter(d => !['resuelta', 'cerrada'].includes(d.estado ?? ''))
          .sort((a, b) => ((b.created_at as string) ?? '') > ((a.created_at as string) ?? '') ? 1 : -1)
          .slice(0, 10)
          .map(d => ({
            titulo:    d.titulo,
            estado:    d.estado,
            prioridad: d.prioridad,
            zona:      d.zona ?? d.ubicacion ?? 'sin zona',
            fecha:     (d.created_at as string)?.slice(0, 10),
            ...(isAdmin ? { autor_id: d.autor_id } : {}),
          }))
      : [];

  const cuotasPendientes: object[] = [];
  if (cuotasSnap.status === 'fulfilled') {
    // Parallelize all pago lookups — one read per cuota instead of sequential awaits
    const cuotaResults = await Promise.allSettled(
      cuotasSnap.value.docs.map(async (cuotaDoc) => {
        const pagoSnap = await db
          .collection('cuotas').doc(cuotaDoc.id)
          .collection('pagos').doc(uid).get();
        const pagado = pagoSnap.exists && pagoSnap.data()?.estado === 'pagado';
        if (!pagado) {
          const c = cuotaDoc.data();
          return {
            nombre:       c.nombre,        // correct field name (was: c.concepto — undefined)
            monto:        c.monto,
            fecha_limite: c.fecha_limite,  // correct field name (was: c.fecha_vencimiento — undefined)
          };
        }
        return null;
      }),
    );
    for (const r of cuotaResults) {
      if (r.status === 'fulfilled' && r.value !== null) {
        cuotasPendientes.push(r.value);
      }
    }
  }

  const votaciones =
    votSnap.status === 'fulfilled'
      ? votSnap.value.docs.map(d => {
          const v = d.data();
          return {
            titulo:   v.titulo,
            opciones: (v.opciones as Array<{texto: string; votos: number}>)?.map(o => `${o.texto} (${o.votos} votos)`) ?? [],
            fecha_fin: v.fecha_fin,
          };
        })
      : [];

  const anuncios =
    anunciosSnap.status === 'fulfilled'
      ? anunciosSnap.value.docs
          .map(d => d.data())
          .sort((a, b) => ((b.created_at as string) ?? '') > ((a.created_at as string) ?? '') ? 1 : -1)
          .slice(0, 5)
          .map(d => ({ titulo: d.titulo, contenido: (d.contenido as string)?.slice(0, 200) }))
      : [];

  const insights = insightsSnap.status === 'fulfilled' && insightsSnap.value.exists
    ? {
        score_riesgo:    insightsSnap.value.data()?.score_riesgo_global ?? 0,
        zonas_calientes: insightsSnap.value.data()?.zonas_calientes ?? [],
        ultimo_analisis: (insightsSnap.value.data()?.generado_at as string)?.slice(0, 16).replace('T', ' '),
      }
    : null;

  const nombreUsuario =
    perfilSnap.status === 'fulfilled'
      ? (perfilSnap.value.data()?.nombre_completo as string) ?? 'vecino'
      : 'vecino';

  return {
    usuario:               { nombre: nombreUsuario, rol },
    resumen:               { incidencias_abiertas: incidencias.length, cuotas_pendientes: cuotasPendientes.length, votaciones_activas: votaciones.length },
    incidencias_abiertas:  incidencias,
    tus_cuotas_pendientes: cuotasPendientes,
    votaciones_activas:    votaciones,
    anuncios_recientes:    anuncios,
    ia_insights:           insights,
  };
}

// ── Incident creator ─────────────────────────────────────────────────────────

interface GeminiIncidentResult {
  titulo:          string;
  zona:            string;
  descripcion:     string;
  prioridad:       string;
  respuesta:       string;
  categoria_nombre?: string; // matched against community categories in Firestore
}

/** Tries to match a Gemini-suggested category name against the community's Firestore categories.
 *  Returns { id, nombre } if a match is found (case-insensitive, partial ok), otherwise null. */
function matchCategoria(
  sugerida:    string,
  categorias:  Array<{ id: string; nombre: string }>,
): { id: string; nombre: string } | null {
  if (!sugerida || categorias.length === 0) return null;
  const needle = sugerida.toLowerCase().trim();
  // 1. Exact match
  const exact = categorias.find(c => c.nombre.toLowerCase().trim() === needle);
  if (exact) return exact;
  // 2. Starts-with match
  const starts = categorias.find(c => c.nombre.toLowerCase().startsWith(needle) || needle.startsWith(c.nombre.toLowerCase()));
  if (starts) return starts;
  // 3. Substring match
  const sub = categorias.find(c => c.nombre.toLowerCase().includes(needle) || needle.includes(c.nombre.toLowerCase()));
  return sub ?? null;
}

async function createIncidenciaFromChat(
  uid:         string,
  comunidadId: string,
  message:     string,
  log:         ReturnType<typeof createLogger>,
): Promise<{ reply: string; incidencia_id: string }> {
  const db  = getAdminDb();
  const now = new Date().toISOString();

  // ── 0. Load community categories so Gemini can pick the right one ────────
  //
  //  Without this step, AI chat incidencias are always saved with
  //  categoria_id: null, which means they never trigger category-specific
  //  patterns in the AI pattern engine (e.g. "3+ filtraciones in same zone").
  let categorias: Array<{ id: string; nombre: string }> = [];
  try {
    const catSnap = await db.collection('categorias_incidencia').get();
    categorias = catSnap.docs
      .map(d => ({ id: d.id, nombre: String(d.data().nombre ?? '') }))
      .filter(c => c.nombre.length > 0);
  } catch {
    // Non-fatal — we'll store categoria_id: null as before
  }

  // Build a category hint for the Gemini prompt (only if categories exist)
  const catHint = categorias.length > 0
    ? `\n\nCategorías disponibles en esta comunidad: ${categorias.map(c => `"${c.nombre}"`).join(', ')}.\nElige la más apropiada en el campo "categoria_nombre". Si ninguna encaja, omite el campo.`
    : '';

  // ── 1. Ask Gemini to classify and structure the incident ─────────────────
  let parsed: GeminiIncidentResult;
  try {
    const raw     = await askGemini(
      INCIDENT_SYSTEM_PROMPT + catHint,
      `Mensaje del usuario: "${message}"`,
    );
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    parsed        = JSON.parse(cleaned);
  } catch (err) {
    log.error('ai_chat_incident_gemini_failed', err);
    // Graceful fallback — still create the incidencia with raw message
    parsed = {
      titulo:      'Incidencia reportada por asistente IA',
      zona:        'otro',
      descripcion: message.slice(0, 200),
      prioridad:   'normal',
      respuesta:   'He registrado tu reporte. El administrador lo revisará en breve.',
    };
  }

  // Ensure zona is a valid enum value using the existing normalizer
  const zona = normalizeZona(parsed.zona);

  // Clamp prioridad to valid values
  const VALID_PRIORIDAD = ['baja', 'normal', 'alta', 'urgente'];
  const prioridad = VALID_PRIORIDAD.includes(parsed.prioridad) ? parsed.prioridad : 'normal';

  // Resolve category ID from Gemini's suggestion
  const categoriaMatch  = parsed.categoria_nombre
    ? matchCategoria(parsed.categoria_nombre, categorias)
    : null;
  const categoriaId     = categoriaMatch?.id    ?? null;
  const categoriaNombre = categoriaMatch?.nombre ?? null;

  log.info('ai_chat_categoria_resolved', {
    sugerida:  parsed.categoria_nombre ?? null,
    resuelta:  categoriaNombre,
    id:        categoriaId,
  });

  // ── 2. Create incidencia ─────────────────────────────────────────────────
  let incidenciaId: string;
  try {
    const ref = await db.collection('incidencias').add({
      comunidad_id:          comunidadId,
      autor_id:              uid,
      titulo:                (parsed.titulo ?? 'Incidencia IA').slice(0, 100),
      descripcion:           parsed.descripcion ?? message.slice(0, 200),
      categoria_id:          categoriaId,   // now correctly set when Gemini matches a category
      estado:                'pendiente',
      prioridad,
      ubicacion:             zona,
      zona,
      tipo_problema:         'reportado_por_chat',
      estimacion_min:        null,
      estimacion_max:        null,
      presupuesto_proveedor: null,
      proveedor_nombre:      null,
      // ── IA metadata ──────────────────────────────────
      creado_por:            'sistema_ia',
      creado_por_avatar:     'ia',
      origen:                'chat_ia',
      mensaje_original:      message.slice(0, 300),
      // ────────────────────────────────────────────────
      created_at:            now,
      updated_at:            now,
      resuelta_at:           null,
    });
    incidenciaId = ref.id;
    log.info('ai_chat_incidencia_created', { incidencia_id: incidenciaId, zona, prioridad });
  } catch (err) {
    log.error('ai_chat_incidencia_create_failed', err);
    return {
      reply:         'Lo sentimos, no se pudo registrar la incidencia automáticamente. Por favor, créala manualmente desde el menú.',
      incidencia_id: '',
    };
  }

  // ── 3. Community notification (non-blocking) ─────────────────────────────
  db.collection('comunidades').doc(comunidadId)
    .collection('notificaciones').add({
      tipo:       'incidencia',
      titulo:     `🤖 Nueva incidencia creada por IA`,
      mensaje:    parsed.titulo ?? 'Incidencia reportada por asistente IA',
      created_at: now,
      created_by: 'sistema_ia',
      related_id: incidenciaId,
      link:       `/incidencias/${incidenciaId}`,
    })
    .catch((err: unknown) => log.error('ai_chat_notification_failed', err));

  // ── 4. Refresh pattern engine (non-blocking) ─────────────────────────────
  // Runs the pattern scan so the PatternAlertWidget updates automatically
  // after each chat incidencia is created — no need to click "Analizar ahora".
  void detectPatterns(comunidadId)
    .then(result => saveInsights(comunidadId, result))
    .catch((err: unknown) => log.error('ai_chat_pattern_refresh_failed', err));

  const respuesta = typeof parsed.respuesta === 'string' ? parsed.respuesta.trim() : '';
  return {
    reply:         stripMarkdown(respuesta) || '¡Listo! He creado una incidencia con tu reporte. El administrador será notificado.',
    incidencia_id: incidenciaId,
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const log = createLogger({ route: '/api/ai/chat', requestId });

  // ── 1. Rate limit ────────────────────────────────────────────────────────
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = await checkRateLimit(`ai-chat:${ip}`, 20, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl);

  // ── 2. Auth ──────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  let uid: string;
  try {
    const decoded = await getAuth().verifyIdToken(authHeader.slice(7));
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
  }

  // ── 3. Parse body ────────────────────────────────────────────────────────
  let message: string;
  let comunidadId: string;
  let rol: string;

  try {
    const body  = await req.json();
    message     = String(body?.message ?? '').trim().slice(0, 500);
    comunidadId = String(body?.comunidadId ?? '').trim();
    rol         = String(body?.rol ?? 'vecino');
  } catch {
    return NextResponse.json({ reply: 'No pude leer tu mensaje. Inténtalo de nuevo.' });
  }

  if (!message) {
    return NextResponse.json({ reply: 'No recibí ninguna pregunta. Escríbeme algo.' });
  }
  if (!comunidadId) {
    return NextResponse.json({ reply: 'No se pudo identificar tu comunidad. Cierra sesión y vuelve a entrar.' });
  }

  const isIncident = isIncidentMessage(message);
  console.log(`[AI] Chat mensaje recibido | tipo: ${isIncident ? 'INCIDENCIA' : 'CONSULTA'} | comunidad: ${comunidadId} | rol: ${rol}`);
  log.info('ai_chat_start', { comunidad_id: comunidadId, rol, is_incident: isIncident });

  // ── 4. INTENT ROUTING ────────────────────────────────────────────────────
  try {
    if (isIncident) {
      // ── INCIDENT MODE — create incidencia + confirm ──────────────────
      console.log('[AI] Modo INCIDENCIA activado — creando incidencia desde chat');
      log.info('ai_chat_incident_detected', { comunidad_id: comunidadId });
      const { reply, incidencia_id } = await createIncidenciaFromChat(uid, comunidadId, message, log);

      return NextResponse.json({
        reply,
        incidencia_creada: incidencia_id !== '',
        incidencia_id:     incidencia_id || undefined,
      });
    }

    // ── CHAT MODE — hybrid: Firestore first, Gemini as fallback ──────────
    console.log('[AI] Modo CONSULTA activado — respondiendo con contexto de comunidad');

    // ── Step 1: intent detection (no AI, instant) ────────────────────────
    const intent = detectIntent(message);
    console.log('[AI ROUTER] Intent:', intent ?? 'null → fallback a Gemini');

    // ── Step 2: direct Firestore response — covers ~80% of queries ───────
    if (intent) {
      try {
        const directReply = await buildDirectFirestoreResponse(intent, comunidadId, uid, rol);
        if (directReply) {
          log.info('ai_chat_direct_response', { comunidad_id: comunidadId, intent });
          console.log(`[AI ROUTER] Respondido directamente sin Gemini — intent: ${intent}`);
          return NextResponse.json({ reply: directReply });
        }
      } catch (err) {
        log.error('ai_chat_direct_response_failed', err, { intent });
        console.warn('[AI ROUTER] Direct response failed — fallback a Gemini');
        // Fall through to Gemini
      }
    }

    // ── Step 3: build Firestore context for Gemini (complex queries) ─────
    let contexto: object;
    try {
      contexto = await buildContext(comunidadId, uid, rol);
      console.log('[AI] Contexto construido — tamaño JSON:', JSON.stringify(contexto).length, 'chars');
    } catch (err) {
      log.error('ai_chat_context_failed', err, { comunidad_id: comunidadId });
      contexto = {};
    }

    // ── Step 4: call Gemini ───────────────────────────────────────────────
    let reply: string;
    try {
      const userPrompt = `CONTEXTO DE LA COMUNIDAD:\n${JSON.stringify(contexto, null, 2)}\n\nPREGUNTA DEL USUARIO:\n${message}`;
      const rawReply   = await askGemini(CHAT_SYSTEM_PROMPT, userPrompt);
      const cleaned    = typeof rawReply === 'string' ? rawReply.trim() : '';
      reply = stripMarkdown(cleaned) || 'No tengo información suficiente para responder eso.';
      console.log('[AI] Respuesta Gemini generada — longitud:', reply.length, 'chars');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const is429  = errMsg.includes('429') || errMsg.toLowerCase().includes('resource exhausted') || errMsg.toLowerCase().includes('too many requests');
      log.error('ai_chat_gemini_failed', err, { comunidad_id: comunidadId });
      console.error('[AI] Gemini falló:', errMsg);
      reply = is429
        ? 'Estoy recibiendo muchas solicitudes ahora mismo. Inténtalo en unos segundos.'
        : 'No pude procesar tu solicitud en este momento. Inténtalo de nuevo.';
    }

    // ── Step 5: never return empty ────────────────────────────────────────
    if (!reply || reply.trim() === '') {
      reply = 'No tengo información suficiente para responder eso.';
    }

    log.info('ai_chat_done', { comunidad_id: comunidadId });
    return NextResponse.json({ reply });

  } catch (err) {
    // Outer catch — should never reach here, but guarantees client always gets JSON
    log.error('ai_chat_unhandled', err);
    return NextResponse.json({
      reply: 'No pude procesar tu solicitud en este momento. Inténtalo de nuevo.',
    });
  }
}
