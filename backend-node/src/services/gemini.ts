/**
 * Shared Gemini (Google Generative Language) client.
 *
 * Used for multimodal prescription OCR (image/PDF -> text) and for medicine
 * extraction when no OpenAI key is configured. Relies only on GEMINI_API_KEY.
 */
import { settings } from "../config.js";

// Flash-Lite supports text + image + PDF input and has the most generous free
// tier (the standard Flash free quota is small and exhausts quickly).
export const DEFAULT_MODEL = "gemini-2.5-flash-lite";

const API =
  "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}";

export interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

export function geminiAvailable(): boolean {
  return Boolean(settings.geminiApiKey);
}

/** Build an inline_data part for an image or PDF. */
export function inlineDataPart(content: Buffer, mimeType: string): GeminiPart {
  return {
    inline_data: { mime_type: mimeType, data: content.toString("base64") },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Single generateContent call. Returns the text response, or null on failure. */
export async function geminiGenerate(
  parts: GeminiPart[],
  opts: { model?: string; maxTokens?: number; temperature?: number; timeoutMs?: number } = {}
): Promise<string | null> {
  if (!settings.geminiApiKey) return null;

  const model = opts.model ?? DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? 2048;
  const temperature = opts.temperature ?? 0.1;
  const timeoutMs = opts.timeoutMs ?? 30000;

  const url = API.replace("{model}", model).replace("{key}", settings.geminiApiKey);
  const payload = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) {
        if ((resp.status === 429 || resp.status === 503) && attempt === 0) {
          console.warn(`Gemini ${resp.status}, retrying in 2s...`);
          await sleep(2000);
          continue;
        }
        const body = (await resp.text().catch(() => "")).slice(0, 300);
        console.warn(`Gemini call failed: ${resp.status} ${body}`);
        return null;
      }

      const data: any = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      return typeof text === "string" ? text.trim() : null;
    } catch (e) {
      clearTimeout(timer);
      console.warn(`Gemini call failed: ${(e as Error).message}`);
      return null;
    }
  }
  return null;
}
