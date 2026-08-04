/**
 * Medicine label analyzer — extracts name, composition, uses, dosage, side
 * effects, warnings, storage from a pack/strip image.
 *
 * Priority: Gemini Vision (multi-model) → Google Vision OCR → Gemini text →
 * rule-based → known-medicine offline lookup. Port of medicine_label.py.
 * (The Windows-only winocr offline path is omitted — it has no Node equivalent.)
 */
import sharp from "sharp";
import { settings } from "../config.js";
import { KNOWN_MEDICINES_LABEL, LabelInfo } from "./medicineLabelData.js";

// Flash-Lite has the most generous free tier and supports multimodal (vision)
// input — same model the rest of the app uses. The old 2.0/1.5 models returned
// 429 (tiny free quota) / 404 (retired), which surfaced as the "AI is busy" message.
const GEMINI_VISION_MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
const GEMINI_TEXT_MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
const GEMINI_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}";

const LABEL_PROMPT = `You are a pharmacist assistant. Analyze this medicine label/packaging image and extract information.

Return ONLY a valid JSON object with these exact fields:
{
  "name": "Brand name of the medicine",
  "generic_name": "Generic/chemical name or composition",
  "manufacturer": "Manufacturer name",
  "uses": ["use 1", "use 2"],
  "dosage": "How to take — dose, frequency, duration",
  "side_effects": ["side effect 1", "side effect 2"],
  "warnings": ["warning 1", "warning 2"],
  "storage": "Storage instructions",
  "expiry": "Expiry date if visible",
  "prescription_required": true or false
}

Rules:
- If a field is not visible or unclear, use null
- Keep uses and side_effects as short bullet strings (max 5 each)
- Include Hindi text if present on the label
- Return ONLY the JSON object, no markdown, no code fences, no explanation
`;

const TEXT_ANALYSIS_PROMPT = (text: string) => `You are a pharmacist assistant. Based on this medicine label text (from OCR), extract information.

Return ONLY a valid JSON object with these exact fields:
{
  "name": "Brand name of the medicine",
  "generic_name": "Generic/chemical name or composition",
  "manufacturer": "Manufacturer name",
  "uses": ["use 1", "use 2"],
  "dosage": "How to take — dose, frequency, duration",
  "side_effects": ["side effect 1", "side effect 2"],
  "warnings": ["warning 1", "warning 2"],
  "storage": "Storage instructions",
  "expiry": "Expiry date if visible",
  "prescription_required": true or false
}

Rules:
- If a field is not visible or unclear, use null
- Keep uses and side_effects as short bullet strings
- Return ONLY the JSON object, no markdown, no explanation

LABEL TEXT:
${text}
`;

// ── Regex helpers ─────────────────────────────────────────────────────────
const COMPOSITION_PAT = /(?:composition|contains?|each\s+(?:tablet|capsule|ml)\s+contains?)[:\s]+([^\n]+)/i;
const MFG_PAT = /(?:manufactured\s+by|mfg\.?\s+by|marketed\s+by)[:\s]+([^\n]+)/i;
const EXPIRY_PAT = /(?:exp(?:iry)?\.?\s*(?:date)?|use\s+before)[:\s]+([^\n]+)/i;
const STORAGE_PAT = /(?:store|storage)[:\s]+([^\n]+)/i;
const STRENGTH_PAT = /(\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g|iu)\b)/i;
const RX_PAT = /\bRx\b|\bschedule\s+[HGX]\b|\bprescription\b/i;
const BRAND_SUFFIX = /\b(tablet|cap(?:sule)?|syrup|injection|cream|gel|ointment|drops?|spray|inhaler)\b/i;

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

export interface LabelResult {
  name: string | null;
  generic_name: string | null;
  manufacturer: string | null;
  uses: string[] | null;
  dosage: string | null;
  side_effects: string[] | null;
  warnings: string[] | null;
  storage: string | null;
  expiry: string | null;
  prescription_required: boolean | null;
  source?: string;
  error?: string;
  ocr_text?: string;
}

async function resizeImage(imageBytes: Buffer, maxPx = 1024): Promise<{ data: Buffer; mime: string }> {
  try {
    const img = sharp(imageBytes);
    const meta = await img.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    let pipeline = img;
    if (Math.max(w, h) > maxPx) {
      pipeline = w >= h ? img.resize({ width: maxPx }) : img.resize({ height: maxPx });
    }
    const data = await pipeline.jpeg({ quality: 85 }).toBuffer();
    return { data, mime: "image/jpeg" };
  } catch (e) {
    console.log("Image resize skipped:", (e as Error).message);
    return { data: imageBytes, mime: "image/jpeg" };
  }
}

function parseGeminiJson(raw: string): any | null {
  raw = raw.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) raw = match[0];
  raw = raw.replace(/,\s*\}/g, "}").replace(/,\s*\]/g, "]");
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function geminiRequest(url: string, payload: string, timeoutMs = 10000): Promise<string | null> {
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
      console.warn(`Gemini HTTP ${resp.status} — falling back to offline OCR`);
      return null;
    }
    const data: any = await resp.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch (e) {
    clearTimeout(timer);
    console.warn("Gemini request failed:", (e as Error).message);
    return null;
  }
}

async function callGeminiVision(imageBytes: Buffer): Promise<any | null> {
  if (!settings.geminiApiKey) return null;
  const { data: small, mime: smallMime } = await resizeImage(imageBytes, 1024);
  const b64 = small.toString("base64");
  const payload = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: LABEL_PROMPT }, { inline_data: { mime_type: smallMime, data: b64 } }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 800 },
  });

  for (const model of GEMINI_VISION_MODELS) {
    const url = GEMINI_BASE.replace("{model}", model).replace("{key}", settings.geminiApiKey);
    console.log(`Trying Gemini Vision: ${model}`);
    const raw = await geminiRequest(url, payload, 30000);
    if (raw) {
      const result = parseGeminiJson(raw);
      if (result) {
        console.log(`Gemini Vision succeeded with ${model}`);
        return result;
      }
    }
    console.warn(`Model ${model} failed, trying next...`);
  }
  return null;
}

async function callGeminiText(ocrText: string): Promise<any | null> {
  if (!settings.geminiApiKey) return null;
  const payload = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: TEXT_ANALYSIS_PROMPT(ocrText.slice(0, 3000)) }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 600 },
  });
  for (const model of GEMINI_TEXT_MODELS) {
    const url = GEMINI_BASE.replace("{model}", model).replace("{key}", settings.geminiApiKey);
    const raw = await geminiRequest(url, payload, 20000);
    if (raw) {
      const result = parseGeminiJson(raw);
      if (result) return result;
    }
  }
  return null;
}

// ── Offline known-medicine lookup ─────────────────────────────────────────
function extractLabelFields(text: string, matchedKey: string, info: LabelInfo): LabelResult {
  const strength = STRENGTH_PAT.exec(text);
  const nameHint = info.generic_name || (strength ? `${titleCase(matchedKey)} ${strength[0]}` : titleCase(matchedKey));
  const comp = COMPOSITION_PAT.exec(text);
  const mfg = MFG_PAT.exec(text);
  const expiry = EXPIRY_PAT.exec(text);
  const storage = STORAGE_PAT.exec(text);
  return {
    name: info.generic_name || nameHint,
    generic_name: info.generic_name || (comp ? comp[1].trim() : null),
    manufacturer: info.manufacturer || (mfg ? mfg[1].trim() : null),
    uses: info.uses,
    dosage: info.dosage,
    side_effects: info.side_effects,
    warnings: info.warnings,
    storage: info.storage || (storage ? storage[1].trim() : null),
    expiry: expiry ? expiry[1].trim() : null,
    prescription_required: info.prescription_required ?? RX_PAT.test(text),
  };
}

function lookupLocalDb(nameTokens: string[]): [string, LabelInfo] | null {
  if (settings.useRealMedicineDb) return null;
  for (const token of nameTokens) {
    for (const [key, info] of Object.entries(KNOWN_MEDICINES_LABEL)) {
      if (token.includes(key) || key.includes(token)) return [key, info];
    }
  }
  return null;
}

function knownMedicineLookup(text: string): LabelResult | null {
  const lower = text.toLowerCase();
  const words = lower.match(/[a-z]{4,}/g) || [];
  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) bigrams.push(`${words[i]} ${words[i + 1]}`);
  const tokens = [...bigrams, ...words];

  const match = lookupLocalDb(tokens);
  if (!match) return null;
  const [matchedKey, info] = match;
  return extractLabelFields(text, matchedKey, info);
}

function ruleBasedLabelParse(ocrText: string): LabelResult {
  const known = knownMedicineLookup(ocrText);
  if (known) return known;

  const lines = ocrText.split("\n").map((l) => l.trim()).filter(Boolean);
  let name: string | null = null;
  for (const line of lines.slice(0, 5)) {
    if (line.length > 2 && /^[A-Z]/.test(line) && !BRAND_SUFFIX.test(line)) {
      name = line;
      break;
    }
  }
  const comp = COMPOSITION_PAT.exec(ocrText);
  const mfg = MFG_PAT.exec(ocrText);
  const expiry = EXPIRY_PAT.exec(ocrText);
  const storage = STORAGE_PAT.exec(ocrText);

  return {
    name,
    generic_name: comp ? comp[1].trim() : null,
    manufacturer: mfg ? mfg[1].trim() : null,
    uses: null,
    dosage: null,
    side_effects: null,
    warnings: null,
    storage: storage ? storage[1].trim() : null,
    expiry: expiry ? expiry[1].trim() : null,
    prescription_required: RX_PAT.test(ocrText),
    ocr_text: ocrText.slice(0, 500),
  };
}

// Google Vision OCR (reused approach from ocr.ts)
function visionAvailable(): boolean {
  return Boolean(settings.googleApplicationCredentials || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}
async function ocrImageBytes(content: Buffer): Promise<string> {
  const vision = await import("@google-cloud/vision");
  const client = new vision.default.ImageAnnotatorClient();
  const [response] = await client.documentTextDetection({ image: { content } });
  if (response.error?.message) throw new Error(`Vision API error: ${response.error.message}`);
  if (response.fullTextAnnotation?.text) return response.fullTextAnnotation.text.trim();
  const texts = (response.textAnnotations || []).map((a) => a.description).filter((d): d is string => Boolean(d));
  return texts.length ? texts.join("\n").trim() : "";
}

export async function analyzeLabel(imageBytes: Buffer, _mimeType: string): Promise<LabelResult> {
  // 1. Gemini Vision
  let result = await callGeminiVision(imageBytes);
  if (result && result.name) {
    result.source = "ai";
    return result;
  }

  // 2. Google Vision OCR → Gemini text
  let ocrText = "";
  if (visionAvailable()) {
    try {
      ocrText = await ocrImageBytes(imageBytes);
      console.log(`Google Vision OCR extracted ${ocrText.length} chars`);
    } catch (e) {
      console.warn("OCR failed:", (e as Error).message);
    }
  }

  if (ocrText) {
    result = await callGeminiText(ocrText);
    if (result && result.name) {
      result.source = "ai";
      return result;
    }
    const ruled = ruleBasedLabelParse(ocrText);
    ruled.source = "ocr";
    return ruled;
  }

  // (Windows offline OCR path from the Python version is intentionally omitted.)

  // Last resort: Gemini is probably just rate-limited — tell user to retry.
  return {
    name: null, generic_name: null, manufacturer: null, uses: null, dosage: null,
    side_effects: null, warnings: null, storage: null, expiry: null, prescription_required: null,
    source: "none",
    error: "⏳ The AI is busy right now (rate limit). Please wait a few seconds and try again — the image looks fine!",
  };
}
