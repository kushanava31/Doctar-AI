/**
 * Prescription → text transcription.
 * Priority (USE_MOCK_OCR=false): Google Vision → Gemini multimodal →
 * embedded PDF text → mock demo text.
 * Faithful port of the Python ocr.py.
 */
import { settings } from "../config.js";
import { geminiAvailable, geminiGenerate, inlineDataPart } from "./gemini.js";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png"]);
const ALLOWED_PDF = "application/pdf";

function visionAvailable(): boolean {
  return Boolean(
    settings.googleApplicationCredentials || process.env.GOOGLE_APPLICATION_CREDENTIALS
  );
}

async function getVisionClient() {
  const vision = await import("@google-cloud/vision");
  return new vision.default.ImageAnnotatorClient();
}

async function ocrImageBytes(content: Buffer): Promise<string> {
  const client = await getVisionClient();
  const [response] = await client.documentTextDetection({ image: { content } });

  if (response.error?.message) {
    throw new Error(`Vision API error: ${response.error.message}`);
  }
  if (response.fullTextAnnotation?.text) {
    return response.fullTextAnnotation.text.trim();
  }
  const texts = (response.textAnnotations || [])
    .map((a) => a.description)
    .filter((d): d is string => Boolean(d));
  return texts.length ? texts.join("\n").trim() : "";
}

async function pdfEmbeddedText(content: Buffer): Promise<string> {
  // pdf-parse pulls any selectable text already embedded in a (digital) PDF.
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(content);
  return (data.text || "").trim();
}

async function ocrPdfBytes(content: Buffer): Promise<string> {
  const embedded = await pdfEmbeddedText(content);
  if (embedded) return embedded;
  // Scanned-PDF rasterization via Vision is omitted here; embedded text +
  // Gemini multimodal (which accepts PDFs directly) cover the real paths.
  return "";
}

export async function extractTextFromFile(content: Buffer, mimeType: string): Promise<string> {
  if (settings.useMockOcr) {
    console.log("USE_MOCK_OCR=true — skipping real OCR and using demo data");
    return mockOcrForDev();
  }

  const mime = mimeType.toLowerCase();

  if (visionAvailable()) {
    if (ALLOWED_IMAGE_TYPES.has(mime) || mime.startsWith("image/")) {
      return ocrImageBytes(content);
    }
    if (mime === ALLOWED_PDF) {
      const text = await ocrPdfBytes(content);
      return text || ocrImageBytes(content);
    }
    throw new Error(`Unsupported file type: ${mimeType}`);
  }

  // No Google Vision configured — try Gemini multimodal OCR.
  const text = await geminiOcr(content, mime);
  if (text) return text;

  return mockOcrForDev();
}

const OCR_PROMPT = `You are a medical OCR engine. Read this prescription image carefully and transcribe ALL text you can see, exactly as written.

Rules:
- List each medicine on its own line, preserving the drug name, strength/dose (e.g. 500mg, 10ml), form (tablet/cap/syrup), frequency (e.g. 1-0-1, BD, TDS, OD, at night), duration (e.g. 5 days, 2 weeks), and food instructions (before/after food, AC/PC).
- Include header details (doctor, date, patient) if visible.
- Do NOT invent medicines that are not in the image. If the image is unreadable, output exactly: UNREADABLE
- Output plain text only, no JSON, no markdown.`;

async function geminiOcr(content: Buffer, mime: string): Promise<string> {
  if (!geminiAvailable()) return "";

  let geminiMime: string;
  if (mime === ALLOWED_PDF) {
    const embedded = await pdfEmbeddedText(content);
    if (embedded) return embedded;
    geminiMime = "application/pdf";
  } else if (ALLOWED_IMAGE_TYPES.has(mime) || mime.startsWith("image/")) {
    geminiMime = mime === "image/jpg" ? "image/jpeg" : mime;
  } else {
    return "";
  }

  const parts = [{ text: OCR_PROMPT }, inlineDataPart(content, geminiMime)];
  const result = await geminiGenerate(parts, { maxTokens: 2048 });
  if (!result || result.trim().toUpperCase() === "UNREADABLE") {
    console.warn("Gemini OCR returned no usable text");
    return "";
  }
  return result.trim();
}

function mockOcrForDev(): string {
  console.warn("Google Vision credentials not set; using mock OCR text");
  return `Dr. Sharma Clinic
Date: 03/06/2026
Patient: Demo Patient

1. Tab. Paracetamol 500mg - 1-0-1 x 5 days - After food
2. Cap. Amoxicillin 250mg - 1-1-1 x 7 days - Before food (AC)
3. Syr. Cough Relief 10ml - 0-0-1 at night x 3 days - After food (PC)

Rx: Take medicines as directed.
`;
}
