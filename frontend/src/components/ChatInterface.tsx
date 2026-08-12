"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  pdfDownloadUrl,
  processPrescription,
  uploadPrescription,
  type MedicineItem,
} from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import ChatSidebar from "@/components/ChatSidebar";
import {
  deleteSession as apiDeleteSession,
  getSession as apiGetSession,
  listSessions as apiListSessions,
  renameSession as apiRenameSession,
  type SessionSummary,
} from "@/lib/chatSessions";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const GREETING_MESSAGE = {
  role: "assistant" as const,
  text: "👋 Hello! I'm DOCTAR AI — your health assistant.\n\nI can help you:\n• 🔍 **Find doctors** by speciality, city, or budget\n• 📋 **Upload a prescription** — tap the 📎 button to get your medicine schedule\n• 📷 **Scan a medicine label** — tap the camera button to identify any medicine\n• 💊 **Answer questions** about DOCTAR services\n\nTry asking: *\"Find a cardiologist in Delhi under ₹1000\"*",
};

interface Doctor {
  id: number;
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

interface Hospital {
  id: string;
  name: string;
  city: string;
  address: string;
  type: string;
  emergency: boolean;
  phone: string | null;
  rating: number;
  beds?: number;
}

interface PrescriptionResult {
  id: string;
  medicines: MedicineItem[];
}

interface MedicineLabel {
  name: string | null;
  generic_name: string | null;
  manufacturer: string | null;
  uses: string[] | null;
  dosage: string | null;
  side_effects: string[] | null;
  warnings: string[] | null;
  storage: string | null;
  expiry: string | null;
  prescription_required: boolean | null;
  source: "ai" | "ocr" | "none";
  error?: string;
  ocr_text?: string;
}

interface Message {
  role: "user" | "assistant";
  text: string;
  doctors?: Doctor[];
  hospitals?: Hospital[];
  prescription?: PrescriptionResult;
  medicineLabel?: MedicineLabel;
  imagePreview?: string;
  isFile?: boolean;
  askCity?: boolean;          // show inline city-input when both geolocation methods fail
  pendingQuery?: string;      // the "near me" query to retry once city is known
  showNearMeChip?: boolean;   // show "Find Doctors Near Me" chip after health advice
  resolvedCity?: string;      // city used for this search (shown in result header)
  resolvedCitySource?: "gps" | "ip" | "manual" | null; // provenance of resolvedCity
}

function DoctorCard({ d }: { d: Doctor }) {
  return (
    <div className="bg-white border border-doctar-100 rounded-xl p-3 mt-2 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-800">{d.name.startsWith("Dr.") ? d.name : `Dr. ${d.name}`}</p>
          <p className="text-sm text-doctar-700">{d.speciality}</p>
          <p className="text-xs text-gray-500 mt-0.5">{d.hospital}, {d.city}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-bold text-doctar-700">₹{d.fee}</p>
          <p className="text-xs text-yellow-600">⭐ {d.rating}/5</p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-gray-500">{d.experience_years} yrs · {d.languages}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${d.available_today ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
          {d.available_today ? "Available Today" : "By Appointment"}
        </span>
      </div>
      <button className="mt-2 w-full bg-doctar-600 hover:bg-doctar-700 text-white text-sm font-medium py-1.5 rounded-lg transition-colors">
        Book Appointment
      </button>
    </div>
  );
}

function HospitalCard({ h }: { h: Hospital }) {
  return (
    <div className="bg-white border border-doctar-100 rounded-xl p-3 mt-2 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-800 truncate">🏥 {h.name}</p>
          <p className="text-sm text-doctar-700">{h.type}</p>
          <p className="text-xs text-gray-500 mt-0.5 truncate">📍 {h.address}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-yellow-600 font-medium">⭐ {h.rating}/5</p>
          {h.beds && <p className="text-xs text-gray-400">{h.beds} beds</p>}
        </div>
      </div>
      <div className="flex items-center justify-between mt-2 gap-2">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          h.emergency ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"
        }`}>
          {h.emergency ? "🚨 Emergency" : "No Emergency"}
        </span>
        {h.phone && (
          <span className="text-xs text-gray-500 truncate">📞 {h.phone}</span>
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => window.open(`https://www.google.com/maps/search/${encodeURIComponent(h.name + " " + h.city)}`, "_blank")}
          className="flex-1 bg-doctar-600 hover:bg-doctar-700 text-white text-sm font-medium py-1.5 rounded-lg transition-colors"
        >
          🗺️ Get Directions
        </button>
        {/* A real <a href="tel:"> rather than window.location — mobile browsers
            handle the former reliably, and it keeps the control usable via
            long-press / "copy number" on desktop where there's no dialer. */}
        <a
          href="tel:108"
          className="flex-1 flex items-center justify-center bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-1.5 rounded-lg transition-colors"
        >
          📞 Call Ambulance
        </a>
      </div>
    </div>
  );
}

function MedicineCard({ med, idx }: { med: MedicineItem; idx: number }) {
  const foodLabel =
    med.food_instructions?.toUpperCase() === "AC"
      ? "Before food / खाने से पहले"
      : med.food_instructions?.toUpperCase() === "PC"
      ? "After food / खाने के बाद"
      : med.food_instructions || "—";

  return (
    <div className="bg-white border border-doctar-100 rounded-xl p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-800 text-sm">{idx}. {med.name}</p>
          <p className="text-xs text-doctar-700 mt-0.5">{med.dosage}</p>
        </div>
        <span className="text-xs bg-doctar-50 text-doctar-700 border border-doctar-200 rounded-full px-2 py-0.5 shrink-0">
          {med.duration}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
        <span>🕐 {med.timing}</span>
        <span>🍽️ {foodLabel}</span>
        {med.purpose && <span className="text-doctar-700 font-medium w-full">💊 {med.purpose}</span>}
      </div>
    </div>
  );
}

const LANG_OPTIONS: { lang: "en" | "hi" | "both"; label: string; sublabel: string; emoji: string }[] = [
  { lang: "en", label: "English", sublabel: "English only", emoji: "🇬🇧" },
  { lang: "hi", label: "हिंदी", sublabel: "Hindi only", emoji: "🇮🇳" },
  { lang: "both", label: "Both", sublabel: "English + हिंदी", emoji: "📄" },
];

function PrescriptionMessage({ result }: { result: PrescriptionResult }) {
  const [chosen, setChosen] = useState<"en" | "hi" | "both" | null>(null);

  return (
    <div className="mt-2 space-y-2">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        {result.medicines.length} medicine{result.medicines.length !== 1 ? "s" : ""} found
      </p>
      {result.medicines.map((m, i) => (
        <MedicineCard key={i} med={m} idx={i + 1} />
      ))}

      {/* Language picker */}
      {!chosen ? (
        <div className="mt-3 bg-doctar-50 border border-doctar-200 rounded-xl p-3">
          <p className="text-sm font-medium text-doctar-800 mb-2">
            📥 Which language do you want the PDF in?
          </p>
          <div className="grid grid-cols-3 gap-2">
            {LANG_OPTIONS.map((opt) => (
              <button
                key={opt.lang}
                onClick={() => setChosen(opt.lang)}
                className="flex flex-col items-center gap-1 bg-white hover:bg-doctar-600 hover:text-white border border-doctar-200 hover:border-doctar-600 rounded-xl py-2.5 px-2 transition-all group"
              >
                <span className="text-xl">{opt.emoji}</span>
                <span className="text-xs font-semibold">{opt.label}</span>
                <span className="text-[10px] text-gray-400 group-hover:text-doctar-100">{opt.sublabel}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <a
            href={pdfDownloadUrl(result.id, chosen)}
            download
            className="flex items-center justify-center gap-2 w-full bg-doctar-600 hover:bg-doctar-700 text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download PDF — {LANG_OPTIONS.find(o => o.lang === chosen)?.sublabel}
          </a>
          <button
            onClick={() => setChosen(null)}
            className="w-full text-xs text-doctar-600 hover:text-doctar-800 py-1 transition-colors"
          >
            ← Change language
          </button>
        </div>
      )}
    </div>
  );
}

function MedicineLabelCard({ label }: { label: MedicineLabel }) {
  if (label.error) {
    return (
      <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        ❌ {label.error}
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-doctar-100 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-doctar-600 text-white px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-bold text-base leading-tight">{label.name || "Unknown Medicine"}</p>
            {label.generic_name && (
              <p className="text-doctar-100 text-xs mt-0.5">{label.generic_name}</p>
            )}
          </div>
          {label.prescription_required && (
            <span className="shrink-0 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">Rx</span>
          )}
        </div>
        {label.manufacturer && (
          <p className="text-doctar-200 text-xs mt-1">🏭 {label.manufacturer}</p>
        )}
      </div>

      <div className="p-3 space-y-3 text-sm">
        {/* Uses */}
        {label.uses && label.uses.length > 0 && (
          <div>
            <p className="font-semibold text-gray-700 text-xs uppercase tracking-wide mb-1">✅ Uses</p>
            <ul className="space-y-0.5">
              {label.uses.map((u, i) => (
                <li key={i} className="text-gray-700 flex gap-1.5"><span className="text-doctar-500 shrink-0">•</span>{u}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Dosage */}
        {label.dosage && (
          <div>
            <p className="font-semibold text-gray-700 text-xs uppercase tracking-wide mb-1">💊 Dosage</p>
            <p className="text-gray-700">{label.dosage}</p>
          </div>
        )}

        {/* Side effects */}
        {label.side_effects && label.side_effects.length > 0 && (
          <div>
            <p className="font-semibold text-gray-700 text-xs uppercase tracking-wide mb-1">⚠️ Side Effects</p>
            <ul className="space-y-0.5">
              {label.side_effects.map((s, i) => (
                <li key={i} className="text-gray-600 flex gap-1.5"><span className="text-orange-400 shrink-0">•</span>{s}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Warnings */}
        {label.warnings && label.warnings.length > 0 && (
          <div className="bg-orange-50 border border-orange-100 rounded-lg p-2">
            <p className="font-semibold text-orange-700 text-xs uppercase tracking-wide mb-1">🚫 Warnings</p>
            <ul className="space-y-0.5">
              {label.warnings.map((w, i) => (
                <li key={i} className="text-orange-700 text-xs flex gap-1.5"><span className="shrink-0">•</span>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Storage & Expiry */}
        <div className="flex flex-wrap gap-3 text-xs text-gray-500 border-t border-gray-100 pt-2">
          {label.storage && <span>🌡️ {label.storage}</span>}
          {label.expiry && <span>📅 Exp: {label.expiry}</span>}
          {label.source !== "ai" && (
            <span className="text-gray-400 italic">OCR-based — verify with pharmacist</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Escape before any markdown substitution runs — this feeds dangerouslySetInnerHTML,
 * and every message bubble (including the user's own) goes through it. Without this,
 * typing e.g. `<img src=x onerror=...>` executes it in the sender's own browser. */
function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdown(text: string) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br/>");
}

// ── Voice input (Web Speech API) ───────────────────────────────────────────
// Support is uneven: Chrome/Edge/Safari implement it (Chrome behind the
// webkit- prefix), Firefox does not. Everything below feature-detects and the
// button simply doesn't render when unsupported.
interface SpeechRecognitionAlternativeLike { transcript: string }
interface SpeechRecognitionResultLike {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { readonly length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const SUGGESTIONS = [
  "📍 Doctors near me",
  "🏥 Hospitals near me",
  "Find a cardiologist in Delhi",
  "Dermatologist under ₹500",
  "I have a headache",
  "What is DOCTAR?",
];

// ── Popular Indian cities shown in the picker ──────────────────────────────
const POPULAR_CITIES = [
  "Delhi", "Mumbai", "Kolkata", "Bangalore", "Hyderabad", "Chennai",
  "Pune", "Ahmedabad", "Jaipur", "Lucknow", "Chandigarh", "Kochi",
  "Surat", "Nagpur", "Indore", "Bhopal", "Patna", "Ranchi",
  "Guwahati", "Bhubaneswar", "Visakhapatnam", "Vadodara", "Agra", "Varanasi",
];

interface LocationPickerProps {
  onSelect: (city: string) => void;
  onDetect: () => void;
  detecting: boolean;
  onClose: () => void;
}

function LocationPicker({ onSelect, onDetect, detecting, onClose }: LocationPickerProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = query.trim().length > 0
    ? POPULAR_CITIES.filter((c) => c.toLowerCase().includes(query.toLowerCase()))
    : POPULAR_CITIES;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const city = query.trim();
    if (city) { onSelect(city); }
  }

  return (
    <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-800">Choose your location</p>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-3 space-y-2">
        {/* Search input */}
        <form onSubmit={handleSubmit}>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type your State or City"
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#9333ea] focus:border-transparent text-gray-800 placeholder-gray-400"
            />
          </div>
        </form>

        {/* Detect my location */}
        <button
          onClick={onDetect}
          disabled={detecting}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-blue-50 transition-colors group disabled:opacity-60"
        >
          {detecting ? (
            <svg className="w-5 h-5 text-blue-600 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
            </svg>
          ) : (
            /* GPS crosshair icon */
            <svg className="w-5 h-5 text-blue-600 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3" fill="#2563eb" stroke="none"/>
              <circle cx="12" cy="12" r="7" />
              <line x1="12" y1="2"  x2="12" y2="5"  />
              <line x1="12" y1="19" x2="12" y2="22" />
              <line x1="2"  y1="12" x2="5"  y2="12" />
              <line x1="19" y1="12" x2="22" y2="12" />
            </svg>
          )}
          <span className="text-sm font-medium text-blue-600">
            {detecting ? "Detecting location…" : "Detect my location"}
          </span>
        </button>

        {/* Divider */}
        <div className="flex items-center gap-2 px-1">
          <div className="flex-1 h-px bg-gray-100" />
          <span className="text-[10px] text-gray-400 uppercase tracking-wide">Popular cities</span>
          <div className="flex-1 h-px bg-gray-100" />
        </div>

        {/* City grid */}
        <div className="max-h-52 overflow-y-auto -mx-1 px-1">
          {filtered.length > 0 ? (
            <div className="grid grid-cols-3 gap-1.5">
              {filtered.map((city) => (
                <button
                  key={city}
                  onClick={() => onSelect(city)}
                  className="text-xs text-gray-700 bg-gray-50 hover:bg-[#9333ea] hover:text-white border border-gray-200 hover:border-[#9333ea] rounded-xl py-2 px-2 transition-all truncate font-medium"
                >
                  {city}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 text-center py-4">No cities found. Press Enter to use &quot;{query}&quot;.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ChatInterface({ compact = false }: { compact?: boolean }) {
  type LocationSource = "gps" | "ip" | "manual" | null;

  const [userCity, setUserCityState] = useState<string | null>(null);
  const [locationSource, setLocationSourceState] = useState<LocationSource>(null);
  const [locationResolving, setLocationResolving] = useState(false);
  const [locStatus, setLocStatus] = useState<"idle" | "loading" | "denied">("idle");
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Refs mirror the state above so async callbacks (which would otherwise close
  // over a stale `userCity`/`locationSource`) always read the current value.
  const userCityRef = useRef<string | null>(null);
  const locationSourceRef = useRef<LocationSource>(null);

  /** Update the known city and its provenance together — state (for render) and refs (for async reads). */
  function applyLocation(city: string, source: LocationSource) {
    userCityRef.current = city;
    locationSourceRef.current = source;
    setUserCityState(city);
    setLocationSourceState(source);
  }

  // Memoized lookups backing the silent mount-time auto-detect. Kept as refs
  // so the "near me" flow (in resolveNearMeCity, below) can await the SAME
  // in-flight request instead of firing a second GPS prompt / IP call.
  const autoIpLookupRef = useRef<Promise<string | null> | null>(null);
  const autoGpsLookupRef = useRef<Promise<string | null> | null>(null);

  function autoIpLookup(): Promise<string | null> {
    if (!autoIpLookupRef.current) autoIpLookupRef.current = cityFromIP();
    return autoIpLookupRef.current;
  }

  function autoGpsLookup(): Promise<string | null> {
    if (!autoGpsLookupRef.current) {
      autoGpsLookupRef.current = new Promise<string | null>((resolve) => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
          async (pos) => resolve(await cityFromCoords(pos.coords.latitude, pos.coords.longitude)),
          () => resolve(null), // denied / unavailable
          { timeout: 8000 }
        );
      });
    }
    return autoGpsLookupRef.current;
  }

  // ── Auto-detect location silently on mount ──────────────────────────────
  // IP lookup first (no permission needed, instant), GPS second (precise).
  // Non-blocking — chat works normally even if both fail. A result is only
  // applied if it wouldn't clobber a manual pick, and a slower IP result can
  // never overwrite an already-resolved (more accurate) GPS fix.
  useEffect(() => {
    let cancelled = false;

    autoIpLookup().then((ipCity) => {
      if (cancelled || !ipCity) return;
      if (locationSourceRef.current === "manual" || locationSourceRef.current === "gps") return;
      applyLocation(ipCity, "ip");
    });

    autoGpsLookup().then((gpsCity) => {
      if (cancelled || !gpsCity) return;
      if (locationSourceRef.current === "manual") return;
      applyLocation(gpsCity, "gps");
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // ← run once on mount only

  // Close picker when clicking outside
  const handleOutsideClick = useCallback((e: MouseEvent) => {
    if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
      setShowPicker(false);
    }
  }, []);

  useEffect(() => {
    if (showPicker) document.addEventListener("mousedown", handleOutsideClick);
    else document.removeEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [showPicker, handleOutsideClick]);

  const [messages, setMessages] = useState<Message[]>([GREETING_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Chat sessions / sidebar (full page only — compact widget is untouched) ──
  const { user } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  // Mobile-only drawer state — irrelevant above the md breakpoint, where
  // ChatSidebar is always visible inline regardless of this value.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;

  const refreshSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const list = await apiListSessions();
      setSessions(list);
    } catch {
      setSessionsError("Couldn't load your chat history.");
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  // Load the sidebar list once we know who's logged in, and clear any
  // in-progress conversation state on every login/logout transition — the
  // primary defense (not just the backend's silent-rebase) against a stale
  // sessionId surviving an account switch on a shared browser.
  useEffect(() => {
    if (user) {
      refreshSessions();
    } else {
      setSessions([]);
    }
    setSessionId(null);
    setMessages([GREETING_MESSAGE]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  function startNewChat() {
    setSessionId(null);
    setMessages([GREETING_MESSAGE]);
  }

  async function selectSession(id: string) {
    try {
      const detail = await apiGetSession(id);
      setSessionId(detail.id);
      setMessages(
        detail.messages.map((m) => ({
          role: m.role,
          text: m.text,
          doctors: m.doctors,
          hospitals: m.hospitals,
        }))
      );
    } catch {
      setSessionsError("Couldn't load that conversation.");
    }
  }

  async function handleRenameSession(id: string, title: string) {
    // Optimistic — the sidebar already shows the typed title immediately.
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
    try {
      await apiRenameSession(id, title);
    } catch {
      refreshSessions(); // reconcile with the server on failure
    }
  }

  async function handleDeleteSession(id: string) {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (id === sessionId) startNewChat();
    try {
      await apiDeleteSession(id);
    } catch {
      refreshSessions();
    }
  }

  // ── Voice input ─────────────────────────────────────────────────────────
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Text already committed when this dictation started, so interim results
  // extend what the user typed instead of overwriting it.
  const voiceBaseRef = useRef("");

  // Detect support after mount — `window` doesn't exist during SSR, and
  // checking in a render would desync server and client markup.
  useEffect(() => {
    setVoiceSupported(getSpeechRecognitionCtor() !== null);
  }, []);

  // Make sure a live recognition session can't outlive the component.
  useEffect(() => {
    return () => {
      const rec = recognitionRef.current;
      if (rec) {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        try { rec.abort(); } catch { /* already stopped */ }
        recognitionRef.current = null;
      }
    };
  }, []);

  function stopListening() {
    const rec = recognitionRef.current;
    if (rec) {
      try { rec.stop(); } catch { /* already stopped */ }
    }
    setListening(false);
  }

  function startListening() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    // Toggle off if already running.
    if (recognitionRef.current) { stopListening(); return; }

    setVoiceError(null);
    let rec: SpeechRecognitionLike;
    try {
      rec = new Ctor();
    } catch {
      setVoiceError("Voice input couldn't start on this device.");
      return;
    }

    // en-IN gives noticeably better results than en-US for Indian English and
    // for the Hinglish medical vocabulary this app deals in. Pure Hindi
    // dictation remains unreliable — a browser/engine limitation, not
    // something this code can compensate for.
    rec.lang = "en-IN";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    voiceBaseRef.current = input.trim();

    rec.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      const base = voiceBaseRef.current;
      // Populate the field only — never auto-send, so the user can review and
      // edit exactly as they would with typed input.
      setInput(base ? `${base} ${transcript.trim()}` : transcript.trim());
    };

    rec.onerror = (e) => {
      const code = e?.error;
      if (code === "not-allowed" || code === "service-not-allowed") {
        setVoiceError("Microphone permission denied. Enable it in your browser settings.");
      } else if (code === "no-speech") {
        setVoiceError("Didn't catch that — try again.");
      } else if (code !== "aborted") {
        setVoiceError("Voice input failed. Please type instead.");
      }
      setListening(false);
      recognitionRef.current = null;
    };

    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      setListening(true);
    } catch {
      setVoiceError("Voice input couldn't start. Please type instead.");
      recognitionRef.current = null;
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /** Reverse-geocode lat/lng → city name via Nominatim (free, no key). */
  async function cityFromCoords(lat: number, lon: number): Promise<string | null> {
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
        { headers: { "Accept-Language": "en" } }
      );
      const d = await r.json();
      return d.address?.city || d.address?.town || d.address?.village ||
             d.address?.county || d.address?.state_district || null;
    } catch { return null; }
  }

  /** IP-based location — no permission needed, works even when browser blocks GPS. */
  async function cityFromIP(): Promise<string | null> {
    try {
      const r = await fetch("https://ipapi.co/json/");
      if (!r.ok) return null;
      const d = await r.json();
      return d.city || null;
    } catch { return null; }
  }

  /**
   * Two-tier location resolution triggered by an explicit user action (the
   * "Detect my location" button) — always re-attempts both tiers fresh,
   * independent of the mount-time auto-detect's cached results.
   *   1. Browser GPS  → Nominatim reverse-geocode
   *   2. IP geolocation (ipapi.co) — no permission dialog, always works
   * Returns the city string, or null if both fail.
   */
  async function getLocation(): Promise<string | null> {
    setLocStatus("loading");
    setLocationResolving(true);
    try {
      // Tier 1: browser geolocation (precise, requires permission)
      if (navigator.geolocation) {
        const gpsCity = await new Promise<string | null>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            async (pos) => resolve(await cityFromCoords(pos.coords.latitude, pos.coords.longitude)),
            () => resolve(null),   // denied / unavailable — fall through to IP
            { timeout: 8000 }
          );
        });
        if (gpsCity) { applyLocation(gpsCity, "gps"); setLocStatus("idle"); return gpsCity; }
      }

      // Tier 2: IP-based location (no permission, city-level accuracy)
      const ipCity = await cityFromIP();
      if (ipCity) { applyLocation(ipCity, "ip"); setLocStatus("idle"); return ipCity; }

      setLocStatus("denied");
      return null;
    } finally {
      setLocationResolving(false);
    }
  }

  /**
   * Resolve the city for a "near me" query without racing ahead of a
   * still-in-flight GPS fix. If a manual pick or an already-resolved GPS city
   * is known, use it immediately (unchanged from before). Otherwise, wait a
   * short window for the GPS lookup already running (from the mount-time
   * auto-detect) to settle before falling back to the coarser IP-based city —
   * this is what fixes the race where an IP-resolved city (e.g. "New Delhi"
   * for a small-town IP) gets used for the search while the header a moment
   * later corrects itself to the real GPS city.
   */
  async function resolveNearMeCity(): Promise<{ city: string; source: LocationSource } | null> {
    if (userCityRef.current && (locationSourceRef.current === "manual" || locationSourceRef.current === "gps")) {
      return { city: userCityRef.current, source: locationSourceRef.current };
    }

    setLocStatus("loading");
    setLocationResolving(true);

    const GPS_WAIT_MS = 4500;
    const gpsCity = await Promise.race([
      autoGpsLookup(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), GPS_WAIT_MS)),
    ]);

    if (gpsCity) {
      applyLocation(gpsCity, "gps");
      setLocStatus("idle");
      setLocationResolving(false);
      return { city: gpsCity, source: "gps" };
    }

    // GPS didn't settle within the wait window (or already failed/denied) —
    // fall back to IP, reusing the auto-detect's lookup if already in flight.
    const ipCity = await autoIpLookup();
    setLocationResolving(false);

    if (ipCity) {
      applyLocation(ipCity, "ip");
      setLocStatus("idle");
      return { city: ipCity, source: "ip" };
    }

    setLocStatus("denied");
    return null;
  }

  const NEAR_ME_PAT = /\bnear\s*me\b|\bnearby\b|\bnear\s+my\s+(?:location|area|place|home)\b/i;

// ── All Indian cities used for message-level city extraction ────────────────
const ALL_CITIES = [
  "new delhi","delhi","mumbai","bangalore","bengaluru","hyderabad","chennai",
  "kolkata","pune","ahmedabad","jaipur","lucknow","surat","kanpur","nagpur",
  "indore","bhopal","patna","vadodara","ghaziabad","ludhiana","agra","nashik",
  "faridabad","meerut","rajkot","varanasi","srinagar","ranchi","howrah",
  "coimbatore","jabalpur","gwalior","vijayawada","jodhpur","madurai","raipur",
  "kota","guwahati","chandigarh","solapur","bhubaneswar","mysore","mysuru",
  "gurgaon","gurugram","noida","kochi","ernakulam","thiruvananthapuram",
  "dehradun","amritsar","allahabad","prayagraj","visakhapatnam","vizag",
  "siliguri","jamshedpur","cuttack","mangalore","mangaluru","udaipur",
  "navi mumbai","thane","aurangabad","jalandhar","jammu","shimla","pondicherry",
  "puducherry","gangtok","imphal","shillong","goa","panaji","surat","bilaspur",
  "bhilai","durgapur","asansol","warangal","guntur","nellore","kurnool",
  "akola","loni","ulhasnagar","jhansi","hubli","hubballi","bareilly","moradabad",
  "deoghar","bokaro","dhanbad","korba","rourkela","berhampur","sambalpur",
];

/**
 * Extract a city name from a free-text message.
 * Checks "in/near/at X" patterns first, then direct substring match.
 * Returns title-cased city string or null.
 */
function extractLocationFromMessage(msg: string): string | null {
  const lower = msg.toLowerCase();

  // Pattern: "in Delhi", "near Ranchi", "Ranchi mein", "at Mumbai"
  const locPattern = /\b(?:in|near|at|from)\s+([a-z][a-z ]{2,20}?)(?:\s*$|\s*[,.]|\s+(?:ke|ka|ki|mein|me\b|doctor|hospital|clinic|specialist))/i;
  const m = lower.match(locPattern);
  if (m) {
    const candidate = m[1].trim();
    const hit = ALL_CITIES.find((c) => c === candidate || candidate.startsWith(c + " "));
    if (hit) return hit.split(" ").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  }

  // Hinglish: "Delhi mein doctor"
  const hinglishPat = /([a-z][a-z ]{2,20}?)\s+mein\b/i;
  const hm = lower.match(hinglishPat);
  if (hm) {
    const candidate = hm[1].trim();
    const hit = ALL_CITIES.find((c) => c === candidate);
    if (hit) return hit.split(" ").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  }

  // Direct city name anywhere in message (longest match first)
  const sorted = [...ALL_CITIES].sort((a, b) => b.length - a.length);
  for (const city of sorted) {
    const re = new RegExp(`\\b${city}\\b`, "i");
    if (re.test(lower)) {
      return city.split(" ").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
    }
  }

  return null;
}

  async function send(text?: string) {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput("");
    const currentMessages = messages;
    setMessages((prev) => [...prev, { role: "user", text: msg }]);

    // ── Resolve city (priority: message text > known userCity > GPS/IP) ──────
    // Step 1: check if the user typed a city in this message
    const msgCity = extractLocationFromMessage(msg);
    if (msgCity) applyLocation(msgCity, "manual"); // as authoritative as a manual pick

    let city = msgCity || userCityRef.current;
    let citySource: LocationSource = msgCity ? "manual" : locationSourceRef.current;

    // Step 2: "near me" query with no city named in the message itself —
    // resolve the most accurate location, waiting briefly for an in-flight
    // GPS fix instead of racing ahead with a possibly-wrong IP-based city.
    if (NEAR_ME_PAT.test(msg) && !msgCity) {
      setLoading(true);
      const resolved = await resolveNearMeCity();
      if (!resolved) {
        // Both GPS and IP failed — ask the user to type their city
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: "📍 Couldn't detect your location automatically.",
            askCity: true,
            pendingQuery: msg,
          },
        ]);
        setLoading(false);
        return;
      }
      city = resolved.city;
      citySource = resolved.source;
    }

    setLoading(true);
    // Build history from last 6 messages (exclude prescription/doctor UI messages, just text)
    const history = currentMessages
      .filter((m) => m.text && !m.text.startsWith("📤"))
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 150) }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s hard limit
    try {
      const body: Record<string, unknown> = { message: msg, history };
      if (city) body.user_city = city;
      if (sessionIdRef.current) body.session_id = sessionIdRef.current;
      const res = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Needed so the auth cookie actually reaches the API — without this,
        // optionalAuth on the backend never sees a logged-in user and
        // persistence silently never activates, while everything else about
        // the response still looks completely normal.
        credentials: "include",
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await res.json();

      if (data.session_id) {
        setSessionId(data.session_id);
        // Refresh after every authenticated turn, not just new-session
        // creation — keeps an existing session's position in the "most
        // recent first" list correct too, not just its first appearance.
        if (user) refreshSessions();
      }

      // ── Post-process reply: inject city name into "Here are X doctors" headers ──
      let replyText: string = data.reply || "";
      const resolvedCity = city || null;
      if (resolvedCity && data.intent === "find_doctor") {
        // Replace generic "Here are <Specialty> doctors" with city-aware version
        replyText = replyText.replace(
          /^(Here are\s+\*\*[^*]+\*\*\s+doctors)(\.?\s*[:：]?\s*$)/im,
          (_, prefix, suffix) => `${prefix} in **${resolvedCity}**${suffix}`
        );
        // Also handle "I found X doctors" pattern
        replyText = replyText.replace(
          /^(I found \d+ \*\*[^*]+\*\*\s+doctors?)(\.?\s*$)/im,
          (_, prefix) => `${prefix} in **${resolvedCity}**`
        );
      }

      // If a "near me" query had to fall back to the coarser IP-based city
      // (GPS didn't settle in time), say so — the header may still correct
      // itself to a more precise city moments later.
      if (resolvedCity && citySource === "ip" && NEAR_ME_PAT.test(msg)) {
        replyText += "\n\n📶 *Using your approximate network location — tap 📍 to set your exact city if this looks wrong.*";
      }

      // ── Show "Find Doctors Near Me" chip after health-advice replies ────────
      const isHealthAdvice =
        (data.intent === "health_info" || data.intent === "general" || data.intent === "health_advice") &&
        (!data.doctors || data.doctors.length === 0);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: replyText,
          doctors: data.doctors || [],
          hospitals: data.hospitals || [],
          showNearMeChip: isHealthAdvice,
          resolvedCity: resolvedCity ?? undefined,
          resolvedCitySource: citySource,
        },
      ]);
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "AbortError";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: isTimeout
            ? "⏱️ It's taking longer than usual. Please try again in a moment."
            : "Sorry, I couldn't connect to the server. Please try again.",
        },
      ]);
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setMessages((prev) => [
      ...prev,
      { role: "user", text: `📎 ${file.name}`, isFile: true },
    ]);
    setUploading(true);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", text: "📤 Uploading your prescription... reading medicines with AI..." },
    ]);

    try {
      const upload = await uploadPrescription(file);
      const result = await processPrescription(upload.id);
      const meds = result.medicines || [];

      setMessages((prev) => {
        const next = [...prev];
        // replace the "uploading..." message
        const idx = next.findLastIndex((m) => m.role === "assistant" && m.text.startsWith("📤"));
        if (idx !== -1) {
          next[idx] = {
            role: "assistant",
            text: meds.length > 0
              ? `✅ Done! Found **${meds.length} medicine${meds.length !== 1 ? "s" : ""}** in your prescription. Here's your schedule:`
              : "⚠️ I couldn't find any medicines in this image. Please try a clearer photo.",
            prescription: meds.length > 0 ? { id: upload.id, medicines: meds } : undefined,
          };
        }
        return next;
      });
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.findLastIndex((m) => m.role === "assistant" && m.text.startsWith("📤"));
        if (idx !== -1) {
          next[idx] = {
            role: "assistant",
            text: `❌ Sorry, couldn't process this file. ${err instanceof Error ? err.message : "Please try again."}`,
          };
        }
        return next;
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleMedicineImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    // Show image preview in chat
    const previewUrl = URL.createObjectURL(file);
    setMessages((prev) => [
      ...prev,
      { role: "user", text: "📷 Medicine label photo", isFile: true, imagePreview: previewUrl },
      { role: "assistant", text: "🔍 Analyzing the medicine label... please wait." },
    ]);
    setUploading(true);

    const labelController = new AbortController();
    const labelTimeout = setTimeout(() => labelController.abort(), 20000);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API}/api/chat/analyze-medicine-label`, {
        method: "POST",
        body: formData,
        signal: labelController.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Analysis failed");
      }
      const label: MedicineLabel = await res.json();

      setMessages((prev) => {
        const next = [...prev];
        const idx = next.findLastIndex((m) => m.role === "assistant" && m.text.startsWith("🔍"));
        if (idx !== -1) {
          if (label.source === "none" && label.error) {
            // Rate limit or total failure — don't show empty card, just show text
            next[idx] = { role: "assistant", text: label.error };
          } else {
            next[idx] = {
              role: "assistant",
              text: label.name
                ? `💊 Here's what I found about **${label.name}**:`
                : "⚠️ I could partially read the label. Here's what I found:",
              medicineLabel: label,
            };
          }
        }
        return next;
      });
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "AbortError";
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.findLastIndex((m) => m.role === "assistant" && m.text.startsWith("🔍"));
        if (idx !== -1) {
          next[idx] = {
            role: "assistant",
            text: isTimeout
              ? "⏱️ Analysis is taking too long. Please try again."
              : `❌ ${err instanceof Error ? err.message : "Could not analyze the image. Please try again."}`,
          };
        }
        return next;
      });
    } finally {
      clearTimeout(labelTimeout);
      setUploading(false);
    }
  }

  const busy = loading || uploading;

  return (
    <div className={compact ? "h-full flex flex-col bg-white/60" : "app-viewport flex bg-transparent"}>
      {/* Sidebar — full-page /chat view only, per spec. The compact floating
          widget (384×520px) has no room for a persistent side panel. */}
      {!compact && (
        <ChatSidebar
          sessions={sessions}
          currentSessionId={sessionId}
          loading={sessionsLoading}
          error={sessionsError}
          onNewChat={startNewChat}
          onSelectSession={selectSession}
          onRenameSession={handleRenameSession}
          onDeleteSession={handleDeleteSession}
          onRetry={refreshSessions}
          mobileOpen={sidebarOpen}
          onMobileClose={() => setSidebarOpen(false)}
        />
      )}
      <div className="flex-1 min-w-0 flex flex-col">
      {/* Header — shrink-0 so it keeps its size and the message list absorbs
          the flex slack, rather than the header stretching on tall screens. */}
      {!compact && (
        <div className="shrink-0 bg-doctar-700 text-white px-4 py-2.5 sm:px-6 sm:py-4 shadow">
          <div className="max-w-2xl mx-auto flex items-center gap-2 sm:gap-3">
            {/* Sidebar toggle — mobile only. Above md the sidebar is always
                visible inline (see ChatSidebar's md: classes), so there's
                nothing for this button to open there. */}
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open chat history"
              className="md:hidden shrink-0 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            {/* Decorative only — deliberately not a link.
                `draggable={false}` matters: a bare <img> is natively draggable,
                so an imprecise click (mousedown, slight move, mouseup) starts an
                image drag, and dropping it back on the tab navigates the browser
                to /doctar-logo.svg — a real full page load that wipes the whole
                conversation and reads as "clicking the logo reloaded the page".
                `pointer-events-none` makes the element inert to clicks entirely.
                Linking it home would be pointless anyway: next.config.ts
                redirects / → /chat, so this page already is home. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/doctar-logo.svg"
              alt="DOCTAR"
              draggable={false}
              className="w-8 h-8 sm:w-10 sm:h-10 rounded-full pointer-events-none select-none shrink-0"
            />
            <div className="min-w-0">
              <h1 className="font-bold text-base sm:text-lg leading-tight truncate">DOCTAR AI Assistant</h1>
              {/* Hidden on phones: this subtitle wrapped to two lines on a
                  narrow screen, and that extra height came straight out of the
                  conversation area. The chips below say the same thing. */}
              <p className="hidden sm:block text-doctar-200 text-sm">Find doctors · Upload prescription · Health guidance</p>
            </div>

            {/* ── Location selector — top-right of header ── */}
            <div ref={pickerRef} className="ml-auto flex items-center gap-2 shrink-0 relative">
              {/* Clickable row: label + button */}
              <button
                onClick={() => setShowPicker((v) => !v)}
                className="flex items-center gap-2 group"
              >
                <div className="text-right max-w-[110px] sm:max-w-none">
                  <p className="hidden sm:block text-[11px] text-doctar-300 leading-none tracking-wide uppercase">
                    Your location
                  </p>
                  <p className="text-[12px] sm:text-[14px] font-medium text-white leading-tight sm:mt-0.5 truncate group-hover:text-doctar-200 transition-colors">
                    {locStatus === "loading" || locationResolving ? "Detecting…" : userCity || "Set location"}
                  </p>
                </div>

                {/* Pin button — white squircle */}
                <div className={`w-9 h-9 sm:w-11 sm:h-11 shrink-0 bg-white rounded-[14px] sm:rounded-[18px] border border-gray-200 shadow-md flex items-center justify-center transition-all group-hover:shadow-lg ${
                  locStatus === "loading" || locationResolving ? "animate-pulse opacity-70" : ""
                } ${showPicker ? "ring-2 ring-white/60" : ""}`}>
                  {locStatus === "loading" || locationResolving ? (
                    <svg className="w-5 h-5 animate-spin text-[#9333ea]" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                      <path
                        stroke="#9333ea" strokeWidth="1.8"
                        strokeLinecap="round" strokeLinejoin="round"
                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                      />
                      <circle cx="12" cy="11" r="2.2" fill="#9333ea" />
                    </svg>
                  )}
                </div>
              </button>

              {/* Dropdown picker */}
              {showPicker && (
                <LocationPicker
                  detecting={locStatus === "loading" || locationResolving}
                  onClose={() => setShowPicker(false)}
                  onSelect={(city) => {
                    applyLocation(city, "manual");
                    setLocStatus("idle");
                    setShowPicker(false);
                  }}
                  onDetect={async () => {
                    const city = await getLocation();
                    if (city) setShowPicker(false);
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Messages — min-h-0 is required: a flex child defaults to min-height
          auto, so a tall conversation would grow the column past the viewport
          and push the input row off-screen instead of scrolling internally. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 sm:py-4">
        <div className={`${compact ? "" : "max-w-2xl mx-auto"} space-y-4`}>
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] ${m.role === "user" ? "" : "w-full"}`}>
                {m.role === "assistant" && (
                  <div className="flex items-center gap-1.5 mb-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                      src="/doctar-logo.svg"
                      alt=""
                      draggable={false}
                      className="w-5 h-5 rounded-full pointer-events-none select-none"
                    />
                    <span className="text-xs font-medium text-doctar-700">DOCTAR AI</span>
                  </div>
                )}
                {m.imagePreview && (
                  <div className="mb-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={m.imagePreview}
                      alt="Medicine label"
                      className="rounded-xl max-h-48 object-contain border border-doctar-200"
                    />
                  </div>
                )}
                <div
                  className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    m.role === "user"
                      ? m.isFile
                        ? "bg-doctar-100 text-doctar-800 border border-doctar-200 rounded-br-sm"
                        : "bg-doctar-600 text-white rounded-br-sm"
                      : "bg-white text-gray-800 shadow-sm border border-gray-100 rounded-bl-sm"
                  }`}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }}
                />
                {m.doctors && m.doctors.length > 0 && (
                  <div className="mt-1 space-y-2">
                    {m.doctors.map((d) => <DoctorCard key={d.id} d={d} />)}
                  </div>
                )}
                {m.hospitals && m.hospitals.length > 0 && (
                  <div className="mt-1 space-y-2">
                    {m.hospitals.map((h) => <HospitalCard key={h.id} h={h} />)}
                  </div>
                )}
                {m.askCity && (
                  <form
                    className="mt-2 flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const input = (e.currentTarget.elements.namedItem("city") as HTMLInputElement);
                      const typed = input.value.trim();
                      if (!typed) return;
                      applyLocation(typed, "manual");
                      // re-fire the original near-me query with the typed city
                      send(m.pendingQuery || typed);
                    }}
                  >
                    <input
                      name="city"
                      autoFocus
                      placeholder="Enter your city…"
                      className="flex-1 border border-doctar-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-doctar-500"
                    />
                    <button
                      type="submit"
                      className="shrink-0 bg-doctar-600 hover:bg-doctar-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
                    >
                      Go
                    </button>
                  </form>
                )}
                {m.prescription && (
                  <PrescriptionMessage result={m.prescription} />
                )}
                {m.medicineLabel && (
                  <MedicineLabelCard label={m.medicineLabel} />
                )}
                {m.showNearMeChip && (
                  <div className="mt-3">
                    <button
                      onClick={() => send("find doctors near me")}
                      className="inline-flex items-center gap-1.5 text-sm font-medium bg-doctar-50 hover:bg-doctar-100 border border-doctar-200 text-doctar-700 rounded-full px-3 py-1.5 transition-colors"
                    >
                      🏥 Find Doctors Near Me
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {busy && !uploading && (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                <div className="flex gap-1.5 items-center">
                  <span className="w-2 h-2 bg-doctar-400 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-2 h-2 bg-doctar-400 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-2 h-2 bg-doctar-400 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Suggestions */}
      {messages.length === 1 && (
        <div className={`shrink-0 px-4 pb-2 ${compact ? "" : "max-w-2xl mx-auto w-full"}`}>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-xs bg-doctar-50 hover:bg-doctar-100 text-doctar-700 border border-doctar-200 rounded-full px-3 py-1.5 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input — shrink-0 keeps it pinned above the fold; pb uses the safe-area
          inset so it clears the iOS home indicator / Android gesture bar. */}
      <div className="shrink-0 px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-white border-t border-gray-100">
        {/* Compact mode: show current city + location picker trigger */}
        {compact && (
          <div ref={pickerRef} className="relative mb-2 flex items-center justify-between">
            <button
              onClick={() => setShowPicker((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-doctar-600 hover:text-doctar-800 transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                <path stroke="#9333ea" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <circle cx="12" cy="11" r="2.2" fill="#9333ea" />
              </svg>
              <span>{locStatus === "loading" || locationResolving ? "Detecting…" : userCity ? `📍 ${userCity}` : "Set your city"}</span>
            </button>
            {showPicker && (
              <div className="absolute bottom-full right-0 mb-1 z-50">
                <LocationPicker
                  detecting={locStatus === "loading" || locationResolving}
                  onClose={() => setShowPicker(false)}
                  onSelect={(city) => { applyLocation(city, "manual"); setLocStatus("idle"); setShowPicker(false); }}
                  onDetect={async () => { const city = await getLocation(); if (city) setShowPicker(false); }}
                />
              </div>
            )}
          </div>
        )}
        <div className={`${compact ? "" : "max-w-2xl mx-auto"} flex gap-2 items-center`}>
          {/* Prescription attachment button */}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            title="Upload prescription"
            className="shrink-0 w-10 h-10 flex items-center justify-center text-doctar-600 hover:bg-doctar-50 disabled:opacity-40 rounded-xl border border-gray-200 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={handleFile}
          />

          {/* Medicine label scan button */}
          <button
            onClick={() => cameraRef.current?.click()}
            disabled={busy}
            title="Scan medicine label / पैकेट की फोटो लें"
            className="shrink-0 w-10 h-10 flex items-center justify-center text-doctar-500 hover:bg-doctar-50 disabled:opacity-40 rounded-xl border border-gray-200 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleMedicineImage}
          />

          <input
            className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-doctar-500 focus:border-transparent"
            placeholder={listening ? "🎙️ Listening… speak now" : "Ask about doctors, or attach a prescription 📎"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            disabled={busy}
          />

          {/* Voice input — rendered only where the Web Speech API exists.
              Sits on the right, between the text field and Send: dictating is
              part of composing a message, so it belongs with the send action
              rather than with the attach/scan inputs on the left. */}
          {voiceSupported && (
            <button
              onClick={listening ? stopListening : startListening}
              disabled={uploading}
              title={listening ? "Stop listening" : "Speak your question"}
              aria-label={listening ? "Stop voice input" : "Start voice input"}
              aria-pressed={listening}
              className={`shrink-0 w-10 h-10 flex items-center justify-center rounded-xl border transition-colors ${
                listening
                  ? "bg-red-50 border-red-300 text-red-600 animate-pulse"
                  : "text-doctar-500 hover:bg-doctar-50 border-gray-200"
              } disabled:opacity-40`}
            >
              {listening ? (
                <span className="relative flex items-center justify-center">
                  <span className="absolute w-3 h-3 bg-red-500 rounded-full animate-ping opacity-75" />
                  <span className="relative w-2.5 h-2.5 bg-red-600 rounded-full" />
                </span>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-14 0m7 7v3m0-3a4 4 0 01-4-4V6a4 4 0 118 0v8a4 4 0 01-4 4z" />
                </svg>
              )}
            </button>
          )}

          <button
            onClick={() => send()}
            disabled={busy || !input.trim()}
            className="shrink-0 bg-doctar-600 hover:bg-doctar-700 disabled:opacity-40 text-white w-10 h-10 flex items-center justify-center rounded-xl transition-colors"
          >
            <svg className="w-4 h-4 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
        {voiceError && (
          <p className="mt-1.5 text-center text-xs text-red-500">{voiceError}</p>
        )}
        <p className="mt-1.5 text-center text-xs text-gray-400">
          📎 Prescription &nbsp;·&nbsp; <span className="text-doctar-400">📷 Scan medicine label</span>
          {voiceSupported && <> &nbsp;·&nbsp; <span className="text-doctar-400">🎙️ Speak</span></>}
        </p>
      </div>
      </div>
    </div>
  );
}
