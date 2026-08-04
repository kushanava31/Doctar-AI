import { Schema, model, InferSchemaType } from "mongoose";

const doctorSchema = new Schema(
  {
    name: { type: String, required: true },
    speciality: { type: String, required: true },
    city: { type: String, required: true },
    fee: { type: Number, required: true },
    experienceYears: { type: Number, default: 0 },
    rating: { type: Number, default: 4.0 },
    hospital: { type: String, required: true },
    availableToday: { type: Boolean, default: true },
    languages: { type: String, default: "Hindi, English" },
    phone: { type: String, default: null },
  },
  { timestamps: true }
);

doctorSchema.index({ city: 1, speciality: 1 });

export type DoctorDoc = InferSchemaType<typeof doctorSchema>;
export const Doctor = model("Doctor", doctorSchema);

/** Serialize a doctor document to the API shape (matches the Python contract). */
export function doctorToDict(d: any): Record<string, unknown> {
  return {
    id: String(d._id ?? d.id),
    name: d.name,
    speciality: d.speciality,
    city: d.city,
    fee: d.fee,
    experience_years: d.experienceYears ?? 0,
    rating: d.rating ?? 4.0,
    hospital: d.hospital,
    available_today: d.availableToday ?? true,
    languages: d.languages,
    phone: d.phone ?? null,
  };
}
