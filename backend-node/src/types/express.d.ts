// `import` makes this file a module, which is what makes `declare global`
// below correctly merge into the real Express namespace rather than
// silently scoping itself to just this file (a mistake that produces no
// build error — req.userId would just stay untyped everywhere else).
import "express";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth/optionalAuth. null = no valid session. */
      userId?: string | null;
    }
  }
}
