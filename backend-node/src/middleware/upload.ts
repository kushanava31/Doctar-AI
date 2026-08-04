import multer from "multer";
import { settings } from "../config.js";

/** In-memory upload; we persist to disk ourselves in the storage service. */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: settings.maxUploadMb * 1024 * 1024 },
});
