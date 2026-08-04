import { Schema, model, InferSchemaType } from "mongoose";
import { randomUUID } from "node:crypto";

const medicineSchema = new Schema(
  {
    name: { type: String, default: "" },
    dosage: { type: String, default: "" },
    timing: { type: String, default: "" },
    duration: { type: String, default: "" },
    foodInstructions: { type: String, default: "" }, // AC (before food) / PC (after food)
    purpose: { type: String, default: "" },
  },
  { _id: false }
);

const prescriptionSchema = new Schema(
  {
    // UUID string preserved so API URLs/contract stay identical to the Python app
    _id: { type: String, default: () => randomUUID() },
    imagePath: { type: String, required: true },
    originalFilename: { type: String, required: true },
    mimeType: { type: String, required: true },
    ocrText: { type: String, default: null },
    medicines: { type: [medicineSchema], default: [] },
    status: { type: String, default: "uploaded" },
  },
  { timestamps: true, _id: false }
);

export type MedicineDoc = InferSchemaType<typeof medicineSchema>;
export type PrescriptionDoc = InferSchemaType<typeof prescriptionSchema>;
export const Prescription = model("Prescription", prescriptionSchema);

export interface MedicineItem {
  name: string;
  dosage: string;
  timing: string;
  duration: string;
  food_instructions: string;
  purpose: string;
}

/** A medicine subdocument → API shape (snake_case to match the Python contract). */
export function medicineToDict(m: any): MedicineItem {
  return {
    name: m.name ?? "",
    dosage: m.dosage ?? "",
    timing: m.timing ?? "",
    duration: m.duration ?? "",
    food_instructions: m.foodInstructions ?? "",
    purpose: m.purpose ?? "",
  };
}

/** API/AI shape → storage shape (camelCase for Mongoose). */
export function medicineToDoc(m: Partial<MedicineItem>): Record<string, string> {
  return {
    name: m.name ?? "",
    dosage: m.dosage ?? "",
    timing: m.timing ?? "",
    duration: m.duration ?? "",
    foodInstructions: m.food_instructions ?? "",
    purpose: m.purpose ?? "",
  };
}

/** Full prescription document → API response shape. */
export function prescriptionToResponse(p: any): Record<string, unknown> {
  return {
    id: String(p._id),
    original_filename: p.originalFilename,
    mime_type: p.mimeType,
    ocr_text: p.ocrText ?? null,
    medicines: (p.medicines ?? []).map(medicineToDict),
    status: p.status,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}
