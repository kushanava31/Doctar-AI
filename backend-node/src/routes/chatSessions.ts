import { Router, Request, Response } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { chatSessionToDetail, chatSessionToSummary } from "../models/ChatSession.js";
import { deleteSession, findOwnedSession, listSessions, renameSession } from "../services/chatSessions.js";

const router = Router();

router.use(requireAuth);

// GET /api/chat/sessions
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const sessions = await listSessions(req.userId!);
    res.json(sessions.map(chatSessionToSummary));
  })
);

// GET /api/chat/sessions/:sessionId
router.get(
  "/:sessionId",
  asyncHandler(async (req: Request, res: Response) => {
    const session = await findOwnedSession(req.userId!, req.params.sessionId);
    if (!session) throw new HttpError(404, "Session not found");
    res.json(chatSessionToDetail(session));
  })
);

const renameSchema = z.object({
  title: z.string().trim().min(1, "Title cannot be empty").max(200),
});

// PATCH /api/chat/sessions/:sessionId
router.patch(
  "/:sessionId",
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = renameSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || "Invalid request");

    const session = await renameSession(req.userId!, req.params.sessionId, parsed.data.title);
    if (!session) throw new HttpError(404, "Session not found");
    res.json(chatSessionToSummary(session));
  })
);

// DELETE /api/chat/sessions/:sessionId
router.delete(
  "/:sessionId",
  asyncHandler(async (req: Request, res: Response) => {
    const deleted = await deleteSession(req.userId!, req.params.sessionId);
    if (!deleted) throw new HttpError(404, "Session not found");
    res.status(204).end();
  })
);

export default router;
