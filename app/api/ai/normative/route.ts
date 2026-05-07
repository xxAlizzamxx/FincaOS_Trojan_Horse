import { NextRequest, NextResponse } from 'next/server';
import { askGemini } from '@/lib/gemini';
import { checkRateLimit, rateLimitResponse } from '@/lib/rateLimit';

const SYSTEM_PROMPT = `Eres un asistente legal especializado en comunidades de propietarios en España.
Conoces a fondo:
- La Ley de Propiedad Horizontal (LPH, Ley 49/1960 y sus modificaciones)
- El Código Civil español
- La Ley 5/2012 de mediación
- Las ordenanzas municipales habituales
- La LOPD y RGPD en contexto de comunidades

Tu tarea es responder preguntas de vecinos sobre normativa de comunidades de propietarios.

REGLAS:
- Cita artículos específicos de la ley cuando los menciones (ej: "art. 7.2 LPH").
- Sé preciso pero accesible. Los vecinos no son abogados.
- Si la pregunta requiere interpretación compleja o depende del caso concreto, recomienda consultar con el administrador o un abogado.
- Responde en español.
- Máximo 250 palabras.
- Si no estás seguro de algo, dilo claramente.`;

export async function POST(req: NextRequest) {
  // Rate limit: 10 requests / 60 s per IP
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = await checkRateLimit(`ai-normative:${ip}`, 10, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl);

  try {
    const { pregunta } = await req.json();

    const respuesta = await askGemini(SYSTEM_PROMPT, `Pregunta del vecino: ${pregunta}`);

    return NextResponse.json({ respuesta });
  } catch (error: any) {
    console.error('AI normative error:', error);
    return NextResponse.json({
      respuesta: 'Lo siento, no he podido procesar tu consulta en este momento. Te recomiendo consultar directamente con tu administrador de fincas para obtener orientación sobre este tema.',
    });
  }
}
