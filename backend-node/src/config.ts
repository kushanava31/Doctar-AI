import dotenv from "dotenv";

dotenv.config();

function bool(v: string | undefined, fallback = false): boolean {
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export const settings = {
  mongodbUri: process.env.MONGODB_URI || "mongodb://localhost:27017/doctar",
  port: Number(process.env.PORT || 8000),
  uploadDir: process.env.UPLOAD_DIR || "uploads",
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 10),

  // CORS — list of allowed origins, or "*" for any
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  // External APIs
  googleApplicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || null,
  googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY || null,
  openaiApiKey: process.env.OPENAI_API_KEY || null,
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  geminiApiKey: process.env.GEMINI_API_KEY || null,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,

  // Feature flags
  useMockOcr: bool(process.env.USE_MOCK_OCR),
  useRealDoctorDb: bool(process.env.USE_REAL_DOCTOR_DB),
  useRealMedicineDb: bool(process.env.USE_REAL_MEDICINE_DB),
} as const;

export type Settings = typeof settings;
