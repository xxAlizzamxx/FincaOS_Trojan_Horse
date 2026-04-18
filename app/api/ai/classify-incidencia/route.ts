/**
 * POST /api/ai/classify-incidencia
 * Usa Gemini 1.5 Flash para analizar texto libre y extraer
 * datos estructurados de una posible incidencia.
 */
import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getAdminDb } from '@/lib/firebase/admin';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
  // Rate limit: 15 requests / 60 s per IP
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = await checkRateLimit(`ai-classify:${ip}`, 15, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl);

  // Auth
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  try {
    await getAuth().verifyIdToken(authHeader.slice(7));
  } catch {
    return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
  }

  const { mensaje, comunidadId } = await req.json() as {
    mensaje: string;
    comunidadId: string;
  };

  if (!mensaje?.trim()) {
    return NextResponse.json({ error: 'Mensaje vacío' }, { status: 400 });
  }

  // Cargar incidencias activas para detectar duplicados
  const db = getAdminDb();
  let titulosRecientes: { id: string; titulo: string }[] = [];
  try {
    const snap = await db.collection('incidencias')
      .where('comunidad_id', '==', comunidadId)
      .where('estado', 'in', ['pendiente', 'en_revision', 'presupuestada', 'en_ejecucion'])
      .limit(20).get();
    titulosRecientes = snap.docs.map(d => ({ id: d.id, titulo: d.data().titulo as string }));
  } catch {
    // Si falla, continuar sin duplicados
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const prompt = `Eres el asistente de FincaOS, app de gestión de comunidades de propietarios en España.
Analiza el mensaje del vecino y extrae información estructurada. RESPONDE SOLO JSON VÁLIDO sin texto adicional ni markdown.

Incidencias activas en la comunidad (para detectar duplicados):
${JSON.stringify(titulosRecientes)}

Mensaje del vecino: "${mensaje}"

Responde con exactamente este JSON:
{
  "titulo": "string máx 60 chars, descriptivo y concreto",
  "descripcion": "string ampliado con detalles relevantes",
  "categoria": "Ascensor | Fontanería | Electricidad | Limpieza | Seguridad | Obras | Jardines | Parking | Fachada | Otro",
  "prioridad": "baja | normal | alta | urgente",
  "ubicacion": "zona del edificio si se menciona, sino null",
  "afectados_estimados": 1,
  "accion_sugerida": "siguiente paso recomendado en máx 80 chars",
  "posible_duplicado_id": "id de incidencia existente similar o null",
  "posible_duplicado_titulo": "título de la incidencia similar o null",
  "confianza": 0.9
}`;

  try {
    const result = await model.generateContent(prompt);
    let text = result.response.text().trim();
    // Limpiar markdown si el modelo lo envuelve
    text = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    const data = JSON.parse(text);
    return NextResponse.json(data);
  } catch (err) {
    console.error('[AI classify]', err);
    return NextResponse.json({ error: 'No se pudo procesar el mensaje' }, { status: 422 });
  }
}
