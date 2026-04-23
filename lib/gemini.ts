import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export const gemini = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

export async function askGemini(systemPrompt: string, userMessage: string): Promise<string> {
  try {
    const result = await gemini.generateContent(`${systemPrompt}\n\n---\n\n${userMessage}`);
    return result.response.text();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[AI] Gemini API error:', msg);
    throw err;
  }
}
