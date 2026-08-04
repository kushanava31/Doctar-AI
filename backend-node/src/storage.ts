import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { settings } from "./config.js";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "application/pdf",
]);

const EXT_MAP: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "application/pdf": ".pdf",
};

export async function ensureUploadDir(): Promise<string> {
  await fs.mkdir(settings.uploadDir, { recursive: true });
  return settings.uploadDir;
}

export interface SavedUpload {
  imagePath: string;
  originalFilename: string;
  mimeType: string;
}

/** Persist an uploaded file buffer; mirrors Python's save_upload(). */
export async function saveUpload(file: Express.Multer.File): Promise<SavedUpload> {
  const mime = file.mimetype || "application/octet-stream";
  if (!ALLOWED_TYPES.has(mime)) {
    throw new Error("Unsupported file type. Allowed: JPG, PNG, PDF");
  }

  const maxBytes = settings.maxUploadMb * 1024 * 1024;
  if (file.buffer.length > maxBytes) {
    throw new Error(`File too large. Max ${settings.maxUploadMb}MB`);
  }

  let ext = path.extname(file.originalname || "upload").toLowerCase();
  if (!ext) ext = EXT_MAP[mime] || ".bin";

  const dir = await ensureUploadDir();
  const filename = `${randomUUID()}${ext}`;
  const filepath = path.join(dir, filename);
  await fs.writeFile(filepath, file.buffer);

  return {
    imagePath: filepath,
    originalFilename: file.originalname || filename,
    mimeType: mime,
  };
}

export async function readFileBytes(p: string): Promise<Buffer> {
  return fs.readFile(p);
}
