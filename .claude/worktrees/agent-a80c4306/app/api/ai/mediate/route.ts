import { NextRequest, NextResponse } from 'next/server';
import { askGemini } from '@/lib/gemini';

const SYSTEM_PROMPT = `Eres un mediador experto en conflictos vecinales en comunidades de propietarios en España.
Conoces a fondo la Ley de Propiedad Horizontal (LPH, Ley 49/1960), la Ley 5/2012 de mediación en asuntos civiles y mercantiles, y las ordenanzas municipales habituales.

Tu tarea es analizar un conflicto vecinal y generar una propuesta de mediación neutral y justa.

REGLAS:
- Cita artículos específicos de la LPH cuando apliquen.
- Sé neutral: no tomes partido por ningún vecino.
- Da una propuesta concreta y accionable.
- Si el conflicto es recurrente, sugiere medidas más firmes.
- Mantén un tono profesional pero accesible.
- Responde en español.
- Estructura tu respuesta con: 1) Base legal, 2) Análisis, 3) Propuesta concreta.
- Máximo 300 palabras.`;

export async function POST(req: NextRequest) {
  try {
    const { tipo, descripcion, es_recurrente } = await req.json();

    const userMessage = `Tipo de conflicto: ${tipo}
Descripción: ${descripcion}
¿Es recurrente?: ${es_recurrente ? 'Sí, ha ocurrido antes' : 'No, es la primera vez'}

Analiza este conflicto y genera una propuesta de mediación.`;

    const propuesta = await askGemini(SYSTEM_PROMPT, userMessage);

    return NextResponse.json({ propuesta });
  } catch (error: any) {
    console.error('AI mediate error:', error);
    return NextResponse.json({
      propuesta: 'Según la Ley de Propiedad Horizontal, todos los propietarios tienen el derecho a exigir el cumplimiento de las obligaciones de convivencia. Se recomienda intentar una resolución amistosa mediante comunicación formal. Si no se resuelve, contacte con su administrador para escalar el caso.',
    });
  }
}
