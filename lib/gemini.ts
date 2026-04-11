import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export const gemini = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

export async function askGemini(systemPrompt: string, userMessage: string): Promise<string> {
  const result = await gemini.generateContent(`${systemPrompt}\n\n---\n\n${userMessage}`);
  return result.response.text();
}
