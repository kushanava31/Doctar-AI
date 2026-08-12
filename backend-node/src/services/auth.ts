/**
 * Password hashing, JWT signing/verification, and the shared cookie options
 * used by both the login (set) and logout (clear) code paths.
 *
 * KNOWN LIMITATION: logout only clears the client-side cookie. The JWT
 * itself is not invalidated server-side — a copy of the token (a log line,
 * a captured request) stays valid until it expires and can be replayed
 * directly with a manually-set Cookie header, bypassing httpOnly entirely.
 * A `tokenVersion` field on User, embedded in the token and bumped on
 * logout, is the standard cheap fix for real revocation — not built here.
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { CookieOptions } from "express";
import { settings } from "../config.js";

const BCRYPT_COST = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface TokenPayload {
  sub: string;
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId } satisfies TokenPayload, settings.jwtSecret, {
    expiresIn: settings.jwtExpiresIn as jwt.SignOptions["expiresIn"],
  });
}

/** Returns the user id, or null on any failure (missing/expired/bad signature). */
export function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, settings.jwtSecret) as TokenPayload;
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export const AUTH_COOKIE_NAME = "doctar_token";

function expiresInMs(): number {
  // settings.jwtExpiresIn is a jsonwebtoken-style duration string (e.g. "14d").
  // Parse just the cases we actually use rather than pulling in a duration
  // library for one value — falls back to 14 days on anything unexpected.
  const match = /^(\d+)([smhd])$/.exec(settings.jwtExpiresIn);
  if (!match) return 14 * 24 * 60 * 60 * 1000;
  const n = Number(match[1]);
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "s" | "m" | "h" | "d"];
  return n * unitMs;
}

/**
 * Single source of truth for cookie identity attributes (everything EXCEPT
 * maxAge), used identically by both res.cookie() (login/signup) and
 * res.clearCookie() (logout) — clearCookie silently no-ops if its options
 * don't exactly match how the cookie was set, so duplicating this object
 * instead of sharing it is a very easy way to ship a logout button that
 * doesn't actually log anyone out.
 *
 * maxAge is deliberately NOT part of this shared object: Express's
 * clearCookie() merges its options into a Set-Cookie that already carries
 * `expires: <the past>`, and per RFC 6265 a `Max-Age` attribute takes
 * precedence over `Expires` when both are present — so if a future maxAge
 * leaked into the clear call, it would silently *extend* the cookie's life
 * instead of deleting it. authCookieOptions() (set) adds maxAge on top of
 * this; clearAuthCookieOptions() (clear) does not.
 */
function baseCookieOptions(): CookieOptions {
  const isProd = settings.nodeEnv === "production";
  return {
    httpOnly: true,
    secure: isProd,
    // "none" is required for the current cross-site Vercel↔Railway
    // deployment; "lax" locally (and would be safe in prod too if the API
    // ever moves to a same-site subdomain — see the backend README).
    sameSite: isProd ? "none" : "lax",
    path: "/",
  };
}

export function authCookieOptions(): CookieOptions {
  return { ...baseCookieOptions(), maxAge: expiresInMs() };
}

export function clearAuthCookieOptions(): CookieOptions {
  return baseCookieOptions();
}
