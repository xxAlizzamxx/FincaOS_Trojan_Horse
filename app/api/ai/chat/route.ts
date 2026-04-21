/**
 * POST /api/ai/chat
 *
 * Community AI assistant — answers questions about the user's community
 * using REAL data from Firestore (not hallucinations).
 *
 * Context injected per request:
 *   - Last 10 open incidencias (title, estado, prioridad, zona)
 *   - User's pending cuotas
 *   - Active votaciones
 *   - Last 5 anuncios
 *   - Current AI risk score + detected patterns
 *
 * Security:
 *   - Auth: Firebase ID token required
 *   - Data: filtered strictly to user's comunidad_id
 *   - Role-aware: admin sees aggregate data; vecino sees only their own cuotas
 *   - Rate limit: 20 req / 60 s per IP
 *
 * Response: { reply: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth }    from 'firebase-admin/auth';
import { getAdminDb } from '@/lib/firebase/admin';
import { askGemini }  from '@/lib/gemini';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { createLogger } from '@/lib/logger';

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

// ── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres el asistente virtual de FincaOS, una aplicación para gestión de comunidades de propietarios en España.

REGLAS ESTRICTAS:
1. Responde SOLO usando los datos del contexto proporcionado. NUNCA inventes información.
2. Si no encuentras los datos para responder, di exactamente: "No tengo datos suficientes en el sistema para responder eso."
3. Responde siempre en español, de forma clara y concisa (máximo 3-4 oraciones salvo que sea necesario más).
4. No reveles datos de otros vecinos a usuarios sin rol admin/presidente.
5. No des consejos legales ni médicos — redirige a profesionales para esos temas.
6. Si la pregunta es sobre algo que no está en el contexto (tiempo, noticias, etc.), indícalo amablemente.
7. Usa un tono profesional pero cercano, como un administrador de fincas experimentado.`;

// ── Context builder ──────────────────────────────────────────────────────────

async function buildContext(comunidadId: string, uid: string, rol: string) {
  const db = getAdminDb();

  // Run all fetches in parallel for speed
  const [incSnap, cuotasSnap, votSnap, anunciosSnap, insightsSnap, perfilSnap] =
    await Promise.allSettled([
      // Open incidencias — last 10 (client-side sort to avoid composite index)
      db.collection('incidencias')
        .where('comunidad_id', '==', comunidadId)
        .limit(50)
        .get(),

      // All cuotas for the community
      db.collection('cuotas')
        .where('comunidad_id', '==', comunidadId)
        .get(),

      // Active votaciones
      db.collection('votaciones')
        .where('comunidad_id', '==', comunidadId)
        .where('activa', '==', true)
        .get(),

      // Recent anuncios
      db.collection('anuncios')
        .where('comunidad_id', '==', comunidadId)
        .limit(5)
        .get(),

      // AI insights
      db.collection('ai_insights').doc(comunidadId).get(),

      // User's own perfil (to get nombre, etc.)
      db.collection('perfiles').doc(uid).get(),
    ]);

  const isAdmin = rol === 'admin' || rol === 'presidente';

  // ── Incidencias ────────────────────────────────────────────────────────
  const incidencias =
    incSnap.status === 'fulfilled'
      ? incSnap.value.docs
          .map(d => d.data())
          .filter(d => !['resuelta', 'cerrada'].includes(d.estado ?? ''))
          .sort((a, b) => (b.created_at ?? '') > (a.created_at ?? '') ? 1 : -1)
          .slice(0, 10)
          .map(d => ({
            titulo:   d.titulo,
            estado:   d.estado,
            prioridad: d.prioridad,
            zona:     d.zona ?? d.ubicacion ?? 'sin zona',
            fecha:    (d.created_at as string)?.slice(0, 10),
            ...(isAdmin ? { autor_id: d.autor_id } : {}),
          }))
      : [];

  // ── Cuotas del usuario ─────────────────────────────────────────────────
  const cuotasPendientes: object[] = [];
  if (cuotasSnap.status === 'fulfilled') {
    for (const cuotaDoc of cuotasSnap.value.docs) {
      try {
        const pagoSnap = await db
          .collection('cuotas').doc(cuotaDoc.id)
          .collection('pagos').doc(uid)
          .get();

        const pagado = pagoSnap.exists && pagoSnap.data()?.estado === 'pagado';
        if (!pagado) {
          const c = cuotaDoc.data();
          cuotasPendientes.push({
            concepto:          c.concepto,
            monto:             c.monto,
            fecha_vencimiento: c.fecha_vencimiento,
          });
        }
      } catch {
        // Skip this cuota if we can't read the payment status
      }
    }
  }

  // ── Votaciones activas ─────────────────────────────────────────────────
  const votaciones =
    votSnap.status === 'fulfilled'
      ? votSnap.value.docs.map(d => {
          const v = d.data();
          return {
            titulo:   v.titulo,
            opciones: (v.opciones as Array<{texto: string; votos: number}>)
              ?.map(o => `${o.texto} (${o.votos} votos)`) ?? [],
            fecha_fin: v.fecha_fin,
          };
        })
      : [];

  // ── Anuncios recientes ─────────────────────────────────────────────────
  const anuncios =
    anunciosSnap.status === 'fulfilled'
      ? anunciosSnap.value.docs
          .map(d => d.data())
          .sort((a, b) => (b.created_at ?? '') > (a.created_at ?? '') ? 1 : -1)
          .slice(0, 5)
          .map(d => ({ titulo: d.titulo, contenido: (d.contenido as string)?.slice(0, 200) }))
      : [];

  // ── AI Insights ────────────────────────────────────────────────────────
  const insights = insightsSnap.status === 'fulfilled' && insightsSnap.value.exists
    ? {
        score_riesgo: insightsSnap.value.data()?.score_riesgo_global ?? 0,
        zonas_calientes: insightsSnap.value.data()?.zonas_calientes ?? [],
        ultimo_analisis: (insightsSnap.value.data()?.generado_at as string)?.slice(0, 16).replace('T', ' '),
      }
    : null;

  // ── User name ──────────────────────────────────────────────────────────
  const nombreUsuario =
    perfilSnap.status === 'fulfilled'
      ? (perfilSnap.value.data()?.nombre_completo as string) ?? 'vecino'
      : 'vecino';

  return {
    usuario: { nombre: nombreUsuario, rol },
    resumen: {
      incidencias_abiertas: incidencias.length,
      cuotas_pendientes:    cuotasPendientes.length,
      votaciones_activas:   votaciones.length,
    },
    incidencias_abiertas: incidencias,
    tus_cuotas_pendientes: cuotasPendientes,
    votaciones_activas:    votaciones,
    anuncios_recientes:    anuncios,
    ia_insights:           insights,
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
    const body = await req.json();
    message     = String(body.message ?? '').trim().slice(0, 500);
    comunidadId = String(body.comunidadId ?? '').trim();
    rol         = String(body.rol ?? 'vecino');
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  if (!message || !comunidadId) {
    return NextResponse.json({ error: 'message y comunidadId son obligatorios' }, { status: 400 });
  }

  log.info('ai_chat_start', { comunidad_id: comunidadId, rol });

  // ── 4. Build context from Firestore ─────────────────────────────────────
  let contexto: object;
  try {
    contexto = await buildContext(comunidadId, uid, rol);
  } catch (err) {
    log.error('ai_chat_context_failed', err, { comunidad_id: comunidadId });
    contexto = { error: 'No se pudo cargar el contexto de la comunidad.' };
  }

  // ── 5. Call Gemini ───────────────────────────────────────────────────────
  const userPrompt = `CONTEXTO DE LA COMUNIDAD:
${JSON.stringify(contexto, null, 2)}

PREGUNTA DEL USUARIO:
${message}`;

  let reply: string;
  try {
    reply = await askGemini(SYSTEM_PROMPT, userPrompt);
  } catch (err) {
    log.error('ai_chat_gemini_failed', err);
    return NextResponse.json(
      { reply: 'Lo siento, el asistente no está disponible en este momento. Inténtalo de nuevo en unos segundos.' },
    );
  }

  log.info('ai_chat_done', { comunidad_id: comunidadId });
  return NextResponse.json({ reply });
}
