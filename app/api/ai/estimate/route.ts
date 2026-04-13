import { NextRequest, NextResponse } from 'next/server';
import { askGemini } from '@/lib/gemini';

const SYSTEM_PROMPT = `Eres un experto en reparaciones y mantenimiento de comunidades de propietarios en España.
Tu tarea es estimar el rango de coste de una reparación y clasificar su urgencia basándote en la categoría, descripción y ubicación.

REGLAS:
- Responde SOLO con un JSON válido, sin markdown ni texto adicional.
- Formato: {"min": number, "max": number, "prioridad": "baja"|"normal"|"alta"|"urgente", "explicacion": "breve explicación en español"}
- Los precios deben ser realistas para el mercado español actual (2024-2026).
- El rango min-max debe ser razonable (max no más de 3x min generalmente).
- Si la descripción es vaga, da un rango más amplio.
- Incluye IVA en la estimación.
- Criterios de urgencia:
  - "urgente": riesgo para personas, inundaciones activas, fallo eléctrico peligroso, ascensor atrapado
  - "alta": afecta a múltiples vecinos, servicios esenciales (agua, luz, gas), daño que empeora rápido
  - "normal": problemas comunes sin riesgo inmediato (goteras leves, pintura, cerraduras)
  - "baja": mejoras estéticas, mantenimiento preventivo, peticiones no urgentes`;

export async function POST(req: NextRequest) {
  try {
    const { categoria, descripcion, ubicacion } = await req.json();

    const userMessage = `Categoría: ${categoria || 'General'}
Descripción: ${descripcion || 'Sin descripción'}
Ubicación: ${ubicacion || 'Zona común'}

Estima el rango de coste de esta reparación en euros.`;

    const response = await askGemini(SYSTEM_PROMPT, userMessage);

    // Parse JSON from response (handle potential markdown wrapping)
    const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const data = JSON.parse(cleaned);

    const validPrioridades = ['baja', 'normal', 'alta', 'urgente'];
    const prioridad = validPrioridades.includes(data.prioridad) ? data.prioridad : 'normal';

    return NextResponse.json({
      min: Math.round(data.min),
      max: Math.round(data.max),
      prioridad,
      explicacion: data.explicacion || '',
    });
  } catch (error: any) {
    console.error('AI estimate error:', error);
    return NextResponse.json({ min: 100, max: 600, prioridad: 'normal', explicacion: 'Estimación aproximada basada en datos generales.' });
  }
}
