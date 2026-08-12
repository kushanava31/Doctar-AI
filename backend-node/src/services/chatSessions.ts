/**
 * Chat session persistence — history is only ever written/read for a
 * verified, cookie-authenticated userId (see middleware/auth.ts). Nothing
 * here accepts a client-supplied user id for anything.
 */
import mongoose from "mongoose";
import { ChatSession } from "../models/ChatSession.js";
import type { ChatResult } from "./chat.js";

const MAX_SESSIONS_LISTED = 50;
/** Word-boundary truncation so a title doesn't cut off mid-word. */
function deriveTitle(firstUserMessage: string): string {
  const trimmed = firstUserMessage.trim();
  if (trimmed.length <= 48) return trimmed;
  const cut = trimmed.slice(0, 48);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim() + "…";
}

/**
 * One shared ownership check, reused by get/rename/delete — a session
 * belonging to someone else is treated identically to a session that
 * doesn't exist (null), never distinguished, so a non-owner probing ids
 * can't tell the two apart.
 */
export async function findOwnedSession(userId: string, sessionId: string) {
  if (!mongoose.isValidObjectId(sessionId)) return null;
  return ChatSession.findOne({ _id: sessionId, userId });
}

/**
 * Persist one chat turn (user message + assistant reply). Creates a new
 * session if requestedSessionId is absent, or if it's present but doesn't
 * belong to this user (e.g. a stale id surviving an account switch) — a
 * mismatch silently starts fresh rather than erroring, since the ownership
 * check already guarantees it can never write into someone else's session
 * either way; this is a UX choice, not a security one. Returns the session
 * id actually written to.
 */
export async function persistTurn(
  userId: string,
  requestedSessionId: string | null,
  userMessage: string,
  result: ChatResult
): Promise<string> {
  let session = requestedSessionId ? await findOwnedSession(userId, requestedSessionId) : null;

  if (!session) {
    if (requestedSessionId) {
      console.warn(
        `Chat session ${requestedSessionId} not owned by user ${userId} (or missing) — starting a new session instead.`
      );
    }
    session = new ChatSession({
      userId,
      title: deriveTitle(userMessage),
      messages: [],
    });
  }

  session.messages.push({ role: "user", text: userMessage, createdAt: new Date() } as any);
  session.messages.push({
    role: "assistant",
    text: result.reply,
    doctors: result.doctors?.length ? result.doctors : undefined,
    hospitals: result.hospitals?.length ? result.hospitals : undefined,
    medicineInfo: result.medicine_info ?? undefined,
    createdAt: new Date(),
  } as any);

  await session.save();
  return String(session._id);
}

export async function listSessions(userId: string) {
  return ChatSession.find({ userId })
    .sort({ updatedAt: -1 })
    .limit(MAX_SESSIONS_LISTED)
    .select({ title: 1, updatedAt: 1 })
    .lean();
}

export async function getSession(userId: string, sessionId: string) {
  return findOwnedSession(userId, sessionId);
}

export async function renameSession(userId: string, sessionId: string, title: string) {
  const session = await findOwnedSession(userId, sessionId);
  if (!session) return null;
  session.title = title;
  await session.save();
  return session;
}

export async function deleteSession(userId: string, sessionId: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(sessionId)) return false;
  const result = await ChatSession.deleteOne({ _id: sessionId, userId });
  return result.deletedCount > 0;
}
