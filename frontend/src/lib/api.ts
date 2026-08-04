const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function formatApiError(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => (typeof d === "object" && d && "msg" in d ? String(d.msg) : String(d))).join(", ");
  }
  return fallback;
}

export interface MedicineItem {
  name: string;
  dosage: string;
  timing: string;
  duration: string;
  food_instructions: string;
  purpose?: string;
}

export interface Prescription {
  id: string;
  original_filename: string;
  mime_type: string;
  ocr_text: string | null;
  medicines: MedicineItem[];
  status: string;
  created_at: string;
  updated_at: string;
}

export interface UploadResponse {
  id: string;
  status: string;
  message: string;
}

export interface ProcessResponse {
  id: string;
  status: string;
  ocr_text: string | null;
  medicines: MedicineItem[] | null;
  error: string | null;
}

export async function uploadPrescription(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/prescriptions/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(formatApiError(err.detail, "Upload failed"));
  }
  return res.json();
}

export async function processPrescription(id: string): Promise<ProcessResponse> {
  const res = await fetch(`${API_BASE}/api/prescriptions/${id}/process`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(formatApiError(err.detail, "Processing failed"));
  }
  return res.json();
}

export async function getPrescription(id: string): Promise<Prescription> {
  const res = await fetch(`${API_BASE}/api/prescriptions/${id}`);
  if (!res.ok) throw new Error("Failed to load prescription");
  return res.json();
}

export async function updatePrescription(
  id: string,
  medicines: MedicineItem[]
): Promise<Prescription> {
  const res = await fetch(`${API_BASE}/api/prescriptions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ medicines }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(formatApiError(err.detail, "Update failed"));
  }
  return res.json();
}

export function pdfDownloadUrl(id: string, lang: "en" | "hi" | "both" = "both"): string {
  return `${API_BASE}/api/prescriptions/${id}/pdf?lang=${lang}`;
}

export function imageUrl(id: string): string {
  return `${API_BASE}/api/prescriptions/${id}/image`;
}
