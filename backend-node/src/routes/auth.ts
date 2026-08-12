import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { User, userToDict } from "../models/User.js";
import {
  authCookieOptions,
  clearAuthCookieOptions,
  AUTH_COOKIE_NAME,
  hashPassword,
  signToken,
  verifyPassword,
} from "../services/auth.js";

const router = Router();

// Standard express-rate-limit IP-based keying (their built-in IPv6-safe
// default) — deliberately not combining with email to avoid the IPv6
// key-normalization pitfalls the library specifically warns about when
// hand-rolling a composite key.
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: "Too many attempts. Please try again in a few minutes." },
});

const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().trim().min(1).max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

function firstZodMessage(err: z.ZodError): string {
  return err.issues[0]?.message || "Invalid request";
}

// POST /api/auth/signup
router.post(
  "/signup",
  authRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const { email, password, name } = parsed.data;

    // Pre-check for a friendlier error in the common case, but not relied on
    // alone — the schema's unique index is what actually prevents a race
    // between two concurrent signups for the same email.
    const existing = await User.findOne({ email }).lean();
    if (existing) throw new HttpError(409, "An account with this email already exists");

    const passwordHash = await hashPassword(password);
    let user;
    try {
      user = await User.create({ email, passwordHash, name: name ?? null });
    } catch (e: any) {
      if (e?.code === 11000) throw new HttpError(409, "An account with this email already exists");
      throw e;
    }

    const token = signToken(String(user._id));
    res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());
    res.status(201).json(userToDict(user));
  })
);

// POST /api/auth/login
router.post(
  "/login",
  authRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const { email, password } = parsed.data;

    // email is already lowercased/trimmed by the zod schema above — matters
    // because the User model's `lowercase: true` only normalizes on save,
    // not on query filters, so this query relies on the schema doing it too.
    const user = await User.findOne({ email }).select("+passwordHash");
    // Same generic message whether the account doesn't exist or the password
    // is wrong — doesn't leak which one to a prospective attacker.
    const GENERIC_ERROR = "Invalid email or password";
    if (!user) throw new HttpError(401, GENERIC_ERROR);

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) throw new HttpError(401, GENERIC_ERROR);

    const token = signToken(String(user._id));
    res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());
    res.json(userToDict(user));
  })
);

// POST /api/auth/logout
router.post(
  "/logout",
  asyncHandler(async (_req: Request, res: Response) => {
    res.clearCookie(AUTH_COOKIE_NAME, clearAuthCookieOptions());
    res.json({ ok: true });
  })
);

// GET /api/auth/me
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const user = await User.findById(req.userId);
    if (!user) throw new HttpError(401, "Not authenticated");
    res.json(userToDict(user));
  })
);

export default router;
