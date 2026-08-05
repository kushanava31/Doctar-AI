/**
 * Real-time doctor & hospital search via Google Places API (New).
 * Called when the local DB has no results. Returns dicts in the same shape as
 * DB records. Faithful port of the Python google_places.py.
 */
import { createHash } from "node:crypto";
import { settings } from "../config.js";
import type { DoctorDict, HospitalDict } from "./doctorRepository.js";

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.currentOpeningHours",
  "places.internationalPhoneNumber",
  "places.regularOpeningHours",
  "places.types",
  "places.id",
].join(",");

const QUERY_MAP: Record<string, string> = {
  Cardiologist: "cardiologist heart doctor clinic",
  Dermatologist: "dermatologist skin clinic",
  Orthopedic: "orthopedic surgeon bone joint clinic",
  Neurologist: "neurologist brain nerve clinic",
  Pediatrician: "pediatrician child specialist clinic",
  Gynecologist: "gynecologist obstetrician women clinic",
  Psychiatrist: "psychiatrist mental health clinic",
  Diabetologist: "diabetologist diabetes specialist clinic",
  "ENT Specialist": "ENT specialist ear nose throat clinic",
  Ophthalmologist: "ophthalmologist eye specialist clinic",
  Dentist: "dentist dental clinic",
  "General Physician": "general physician family doctor clinic",
};

const CITY_FEE: Record<string, [number, number]> = {
  delhi: [500, 1500], mumbai: [600, 2000], bangalore: [500, 1500],
  kolkata: [400, 1200], chennai: [400, 1200], hyderabad: [400, 1200],
  pune: [400, 1100], ahmedabad: [350, 1000], gurgaon: [600, 1500],
  noida: [500, 1200],
  jaipur: [350, 900], lucknow: [300, 800], chandigarh: [400, 1000],
  indore: [300, 800], bhopal: [300, 800], surat: [300, 800],
  nagpur: [300, 800], kochi: [350, 900], visakhapatnam: [300, 800],
  coimbatore: [300, 800], vadodara: [300, 800], patna: [250, 700],
};

/**
 * Fee is synthetic either way (Places doesn't return consultation fees), so
 * when the caller passed a budget cap ("under ₹500"), bound the generated
 * fee to it directly rather than rejecting a genuine live result over a
 * made-up number that happened to land above the cap. Mirrors
 * doctorRepository.ts's boundedFee — kept local here to avoid a circular
 * import back into that module.
 */
function feeForCity(city: string, speciality: string, maxFee: number | null = null): number {
  const seed = parseInt(createHash("md5").update(`${city}${speciality}`).digest("hex").slice(0, 8), 16);
  if (maxFee && maxFee > 0) {
    const high = Math.floor(maxFee);
    const low = Math.min(high, Math.max(100, Math.floor(high * 0.4)));
    const span = high - low;
    return low + (span > 0 ? seed % (span + 1) : 0);
  }
  const [low, high] = CITY_FEE[city.toLowerCase()] ?? [250, 600];
  return low + (seed % (high - low + 1));
}

function ratingFromGoogle(r: unknown): number {
  if (r === null || r === undefined) return 4.2;
  return Math.min(5.0, Math.round(Number(r) * 10) / 10);
}

function isOpenNow(place: any): boolean {
  const hours = place.currentOpeningHours || place.regularOpeningHours || {};
  return Boolean(hours.openNow ?? true);
}

function langForCity(city: string): string {
  const c = city.toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => c.includes(k));
  if (has("kolkata", "siliguri", "rajganj", "asansol")) return "Hindi, English, Bengali";
  if (has("chennai", "coimbatore", "madurai", "trichy")) return "Hindi, English, Tamil";
  if (has("hyderabad", "vizag", "vijayawada", "warangal")) return "Hindi, English, Telugu";
  if (has("bangalore", "bengaluru", "mysore", "hubli")) return "Hindi, English, Kannada";
  if (has("mumbai", "pune", "nagpur", "nashik")) return "Hindi, English, Marathi";
  if (has("ahmedabad", "surat", "vadodara", "rajkot")) return "Hindi, English, Gujarati";
  if (has("kochi", "thiruvananthapuram", "kozhikode")) return "Hindi, English, Malayalam";
  if (has("chandigarh", "amritsar", "ludhiana", "jalandhar")) return "Hindi, English, Punjabi";
  return "Hindi, English";
}

async function placesTextSearch(query: string, maxResultCount: number): Promise<any[]> {
  if (!settings.googlePlacesApiKey) return [];
  const payload = JSON.stringify({
    textQuery: query,
    languageCode: "en",
    regionCode: "IN",
    maxResultCount,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.googlePlacesApiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: payload,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      const body = (await resp.text().catch(() => "")).slice(0, 300);
      console.warn(`Google Places API error ${resp.status}: ${body}`);
      return [];
    }
    const data: any = await resp.json();
    return data.places || [];
  } catch (e) {
    clearTimeout(timer);
    console.warn("Google Places request failed:", (e as Error).message);
    return [];
  }
}

export async function searchDoctorsLive(
  speciality: string,
  city: string,
  limit = 5,
  maxFee: number | null = null
): Promise<DoctorDict[]> {
  if (!settings.googlePlacesApiKey) return [];

  const searchTerm = QUERY_MAP[speciality] ?? `${speciality} clinic`;
  const query = `${searchTerm} in ${city}, India`;
  const places = await placesTextSearch(query, Math.min(limit * 3, 20));
  if (!places.length) {
    console.log(`Google Places: no results for '${query}'`);
    return [];
  }

  const lang = langForCity(city);
  const results: DoctorDict[] = [];

  for (let i = 0; i < places.length; i++) {
    const place = places[i];
    const rawName: string = place.displayName?.text || "";
    if (!rawName) continue;

    const address: string = place.formattedAddress || city;
    const phone: string | null = place.internationalPhoneNumber || null;
    const rating = ratingFromGoogle(place.rating);
    const openNow = isOpenNow(place);
    const placeId: string = place.id || `gp_${i}`;

    const isDoctorName = rawName.toLowerCase().startsWith("dr");
    if (!isDoctorName) continue; // skip pure clinic entries

    const doctorName = rawName.toLowerCase().startsWith("dr.")
      ? rawName
      : `Dr. ${rawName.slice(2).trim()}`;
    const hospital = address.split(",")[0].trim() || city;

    const fee = feeForCity(city, speciality, maxFee);
    const exp = Math.max(5, Math.floor((rating - 3.5) * 10));

    results.push({
      id: `live_${placeId}`,
      name: doctorName,
      speciality,
      hospital,
      city,
      fee,
      rating,
      experience_years: exp,
      available_today: openNow,
      languages: lang,
      // @ts-expect-error — phone is an optional extra field also present on live records
      phone,
    });

    if (results.length >= limit) break;
  }

  console.log(
    `Google Places: ${results.length} doctor results for ${speciality} in ${city} (from ${places.length} places)`
  );
  return results;
}

export async function searchHospitalsLive(
  city: string,
  hospitalType: string | null = null,
  limit = 5
): Promise<HospitalDict[]> {
  if (!settings.googlePlacesApiKey) return [];

  const typeTerm = hospitalType ? `${hospitalType} ` : "";
  const query = `${typeTerm}hospital clinic medical centre in ${city}, India`;
  const places = await placesTextSearch(query, Math.min(limit * 2, 20));

  const results: HospitalDict[] = [];
  for (let i = 0; i < places.length; i++) {
    const place = places[i];
    const name: string = place.displayName?.text || "";
    if (!name) continue;
    const address: string = place.formattedAddress || city;
    const rating = ratingFromGoogle(place.rating);
    const phone: string | null = place.internationalPhoneNumber || null;

    results.push({
      id: `live_hosp_${place.id ?? i}`,
      name,
      city,
      address,
      type: hospitalType ? titleCase(hospitalType) : "Hospital",
      emergency: true,
      phone,
      rating,
      beds: null as unknown as number,
    });
    if (results.length >= limit) break;
  }
  return results;
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}
