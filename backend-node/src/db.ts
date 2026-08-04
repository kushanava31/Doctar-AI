import mongoose from "mongoose";
import { settings } from "./config.js";

let connected = false;

export async function connectDB(): Promise<typeof mongoose> {
  if (connected) return mongoose;
  mongoose.set("strictQuery", true);
  // Never auto-build indexes — this DB is shared with the main site, and we must
  // not issue DDL against its existing collections (e.g. `doctors`).
  mongoose.set("autoIndex", false);
  await mongoose.connect(settings.mongodbUri);
  connected = true;
  console.log(`✔ MongoDB connected: ${redact(settings.mongodbUri)}`);
  return mongoose;
}

export async function disconnectDB(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}

function redact(uri: string): string {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, "//$1:****@");
}
