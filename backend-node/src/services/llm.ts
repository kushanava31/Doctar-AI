/**
 * Medicine extraction: OpenAI → Gemini → rule-based parser (no key needed).
 * Faithful port of the Python llm.py.
 */
import OpenAI from "openai";
import { settings } from "../config.js";
import type { MedicineItem } from "../models/Prescription.js";
import { geminiGenerate } from "./gemini.js";

function mkMedicine(p: Partial<MedicineItem>): MedicineItem {
  return {
    name: p.name ?? "",
    dosage: p.dosage ?? "",
    timing: p.timing ?? "",
    duration: p.duration ?? "",
    food_instructions: p.food_instructions ?? "",
    purpose: p.purpose ?? "",
  };
}

// ---------------------------------------------------------------------------
// Known medicine → purpose lookup (English / Hindi)
// ---------------------------------------------------------------------------
const MEDICINE_PURPOSE: Record<string, string> = {
  paracetamol: "For fever and pain / बुखार और दर्द के लिए",
  crocin: "For fever and pain / बुखार और दर्द के लिए",
  dolo: "For fever and pain / बुखार और दर्द के लिए",
  ibuprofen: "For pain and inflammation / दर्द और सूजन के लिए",
  combiflam: "For pain and fever / दर्द और बुखार के लिए",
  amoxicillin: "For bacterial infection / बैक्टीरियल संक्रमण के लिए",
  amoxyclav: "For bacterial infection / बैक्टीरियल संक्रमण के लिए",
  azithromycin: "For bacterial infection / बैक्टीरियल संक्रमण के लिए",
  azee: "For bacterial infection / बैक्टीरियल संक्रमण के लिए",
  ciprofloxacin: "For bacterial infection / बैक्टीरियल संक्रमण के लिए",
  metronidazole: "For infection / संक्रमण के लिए",
  omeprazole: "For acidity and stomach / एसिडिटी के लिए",
  pantoprazole: "For acidity and stomach / एसिडिटी के लिए",
  pan: "For acidity and stomach / एसिडिटी के लिए",
  ranitidine: "For acidity / एसिडिटी के लिए",
  metformin: "For diabetes / मधुमेह के लिए",
  glucophage: "For diabetes / मधुमेह के लिए",
  glimepiride: "For diabetes / मधुमेह के लिए",
  amlodipine: "For blood pressure / रक्तचाप के लिए",
  telmisartan: "For blood pressure / रक्तचाप के लिए",
  losartan: "For blood pressure / रक्तचाप के लिए",
  atorvastatin: "For cholesterol / कोलेस्ट्रॉल के लिए",
  rosuvastatin: "For cholesterol / कोलेस्ट्रॉल के लिए",
  ecosprin: "Blood thinner / रक्त पतला करने के लिए",
  aspirin: "Blood thinner / रक्त पतला करने के लिए",
  cetirizine: "For allergy / एलर्जी के लिए",
  levocetrizine: "For allergy / एलर्जी के लिए",
  montelukast: "For allergy and asthma / एलर्जी और अस्थमा के लिए",
  salbutamol: "For breathing / सांस के लिए",
  dextromethorphan: "For cough / खांसी के लिए",
  cough: "For cough relief / खांसी से राहत के लिए",
  benadryl: "For cough and cold / खांसी और सर्दी के लिए",
  alex: "For cough and cold / खांसी और सर्दी के लिए",
  sinarest: "For cold and congestion / सर्दी और जुकाम के लिए",
  vitamin: "Vitamin supplement / विटामिन सप्लीमेंट",
  calcium: "Calcium supplement / कैल्शियम सप्लीमेंट",
  iron: "Iron supplement / आयरन सप्लीमेंट",
  zinc: "Zinc supplement / जिंक सप्लीमेंट",
  prednisolone: "For inflammation / सूजन के लिए",
  deflazacort: "For inflammation / सूजन के लिए",
  diclofenac: "For pain and inflammation / दर्द और सूजन के लिए",
  aceclofenac: "For pain and inflammation / दर्द और सूजन के लिए",
  rabeprazole: "For acidity / एसिडिटी के लिए",
  domperidone: "For nausea and vomiting / मतली और उल्टी के लिए",
  ondansetron: "For nausea and vomiting / मतली और उल्टी के लिए",
  metoclopramide: "For nausea / मतली के लिए",
  fluconazole: "For fungal infection / फंगल संक्रमण के लिए",
  clotrimazole: "For fungal infection / फंगल संक्रमण के लिए",
};

export function lookupPurpose(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, purpose] of Object.entries(MEDICINE_PURPOSE)) {
    if (lower.includes(key)) return purpose;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Rule-based prescription parser (no API key needed)
// ---------------------------------------------------------------------------
const TIMING_EXPLICIT = /\b([01]-[01]-[01])\b/;
const TIMING_WORDS: Array<[RegExp, string]> = [
  [/\bonce\s+daily\b|\bod\b/i, "1-0-0"],
  [/\btwice\s+daily\b|\bbd\b|\bbid\b/i, "1-0-1"],
  [/\bthrice\s+daily\b|\btds\b|\btid\b|\bthree\s+times\b/i, "1-1-1"],
  [/\bmorning\s+and\s+night\b|\bmorning\s*&\s*night\b/i, "1-0-1"],
  [/\bmorning\s+only\b|\bevery\s+morning\b/i, "1-0-0"],
  [/\bat\s+night\b|\bbedtime\b|\bnight\s+only\b|\bhs\b/i, "0-0-1"],
  [/\bmorning\s+afternoon\s+night\b/i, "1-1-1"],
];

const DURATION_PAT = /\b(\d+)\s*(days?|weeks?|months?)\b/i;
const FOOD_BEFORE = /\bac\b|\bbefore\s+food\b|\bbefore\s+meal\b|\bempty\s+stomach\b/i;
const FOOD_AFTER = /\bpc\b|\bafter\s+food\b|\bafter\s+meal\b|\bwith\s+food\b/i;
const DOSAGE_PAT =
  /(\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g|iu|units?)(?:\/\d+\s*(?:mg|ml))?)|\b(\d+\s*(?:ml|drops?|puffs?))\b|\b(tablet|cap(?:sule)?|syrup|drops?|injection|cream|gel|ointment|inhaler|spray)/gi;
const MED_PREFIX = /^(?:tab\.?|cap\.?|syr\.?|inj\.?|oint\.?|gel\.?|drops?\.?|susp\.?|soln?\.?)\s+/i;
const SKIP_LINE =
  /^\s*(?:dr\.?|doctor|clinic|hospital|date|patient|name|age|rx|ref|address|phone|tel|diagnosis|advice|follow|sign|stamp|next\s+visit)/i;

function parseTiming(line: string): string {
  const m = TIMING_EXPLICIT.exec(line);
  if (m) return m[1];
  for (const [pattern, value] of TIMING_WORDS) {
    if (pattern.test(line)) return value;
  }
  return "";
}

function parseDuration(line: string): string {
  const m = DURATION_PAT.exec(line);
  return m ? `${m[1]} ${m[2].toLowerCase()}` : "";
}

function parseFood(line: string): string {
  if (FOOD_BEFORE.test(line)) return "AC";
  if (FOOD_AFTER.test(line)) return "PC";
  return "";
}

function parseDosage(line: string): string {
  const parts: string[] = [];
  for (const m of line.matchAll(DOSAGE_PAT)) {
    const val = [m[1], m[2], m[3]].find((g) => g) ?? "";
    if (val) parts.push(val.trim());
  }
  return parts.length ? parts.slice(0, 2).join(" ") : "";
}

function cleanMedicineName(raw: string): string {
  let name = raw.replace(MED_PREFIX, "").trim();
  name = name.replace(/\s+\d[\d\-\s]*$/, "");
  name = name.replace(/\s+\d+(?:mg|ml|mcg|g)\b.*/i, "");
  name = name.replace(/\s+-\s+.*/, "");
  name = name.replace(/^[\s.,:/-]+|[\s.,:/-]+$/g, "");
  return name;
}

function isMedicineLine(line: string): boolean {
  if (SKIP_LINE.test(line)) return false;
  if (line.trim().length < 3) return false;
  const hasTiming = TIMING_EXPLICIT.test(line) || TIMING_WORDS.some(([p]) => p.test(line));
  const hasDosage = new RegExp(DOSAGE_PAT.source, "i").test(line);
  const hasDuration = DURATION_PAT.test(line);
  const hasNumberPrefix = /^\s*\d+[.)]\s+/.test(line);
  return hasTiming || hasDosage || hasDuration || hasNumberPrefix;
}

function extractMedicineNameFromLine(line: string): string {
  let cleaned = line.replace(/^\s*[\d.)•\-]+\s*/, "").trim();
  cleaned = cleaned.replace(MED_PREFIX, "").trim();
  const stop = /\s+(?:\d+(?:mg|ml|mcg|g|iu)\b|\d-\d-\d|\bac\b|\bpc\b|\bbd\b|\btds\b|\bod\b|\bfor\b|\bx\b)/i.exec(
    cleaned
  );
  if (stop) cleaned = cleaned.slice(0, stop.index).trim();
  return cleanMedicineName(cleaned);
}

function ruleBasedParse(ocrText: string): MedicineItem[] {
  const medicines: MedicineItem[] = [];
  for (let line of ocrText.split("\n")) {
    line = line.trim();
    if (!line || !isMedicineLine(line)) continue;

    const name = extractMedicineNameFromLine(line);
    if (!name || name.length < 2) continue;
    if (medicines.some((m) => m.name.toLowerCase() === name.toLowerCase())) continue;

    medicines.push(
      mkMedicine({
        name,
        dosage: parseDosage(line),
        timing: parseTiming(line),
        duration: parseDuration(line),
        food_instructions: parseFood(line),
        purpose: lookupPurpose(name),
      })
    );
  }
  return medicines;
}

// ---------------------------------------------------------------------------
// LLM extraction
// ---------------------------------------------------------------------------
const EXTRACTION_PROMPT = `You are a medical prescription parser for Indian prescriptions.

Extract ALL medicines from the OCR text below. For each medicine return:
- name: medicine name (brand or generic)
- dosage: strength and form (e.g. "500mg tablet", "10ml syrup")
- timing: dose pattern like 1-0-1, 1-0-0, 1-1-1, 0-0-1 (morning-noon-night)
- duration: how long to take (e.g. "5 days", "2 weeks")
- food_instructions: AC (before food), PC (after food), or empty if not specified
- purpose: brief description in format "English / Hindi" e.g. "For fever and pain / बुखार और दर्द के लिए"

Return ONLY valid JSON array, no markdown:
[{"name":"...","dosage":"...","timing":"...","duration":"...","food_instructions":"...","purpose":"..."}]

If no medicines found, return [].
OCR TEXT:
`;

function parseMedicineJson(raw: string): MedicineItem[] {
  raw = raw.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  const match = raw.match(/\[[\s\S]*\]/);
  if (match) raw = match[0];

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error("Failed to parse LLM JSON:", raw.slice(0, 500));
    throw new Error(`LLM returned invalid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(data)) throw new Error("LLM response must be a JSON array");

  return data
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item) => {
      const name = String(item.name ?? "");
      const purpose = String(item.purpose ?? "") || lookupPurpose(name);
      return mkMedicine({
        name,
        dosage: String(item.dosage ?? ""),
        timing: String(item.timing ?? ""),
        duration: String(item.duration ?? ""),
        food_instructions: String(item.food_instructions ?? ""),
        purpose,
      });
    });
}

async function llmExtract(ocrText: string): Promise<MedicineItem[]> {
  const client = new OpenAI({ apiKey: settings.openaiApiKey! });
  const response = await client.chat.completions.create({
    model: settings.openaiModel,
    messages: [
      { role: "system", content: "Extract medicine data from prescriptions. Respond with JSON only." },
      { role: "user", content: EXTRACTION_PROMPT + ocrText },
    ],
    temperature: 0.1,
  });
  const raw = (response.choices[0]?.message?.content || "[]").trim();
  return parseMedicineJson(raw);
}

async function geminiExtract(ocrText: string): Promise<MedicineItem[]> {
  const raw = await geminiGenerate([{ text: EXTRACTION_PROMPT + ocrText }], {
    maxTokens: 1500,
    temperature: 0.1,
  });
  if (!raw) return [];
  try {
    return parseMedicineJson(raw);
  } catch {
    console.warn("Gemini extraction returned unparseable JSON; falling back to rules");
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
export async function extractMedicines(ocrText: string): Promise<MedicineItem[]> {
  if (settings.openaiApiKey) {
    console.log("Using OpenAI for medicine extraction");
    return llmExtract(ocrText);
  }

  if (settings.geminiApiKey) {
    console.log("Using Gemini for medicine extraction");
    const medicines = await geminiExtract(ocrText);
    if (medicines.length) return medicines;
    console.log("Gemini extraction empty — falling back to rule-based parser");
  }

  console.log("Using rule-based parser on OCR text");
  const medicines = ruleBasedParse(ocrText);
  if (!medicines.length) {
    console.warn("Rule-based parser found nothing; OCR text may be too noisy or image unreadable");
  }
  return medicines;
}
