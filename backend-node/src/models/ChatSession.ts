import { Schema, model, InferSchemaType } from "mongoose";

const chatMessageSchema = new Schema(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    text: { type: String, required: true },
    // Mixed rather than a strict sub-schema — matches the existing looseness
    // of ChatResult in services/chat.ts, where doctors/hospitals/medicine_info
    // are already typed `any[]`/`any` with no stricter shape defined anywhere.
    doctors: { type: Schema.Types.Mixed, default: undefined },
    hospitals: { type: Schema.Types.Mixed, default: undefined },
    medicineInfo: { type: Schema.Types.Mixed, default: undefined },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const chatSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true },
    messages: { type: [chatMessageSchema], default: [] },
  },
  { timestamps: true }
);

// Backs the "recent sessions" sidebar query: find mine, newest first.
chatSessionSchema.index({ userId: 1, updatedAt: -1 });

export type ChatMessageDoc = InferSchemaType<typeof chatMessageSchema>;
export type ChatSessionDoc = InferSchemaType<typeof chatSessionSchema>;
export const ChatSession = model("ChatSession", chatSessionSchema);

function chatMessageToDict(m: any): Record<string, unknown> {
  return {
    role: m.role,
    text: m.text,
    doctors: m.doctors ?? [],
    hospitals: m.hospitals ?? [],
    medicine_info: m.medicineInfo ?? null,
    created_at: m.createdAt,
  };
}

/** Summary shape for the sidebar's recent-sessions list. */
export function chatSessionToSummary(s: any): Record<string, unknown> {
  return {
    id: String(s._id),
    title: s.title,
    updated_at: s.updatedAt,
  };
}

/** Full shape for loading a session's history into the chat window. */
export function chatSessionToDetail(s: any): Record<string, unknown> {
  return {
    id: String(s._id),
    title: s.title,
    messages: (s.messages ?? []).map(chatMessageToDict),
  };
}
