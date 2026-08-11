/**
 * Chat service — a single Gemini call per message extracts intent + generates a
 * response; the DB is queried for doctor data, then the reply is formatted.
 * Faithful port of the Python chat.py.
 */
import { settings } from "../config.js";
import { getDoctorRecommendations, findHospitals, type DoctorDict } from "./doctorRepository.js";
import { geminiQuotaBlocked, noteGeminiQuotaError } from "./gemini.js";
import { isMedicineQuery, lookupMedicine } from "./medicineInfo.js";
import {
  extractCondition,
  formatSymptomReply,
  isSymptomInfoQuery,
  lookupSymptomInfo,
  type SymptomInfo,
} from "./symptomInfo.js";

export interface HistoryMessage {
  role: string;
  text: string;
}

export interface ChatResult {
  reply: string;
  intent: string;
  doctors: any[];
  hospitals: any[];
  medicine_info?: any;
  symptom_info?: SymptomInfo;
}

// ── In-memory cache (30 min TTL) ──────────────────────────────────────────
const CACHE = new Map<string, { ts: number; val: any }>();
const CACHE_TTL = 1800 * 1000;

function cacheGet(key: string): any | null {
  const entry = CACHE.get(key);
  if (entry) {
    if (Date.now() - entry.ts < CACHE_TTL) return entry.val;
    CACHE.delete(key);
  }
  return null;
}
function cacheSet(key: string, val: any): void {
  if (CACHE.size > 200) CACHE.delete(CACHE.keys().next().value as string);
  CACHE.set(key, { ts: Date.now(), val });
}

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key={key}";

const COMBINED_PROMPT = (message: string, historyCtx: string) => `You are DOCTAR AI — a health assistant for an Indian healthcare platform.

Given the user message, respond with a JSON object with these fields:
- intent: "find_doctor" | "find_hospital" | "health_advice" | "serious_symptom" | "faq" | "greeting" | "unknown"
- speciality: doctor speciality (exact string from list, or null)
  Valid: "Cardiologist","Dermatologist","Orthopedic","Neurologist","Pediatrician","Gynecologist","Psychiatrist","Diabetologist","ENT Specialist","Ophthalmologist","Dentist","General Physician","Urologist"
- city: Indian city name (title case) or null
- max_fee: integer max fee in rupees or null
- is_serious: true if emergency/serious symptom, false otherwise
- hospital_type: if intent is find_hospital and user specified a type, a short label like "children", "cardiac", "maternity", "eye", "cancer", "trauma", "dental", "orthopedic", "mental health". Otherwise null.
- reply: your natural response (2-4 sentences, warm, helpful)
- generate_doctors: true ONLY if intent is "find_doctor" AND city is a small/tier-2/tier-3 Indian city not likely in the main database. False otherwise.
- doctors: if generate_doctors is true, include an array of 5 realistic doctor objects for that city. Otherwise null.

Doctor object format (when generating):
{"name":"Dr. Full Name","hospital":"Hospital Name in that city","fee":600,"rating":4.4,"experience_years":8,"available_today":true,"languages":"Hindi, English, LocalLanguage"}

Intent rules:
- find_doctor: user EXPLICITLY wants a doctor.
- find_hospital: user wants a hospital, clinic, nursing home, or medical centre. Extract hospital_type if specified.
- health_advice: user is DESCRIBING a symptom without asking for a doctor. Give medicine/remedy advice.
- serious_symptom: chest pain, difficulty breathing, stroke, seizure, severe pain, high fever, heart attack.
- faq: questions about DOCTAR (helpline: +91-8877772277, website: doctar.in)
- greeting: hi/hello/namaste/hey/good morning etc.
- unknown: ONLY for messages completely unrelated to health.
${historyCtx}
IMPORTANT: Respond ONLY with valid JSON. No markdown, no code fences.

User message: ${message}`;

interface Parsed {
  intent: string;
  speciality: string | null;
  city: string | null;
  max_fee: number | null;
  is_serious: boolean;
  generate_doctors: boolean;
  doctors: any[] | null;
  hospital_type?: string | null;
  reply: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Kept in sync with doctorRepository.ts's geminiJsonArray — both run inside
// the /api/chat request path, which the frontend aborts after 15s total
// (see ChatInterface.tsx), so timeout × attempts must stay well under that.
const GEMINI_TIMEOUT_MS = 5000;
const GEMINI_MAX_ATTEMPTS = 2;

async function callGemini(message: string, history?: HistoryMessage[]): Promise<any | null> {
  if (!settings.geminiApiKey) return null;

  const cacheKey = message.toLowerCase().trim();
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // A quota-exhausted key would otherwise cost every message the full retry
  // budget before falling back to the (perfectly good) rule-based parser.
  if (geminiQuotaBlocked()) {
    console.warn("Gemini intent parse skipped — quota cool-down active; using rule-based parser");
    return null;
  }

  let historyCtx = "";
  if (history && history.length) {
    const turns = history.slice(-6);
    const lines = turns.map((h) => `${h.role.toUpperCase()}: ${h.text.slice(0, 150)}`);
    historyCtx = "\nRecent conversation:\n" + lines.join("\n") + "\n";
  }

  const prompt = COMBINED_PROMPT(message, historyCtx);
  const url = GEMINI_URL.replace("{key}", settings.geminiApiKey);
  const payload = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }]}],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
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
        // failure is diagnosable from server logs alone — e.g. an invalid
        // key, a retired model, or a quota/overload message all look
        // identical as a bare status code but very different in the body.
        const body = (await resp.text().catch(() => "")).slice(0, 500);
        if (resp.status === 429) {
          // Quota exhaustion, not transient overload — retrying within this
          // request can only make the user wait longer for the same answer.
          noteGeminiQuotaError(body);
          console.warn(`Gemini 429 (quota) — falling back to rule-based parser: ${body}`);
          return null;
        }
        if (resp.status === 503 && attempt < GEMINI_MAX_ATTEMPTS - 1) {
          const backoff = Math.min(1000 * (attempt + 1), 3000);
          console.warn(`Gemini 503 (overloaded), retrying in ${backoff}ms: ${body}`);
          await sleep(backoff);
          continue;
        }
        console.warn(`Gemini call failed: ${resp.status} ${body}`);
        return null;
      }
      const data: any = await resp.json();
      let raw = String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
      raw = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) raw = match[0];
      const result = JSON.parse(raw);
      cacheSet(cacheKey, result);
      return result;
    } catch (e) {
      clearTimeout(timer);
      console.warn("Gemini call failed:", (e as Error).message);
      return null;
    }
  }
  return null;
}

// ── Keyword matching ──────────────────────────────────────────────────────
function kwMatch(keyword: string, text: string): boolean {
  if (keyword.includes(" ")) return text.includes(keyword);
  return new RegExp("\\b" + escapeRegex(keyword) + "\\b").test(text);
}
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Data tables live in a separate module to keep this file readable.
import {
  MINOR_MEDICINE_MAP,
  CITIES,
  SPECIALITY_KEYWORDS,
  HOSPITAL_TYPE_KEYWORDS,
  HOSPITAL_KEYWORDS,
  FAQ_ABOUT_DOCTAR,
  FAQ_KEYWORDS,
  EMERGENCY_KEYWORDS,
  EMERGENCY_PAT,
  FIRST_AID_KEYWORDS,
  FIRST_AID_STEPS,
  type FirstAidGuide,
  SYMPTOM_HISTORY_MAP,
  SYMPTOM_TO_SPECIALTY_SORTED,
  TYPO_MAP,
  MEDICAL_VOCAB,
  FUZZY_STOP_WORDS,
} from "./chatData.js";

function findInPairs(pairs: Array<[string, string]>, predicate: (k: string) => boolean): string | null {
  for (const [k, v] of pairs) if (predicate(k)) return v;
  return null;
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

function findCity(text: string): string | null {
  for (const c of CITIES) if (text.includes(c)) return titleCase(c);
  return null;
}

// ── Fallback parser (no Gemini key) ───────────────────────────────────────
const DOCTOR_SEEK =
  /\b(doctor|specialist|physician|clinic|hospital|doc|chahiye|batao|dikhao|milao|suggest|recommend|find|search|book|consult)\b/i;
const COMPLAINT_PAT =
  /\b(mujhe|mera|meri|mere|humein|hamara|hamari)\b|\b(ho\s*rha|ho\s*rhi|hota\s*hai|hoti\s*hai|lag\s*rha|lag\s*rhi|aa\s*rha|aa\s*rhi|rehta|rehti|hua|hui|tha|thi)\b|\bi\s+(have|am\s+having|feel|got|suffering|experiencing)\b|\bmy\s+\w+\s+(is|are|hurts|aches|burning|itching|swollen)\b/i;

/**
 * Emergency reply text, with hardcoded home first aid when we recognise the
 * situation. First aid is always framed as what to do *while help is coming* —
 * it never replaces calling 108.
 *
 * "urgent" guides (nosebleed, fainting) lead with the steps instead of a
 * red-alert banner: shouting "MEDICAL EMERGENCY, call an ambulance" at someone
 * with a nosebleed is the fastest way to teach them to ignore the banner when
 * it actually matters.
 */
function emergencyReply(guide?: FirstAidGuide): string {
  const CRITICAL_HEADER =
    "🚨 **This sounds like a medical emergency.** Please call an ambulance (📞 108 / 112) or rush to the nearest emergency hospital right away.";

  if (!guide) {
    return `${CRITICAL_HEADER} Here are emergency hospitals near you:`;
  }

  const steps = guide.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");

  if (guide.severity === "urgent") {
    const parts = [
      `⚡ **First aid for ${guide.label.toLowerCase()} — do this now:**\n${steps}`,
    ];
    if (guide.escalate) parts.push(`🚨 **${guide.escalate}**`);
    parts.push(
      "📞 *If you're unsure or it's getting worse, call 108 — it's always better to check.*\n\nNearby hospitals if you need them:"
    );
    return parts.join("\n\n");
  }

  const parts = [
    CRITICAL_HEADER,
    `⚡ **While help is on the way — ${guide.label.toLowerCase()}:**\n${steps}`,
  ];
  if (guide.escalate) parts.push(`🚨 **${guide.escalate}**`);
  parts.push("*First aid supports emergency care — it does not replace it. Keep 108 on the line if you can.*\n\nEmergency hospitals near you:");
  return parts.join("\n\n");
}

function fallbackParse(message: string): Parsed {
  const lower = message.toLowerCase();

  // True medical emergencies
  if (EMERGENCY_PAT.test(lower)) {
    const hospitalType = findInPairs(EMERGENCY_KEYWORDS, (kw) => lower.includes(kw)) || "emergency";
    const firstAidKey = findInPairs(FIRST_AID_KEYWORDS, (kw) => lower.includes(kw));
    const guide = firstAidKey ? FIRST_AID_STEPS[firstAidKey] : undefined;
    return {
      intent: "emergency", speciality: null, city: null, max_fee: null,
      is_serious: true, generate_doctors: false, doctors: null, hospital_type: hospitalType,
      reply: emergencyReply(guide),
    };
  }

  // FAQ
  if (FAQ_KEYWORDS.some((kw) => lower.includes(kw))) {
    const isContact = ["helpline", "contact", "number", "phone", "website"].some((w) => lower.includes(w));
    const reply = isContact
      ? "You can reach DOCTAR at 📞 +91-8877772277 or visit 🌐 doctar.in."
      : FAQ_ABOUT_DOCTAR;
    return baseParsed("faq", reply);
  }

  const greetings = new Set([
    "hi", "hello", "hey", "namaste", "hii", "helo", "namaskar", "haan", "hanji",
    "kya hal hai", "kaise ho", "kaisa hai", "theek ho", "good morning",
    "good evening", "good afternoon", "good night", "shukriya", "dhanyawad",
    "jai hind", "ram ram", "sat sri akal", "adaab",
  ]);
  if (greetings.has(lower.trim()) || [...greetings].some((g) => lower.startsWith(g + " "))) {
    return baseParsed(
      "greeting",
      "👋 Hello! I'm DOCTAR AI. I can find doctors, hospitals, give health advice, and read prescriptions. How can I help?"
    );
  }

  let speciality = findInPairs(SPECIALITY_KEYWORDS, (k) => kwMatch(k, lower));
  let city = findCity(lower);
  if (!city) {
    const m = message.match(/\bin\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
    if (m) city = titleCase(m[1]);
    else {
      const m2 = lower.match(/\bin\s+([a-z][a-z]+(?:\s+[a-z]+)?)\b/);
      if (m2) city = titleCase(m2[1]);
    }
  }

  const feeM = lower.match(/(?:under|below|₹|rs\.?)\s*(\d+)/);
  const maxFee = feeM ? parseInt(feeM[1], 10) : null;

  // Hospital query
  if (HOSPITAL_KEYWORDS.some((kw) => lower.includes(kw))) {
    const hospitalType = findInPairs(HOSPITAL_TYPE_KEYWORDS, (kw) => lower.includes(kw));
    const typeLabel = hospitalType ? `${hospitalType} ` : "";
    return {
      intent: "find_hospital", speciality: null, city, max_fee: null,
      is_serious: false, generate_doctors: false, doctors: null, hospital_type: hospitalType,
      reply: `Searching for ${typeLabel}hospitals${city ? ` in ${city}` : ""}...`,
    };
  }

  const isComplaint = COMPLAINT_PAT.test(lower);
  const isDoctorSeek = DOCTOR_SEEK.test(lower);

  if (isComplaint && !isDoctorSeek && !city) {
    for (const [kw, advice] of MINOR_MEDICINE_MAP) {
      if (lower.includes(kw)) return adviceParsed(advice);
    }
    if (speciality) {
      return {
        intent: "health_advice", speciality, city: null, max_fee: null,
        is_serious: false, generate_doctors: false, doctors: null,
        reply: `For this issue, it's best to consult a **${speciality}**. In the meantime, rest well and stay hydrated. If symptoms are severe, please see a doctor immediately.\n\n⚠️ *Type "${speciality} near me" to find one.*`,
      };
    }
  }

  if (!isDoctorSeek && !city) {
    for (const [kw, advice] of MINOR_MEDICINE_MAP) {
      if (lower.includes(kw)) return adviceParsed(advice);
    }
  }

  if (speciality || city) {
    return {
      intent: "find_doctor", speciality, city, max_fee: maxFee,
      is_serious: false, generate_doctors: false, doctors: null,
      reply: `Searching for ${speciality || "doctors"}${city ? ` in ${city}` : ""}...`,
    };
  }

  for (const [kw, advice] of MINOR_MEDICINE_MAP) {
    if (lower.includes(kw)) return adviceParsed(advice);
  }

  return baseParsed(
    "unknown",
    'I\'m not sure I understood that. I can help with:\n• 🔍 **Finding doctors** — e.g. *"cardiologist in Delhi"*\n• 🏥 **Finding hospitals** — e.g. *"hospitals in Pune"*\n• 💊 **Health advice** — e.g. *"I have a headache"*\n• 📋 **Reading prescriptions** — tap the 📎 button\n\nCould you rephrase your question?'
  );
}

/**
 * Overlay Gemini's parse on the rule-based one.
 *
 * Gemini wins on every field it actually answered, but a null/undefined from
 * it must NOT erase what the rule-based parser already extracted. A plain
 * `{...fast, ...gemini}` spread did erase it: asked about "dermatologist in
 * Jharkhand", Gemini returns city:null (Jharkhand is a state, not a city),
 * which wiped the perfectly usable "Jharkhand" the parser had found and
 * dead-ended the search on "no doctors found" — a false negative caused
 * purely by the merge, not by the data.
 */
function mergeParsed(fast: Parsed, gemini: Record<string, unknown>): Parsed {
  const merged: Record<string, unknown> = { ...fast };
  for (const [key, value] of Object.entries(gemini)) {
    if (value !== null && value !== undefined) merged[key] = value;
  }
  return merged as unknown as Parsed;
}

function baseParsed(intent: string, reply: string): Parsed {
  return { intent, speciality: null, city: null, max_fee: null, is_serious: false, generate_doctors: false, doctors: null, reply };
}
function adviceParsed(advice: string): Parsed {
  return baseParsed(
    "health_advice",
    `💡 **Home Care Tip:** ${advice}\n\n⚠️ *These are general home care tips only. Please see a doctor if symptoms persist or worsen.*`
  );
}

// ── History helpers ───────────────────────────────────────────────────────
function extractLastSearch(history: HistoryMessage[]): [string | null, string | null] {
  if (!history.length) return [null, null];
  for (let i = history.length - 1; i >= 0; i--) {
    const text = (history[i].text || "").toLowerCase();
    const speciality = findInPairs(SPECIALITY_KEYWORDS, (k) => kwMatch(k, text));
    const city = findCity(text);
    if (speciality || city) return [speciality, city];
    for (const [symptom, spec] of SYMPTOM_HISTORY_MAP) {
      if (text.includes(symptom)) return [spec, city];
    }
  }
  return [null, null];
}

// Note: "(get me|find me|show me|book|nearby|near me)" is deliberately NOT in
// this pattern — those are generic request phrasings, not a genuine reference
// back to the prior topic, and treating them as a follow-up signal is what
// let a fresh "show me a doctor near me" inherit a stale speciality (see
// resolveFollowupSpeciality below).
const FOLLOWUP_PAT =
  /\b(for it|for this|for that|for the same|about it|about this|about that)\b|\b(same|those|them|the same|above|mentioned)\b/i;
const PRONOUN_PAT = /\b(it|this|that|same|them|those|the same|above)\b/i;
const FRESH_TOPIC_PAT =
  /\b(fever|headache|cough|cold|heart|skin|eye|ear|tooth|teeth|diabetes|kidney|stomach|back|knee|joint|pregnancy|period|anxiety|depression|sugar|thyroid|bukhar|khansi|pet dard|sar dard|sir dard|dil|seena|ghutna|kamar|aankh|daant|kaan|naak|gala|chamdi)\b/i;

function isFollowupMessage(text: string): boolean {
  const words = text.trim().split(/\s+/);
  if (words.length >= 12) return false;
  const hasSignal = PRONOUN_PAT.test(text) || FOLLOWUP_PAT.test(text);
  if (!hasSignal) return false;
  if (FRESH_TOPIC_PAT.test(text)) return false;
  return true;
}

function extractSpecialtyFromHistory(history: HistoryMessage[]): [string | null, string | null] {
  if (!history.length) return [null, null];
  for (let i = history.length - 1; i >= 0; i--) {
    const text = (history[i].text || "").toLowerCase();
    const city = findCity(text);
    const speciality = findInPairs(SPECIALITY_KEYWORDS, (k) => kwMatch(k, text));
    if (speciality) return [speciality, city];
    for (const [symptom, spec] of SYMPTOM_TO_SPECIALTY_SORTED) {
      if (text.includes(symptom)) return [spec, city];
    }
  }
  return [null, null];
}

/** Speciality/symptom mentioned in THIS message alone — never from history. */
function specialityFromText(text: string): string | null {
  const lower = text.toLowerCase();
  const speciality = findInPairs(SPECIALITY_KEYWORDS, (k) => kwMatch(k, lower));
  if (speciality) return speciality;
  for (const [symptom, spec] of SYMPTOM_TO_SPECIALTY_SORTED) {
    if (lower.includes(symptom)) return spec;
  }
  return null;
}

/** Speciality mentioned in the LAST history entry only (the immediately preceding turn). */
function lastTurnSpecialty(history: HistoryMessage[]): string | null {
  if (!history.length) return null;
  const text = (history[history.length - 1].text || "").toLowerCase();
  const speciality = findInPairs(SPECIALITY_KEYWORDS, (k) => kwMatch(k, text));
  if (speciality) return speciality;
  for (const [symptom, spec] of SYMPTOM_TO_SPECIALTY_SORTED) {
    if (text.includes(symptom)) return spec;
  }
  return null;
}

/**
 * Resolve which speciality (if any) a follow-up-shaped doctor request should
 * use. Priority:
 *   1. A speciality/symptom named in THIS message — always wins.
 *   2. A genuine reference back to the prior topic (a pronoun like "it"/
 *      "that", or an explicit "more/another doctor" request) — trusts the
 *      full history scan (deepSpec), same as before.
 *   3. Otherwise this is a generically-phrased fresh request (e.g. "find
 *      doctors near me" clicked via the near-me chip) — only the speciality
 *      from the LAST turn counts, so a mention from further back (across an
 *      unrelated exchange in between) is never silently reused.
 */
function resolveFollowupSpeciality(
  text: string,
  history: HistoryMessage[],
  deepSpec: string | null
): string | null {
  const ownSpec = specialityFromText(text);
  if (ownSpec) return ownSpec;
  if (PRONOUN_PAT.test(text) || FOLLOWUP_PAT.test(text) || MORE_DOCTORS_PAT.test(text)) {
    return deepSpec;
  }
  return lastTurnSpecialty(history);
}

// ── Typo tolerance ────────────────────────────────────────────────────────
/** difflib.SequenceMatcher-style ratio (Ratcliff/Obershelp). */
function seqRatio(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const matches = matchingBlocksLength(a, b);
  return (2.0 * matches) / (a.length + b.length);
}
function matchingBlocksLength(a: string, b: string): number {
  // Recursive longest-matching-block (approximation of difflib).
  if (!a.length || !b.length) return 0;
  let bestI = 0, bestJ = 0, bestSize = 0;
  const j2len: Record<number, number> = {};
  for (let i = 0; i < a.length; i++) {
    const newj2len: Record<number, number> = {};
    for (let j = 0; j < b.length; j++) {
      if (a[i] === b[j]) {
        const k = (j > 0 ? j2len[j - 1] || 0 : 0) + 1;
        newj2len[j] = k;
        if (k > bestSize) { bestI = i - k + 1; bestJ = j - k + 1; bestSize = k; }
      }
    }
    for (const key in newj2len) j2len[Number(key)] = newj2len[Number(key)];
    for (const key in j2len) if (!(key in newj2len)) delete j2len[Number(key)];
  }
  if (bestSize === 0) return 0;
  return (
    bestSize +
    matchingBlocksLength(a.slice(0, bestI), b.slice(0, bestJ)) +
    matchingBlocksLength(a.slice(bestI + bestSize), b.slice(bestJ + bestSize))
  );
}

function getCloseMatch(word: string, vocab: string[], cutoff: number): string | null {
  let best: string | null = null;
  let bestScore = cutoff;
  for (const v of vocab) {
    const score = seqRatio(word, v);
    if (score >= bestScore) { bestScore = score; best = v; }
  }
  return best;
}

/**
 * Every word appearing in any phrase the rule-based matcher understands.
 *
 * These are real domain vocabulary and must never be "corrected" into
 * something else. Without this guard the word-level pass silently rewrote
 * meaningful terms into near-neighbours from MEDICAL_VOCAB — "mental" became
 * "dental" (0.83 similarity), so "mental health doctor" routed to a Dentist
 * instead of a Psychiatrist. Protecting known-good words is a far more robust
 * fix than trying to enumerate every bad pair.
 */
const PROTECTED_WORDS: Set<string> = (() => {
  const set = new Set<string>();
  const addPhrase = (p: string) => {
    for (const w of p.toLowerCase().split(/\s+/)) {
      const clean = w.replace(/[^a-z]/g, "");
      if (clean.length >= 3) set.add(clean);
    }
  };
  for (const [k] of SPECIALITY_KEYWORDS) addPhrase(k);
  for (const [k] of SYMPTOM_HISTORY_MAP) addPhrase(k);
  for (const [k] of MINOR_MEDICINE_MAP) addPhrase(k);
  for (const [k] of EMERGENCY_KEYWORDS) addPhrase(k);
  for (const [k] of HOSPITAL_TYPE_KEYWORDS) addPhrase(k);
  for (const kw of HOSPITAL_KEYWORDS) addPhrase(kw);
  for (const c of CITIES) addPhrase(c);
  return set;
})();

function fuzzyCorrectWord(word: string): string {
  if (word.length < 5) return word;
  const lw = word.toLowerCase();
  if (FUZZY_STOP_WORDS.has(lw)) return word;
  if (MEDICAL_VOCAB.includes(lw)) return word;
  if (PROTECTED_WORDS.has(lw)) return word;
  const match = getCloseMatch(lw, MEDICAL_VOCAB, 0.82);
  return match ?? word;
}

// ── Hinglish phrase correction ────────────────────────────────────────────
// fuzzyCorrectWord above only rescues single English words against
// MEDICAL_VOCAB. The Hinglish tables are matched by exact substring, so a
// misspelt *phrase* ("shir dard" for "sir dard", "pait dard" for "pet dard")
// used to hit neither mechanism and dead-ended on "I didn't understand that".
//
// Two stages, cheapest and most precise first:
//   1. Transliteration-normalised exact match. Roman Hindi drifts in
//      predictable ways (sh/s, ph/f, z/j, v/w, aa/a, ai/e, doubled letters,
//      spacing), so normalising both sides and comparing exactly catches most
//      real-world drift with no false-positive risk.
//   2. Ratcliff/Obershelp fuzzy match for genuine typos the normaliser can't
//      model ("pet me dard" → "pet mein dard").

/** Every phrase the rule-based matcher understands, longest-specific first. */
const FUZZY_PHRASES: string[] = (() => {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (k: string) => {
    const key = k.toLowerCase().trim();
    if (key && !seen.has(key)) { seen.add(key); out.push(key); }
  };
  for (const [k] of SPECIALITY_KEYWORDS) add(k);
  for (const [k] of SYMPTOM_HISTORY_MAP) add(k);
  for (const [k] of MINOR_MEDICINE_MAP) add(k);
  // Emergency phrases too — a typo'd "chest pian" should still reach the
  // emergency branch rather than falling through to "I didn't understand".
  for (const [k] of EMERGENCY_KEYWORDS) add(k);
  return out;
})();

/** Collapse predictable Roman-Hindi transliteration drift to a comparison key. */
function translitKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z]/g, "")   // also drops spaces: "sirdard" ≡ "sir dard"
    .replace(/ph/g, "f")
    .replace(/sh/g, "s")
    .replace(/z/g, "j")
    .replace(/v/g, "w")
    .replace(/ee/g, "i")
    .replace(/oo/g, "u")
    .replace(/ai/g, "e")
    .replace(/(.)\1+/g, "$1")  // doubled letters → single (bukhaar → bukhar)
    .replace(/y$/, "i");
}

/** Speciality a phrase resolves to, for collision detection. */
function phraseSpeciality(phrase: string): string | null {
  for (const [k, v] of SPECIALITY_KEYWORDS) if (k === phrase) return v;
  for (const [k, v] of SYMPTOM_HISTORY_MAP) if (k === phrase) return v;
  return null;
}

/**
 * translit key → canonical phrase. Keys claimed by phrases that mean
 * genuinely different things are dropped rather than guessed at — silently
 * rewriting "pair mein dard" (leg) to "pet mein dard" (stomach) would be
 * worse than not correcting at all.
 */
const TRANSLIT_INDEX: Map<string, string> = (() => {
  const byKey = new Map<string, string[]>();
  for (const phrase of FUZZY_PHRASES) {
    const key = translitKey(phrase);
    if (key.length < 4) continue;   // too short to disambiguate safely
    const list = byKey.get(key);
    if (list) list.push(phrase);
    else byKey.set(key, [phrase]);
  }

  const index = new Map<string, string>();
  for (const [key, phrases] of byKey) {
    if (phrases.length === 1) { index.set(key, phrases[0]); continue; }
    const specialities = new Set(phrases.map(phraseSpeciality).filter(Boolean));
    if (specialities.size > 1) continue;   // ambiguous — don't guess
    index.set(key, phrases[0]);            // same meaning; first is most specific
  }
  return index;
})();

/**
 * Sorted-letter key, for catching transposition typos ("bukahr" → "bukhar").
 *
 * Adjacent-key swaps are among the most common typos, but Ratcliff/Obershelp
 * scores them badly — "bukahr"/"bukhar" is only 0.83, below the cutoff — and
 * lowering the cutoff far enough to catch them lets meaning-changing pairs
 * through. Comparing letter multisets targets exactly transpositions and
 * nothing else.
 */
function anagramKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "").split("").sort().join("");
}

/** Anagram key → canonical phrase; ambiguous keys dropped, as with translit. */
const ANAGRAM_INDEX: Map<string, string> = (() => {
  const byKey = new Map<string, string[]>();
  for (const phrase of FUZZY_PHRASES) {
    const key = anagramKey(phrase);
    if (key.length < 5) continue;
    const list = byKey.get(key);
    if (list) list.push(phrase);
    else byKey.set(key, [phrase]);
  }
  const index = new Map<string, string>();
  for (const [key, phrases] of byKey) {
    if (phrases.length === 1) { index.set(key, phrases[0]); continue; }
    const specialities = new Set(phrases.map(phraseSpeciality).filter(Boolean));
    if (specialities.size > 1) continue;
    index.set(key, phrases[0]);
  }
  return index;
})();

const MAX_PHRASE_WORDS = 4;
// 0.90, not 0.85. At 0.85 meaning-changing near-neighbours slipped through —
// "pain doctor"/"brain doctor" score 0.87 and "health doctor"/"heart doctor"
// 0.88. Genuine typos ("chest pian", "hart attack", "kamar dardh") all still
// score ≥ 0.90, so the tighter cutoff costs nothing real.
const PHRASE_FUZZY_CUTOFF = 0.9;
/** Below this, a fuzzy edit is as likely to change meaning as to fix a typo. */
const MIN_FUZZY_PHRASE_LEN = 6;
/** Candidates bucketed by word count so an n-gram only compares against its own size. */
const PHRASES_BY_WORD_COUNT: Map<number, string[]> = (() => {
  const m = new Map<number, string[]>();
  for (const p of FUZZY_PHRASES) {
    const n = p.split(/\s+/).length;
    if (n > MAX_PHRASE_WORDS) continue;
    const list = m.get(n);
    if (list) list.push(p);
    else m.set(n, [p]);
  }
  return m;
})();

const CANONICAL_PHRASES = new Set(FUZZY_PHRASES);

/** Best fuzzy phrase match for an n-gram, or null. */
function closestPhrase(gram: string, wordCount: number): string | null {
  const candidates = PHRASES_BY_WORD_COUNT.get(wordCount);
  if (!candidates) return null;
  let best: string | null = null;
  let bestScore = PHRASE_FUZZY_CUTOFF;
  for (const cand of candidates) {
    // Cheap length gate — a phrase differing by >30% in length can't clear
    // the cutoff, and skipping it avoids the O(n²) block match.
    if (Math.abs(cand.length - gram.length) / Math.max(cand.length, gram.length) > 0.3) continue;
    const score = seqRatio(gram, cand);
    if (score >= bestScore) { bestScore = score; best = cand; }
  }
  return best;
}

/** Rewrite misspelt Hinglish/English symptom phrases to their canonical form. */
function fuzzyCorrectPhrases(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return text;

  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    let consumed = 0;
    let replacement: string | null = null;

    // Longest n-gram first, so "sir mein dard" wins over "dard".
    for (let n = Math.min(MAX_PHRASE_WORDS, words.length - i); n >= 1 && !replacement; n--) {
      const slice = words.slice(i, i + n);
      const gram = slice.join(" ").toLowerCase();

      // Already canonical — emit it verbatim and consume the WHOLE phrase.
      // Consuming only the first word here used to leave the tail to be
      // re-scanned on its own, and a fragment of a good phrase fuzzy-matches
      // dangerously well: "chest pain doctor" → "chest" + "pain doctor",
      // and "pain doctor" then matched "brain doctor".
      if (CANONICAL_PHRASES.has(gram)) {
        out.push(...slice);
        consumed = n;
        replacement = "";   // sentinel: handled, don't fall through
        break;
      }
      if (slice.every((w) => FUZZY_STOP_WORDS.has(w.toLowerCase()))) continue;
      if (gram.replace(/[^a-z]/gi, "").length < 4) continue;

      const key = translitKey(gram);
      const viaTranslit = key.length >= 4 ? TRANSLIT_INDEX.get(key) : undefined;
      if (viaTranslit && viaTranslit !== gram) {
        replacement = viaTranslit;
        consumed = n;
        break;
      }

      const anaKey = anagramKey(gram);
      const viaAnagram = anaKey.length >= 5 ? ANAGRAM_INDEX.get(anaKey) : undefined;
      if (viaAnagram && viaAnagram !== gram) {
        replacement = viaAnagram;
        consumed = n;
        break;
      }

      if (gram.length >= MIN_FUZZY_PHRASE_LEN) {
        const viaFuzzy = closestPhrase(gram, n);
        if (viaFuzzy && viaFuzzy !== gram) {
          replacement = viaFuzzy;
          consumed = n;
        }
      }
    }

    if (replacement) {
      out.push(replacement);
      i += consumed;
    } else if (consumed) {
      i += consumed;   // canonical phrase already pushed above
    } else {
      out.push(words[i]);
      i += 1;
    }
  }
  return out.join(" ");
}

/** Exported for tests — the typo/phrase pipeline is easiest to tune in isolation. */
export function normalizeTypos(text: string): string {
  for (const [pattern, replacement] of TYPO_MAP) {
    text = text.replace(pattern, replacement);
  }
  const wordCorrected = text.split(/\s+/).map(fuzzyCorrectWord).join(" ");
  return fuzzyCorrectPhrases(wordCorrected);
}

// Tightened to require an actual doctor/specialist mention alongside "more/
// other/another" — previously the doctor-word was optional in the first
// alternative, so this pattern (and thus the "more doctors" branch below)
// could fire on any unrelated mention of "more/other/different".
const MORE_DOCTORS_PAT =
  /\b(more|other|another|show more|need more|give more|any more|different)\b.*\b(doctor|specialist|physician|doc)\b|\b(doctor|specialist|physician|doc)\b.*\b(more|other|another)\b|aur\s+doctor|aur\s+dikhao|ek\s+aur\s+doctor|aur\s+batao/i;
const SUGGEST_DOCTOR_PAT =
  /\b(suggest|recommend|refer|advise|give|find|show|get)\b.{0,20}\b(doctor|specialist|physician|doc)\b|\b(doctor|specialist|physician|doc)\b.{0,20}\b(for (it|this|that|same|the pain|the issue|the problem))\b|doctor\s+(chahiye|batao|dikhao|milao|do|chahie|chayiye|lagao)|koi\s+(accha\s+)?doctor|accha\s+doctor|doctor\s+suggest\s+karo|doctor\s+se\s+milna/i;
const NEAR_ME_PAT = /\bnear\s+me\b|\bnearby\b|\bnear\s+my\s+(?:location|area|place|home)\b/i;

/**
 * Search for doctors for a follow-up-style query.
 *
 * This deliberately goes through getDoctorRecommendations rather than doing
 * its own fallback, so every branch of handleMessage gets the identical
 * chain (local DB → Google Places → Gemini → deterministic mock). Under
 * USE_REAL_DOCTOR_DB (a shared production DB — never generate doctors there)
 * that chain stops after the DB lookup, and an exact (speciality, city) match
 * can legitimately come back empty even when the city itself is fine; retry
 * with speciality cleared to surface any real doctor listed in that city
 * before giving up entirely.
 */
async function searchFollowupDoctors(
  speciality: string | null,
  city: string | null
): Promise<{ doctors: DoctorDict[]; isGenerated: boolean; broadenedFrom: string | null }> {
  const exact = await getDoctorRecommendations(speciality, city, null);
  if (exact.doctors.length || !speciality || !city) {
    return { doctors: exact.doctors, isGenerated: exact.isGenerated, broadenedFrom: null };
  }
  const broadened = await getDoctorRecommendations(null, city, null);
  return { doctors: broadened.doctors, isGenerated: broadened.isGenerated, broadenedFrom: speciality };
}

/** Builds the follow-up reply text, honestly reflecting broadened/empty results. */
function followupReplyText(
  verb: string,
  speciality: string | null,
  city: string | null,
  doctors: DoctorDict[],
  isGenerated: boolean,
  broadenedFrom: string | null
): string {
  const note = isGenerated ? "\n\n⚠️ *AI-generated results — verify before visiting.*" : "";
  if (doctors.length) {
    if (broadenedFrom) {
      return `We don't have a **${broadenedFrom}** listed in **${city}** yet, but here are other doctors available there:${note}`;
    }
    const desc = [speciality, city ? `in ${city}` : null].filter(Boolean).join(" ");
    return `${verb} **${desc || "doctors"}** for you:${note}`;
  }
  if (city) {
    return `We don't have any verified doctors listed in **${city}** yet — try a nearby city or a different search.`;
  }
  return `Looking for **${speciality || "doctors"}**... try adding your city for better results.`;
}

// ── Main handler ──────────────────────────────────────────────────────────
export async function handleMessage(
  message: string,
  history: HistoryMessage[] = [],
  userCity: string | null = null
): Promise<ChatResult> {
  let text = normalizeTypos(message.trim());

  // Medicine information query
  if (isMedicineQuery(message.trim())) {
    console.log(`💊 Medicine query detected: ${message.slice(0, 60)}`);
    const info = await lookupMedicine(message.trim());
    const usedFor = (info.used_for || []).slice(0, 3).join(", ");
    const otcText = info.available_otc ? "✅ Available without prescription (OTC)" : "🔒 Prescription required";
    const sideFx = (info.common_side_effects || []).slice(0, 3).join(", ") || "Generally well-tolerated";
    const replyMd =
      `### 💊 ${info.name}\n` +
      `**Type:** ${info.type ?? "—"}\n\n` +
      `**Used for:** ${usedFor}\n\n` +
      `**How it works:** ${info.how_it_works ?? "—"}\n\n` +
      `**Dosage:** ${info.common_dosage ?? "—"}\n\n` +
      `**${otcText}**\n\n` +
      `**Common side effects:** ${sideFx}\n\n` +
      `⚠️ **Warning:** ${info.warnings ?? "—"}\n\n` +
      `🩺 **See a doctor if:** ${info.consult_doctor_if ?? "—"}\n\n` +
      `*${info.disclaimer ?? ""}*`;
    return { reply: replyMd, intent: "medicine_info", doctors: [], hospitals: [], medicine_info: info };
  }

  // Symptom / condition information query ("symptoms of dengue"). Checked
  // before fallbackParse so an informational question about an emergency
  // condition ("heart attack symptoms") returns the symptom list rather than
  // being swept into the emergency flow by EMERGENCY_PAT. The reply still
  // leads with the 108 red flags — see symptomInfo.ts.
  if (isSymptomInfoQuery(message.trim())) {
    const condition = extractCondition(message.trim());
    console.log(`🩺 Symptom info query detected: ${condition}`);
    const info = await lookupSymptomInfo(condition);
    return {
      reply: formatSymptomReply(info),
      intent: "symptom_info",
      doctors: [],
      hospitals: [],
      symptom_info: info,
    };
  }

  // "near me" → substitute user's city
  if (NEAR_ME_PAT.test(text)) {
    if (userCity) {
      text = text.replace(NEAR_ME_PAT, `in ${userCity}`);
    } else {
      return {
        reply: "📍 I need your location to find nearby results. Please tap the 📍 button in the chat bar to share your location, then try again.",
        intent: "location_required", doctors: [], hospitals: [],
      };
    }
  }

  // Follow-up context resolution
  if (isFollowupMessage(text) && history.length) {
    const [deepSpec, ctxCity] = extractSpecialtyFromHistory(history);
    const ctxSpec = resolveFollowupSpeciality(text, history, deepSpec);
    const curCity = findCity(text.toLowerCase()) || ctxCity || userCity;
    if (ctxSpec) {
      const { doctors, isGenerated, broadenedFrom } = await searchFollowupDoctors(ctxSpec, curCity);
      const replyTxt = followupReplyText("Here are", ctxSpec, curCity, doctors, isGenerated, broadenedFrom);
      return { reply: replyTxt, intent: "find_doctor", doctors, hospitals: [] };
    }
  }

  // "more doctors" → repeat last search, broadening beyond the exact
  // speciality if the real DB has nothing for it. Falls through to the
  // general parser if genuinely nothing is available (unchanged from before).
  if (MORE_DOCTORS_PAT.test(text)) {
    const [deepSpec, histCity] = extractLastSearch(history);
    const spec = resolveFollowupSpeciality(text, history, deepSpec);
    const city = histCity || userCity;
    if (spec || city) {
      const { doctors, isGenerated, broadenedFrom } = await searchFollowupDoctors(spec, city);
      if (doctors.length) {
        const replyTxt = followupReplyText("Here are more", spec, city, doctors, isGenerated, broadenedFrom);
        return { reply: replyTxt, intent: "find_doctor", doctors, hospitals: [] };
      }
    }
  }

  // "suggest a doctor for it" / generic "find a doctor" requests. Only a
  // genuine reference to the prior topic (pronoun, "more of the same", or
  // the current message's own speciality/symptom) may pull a speciality from
  // history — otherwise (e.g. "find doctors near me" with no such signal)
  // this resolves to the speciality mentioned in the LAST turn only, so a
  // stale mention from further back (across an unrelated exchange) is never
  // silently reused.
  if (SUGGEST_DOCTOR_PAT.test(text)) {
    const [deepSpec, histCity] = extractLastSearch(history);
    const spec = resolveFollowupSpeciality(text, history, deepSpec);
    const curCity = findCity(text.toLowerCase()) || histCity || userCity;
    if (spec || curCity) {
      const { doctors, isGenerated, broadenedFrom } = await searchFollowupDoctors(spec, curCity);
      const reply = followupReplyText("Sure! Here are", spec, curCity, doctors, isGenerated, broadenedFrom);
      return { reply, intent: "find_doctor", doctors, hospitals: [] };
    }
  }

  // Rule-based first — Gemini only for doctor/hospital searches with a city
  console.log(`💬 CHAT  msg=${text.slice(0, 80)}`);
  const fast = fallbackParse(text);
  const fastIntent = fast.intent;

  let parsed: Parsed;
  if (["greeting", "faq", "health_advice", "unknown", "emergency"].includes(fastIntent)) {
    parsed = fast;
  } else if (["find_doctor", "find_hospital"].includes(fastIntent) && fast.city) {
    const geminiResult = await callGemini(text, history);
    if (geminiResult && geminiResult.intent !== "unknown") {
      parsed = mergeParsed(fast, geminiResult);
    } else {
      parsed = fast;
    }
  } else {
    parsed = fast;
  }

  let intent = parsed.intent ?? "unknown";
  let speciality = parsed.speciality ?? null;
  let city = parsed.city ?? null;

  // Inherit speciality/city from history for bare find_doctor
  if (intent === "find_doctor" && !speciality) {
    const [histSpec, histCity] = extractLastSearch(history);
    if (histSpec) speciality = histSpec;
    if (!city && histCity) city = histCity;
  }

  // Sanity-check speciality against the raw message (explicit keyword wins)
  if (["find_doctor", "serious_symptom", "health_advice"].includes(intent)) {
    const lowerText = text.toLowerCase();
    const sorted = [...SPECIALITY_KEYWORDS].sort((a, b) => b[0].length - a[0].length);
    for (const [kw, spec] of sorted) {
      if (kwMatch(kw, lowerText)) {
        if (speciality !== spec) speciality = spec;
        break;
      }
    }
  }

  const maxFee = parsed.max_fee ?? null;
  const isSerious = parsed.is_serious ?? false;
  let reply = parsed.reply ?? "Sorry, I couldn't understand that. Please try again.";
  const geminiDoctors = parsed.doctors || [];

  if (["greeting", "faq", "unknown"].includes(intent)) {
    return { reply, intent, doctors: [], hospitals: [] };
  }

  // Emergency
  if (intent === "emergency") {
    const searchCity = city || userCity || "";
    const hospitalType = parsed.hospital_type || "emergency";
    if (!searchCity) {
      return {
        reply: reply + "\n\n📍 Tap the 📍 button to share your location so I can find the nearest emergency hospitals.",
        intent: "emergency", doctors: [], hospitals: [],
      };
    }
    const { hospitals, isGenerated } = await findHospitals(searchCity, 5, hospitalType);
    if (isGenerated && hospitals.length) {
      reply += "\n\n⚠️ *These results are AI-generated — call 108 for verified ambulance dispatch and emergency guidance.*";
    }
    return { reply, intent: "emergency", doctors: [], hospitals };
  }

  // Hospital search
  if (intent === "find_hospital") {
    const searchCity = city || userCity || "";
    const hospitalType = parsed.hospital_type ?? null;
    const { hospitals, isGenerated } = await findHospitals(searchCity, 5, hospitalType);
    if (!hospitals.length) {
      const typeLabel = hospitalType ? `${hospitalType} ` : "";
      return {
        reply: `❌ No ${typeLabel}hospitals found${searchCity ? ` in ${searchCity}` : ""}. Try mentioning your city, e.g. *"${typeLabel}hospitals in Pune"*.`,
        intent: "not_found", doctors: [], hospitals: [],
      };
    }
    if (isGenerated) reply += "\n\n⚠️ *These results are AI-generated. Verify details before visiting.*";
    return { reply, intent, doctors: [], hospitals };
  }

  // Health advice
  if (intent === "health_advice" && !isSerious) {
    const showDoctors = ["doctor", "specialist", "consult", "see a", "visit"].some((w) =>
      reply.toLowerCase().includes(w)
    );
    let doctors: any[] = [];
    if (showDoctors && speciality) {
      doctors = (await getDoctorRecommendations(speciality, city || userCity, null)).doctors;
    }
    return { reply, intent, doctors, hospitals: [] };
  }

  // find_doctor / serious_symptom. `userCity` (shared GPS location) stands in
  // when the message named no city — same substitution the hospital branch
  // above already does.
  const searchCity = city || userCity;
  let { doctors, isGenerated, resolvedCity, assumedSpeciality } =
    await getDoctorRecommendations(speciality, searchCity, maxFee);

  if (!doctors.length && Array.isArray(geminiDoctors) && geminiDoctors.length) {
    doctors = geminiDoctors
      .filter((d) => d && typeof d === "object")
      .map((d, i) => ({
        id: `ai_${city}_${speciality}_${i}`.replace(/ /g, "_").replace(/None/g, "x"),
        name: String(d.name ?? `Dr. Specialist ${i + 1}`),
        speciality: speciality || "",
        hospital: String(d.hospital ?? "City Hospital"),
        city: city || "",
        fee: parseInt(d.fee ?? 600, 10) || 600,
        rating: parseFloat(d.rating ?? 4.3) || 4.3,
        experience_years: parseInt(d.experience_years ?? 8, 10) || 8,
        available_today: Boolean(d.available_today ?? true),
        languages: String(d.languages ?? "Hindi, English"),
      }));
    isGenerated = true;
  }

  // A city-only search ("doctors in Kolkata") is answered by the repository's
  // own fallback chain now, so there is no branch-local mock generation left
  // here to bypass USE_REAL_DOCTOR_DB — it just reports what it assumed.
  if (doctors.length && assumedSpeciality && searchCity) {
    reply += `\n\n📍 *Showing available doctors in ${searchCity}.*`;
  }

  if (intent === "find_doctor" && !doctors.length) {
    const parts = [speciality, searchCity ? `in ${searchCity}` : null, maxFee ? `under ₹${maxFee}` : null].filter(Boolean);
    const hint = searchCity
      ? `Try a nearby city, or a specific speciality like *"Gynecologist in ${searchCity}"*.`
      : `Try adding your city, e.g. *"Gynecologist in Deoghar"*.`;
    return {
      reply: `❌ Sorry, no **${parts.length ? parts.join(" ") : "matching"}** doctors found. ${hint}`,
      intent: "not_found", doctors: [], hospitals: [],
    };
  }

  if (doctors.length && searchCity && resolvedCity && resolvedCity.toLowerCase() !== searchCity.toLowerCase()) {
    reply += `\n\n📍 *No doctors found specifically in ${searchCity}. Showing results from nearby ${resolvedCity}.*`;
  }

  if (isGenerated && doctors.length) {
    reply += "\n\n⚠️ *These results are AI-generated. Verify details before booking.*";
  }

  return { reply, intent, doctors, hospitals: [] };
}
