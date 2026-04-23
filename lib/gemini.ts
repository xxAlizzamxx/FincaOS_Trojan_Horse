import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export const gemini = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

const RETRY_DELAYS_MS = [1_500, 4_000, 10_000]; // 1.5 s → 4 s → 10 s

/**
 * Calls Gemini with automatic retry on 429 Rate-Limit errors.
 * Free tier: 15 RPM — a short backoff is enough for transient spikes.
 */
export async function askGemini(systemPrompt: string, userMessage: string): Promise<string> {
  const prompt = `${systemPrompt}\n\n---\n\n${userMessage}`;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const result = await gemini.generateContent(prompt);
      return result.response.text();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const is429 = msg.includes('429') || msg.toLowerCase().includes('resource exhausted') || msg.toLowerCase().includes('too many requests');

      if (is429 && attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt];
        console.warn(`[AI] Gemini 429 — reintentando en ${delay / 1000}s (intento ${attempt + 1}/${RETRY_DELAYS_MS.length})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      console.error('[AI] Gemini API error:', msg);
      throw err;
    }
  }

  // TypeScript: unreachable, but satisfies return type
  throw new Error('askGemini: max retries exceeded');
}
