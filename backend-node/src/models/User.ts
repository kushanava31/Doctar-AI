import { Schema, model, InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // select: false — defense in depth so a stray res.json(userDoc) or
    // .toObject() spread anywhere can't leak the hash. Callers that actually
    // need it (login) must opt in with .select("+passwordHash").
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, default: null },
  },
  { timestamps: true }
);

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = model("User", userSchema);

/** Serialize a user document to the API shape — never includes passwordHash. */
export function userToDict(u: any): Record<string, unknown> {
  return {
    id: String(u._id ?? u.id),
    email: u.email,
    name: u.name ?? null,
  };
}
