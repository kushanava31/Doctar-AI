/**
 * Symptom / condition information service.
 *
 * Answers "what are the symptoms of X" style questions. Deliberately distinct
 * from a *complaint* ("I have chest pain", "mujhe bukhar hai"), which must keep
 * routing to the emergency / health-advice flow in chat.ts — see
 * isSymptomInfoQuery below for how the two are told apart.
 *
 * Same shape as medicineInfo.ts: intent detection → cache → built-in DB →
 * Gemini real-time lookup → generic fallback.
 *
 * SAFETY: someone typing "heart attack symptoms" may well be checking on a
 * person in front of them right now. Every response therefore leads with
 * emergency warning signs and the 108 instruction — both in the built-in
 * entries and in the Gemini prompt's required schema.
 */
import { geminiAvailable, geminiGenerate } from "./gemini.js";

export interface SymptomInfo {
  condition: string;
  common_symptoms: string[];
  /** Red flags that mean "call an ambulance now", not "book an appointment". */
  emergency_signs: string[];
  when_to_see_doctor: string;
  self_care: string;
  /** One of the SPECIALITY_KEYWORDS values in chatData.ts, or null. */
  speciality: string | null;
  disclaimer: string;
}

const DISCLAIMER =
  "General health information only — not a diagnosis. Symptoms overlap between conditions, so please see a doctor for anything persistent, severe, or worrying.";

/** Valid speciality labels — mirrors the values used in chatData.ts. */
const VALID_SPECIALITIES = new Set<string>([
  "General Physician", "Cardiologist", "Dermatologist", "Orthopedic",
  "Neurologist", "Pediatrician", "Gynecologist", "Psychiatrist",
  "Diabetologist", "ENT Specialist", "Ophthalmologist", "Dentist", "Urologist",
]);

function sym(p: Omit<SymptomInfo, "disclaimer"> & { disclaimer?: string }): SymptomInfo {
  return { disclaimer: DISCLAIMER, ...p };
}

// ── Built-in DB ───────────────────────────────────────────────────────────
// Hardcoded rather than Gemini-generated for the conditions where a
// hallucinated symptom list could get someone killed. Gemini fills the long
// tail; these are the ones that must be right even when it is unavailable.
const SYMPTOM_DB: Record<string, SymptomInfo> = {
  "heart attack": sym({
    condition: "Heart Attack (Myocardial Infarction)",
    common_symptoms: [
      "Chest pain, pressure, tightness or squeezing — often central, lasting more than a few minutes",
      "Pain spreading to the left arm, both arms, jaw, neck, back or stomach",
      "Shortness of breath, with or without chest discomfort",
      "Cold sweat, nausea or vomiting",
      "Sudden light-headedness or unusual extreme fatigue",
      "In women, older adults and people with diabetes, pain may be mild or absent — breathlessness, nausea and fatigue may be the only signs",
    ],
    emergency_signs: [
      "Chest pain or pressure lasting more than 5 minutes — call 108 immediately",
      "Chest discomfort with breathlessness, sweating, or vomiting",
      "Collapse, fainting, or unresponsiveness",
      "Bluish lips or face, or gasping/absent breathing",
    ],
    when_to_see_doctor:
      "A suspected heart attack is never a 'wait and watch' — call 108 or get to the nearest emergency department immediately. Do not drive yourself.",
    self_care:
      "There is no safe self-care for a heart attack. While waiting for the ambulance: keep the person sitting and calm, loosen tight clothing, and do not give food or water.",
    speciality: "Cardiologist",
  }),

  stroke: sym({
    condition: "Stroke (Brain Attack)",
    common_symptoms: [
      "Sudden weakness or numbness of the face, arm or leg — typically on one side of the body",
      "Face drooping on one side; uneven smile",
      "Slurred speech, or difficulty speaking and understanding others",
      "Sudden confusion",
      "Sudden trouble seeing in one or both eyes",
      "Sudden severe headache with no known cause",
      "Sudden loss of balance, dizziness or difficulty walking",
    ],
    emergency_signs: [
      "Use F.A.S.T. — Face drooping, Arm weakness, Speech difficulty, Time to call 108",
      "Any sudden one-sided weakness or numbness",
      "Sudden 'worst headache of my life'",
      "Loss of consciousness or seizure",
    ],
    when_to_see_doctor:
      "Call 108 immediately. Stroke treatment is time-critical — clot-busting treatment works best within the first few hours, so note the time symptoms started and tell the medical team.",
    self_care:
      "No self-care applies. While waiting: lay the person on their side with the head slightly raised, do not give food, water or medicines (including aspirin — not all strokes are clots).",
    speciality: "Neurologist",
  }),

  appendicitis: sym({
    condition: "Appendicitis",
    common_symptoms: [
      "Pain starting near the navel that shifts to the lower right abdomen over hours",
      "Pain that worsens with coughing, walking or jarring movements",
      "Loss of appetite",
      "Nausea and vomiting soon after the pain begins",
      "Low-grade fever that may rise as the illness progresses",
      "Abdominal swelling, constipation or inability to pass gas",
    ],
    emergency_signs: [
      "Sudden relief of pain followed by worsening, spreading pain — may mean the appendix has burst",
      "High fever with rigid, board-like abdomen",
      "Severe pain preventing you from standing straight",
      "Persistent vomiting with inability to keep fluids down",
    ],
    when_to_see_doctor:
      "See a doctor the same day for suspected appendicitis — it usually needs surgery and can become life-threatening if the appendix bursts. Go to an emergency department if the pain is severe.",
    self_care:
      "Do not take painkillers, laxatives, or apply a heating pad — these can mask symptoms or increase the risk of rupture. Do not eat or drink until seen, in case surgery is needed.",
    speciality: "General Physician",
  }),

  dengue: sym({
    condition: "Dengue Fever",
    common_symptoms: [
      "Sudden high fever (up to 104°F / 40°C)",
      "Severe headache, especially behind the eyes",
      "Intense muscle, bone and joint pain (the 'breakbone fever' ache)",
      "Nausea and vomiting",
      "Skin rash appearing 2–5 days after the fever starts",
      "Extreme tiredness that can persist for weeks",
    ],
    emergency_signs: [
      "Severe abdominal pain or persistent vomiting",
      "Bleeding from the gums or nose, or blood in vomit or stools",
      "Rapid breathing, cold or clammy skin, restlessness",
      "Sudden drop in temperature accompanied by weakness — warning sign of dengue shock",
      "Black, tarry stools",
    ],
    when_to_see_doctor:
      "See a doctor for any high fever during dengue season to get a platelet count and NS1/IgM test. Go to hospital immediately for any of the warning signs above — the danger period is often as the fever falls, around days 3–7.",
    self_care:
      "Rest and drink plenty of fluids (ORS, coconut water, soups). Use paracetamol only for fever — NEVER aspirin, ibuprofen or other NSAIDs, as they increase bleeding risk in dengue.",
    speciality: "General Physician",
  }),

  diabetes: sym({
    condition: "Diabetes (Type 2)",
    common_symptoms: [
      "Frequent urination, especially at night",
      "Excessive thirst and a persistently dry mouth",
      "Increased hunger despite eating",
      "Unexplained weight loss",
      "Fatigue and weakness",
      "Blurred vision",
      "Slow-healing cuts, wounds, or frequent infections",
      "Tingling or numbness in the hands or feet",
    ],
    emergency_signs: [
      "Fruity-smelling breath with rapid breathing, vomiting and confusion — possible diabetic ketoacidosis, call 108",
      "Shaking, sweating, confusion or unconsciousness from very low blood sugar — give sugar if conscious, call 108 if not",
      "Any non-healing foot ulcer with fever or spreading redness",
    ],
    when_to_see_doctor:
      "See a doctor for a fasting blood sugar and HbA1c test if you have several of these symptoms. Indians develop type 2 diabetes at a lower BMI and younger age, so screening from age 30 is reasonable, earlier with a family history.",
    self_care:
      "Diabetes needs medical diagnosis and management — it cannot be self-treated. Alongside prescribed treatment: regular physical activity, portion control, reduced refined carbohydrates and sugar, and regular monitoring all help.",
    speciality: "Diabetologist",
  }),

  "food poisoning": sym({
    condition: "Food Poisoning",
    common_symptoms: [
      "Nausea and vomiting starting hours after eating",
      "Watery or loose stools / diarrhoea",
      "Stomach cramps and abdominal pain",
      "Mild fever",
      "Headache and general weakness",
    ],
    emergency_signs: [
      "Blood in vomit or stools",
      "Signs of severe dehydration — no urine for 8+ hours, sunken eyes, extreme dizziness on standing",
      "High fever above 102°F (39°C)",
      "Diarrhoea lasting more than 3 days, or inability to keep any fluid down",
      "Blurred vision, muscle weakness or tingling — possible botulism",
    ],
    when_to_see_doctor:
      "Most cases settle in 1–2 days with fluids. See a doctor if symptoms are severe, last beyond 2–3 days, or affect a young child, elderly person, or someone pregnant.",
    self_care:
      "Sip ORS frequently to replace lost fluids and salts. Rest, and reintroduce bland food (rice, banana, toast, curd) gradually. Avoid dairy-heavy, oily and spicy food until recovered.",
    speciality: "General Physician",
  }),

  asthma: sym({
    condition: "Asthma",
    common_symptoms: [
      "Wheezing — a whistling sound while breathing out",
      "Shortness of breath, often worse at night or early morning",
      "Chest tightness or pressure",
      "Persistent dry cough, especially at night or after exercise",
      "Symptoms triggered by dust, smoke, pollen, cold air, or exertion",
    ],
    emergency_signs: [
      "Breathlessness so severe you cannot complete a sentence",
      "Reliever inhaler not helping, or needed again within a few hours",
      "Lips or fingernails turning blue or grey",
      "Straining chest muscles to breathe, or drowsiness/confusion",
    ],
    when_to_see_doctor:
      "See a doctor for diagnosis (spirometry) and a proper inhaler plan if you have recurring wheeze or night-time cough. Go to emergency for a severe attack.",
    self_care:
      "Asthma needs prescribed inhalers — reliever for attacks and usually a preventer daily. Identify and avoid your triggers, and never stop a preventer inhaler just because you feel well.",
    speciality: "General Physician",
  }),

  typhoid: sym({
    condition: "Typhoid Fever",
    common_symptoms: [
      "Fever that rises step-by-step over days, often peaking in the evening",
      "Persistent headache and body ache",
      "Weakness and marked fatigue",
      "Abdominal pain, with constipation or diarrhoea",
      "Loss of appetite",
      "Rose-coloured spots on the chest or abdomen (less common)",
    ],
    emergency_signs: [
      "Severe abdominal pain with a rigid abdomen — possible intestinal perforation, go to hospital immediately",
      "Blood in stools or black tarry stools",
      "Confusion, delirium, or extreme drowsiness",
      "Persistent vomiting with inability to keep fluids down",
    ],
    when_to_see_doctor:
      "See a doctor for any fever lasting more than 3 days — typhoid needs a blood culture / Widal test and a full antibiotic course. Complete the whole course even after you feel better.",
    self_care:
      "Rest, drink plenty of safe (boiled or bottled) water, and eat soft, easily digestible food. Typhoid requires prescribed antibiotics — it will not resolve with home care alone.",
    speciality: "General Physician",
  }),
};

// Aliases → canonical DB key.
const SYMPTOM_ALIASES: Record<string, string> = {
  "heart attack": "heart attack", heartattack: "heart attack",
  "cardiac arrest": "heart attack", "myocardial infarction": "heart attack",
  mi: "heart attack", "dil ka daura": "heart attack", "heart problem": "heart attack",
  brain_attack: "stroke", "brain attack": "stroke", "brain stroke": "stroke",
  paralysis: "stroke", lakwa: "stroke", cva: "stroke",
  appendix: "appendicitis", "appendix pain": "appendicitis",
  "dengue fever": "dengue", "haddi tod bukhar": "dengue",
  "sugar disease": "diabetes", "blood sugar": "diabetes", sugar: "diabetes",
  "type 2 diabetes": "diabetes", "type 1 diabetes": "diabetes",
  madhumeh: "diabetes",
  "stomach infection": "food poisoning", "food poisoning": "food poisoning",
  "food poisining": "food poisoning", "bad food": "food poisoning",
  asthama: "asthma", "breathing problem": "asthma", dama: "asthma",
  "typhoid fever": "typhoid", "motijhara": "typhoid", "miyadi bukhar": "typhoid",
};

// ── Intent detection ──────────────────────────────────────────────────────
/**
 * Informational framings only. A bare complaint ("chest pain", "mujhe bukhar
 * hai") must NOT match — those belong to the emergency / health-advice flow.
 */
const SYMPTOM_QUERY_PATS: RegExp[] = [
  /\b(?:symptoms?|signs?|warning\s+signs?|early\s+signs?)\s+(?:of|for)\b/i,
  /\bwhat\s+(?:are|is)\s+the\s+(?:symptoms?|signs?)\b/i,
  /\b(?:symptoms?|signs?)\s*\??\s*$/i,
  /\bke\s+lakshan\b/i,
  /\bka\s+lakshan\b/i,
  /\blakshan\b/i,
  /\bpehchan\s+kaise\b/i,
  /\bkaise\s+pata\s+chal/i,
  /\bkaise\s+pehchan/i,
  /\bhow\s+(?:to|do\s+i|can\s+i|would\s+i)\s+(?:know|identify|tell|recognise|recognize|detect)\b/i,
  /\bhow\s+do\s+you\s+(?:know|identify|tell)\b/i,
];

/** Complaint markers — "I have X" is a complaint even if it mentions "symptoms". */
const COMPLAINT_MARKERS =
  /\b(?:i\s+(?:have|am\s+having|feel|got|am\s+experiencing|think\s+i\s+have)|my\s+\w+\s+(?:is|are|hurts?)|mujhe|mera|meri|mere|humein)\b/i;

const CONDITION_PREFIX_PAT =
  /^\s*(?:what\s+(?:are|is)\s+(?:the\s+)?|tell\s+me\s+(?:the\s+)?|list\s+(?:the\s+)?|show\s+(?:me\s+)?(?:the\s+)?|explain\s+(?:the\s+)?|know\s+(?:the\s+)?)?(?:early\s+|common\s+|main\s+|initial\s+|warning\s+)*(?:symptoms?|signs?)\s+(?:of|for)\s+/i;

const CONDITION_SUFFIX_PAT =
  /\s*\b(?:ke|ka|ki)?\s*(?:lakshan|symptoms?|signs?|warning\s+signs?|kya\s+hain?|kya\s+hai|kya\s+h|batao|bataiye|hain?|list|detect|pehchan|pehchane|kaise\s+pata\s+chalega|kaise\s+pata\s+chale|in\s+hindi|in\s+english)\b\s*\??\s*$/i;

const CONDITION_LEAD_NOISE_PAT =
  /^\s*(?:what\s+(?:are|is)\s+(?:the\s+)?|tell\s+me\s+about\s+|tell\s+me\s+|how\s+(?:to|do\s+i|can\s+i|would\s+i)\s+(?:know|identify|tell|recognise|recognize|detect)\s+(?:if\s+(?:i|someone|he|she|they)\s+(?:have|has|is\s+having)\s+)?(?:a\s+|an\s+|the\s+)?|do\s+i\s+have\s+|is\s+it\s+)/i;

/** Words that are never a condition on their own — guards against empty/garbage lookups. */
const NON_CONDITION_TERMS = new Set<string>([
  "", "it", "this", "that", "these", "those", "my", "me", "i", "you",
  "a", "an", "the", "some", "any", "all", "what", "which", "who",
  "disease", "illness", "sickness", "problem", "issue", "condition",
  "bimari", "bimaari", "rog", "doctor", "hospital", "medicine",
]);

/** Peel trailing filler until only the condition name remains. */
function stripConditionSuffixes(text: string): string {
  let out = text.trim();
  for (let i = 0; i < 6; i++) {
    const next = out.replace(CONDITION_SUFFIX_PAT, "").trim();
    if (next === out || !next) return out;
    out = next;
  }
  return out;
}

export function extractCondition(message: string): string {
  let text = message.trim().toLowerCase().replace(/[?!.]+$/, "").trim();
  const beforePrefix = text;
  text = text.replace(CONDITION_PREFIX_PAT, "").trim();
  // Only strip generic lead-in noise when the "symptoms of" prefix didn't
  // already do the job, otherwise "what are the symptoms of X" loses X.
  if (text === beforePrefix) text = text.replace(CONDITION_LEAD_NOISE_PAT, "").trim();
  text = stripConditionSuffixes(text);
  // Trailing/leading articles and connectors left behind by the strips.
  text = text.replace(/^(?:a|an|the|of|for|in)\s+/i, "").replace(/\s+(?:of|for|in)$/i, "").trim();
  return text.replace(/\s+/g, " ");
}

export function isSymptomInfoQuery(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (!text) return false;

  // "I have fever symptoms" is a complaint, not a lookup — let the
  // health-advice / emergency flow own it.
  if (COMPLAINT_MARKERS.test(text)) return false;

  if (!SYMPTOM_QUERY_PATS.some((p) => p.test(text))) return false;

  const condition = extractCondition(message);
  if (NON_CONDITION_TERMS.has(condition)) return false;
  // A condition name is at most a few words; anything longer is prose that
  // merely happens to contain "signs of".
  if (condition.split(/\s+/).length > 5) return false;
  return condition.length >= 3;
}

// ── Cache ─────────────────────────────────────────────────────────────────
const CACHE = new Map<string, { ts: number; val: SymptomInfo }>();
const CACHE_TTL = 3600 * 1000;

function cacheGet(key: string): SymptomInfo | null {
  const e = CACHE.get(key);
  if (e) {
    if (Date.now() - e.ts < CACHE_TTL) return e.val;
    CACHE.delete(key);
  }
  return null;
}
function cacheSet(key: string, val: SymptomInfo): void {
  if (CACHE.size > 300) CACHE.delete(CACHE.keys().next().value as string);
  CACHE.set(key, { ts: Date.now(), val });
}

// ── Gemini lookup ─────────────────────────────────────────────────────────
const SYMPTOM_GEMINI_PROMPT = (condition: string) =>
  `You are a medical information assistant for Doctar.in, an Indian healthcare platform.
Given a medical condition, respond ONLY with JSON in exactly this format — no markdown, no code fences:

{
  "condition": "Proper name of the condition",
  "common_symptoms": ["symptom 1", "symptom 2", "symptom 3", "symptom 4", "symptom 5"],
  "emergency_signs": ["red flag 1", "red flag 2", "red flag 3"],
  "when_to_see_doctor": "One or two sentences on when medical care is needed",
  "self_care": "One or two sentences of safe self-care, or a clear statement that self-care is not appropriate",
  "speciality": "one of: General Physician, Cardiologist, Dermatologist, Orthopedic, Neurologist, Pediatrician, Gynecologist, Psychiatrist, Diabetologist, ENT Specialist, Ophthalmologist, Dentist, Urologist",
  "disclaimer": "${DISCLAIMER}"
}

Rules:
- "emergency_signs" must list the signs that mean call an ambulance (108) IMMEDIATELY. Never leave it empty for a condition that can become life-threatening.
- Be accurate and conservative. Do not invent symptoms. Prefer well-established clinical features.
- Use the Indian healthcare context (common local names, Indian emergency number 108).
- If the input is not a recognisable medical condition, set "condition" to the input and return empty symptom lists.
- "speciality" MUST be exactly one of the listed values.

Condition to look up: ${condition}`;

function normaliseSpeciality(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (VALID_SPECIALITIES.has(trimmed)) return trimmed;
  // Tolerate case/spacing drift from the model.
  for (const valid of VALID_SPECIALITIES) {
    if (valid.toLowerCase() === trimmed.toLowerCase()) return valid;
  }
  return null;
}

function toStringList(raw: unknown, limit = 8): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x) => typeof x === "string" && x.trim())
    .map((x) => String(x).trim())
    .slice(0, limit);
}

async function lookupViaGemini(condition: string): Promise<SymptomInfo | null> {
  if (!geminiAvailable()) return null;

  // Timeout kept well under the frontend's 15s abort — this runs inside the
  // /api/chat request path.
  const raw = await geminiGenerate([{ text: SYMPTOM_GEMINI_PROMPT(condition) }], {
    maxTokens: 900,
    temperature: 0.1,
    timeoutMs: 6000,
  });
  if (!raw) return null;

  try {
    let text = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (match) text = match[0];
    const parsed = JSON.parse(text);

    const common = toStringList(parsed.common_symptoms);
    // A result with no symptoms is worse than the generic fallback — reject it
    // so the caller can produce a more honest "I don't have this" response.
    if (!common.length) return null;

    console.log(`Gemini symptom lookup OK: ${condition}`);
    return {
      condition: String(parsed.condition || condition),
      common_symptoms: common,
      emergency_signs: toStringList(parsed.emergency_signs, 6),
      when_to_see_doctor: String(parsed.when_to_see_doctor || "See a doctor if symptoms persist or worsen."),
      self_care: String(parsed.self_care || "Rest and stay hydrated. Do not self-medicate beyond basic supportive care."),
      speciality: normaliseSpeciality(parsed.speciality),
      disclaimer: DISCLAIMER,
    };
  } catch (e) {
    console.warn(`Gemini symptom lookup returned unparseable JSON for ${condition}: ${(e as Error).message}`);
    return null;
  }
}

// ── Public lookup ─────────────────────────────────────────────────────────
function resolveConditionKey(raw: string): string {
  const clean = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return SYMPTOM_ALIASES[clean] ?? clean;
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

export async function lookupSymptomInfo(rawCondition: string): Promise<SymptomInfo> {
  const cacheKey = rawCondition.trim().toLowerCase();
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const key = resolveConditionKey(rawCondition);

  // 1. Built-in DB (authoritative for the safety-critical conditions).
  const builtIn = SYMPTOM_DB[key];
  if (builtIn) {
    cacheSet(cacheKey, builtIn);
    return builtIn;
  }

  // 2. Gemini real-time lookup for the long tail.
  const viaGemini = await lookupViaGemini(key);
  if (viaGemini) {
    cacheSet(cacheKey, viaGemini);
    return viaGemini;
  }

  // 3. Generic fallback — says plainly that we don't have it rather than
  //    inventing a symptom list.
  const fallback: SymptomInfo = {
    condition: titleCase(key),
    common_symptoms: [],
    emergency_signs: [],
    when_to_see_doctor:
      "I don't have reliable symptom information for this condition right now. Please consult a doctor for an accurate assessment.",
    self_care: "",
    speciality: null,
    disclaimer: DISCLAIMER,
  };
  cacheSet(cacheKey, fallback);
  return fallback;
}

/** Render a SymptomInfo as the chat reply markdown. */
export function formatSymptomReply(info: SymptomInfo): string {
  if (!info.common_symptoms.length) {
    return (
      `### 🩺 ${info.condition}\n\n` +
      `${info.when_to_see_doctor}\n\n` +
      `🚨 *If this is an emergency, call **108** immediately.*\n\n` +
      `*${info.disclaimer}*`
    );
  }

  const bullets = (items: string[]) => items.map((s) => `• ${s}`).join("\n");
  const parts = [`### 🩺 Symptoms of ${info.condition}`];

  parts.push(`**Common symptoms:**\n${bullets(info.common_symptoms)}`);

  if (info.emergency_signs.length) {
    parts.push(
      `🚨 **Call an ambulance (108) immediately if:**\n${bullets(info.emergency_signs)}`
    );
  }
  if (info.when_to_see_doctor) parts.push(`🩺 **When to see a doctor:** ${info.when_to_see_doctor}`);
  if (info.self_care) parts.push(`🏠 **Self-care:** ${info.self_care}`);
  if (info.speciality) {
    parts.push(`👨‍⚕️ *Type "${info.speciality} near me" to find a specialist.*`);
  }
  parts.push(`*${info.disclaimer}*`);

  return parts.join("\n\n");
}
