import dotenv from "dotenv";

dotenv.config();

function bool(v: string | undefined, fallback = false): boolean {
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

// JWT_SECRET deliberately has NO fallback default, unlike every other var
// below — a default secret would let anyone reading this source forge login
// tokens. Fail loudly at startup instead of running insecurely.
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error(
    "JWT_SECRET is required. Generate one with: openssl rand -base64 32"
  );
}

export const settings = {
  mongodbUri: process.env.MONGODB_URI || "mongodb://localhost:27017/doctar",
  port: Number(process.env.PORT || 8000),
  uploadDir: process.env.UPLOAD_DIR || "uploads",
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 10),
  // Railway (and most PaaS other than a few) does NOT set this automatically —
  // it must be set explicitly in the deployment's own env vars, not assumed.
  nodeEnv: process.env.NODE_ENV || "development",

  // CORS — list of allowed origins, or "*" for any
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  // Auth
  jwtSecret,
  // jsonwebtoken defaults to a token that NEVER expires if this isn't passed
  // explicitly — always set it.
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "14d",

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
