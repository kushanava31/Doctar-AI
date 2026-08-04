/**
 * Seed the doctors collection. Run with: npm run seed
 * Mirrors the Python seed_doctors.py — clears the collection and inserts the
 * deduplicated doctor records.
 */
import { connectDB, disconnectDB } from "../db.js";
import { Doctor } from "../models/Doctor.js";
import { SEED_DOCTORS } from "../data/seedDoctors.js";

async function main() {
  await connectDB();
  await Doctor.deleteMany({});
  await Doctor.insertMany(SEED_DOCTORS);
  const count = await Doctor.countDocuments();
  const cities = (await Doctor.distinct("city")).length;
  console.log(`Seeded ${count} doctors across ${cities} cities.`);
  await disconnectDB();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
