import { Request, Response, NextFunction } from "express";
import { HttpError } from "./errorHandler.js";
import { AUTH_COOKIE_NAME, verifyToken } from "../services/auth.js";

function getUserIdFromRequest(req: Request): string | null {
  const token = req.cookies?.[AUTH_COOKIE_NAME];
  if (!token || typeof token !== "string") return null;
  return verifyToken(token);
}

/** Blocks with 401 if there's no valid session. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    next(new HttpError(401, "Not authenticated"));
    return;
  }
  req.userId = userId;
  next();
}

/** Never blocks — sets req.userId if a valid session is present, else leaves it null.
 * Used by POST /api/chat so anonymous use keeps working exactly as before. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  req.userId = getUserIdFromRequest(req);
  next();
}
