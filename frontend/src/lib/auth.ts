const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

function formatApiError(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  return fallback;
}

async function authFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
}

export async function apiSignup(email: string, password: string, name?: string): Promise<AuthUser> {
  const res = await authFetch("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, name }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(formatApiError(body.detail, "Sign up failed"));
  return body;
}

export async function apiLogin(email: string, password: string): Promise<AuthUser> {
  const res = await authFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(formatApiError(body.detail, "Login failed"));
  return body;
}

export async function apiLogout(): Promise<void> {
  await authFetch("/api/auth/logout", { method: "POST" });
}

/** Returns null (not throwing) when not authenticated — that's the expected
 * steady state for anonymous visitors, not an error condition. */
export async function apiMe(): Promise<AuthUser | null> {
  const res = await authFetch("/api/auth/me");
  if (res.status === 401) return null;
  if (!res.ok) return null;
  return res.json();
}
