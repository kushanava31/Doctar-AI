/**
 * Combined prescription analysis via a single Gemini multimodal call.
 * Reads the image/PDF and returns BOTH a transcription and structured medicines
 * in one request. Faithful port of the Python prescription_ai.py.
 */
import { settings } from "../config.js";
import type { MedicineItem } from "../models/Prescription.js";
import { geminiAvailable, geminiGenerate, inlineDataPart } from "./gemini.js";
import { lookupPurpose } from "./llm.js";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png"]);
const ALLOWED_PDF = "application/pdf";

const PROMPT = `You are a medical prescription parser for Indian prescriptions (printed labels or handwritten Rx).

Read the attached image/PDF and return ONE JSON object (no markdown, no code fences):
{
  "transcription": "all text you can read, verbatim",
  "medicines": [
    {
      "name": "medicine name (brand or generic)",
      "dosage": "strength and form e.g. '500mg tablet', '10ml syrup'",
      "timing": "dose pattern 1-0-1 / 1-0-0 / 1-1-1 / 0-0-1 (morning-noon-night), or '' if unclear",
      "duration": "e.g. '5 days', '2 weeks', or '' if not stated",
      "food_instructions": "AC (before food), PC (after food), or '' ",
      "purpose": "short 'English / Hindi' e.g. 'For fever and pain / बुखार और दर्द के लिए'"
    }
  ]
}

Rules:
- Extract EVERY medicine you can identify. Use the clean drug name only (e.g. 'Paracetamol', not 'CALPOL 650 TABLETS IP 15 Tablets').
- Do NOT invent medicines that are not visible.
- If the image is unreadable or contains no medicine, return {"transcription":"","medicines":[]}.
- Respond with valid JSON only.`;

function geminiMime(mime: string): string | null {
  mime = mime.toLowerCase();
  if (mime === ALLOWED_PDF) return ALLOWED_PDF;
  if (ALLOWED_IMAGE_TYPES.has(mime) || mime.startsWith("image/")) {
    return mime === "image/jpg" ? "image/jpeg" : mime;
  }
  return null;
}

function jsonToMedicines(items: unknown): MedicineItem[] {
  if (!Array.isArray(items)) return [];
  const out: MedicineItem[] = [];
  for (const item of items) {
    if (item === null || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const name = String(obj.name ?? "").trim();
    if (!name) continue;
    const purpose = String(obj.purpose ?? "") || lookupPurpose(name);
    out.push({
      name,
      dosage: String(obj.dosage ?? ""),
      timing: String(obj.timing ?? ""),
      duration: String(obj.duration ?? ""),
      food_instructions: String(obj.food_instructions ?? ""),
      purpose,
    });
  }
  return out;
}

/**
 * One Gemini call: returns [ocrText, medicines], or null if Gemini can't be used
 * (also null when USE_MOCK_OCR=true, so the caller falls through to the mock path).
 */
export async function analyzePrescriptionImage(
  content: Buffer,
  mimeType: string
): Promise<[string, MedicineItem[]] | null> {
  if (settings.useMockOcr) return null;
  if (!geminiAvailable()) return null;

  const gmime = geminiMime(mimeType);
  if (gmime === null) return null;

  const parts = [{ text: PROMPT }, inlineDataPart(content, gmime)];
  let raw = await geminiGenerate(parts, { maxTokens: 2048, temperature: 0.1 });
  if (!raw) return null;

  raw = raw.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) raw = match[0];

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    console.warn("Gemini prescription JSON unparseable:", raw.slice(0, 300));
    return null;
  }

  const transcription = String(data.transcription ?? "").trim();
  const medicines = jsonToMedicines(data.medicines ?? []);
  return [transcription, medicines];
}
