const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface SessionSummary {
  id: string;
  title: string;
  updated_at: string;
}

export interface SessionMessage {
  role: "user" | "assistant";
  text: string;
  doctors: any[];
  hospitals: any[];
  medicine_info: any;
  created_at: string;
}

export interface SessionDetail {
  id: string;
  title: string;
  messages: SessionMessage[];
}

async function sessionsFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}/api/chat/sessions${path}`, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
}

export async function listSessions(): Promise<SessionSummary[]> {
  const res = await sessionsFetch("");
  if (!res.ok) throw new Error("Failed to load chat history");
  return res.json();
}

export async function getSession(id: string): Promise<SessionDetail> {
  const res = await sessionsFetch(`/${id}`);
  if (!res.ok) throw new Error("Failed to load that conversation");
  return res.json();
}

export async function renameSession(id: string, title: string): Promise<SessionSummary> {
  const res = await sessionsFetch(`/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });
  if (!res.ok) throw new Error("Failed to rename");
  return res.json();
}

export async function deleteSession(id: string): Promise<void> {
  const res = await sessionsFetch(`/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error("Failed to delete");
}
