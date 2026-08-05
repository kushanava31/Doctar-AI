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

// ── Shared quota cool-down ────────────────────────────────────────────────
// The free tier is metered per project *per model*, and a 429 means every
// other Gemini caller in this process is about to get 429 too. Without this,
// a quota-exhausted key costs each request the full retry budget (two calls
// plus a backoff sleep) before falling through to the local fallbacks — so
// the app gets slower precisely when Gemini can't help it. Google returns a
// RetryInfo hint in the error body; honour it, with a floor so we don't hot-
// loop on a hint of "0s".
let quotaBlockedUntil = 0;

export function geminiQuotaBlocked(): boolean {
  return Date.now() < quotaBlockedUntil;
}

/** Parse Google's `"Please retry in 8.29s"` / RetryInfo hint out of an error body. */
export function noteGeminiQuotaError(body: string): void {
  const hint = body.match(/retry(?:Delay"?\s*:\s*"?| in )(\d+(?:\.\d+)?)s/i);
  const seconds = hint ? Math.min(parseFloat(hint[1]), 300) : 60;
  quotaBlockedUntil = Date.now() + Math.max(seconds, 15) * 1000;
}

/** Test seam — clears the cool-down so a fresh run isn't affected by an old 429. */
export function resetGeminiQuotaBlock(): void {
  quotaBlockedUntil = 0;
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
  if (geminiQuotaBlocked()) {
    console.warn("Gemini skipped — quota cool-down active");
    return null;
  }

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
        const body = (await resp.text().catch(() => "")).slice(0, 500);
        if (resp.status === 429) {
          noteGeminiQuotaError(body);
          console.warn(`Gemini 429 (quota) on ${model}: ${body}`);
          return null;
        }
        if (resp.status === 503 && attempt === 0) {
          console.warn(`Gemini 503 (overloaded), retrying in 2s: ${body}`);
          await sleep(2000);
          continue;
        }
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
