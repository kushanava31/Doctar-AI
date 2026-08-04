/**
 * Doctor & hospital data access layer.
 *
 * HOW TO CONNECT YOUR COMPANY DATABASE LATER:
 * Replace queryLocalDb() with a call to your company's API/DB. Each result must
 * be an object with: id, name, speciality, hospital, city, fee, rating,
 * experience_years, available_today, languages.
 *
 * Faithful port of the Python doctor_repository.py (deterministic MD5 hashing
 * preserved via BigInt so generated profiles match the original).
 */
import { createHash } from "node:crypto";
import { settings } from "../config.js";
import { Doctor } from "../models/Doctor.js";
import { searchDoctorsLive, searchHospitalsLive } from "./googlePlaces.js";

export interface DoctorDict {
  id: string | number;
  name: string;
  speciality: string;
  hospital: string;
  city: string;
  fee: number;
  rating: number;
  experience_years: number;
  available_today: boolean;
  languages: string;
}

export interface HospitalDict {
  id: string;
  name: string;
  city: string;
  address: string;
  type: string;
  emergency: boolean;
  phone: string | null;
  rating: number;
  beds: number;
}

// ── State/region → nearest major DB city ──────────────────────────────────
const STATE_TO_CITY: Record<string, string> = {
  "west bengal": "Kolkata", bengal: "Kolkata",
  jharkhand: "Ranchi", bihar: "Patna",
  "uttar pradesh": "lucknow", up: "Lucknow",
  "madhya pradesh": "Indore", mp: "Indore",
  rajasthan: "Jaipur", gujarat: "Ahmedabad",
  maharashtra: "Mumbai", karnataka: "Bangalore",
  "tamil nadu": "Chennai", "andhra pradesh": "Hyderabad",
  telangana: "Hyderabad", kerala: "Kochi",
  odisha: "Bhubaneswar", punjab: "Chandigarh",
  haryana: "Gurgaon", "himachal pradesh": "Shimla",
  uttarakhand: "Dehradun", assam: "Guwahati",
  chhattisgarh: "Raipur", goa: "Panaji",
};

function resolveCity(city: string | null): [string | null, string | null] {
  if (!city) return [null, null];
  const lower = city.toLowerCase().trim();
  const mapped = STATE_TO_CITY[lower];
  if (mapped) return [mapped, city];
  return [city, city];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function queryLocalDb(
  speciality: string | null,
  city: string | null,
  maxFee: number | null,
  limit = 5
): Promise<DoctorDict[]> {
  const [queryCity] = resolveCity(city);
  const filter: Record<string, unknown> = {};
  if (speciality) filter.speciality = speciality;
  if (queryCity) filter.city = { $regex: escapeRegex(queryCity), $options: "i" };
  if (maxFee) filter.fee = { $lte: maxFee };

  const docs = await Doctor.find(filter).sort({ rating: -1 }).limit(limit).lean();
  return docs.map(modelToDict);
}

function modelToDict(d: any): DoctorDict {
  return {
    id: String(d._id ?? d.id),
    name: d.name,
    speciality: d.speciality,
    hospital: d.hospital,
    city: d.city,
    fee: d.fee,
    rating: d.rating,
    experience_years: d.experienceYears ?? 0,
    available_today: d.availableToday ?? true,
    languages: d.languages,
  };
}

// ── Deterministic mock generator (BigInt MD5 hashing) ─────────────────────
const FIRST_NAMES_M = [
  "Rajesh", "Amit", "Sunil", "Prakash", "Vikram", "Arun", "Sanjay", "Ravi",
  "Deepak", "Manoj", "Ajay", "Vinod", "Rakesh", "Ashok", "Pawan", "Naresh",
  "Ramesh", "Dinesh", "Girish", "Harish", "Kamlesh", "Lokesh", "Mahesh",
  "Nilesh", "Pritesh", "Ritesh", "Suresh", "Umesh", "Vijay", "Yogesh",
];
const FIRST_NAMES_F = [
  "Priya", "Sunita", "Anita", "Rekha", "Pooja", "Neha", "Kavita", "Meena",
  "Seema", "Ritu", "Asha", "Nisha", "Geeta", "Shobha", "Manisha", "Savita",
  "Lalita", "Mamta", "Usha", "Radha", "Reena", "Sonia", "Jyoti", "Lata",
  "Manju", "Puja", "Sarita", "Swati", "Vandana", "Yamini",
];
const SURNAMES_HINDI = [
  "Sharma", "Gupta", "Singh", "Verma", "Yadav", "Kumar", "Mishra", "Pandey",
  "Tiwari", "Dubey", "Srivastava", "Jha", "Prasad", "Thakur", "Rai",
  "Chaudhary", "Tripathi", "Shukla", "Saxena", "Agarwal", "Rastogi",
  "Bajpai", "Dwivedi", "Pathak", "Chauhan", "Dixit", "Gangwar", "Maurya",
  "Nishad", "Vishwakarma",
];
const SURNAMES_BENGALI = [
  "Ghosh", "Das", "Chatterjee", "Banerjee", "Roy", "Bose", "Dey", "Sen",
  "Mukherjee", "Paul", "Saha", "Chakraborty", "Mandal", "Kundu", "Biswas",
  "Bhattacharya", "Chandra", "Ganguly", "Guha", "Mitra", "Nandi", "Pal",
  "Sarkar", "Basak", "Majumdar", "Chowdhury", "Karmakar", "Rakshit", "Seal", "Sur",
];
const SURNAMES_SOUTH = [
  "Rao", "Reddy", "Nair", "Pillai", "Menon", "Iyer", "Varma", "Krishnan",
  "Rajan", "Subramaniam", "Patel", "Shah", "Mehta", "Joshi", "Desai",
  "Narayanan", "Balakrishnan", "Venkatesh", "Anand", "Bhat", "Hegde",
  "Kulkarni", "Patil", "Naik", "Kamath", "Shetty", "Acharya", "Bhatt",
  "Gowda", "Murthy",
];

const REGION_SURNAMES: Array<[string, string[]]> = [
  ["kolkata", SURNAMES_BENGALI], ["bengal", SURNAMES_BENGALI],
  ["jharkhand", SURNAMES_HINDI], ["bihar", SURNAMES_HINDI],
  ["deoghar", SURNAMES_HINDI], ["patna", SURNAMES_HINDI],
  ["ranchi", SURNAMES_HINDI], ["lucknow", SURNAMES_HINDI], ["delhi", SURNAMES_HINDI],
  ["varanasi", SURNAMES_HINDI], ["agra", SURNAMES_HINDI], ["kanpur", SURNAMES_HINDI],
  ["allahabad", SURNAMES_HINDI], ["prayagraj", SURNAMES_HINDI],
  ["chennai", SURNAMES_SOUTH], ["hyderabad", SURNAMES_SOUTH],
  ["bangalore", SURNAMES_SOUTH], ["bengaluru", SURNAMES_SOUTH],
  ["kerala", SURNAMES_SOUTH], ["kochi", SURNAMES_SOUTH],
  ["mumbai", SURNAMES_SOUTH], ["pune", SURNAMES_SOUTH],
];

const HOSPITAL_SUFFIXES = [
  "Medical Centre", "Hospital & Research Institute", "Clinic",
  "Nursing Home", "Healthcare", "Specialty Hospital", "Polyclinic",
  "Hospital", "Medical College", "Super Specialty Centre",
];

const SPECIALITY_FEMALE_RATIO: Record<string, number> = {
  Gynecologist: 0.8, Pediatrician: 0.5, Dermatologist: 0.5,
  Psychiatrist: 0.4, Ophthalmologist: 0.4,
};

/** Independent deterministic hash per attribute (full 128-bit MD5 as BigInt). */
function h(city: string, speciality: string, idx: number, attr: string): bigint {
  const raw = `${city.toLowerCase()}|${speciality.toLowerCase()}|${idx}|${attr}`;
  return BigInt("0x" + createHash("md5").update(raw).digest("hex"));
}

function md5Prefix64(s: string): bigint {
  return BigInt("0x" + createHash("md5").update(s).digest("hex").slice(0, 16));
}

function pick<T>(lst: T[], n: bigint): T {
  return lst[Number(((n % BigInt(lst.length)) + BigInt(lst.length)) % BigInt(lst.length))];
}

const CITY_LANG: Array<[string, string]> = [
  ["kolkata", ", Bengali"], ["bengal", ", Bengali"],
  ["chennai", ", Tamil"], ["coimbatore", ", Tamil"], ["madurai", ", Tamil"],
  ["hyderabad", ", Telugu"], ["vizag", ", Telugu"], ["vijayawada", ", Telugu"],
  ["bangalore", ", Kannada"], ["bengaluru", ", Kannada"], ["mysore", ", Kannada"],
  ["mumbai", ", Marathi"], ["pune", ", Marathi"], ["nagpur", ", Marathi"], ["nashik", ", Marathi"],
  ["ahmedabad", ", Gujarati"], ["surat", ", Gujarati"], ["vadodara", ", Gujarati"],
  ["kochi", ", Malayalam"], ["thiruvananthapuram", ", Malayalam"], ["kozhikode", ", Malayalam"],
  ["chandigarh", ", Punjabi"], ["amritsar", ", Punjabi"], ["ludhiana", ", Punjabi"],
];

function getLangHint(city: string): string {
  const lower = city.toLowerCase();
  for (const [key, lang] of CITY_LANG) if (lower.includes(key)) return lang;
  return "";
}

function generateMockDoctors(speciality: string, city: string, count = 5): DoctorDict[] {
  const cityLower = city.toLowerCase();
  const surnames = REGION_SURNAMES.find(([k]) => cityLower.includes(k))?.[1] ?? SURNAMES_HINDI;
  const femaleRatio = SPECIALITY_FEMALE_RATIO[speciality] ?? 0.4;
  const langHint = getLangHint(city).replace(/^,\s*/, "");
  const languages = `Hindi, English${langHint ? ", " + langHint : ""}`;

  const citySeed = md5Prefix64(cityLower);
  const specSeed = md5Prefix64(speciality.toLowerCase());

  const results: DoctorDict[] = [];
  const seenNames = new Set<string>();

  for (let i = 0; i < count; i++) {
    const hGender = h(city, speciality, i, "gender");
    const hFirst = h(city, speciality, i, "first");
    const hLast = h(city, speciality, i, "last");
    const hSuffix = h(city, speciality, i, "suffix");
    const hFee = h(city, speciality, i, "fee");
    const hRating = h(city, speciality, i, "rating");
    const hExp = h(city, speciality, i, "exp");
    const hAvail = h(city, speciality, i, "avail");

    const isFemale = Number(hGender % 100n) < Math.floor(femaleRatio * 100);
    const firstPool = isFemale ? FIRST_NAMES_F : FIRST_NAMES_M;
    const fnLen = BigInt(firstPool.length);
    const lnLen = BigInt(surnames.length);

    let firstIdx = (hFirst + citySeed + specSeed) % fnLen;
    const lastIdx = (hLast + citySeed + specSeed * 7n) % lnLen;

    let first = firstPool[Number(firstIdx)];
    let last = surnames[Number(lastIdx)];

    const INITIALS = "ABCDEFGHJKLMNPRSTVWY";
    const cityInitial =
      INITIALS[Number((citySeed ^ (specSeed * 31n) ^ (BigInt(i) * 97n)) % BigInt(INITIALS.length))];
    let full = `Dr. ${first} ${cityInitial}. ${last}`;

    let retry = 0;
    const maxRetry = firstPool.length + surnames.length;
    while (seenNames.has(full) && retry < maxRetry) {
      retry++;
      first = firstPool[Number((firstIdx + BigInt(retry)) % fnLen)];
      last = surnames[Number((lastIdx + BigInt(retry * 3 + 1)) % lnLen)];
      full = `Dr. ${first} ${cityInitial}. ${last}`;
    }
    seenNames.add(full);

    const hospital = `${last} ${pick(HOSPITAL_SUFFIXES, hSuffix)}`;
    const fee = 300 + Number(hFee % 10n) * 80;
    const rating = Math.round((4.0 + Number(hRating % 11n) / 22) * 10) / 10;
    const exp = 4 + Number(hExp % 18n);

    results.push({
      id: `mock_${city}_${speciality}_${i}`.replace(/ /g, "_"),
      name: full,
      speciality,
      hospital,
      city,
      fee,
      rating,
      experience_years: exp,
      available_today: Number(hAvail % 3n) !== 0,
      languages,
    });
  }
  return results;
}

// ── Gemini fallback generators ────────────────────────────────────────────
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key={key}";

const GENERATE_PROMPT = (count: number, speciality: string, city: string, langHint: string) =>
  `You are a medical directory for India.
Generate ${count} realistic doctor profiles for ${speciality} doctors in ${city}, India.

Return ONLY a valid JSON array. No markdown, no code fences.
Each object must have exactly these fields:
{
  "name": "Dr. Full Name (Indian name appropriate for the region)",
  "speciality": "${speciality}",
  "hospital": "Real or realistic hospital name in ${city}",
  "city": "${city}",
  "fee": <integer between 300 and 1500>,
  "rating": <float between 4.0 and 5.0>,
  "experience_years": <integer between 3 and 25>,
  "available_today": <true or false>,
  "languages": "Hindi, English${langHint}"
}

Rules:
- Use culturally appropriate Indian names for the region (${city})
- Hospital names should sound realistic for that city
- Vary fees, ratings, experience realistically
- Languages: add local language of ${city} if applicable

Return JSON array only:`;

// Kept in sync with chat.ts's callGemini — this also runs inside the
// /api/chat request path (via getDoctorRecommendations), which the frontend
// aborts after 15s total, so timeout × attempts must stay well under that.
// (Previously this was a single attempt with a 15s timeout and no retry —
// consistent with callGemini now, and no longer able to eat the whole
// request budget on its own.)
const GEMINI_TIMEOUT_MS = 5000;
const GEMINI_MAX_ATTEMPTS = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function geminiJsonArray(prompt: string, temperature: number, maxTokens: number): Promise<any[]> {
  if (!settings.geminiApiKey) return [];
  const url = GEMINI_URL.replace("{key}", settings.geminiApiKey);
  const payload = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }]}],
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  });

  for (let attempt = 0; attempt < GEMINI_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        // Truncated response body (not just the status code) so a real
        // failure is diagnosable from server logs alone.
        const body = (await resp.text().catch(() => "")).slice(0, 300);
        if ((resp.status === 429 || resp.status === 503) && attempt < GEMINI_MAX_ATTEMPTS - 1) {
          const backoff = Math.min(1000 * (attempt + 1), 3000);
          console.warn(`Gemini ${resp.status}, retrying in ${backoff}ms: ${body}`);
          await sleep(backoff);
          continue;
        }
        console.warn(`Gemini call failed: ${resp.status} ${body}`);
        return [];
      }
      const data: any = await resp.json();
      let raw = String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
      raw = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) raw = match[0];
      raw = raw.replace(/,\s*}/g, "}").replace(/,\s*\]/g, "]");
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      clearTimeout(timer);
      console.warn("Gemini generation failed:", (e as Error).message);
      return [];
    }
  }
  return [];
}

async function generateViaGemini(speciality: string, city: string, count = 5): Promise<DoctorDict[]> {
  const langHint = getLangHint(city);
  const doctors = await geminiJsonArray(GENERATE_PROMPT(count, speciality, city, langHint), 0.7, 1000);
  return doctors
    .filter((d) => d && typeof d === "object")
    .map((d, i) => ({
      id: `ai_${city}_${speciality}_${i}`.replace(/ /g, "_"),
      name: String(d.name ?? `Dr. ${speciality} ${i + 1}`),
      speciality,
      hospital: String(d.hospital ?? `City Hospital ${city}`),
      city,
      fee: parseInt(d.fee ?? 600, 10) || 600,
      rating: parseFloat(d.rating ?? 4.3) || 4.3,
      experience_years: parseInt(d.experience_years ?? 8, 10) || 8,
      available_today: Boolean(d.available_today ?? true),
      languages: String(d.languages ?? "Hindi, English"),
    }));
}

// ── Public: doctor recommendations ────────────────────────────────────────
export interface DoctorRecommendations {
  doctors: DoctorDict[];
  isGenerated: boolean;
  resolvedCity: string | null;
}

export async function getDoctorRecommendations(
  speciality: string | null,
  city: string | null,
  maxFee: number | null,
  limit = 5
): Promise<DoctorRecommendations> {
  const [queryCity, displayCity] = resolveCity(city);

  // Step 1: local seeded DB
  const doctors = await queryLocalDb(speciality, city, maxFee, limit);

  if (doctors.length && city && queryCity) {
    const firstCity = doctors[0].city || "";
    if (firstCity.toLowerCase() !== queryCity.toLowerCase()) {
      return { doctors, isGenerated: false, resolvedCity: firstCity };
    }
  }
  if (doctors.length) return { doctors, isGenerated: false, resolvedCity: displayCity };

  if (settings.useRealDoctorDb) return { doctors: [], isGenerated: false, resolvedCity: displayCity };

  // Step 2: Google Places live search
  if (speciality && city) {
    const liveDocs = await searchDoctorsLive(speciality, city, limit);
    if (liveDocs.length) {
      console.log(`Google Places returned ${liveDocs.length} live results for ${speciality} in ${city}`);
      return { doctors: liveDocs, isGenerated: false, resolvedCity: city };
    }
  }

  // Step 3: Gemini-generated profiles
  if (speciality && city) {
    const geminiDocs = await generateViaGemini(speciality, city, limit);
    if (geminiDocs.length) return { doctors: geminiDocs, isGenerated: true, resolvedCity: city };
  }

  // Step 4: deterministic mock
  if (speciality && city) {
    return { doctors: generateMockDoctors(speciality, city, limit), isGenerated: true, resolvedCity: city };
  }

  return { doctors: [], isGenerated: false, resolvedCity: displayCity };
}

export const findDoctors = getDoctorRecommendations;

/** Public wrapper for the deterministic mock generator (used as a last resort by chat). */
export function generateMockDoctorsPublic(speciality: string, city: string, count = 5): DoctorDict[] {
  return generateMockDoctors(speciality, city, count);
}

// ── Hospital search ───────────────────────────────────────────────────────
const HOSPITAL_TYPES = [
  "Multi-Specialty Hospital", "Government District Hospital",
  "Private Hospital", "Nursing Home", "Medical College Hospital",
  "Specialty Clinic", "Trauma Centre", "Community Health Centre",
];

const HOSPITAL_PROMPT = (count: number, city: string, typeClause: string) =>
  `You are a hospital directory for India.
List ${count} hospitals/medical centres in ${city}, India.${typeClause}
Return ONLY a valid JSON array — no markdown, no code fences.
Each object must have exactly these fields:
{
  "name": "Hospital or clinic name (realistic for ${city})",
  "address": "Area/locality/landmark in ${city}",
  "type": "Government/Private/Multi-Specialty/Nursing Home/Trauma Centre",
  "emergency": true or false,
  "phone": "local phone number string or null",
  "rating": <float 3.5 to 5.0>,
  "beds": <integer 20 to 2000>
}
Use realistic names and addresses for ${city}. Vary types and sizes.
Return JSON array only:`;

async function generateHospitalsViaGemini(
  city: string,
  count = 5,
  hospitalType: string | null = null
): Promise<HospitalDict[]> {
  const typeClause = hospitalType ? ` Focus specifically on ${hospitalType} hospitals and clinics.` : "";
  const hospitals = await geminiJsonArray(HOSPITAL_PROMPT(count, city, typeClause), 0.6, 800);
  return hospitals
    .filter((hsp) => hsp && typeof hsp === "object")
    .map((hsp, i) => ({
      id: `hospital_${city}_${i}`.replace(/ /g, "_"),
      name: String(hsp.name ?? `${city} Hospital ${i + 1}`),
      city,
      address: String(hsp.address ?? city),
      type: String(hsp.type ?? "Hospital"),
      emergency: Boolean(hsp.emergency ?? false),
      phone: hsp.phone || null,
      rating: parseFloat(hsp.rating ?? 4.0) || 4.0,
      beds: parseInt(hsp.beds ?? 100, 10) || 100,
    }));
}

const LOCALITY_WORDS = [
  "Civil Lines", "MG Road", "Sector 12", "Gandhi Nagar",
  "Nehru Place", "Station Road", "Ram Nagar", "Sadar Bazar",
  "Hazratganj", "Anna Nagar", "Koramangala", "Banjara Hills",
];

const HOSPITAL_TYPE_NAMES: Record<string, string[]> = {
  children: ["Children's Hospital", "Paediatric Centre", "Child Care Hospital", "Kids Health Centre"],
  cardiac: ["Heart Institute", "Cardiac Care Centre", "Heart Hospital", "Cardiology Centre"],
  maternity: ["Maternity Hospital", "Women & Child Hospital", "Mother Care Centre", "Lady Dufferin Hospital"],
  eye: ["Eye Hospital", "Vision Care Centre", "Ophthalmic Centre", "Eye Care Clinic"],
  cancer: ["Cancer Institute", "Oncology Centre", "Cancer Care Hospital", "Tumour Institute"],
  dental: ["Dental Hospital", "Dental Clinic", "Oral Health Centre", "Smile Dental Care"],
  orthopedic: ["Orthopaedic Hospital", "Bone & Joint Centre", "Ortho Clinic", "Joint Care Hospital"],
  "mental health": ["Mental Health Centre", "Psychiatric Hospital", "Mind Care Clinic", "Neuropsychiatry Centre"],
  trauma: ["Trauma Centre", "Emergency Hospital", "Accident & Emergency Hospital"],
  dermatology: ["Skin Hospital", "Dermatology Clinic", "Skin & Cosmetic Centre"],
  government: ["Government District Hospital", "Civil Hospital", "Government Medical College Hospital"],
  private: ["Private Hospital", "Multi-Specialty Hospital", "Super-Specialty Hospital"],
};

function generateMockHospitals(city: string, count = 5, hospitalType: string | null = null): HospitalDict[] {
  const typeNames = HOSPITAL_TYPE_NAMES[hospitalType || ""] ?? [];
  const tag = hospitalType || "general";
  const results: HospitalDict[] = [];
  const seenNames = new Set<string>();

  for (let i = 0; i < count; i++) {
    const hTypeI = h(city, tag, i, "h_type");
    const hLocality = h(city, tag, i, "locality");
    let hSurname = h(city, tag, i, "surname");
    const hBase = h(city, tag, i, "base");
    const hGeneric = h(city, tag, i, "generic");
    const hEmerg = h(city, tag, i, "emergency");
    const hRating = h(city, tag, i, "rating");
    const hBeds = h(city, tag, i, "beds");

    const hTypeVal = pick(HOSPITAL_TYPES, hTypeI);
    const locality = pick(LOCALITY_WORDS, hLocality);
    let surname = pick(SURNAMES_HINDI, hSurname);

    let name: string;
    if (typeNames.length) {
      const base = pick(typeNames, hBase);
      name = i === 0 ? `${city} ${base}` : `${surname} ${base}`;
    } else {
      name =
        i === 0
          ? `${city} ${hTypeVal}`
          : `${surname} ${pick(["Hospital", "Clinic", "Medical Centre", "Nursing Home"], hGeneric)}`;
    }

    const original = name;
    let retry = 0;
    while (seenNames.has(name) && retry < 8) {
      retry++;
      surname = pick(SURNAMES_HINDI, hSurname + BigInt(retry * 5));
      name = i > 0 ? original.replace(original.split(" ")[0], surname) : `${city} ${hTypeVal} ${retry}`;
    }
    seenNames.add(name);

    results.push({
      id: `hospital_${city}_${tag}_${i}`.replace(/ /g, "_"),
      name,
      city,
      address: `${locality}, ${city}`,
      type: hTypeVal,
      emergency: Number(hEmerg % 2n) === 0,
      phone: null,
      rating: Math.round((3.8 + Number(hRating % 13n) / 22) * 10) / 10,
      beds: 30 + Number(hBeds % 20n) * 50,
    });
  }
  return results;
}

export interface HospitalResults {
  hospitals: HospitalDict[];
  isGenerated: boolean;
}

export async function findHospitals(
  city: string,
  limit = 5,
  hospitalType: string | null = null
): Promise<HospitalResults> {
  if (!city) return { hospitals: [], isGenerated: false };
  if (settings.useRealDoctorDb) return { hospitals: [], isGenerated: false };

  const live = await searchHospitalsLive(city, hospitalType, limit);
  if (live.length) return { hospitals: live, isGenerated: false };

  const hospitals = await generateHospitalsViaGemini(city, limit, hospitalType);
  if (hospitals.length) return { hospitals, isGenerated: true };

  return { hospitals: generateMockHospitals(city, limit, hospitalType), isGenerated: true };
}
