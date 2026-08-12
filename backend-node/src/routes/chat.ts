import { Router, Request, Response } from "express";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { optionalAuth } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { handleMessage, HistoryMessage } from "../services/chat.js";
import { analyzeLabel } from "../services/medicineLabel.js";
import { persistTurn } from "../services/chatSessions.js";

const router = Router();

// POST /api/chat
// optionalAuth (not requireAuth): anonymous chat must keep working exactly
// as before — login only unlocks persistence, it's never required to chat.
router.post(
  "/",
  optionalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const message = String(req.body?.message ?? "").trim();
    const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
    const history: HistoryMessage[] = rawHistory.map((m: any) => ({
      role: String(m?.role ?? ""),
      text: String(m?.text ?? ""),
    }));
    const userCity = req.body?.user_city ?? null;

    const result = await handleMessage(message, history, userCity);

    // handleMessage() above is completely unmodified by any of this — only
    // persisted afterward, and only when a real session cookie is present.
    let sessionId: string | null = null;
    if (req.userId) {
      const requestedSessionId = req.body?.session_id ? String(req.body.session_id) : null;
      sessionId = await persistTurn(req.userId, requestedSessionId, message, result);
    }

    res.json({
      reply: result.reply,
      intent: result.intent,
      doctors: result.doctors,
      hospitals: result.hospitals,
      medicine_info: result.medicine_info ?? null,
      session_id: sessionId,
    });
  })
);

// POST /api/chat/analyze-medicine-label
router.post(
  "/analyze-medicine-label",
  upload.single("file"),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw new HttpError(400, "No file uploaded");
    if (!req.file.mimetype || !req.file.mimetype.startsWith("image/")) {
      throw new HttpError(400, "Only image files are supported");
    }
    if (req.file.buffer.length > 10 * 1024 * 1024) {
      throw new HttpError(400, "Image too large (max 10MB)");
    }
    const result = await analyzeLabel(req.file.buffer, req.file.mimetype);
    res.json(result);
  })
);

export default router;
