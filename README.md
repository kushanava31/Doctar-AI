# DOCTAR — AI Health Assistant

Two things in one app:

1. **Prescription reader** — upload a prescription image (JPG, PNG, PDF), extract
   medicines via OCR + AI, review and edit, then download a bilingual
   (English/Hindi) medicine schedule PDF.
2. **AI health chat** — find doctors and hospitals, look up medicine and symptom
   information, get emergency first-aid guidance, and scan a medicine label —
   all in English, Hindi, or Hinglish, by voice or by typing.

The backend is a standalone **Node.js + TypeScript** API ([backend-node/](backend-node/));
the frontend is a **Next.js** app ([frontend/](frontend/)). Data lives in **MongoDB**.

## Quick start

Two processes — the API (:8000) and the web app (:3000).

```bash
# 1. API
cd backend-node
cp .env.example .env        # set MONGODB_URI and GEMINI_API_KEY
npm install                 # also applies the fontkit patch (postinstall)
npm run dev                 # → http://localhost:8000

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev                 # → http://localhost:3000
```

On Windows you can launch both at once with **`start.bat`** (or `run-backend.bat`
for the API only). Then open **http://localhost:3000** (redirects to `/chat`).

## MVP flow

```
Upload → OCR (Gemini multimodal) → AI extraction (Gemini) → Review/Edit → PDF (pdfkit)
```

## Chat assistant capabilities

All of the below is one endpoint, `POST /api/chat` — intent is detected from
the message text, not chosen by the client.

| Ask for | What happens |
|---------|--------------|
| "gyno near me", "cardiologist in Kolkata" | Doctor search: local DB → Google Places live search → Gemini-generated profiles → deterministic mock, in that order. A budget cap ("under ₹500") is respected at every step, not just the local DB query. |
| "hospitals in Pune" | Same fallback chain, no local DB step (there's no hospital collection). |
| "what is paracetamol", "dolo 650 dosage" | Medicine info: built-in DB of common Indian OTC/prescription medicines → Gemini real-time lookup → generic fallback. |
| "symptoms of dengue", "stroke ke lakshan" | Symptom info: common symptoms, red-flag warning signs, when to see a doctor, self-care. Emergency-relevant conditions (heart attack, stroke, appendicitis, dengue, diabetes, food poisoning, asthma, typhoid) are a hardcoded built-in DB, not Gemini-generated, so they stay correct even if Gemini is unavailable. This is informational lookup for a *named* condition, not a diagnostic "here's what you might have" symptom checker. |
| "chest pain", "nose bleeding", "choking" | Emergency detection with hardcoded home first-aid steps (never Gemini-generated) alongside nearby emergency hospitals and the 108/112 instruction. |
| "I have a headache", "mujhe bukhar hai" | Home-care advice for minor complaints, in English and Hinglish. |
| Scan a medicine label (📷 button) | `POST /api/chat/analyze-medicine-label` — Gemini vision reads the packaging. |

**Hinglish and typo tolerance:** the rule-based parser understands both
English and Roman-script Hindi ("sar dard", "pet mein dard"), and a
three-stage fuzzy matcher (transliteration normalisation → transposition
check → similarity scoring) catches misspellings of either — "shir dard",
"bukahr", "pait dard" all resolve correctly.

**Voice input:** the mic button next to Send uses the browser's Web Speech
API to transcribe into the text field for review before sending — never
auto-sent. Hidden entirely in browsers without speech recognition (Firefox).

## Tech stack

| Layer | Stack |
|-------|--------|
| Frontend | Next.js 15, React 19, Tailwind CSS |
| Backend | Node.js, TypeScript, Express |
| Data layer | Mongoose (MongoDB) |
| Database | MongoDB Atlas |
| OCR (primary) | Gemini 2.5 Flash-Lite (multimodal, free tier) |
| OCR (optional) | Google Cloud Vision API |
| AI extraction | Gemini (primary) → OpenAI GPT-4o-mini (optional) → regex rules (always) |
| Chat AI | Gemini 2.5 Flash-Lite — doctor/hospital generation, medicine info, symptom info |
| Voice input | Browser Web Speech API (client-side, no backend involved) |
| PDF | pdfkit + NotoSans Devanagari (bilingual EN/HI) |

## Configuration

All config is via `backend-node/.env` (see `.env.example`):

| Var | Purpose |
|-----|---------|
| `MONGODB_URI` | MongoDB connection string (local or Atlas) |
| `PORT` | API port (default 8000) |
| `CORS_ORIGINS` | Comma-separated allowed origins, or `*` |
| `GEMINI_API_KEY` | Primary AI — OCR, extraction, chat, medicine/symptom info |
| `GOOGLE_APPLICATION_CREDENTIALS` | Vision service-account JSON (optional) |
| `GOOGLE_PLACES_API_KEY` | Live doctor/hospital search (optional) |
| `OPENAI_API_KEY` | Fallback medicine extraction (optional) |
| `ANTHROPIC_API_KEY` | Reserved for medicine lookup (optional) |
| `USE_MOCK_OCR` | Force mock OCR + rule-based extraction (no external calls) |
| `USE_REAL_DOCTOR_DB` | `true` = only ever show doctors that exist in the DB (required once pointed at a real shared production database). `false` = the full generation fallback chain runs, so local prototyping gets results for any speciality+city. |
| `USE_REAL_MEDICINE_DB` | Disable the built-in medicine fallback dict |

### Getting a Gemini key

1. Create a free key at <https://aistudio.google.com/apikey>
2. Set `GEMINI_API_KEY=AIza...` in `backend-node/.env`
3. Restart the API

With no keys set, the app still runs — OCR/extraction/chat fall back to
rule-based/mock paths.

> **Free-tier quota:** `gemini-2.5-flash-lite`'s free tier is capped at
> **20 `generateContent` requests/day per project**, shared across every
> Gemini-backed feature (OCR, chat intent parsing, doctor/hospital
> generation, medicine info, symptom info). Once exhausted, the app doesn't
> break — every Gemini call has a deterministic or rule-based fallback — but
> results stop being AI-generated until the quota resets. For real traffic,
> enable billing on the Google Cloud project.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/prescriptions/upload` | Upload image/PDF |
| POST | `/api/prescriptions/:id/process` | Run OCR + AI extraction |
| GET | `/api/prescriptions/:id` | Get prescription |
| PATCH | `/api/prescriptions/:id` | Update medicines |
| GET | `/api/prescriptions/:id/pdf` | Download schedule PDF (`?lang=en\|hi\|both`) |
| GET | `/api/prescriptions/:id/image` | View uploaded file |
| POST | `/api/chat` | Chat assistant — doctors, hospitals, medicine info, symptom info, emergency first aid |
| POST | `/api/chat/analyze-medicine-label` | Scan a medicine packaging label |

## Project structure

```
doctar/
├── backend-node/             # Node.js + TypeScript API
│   ├── src/
│   │   ├── server.ts         # Express app entry
│   │   ├── config.ts         # env → typed settings
│   │   ├── db.ts             # Mongoose connection
│   │   ├── storage.ts        # upload save/read
│   │   ├── middleware/       # errorHandler, multer upload
│   │   ├── models/           # Doctor, Prescription (Mongoose)
│   │   ├── routes/           # prescriptions.ts, chat.ts
│   │   ├── services/         # chat.ts, chatData.ts, doctorRepository.ts,
│   │   │                     # medicineInfo.ts, symptomInfo.ts, gemini.ts,
│   │   │                     # googlePlaces.ts, ocr.ts, llm.ts, pdf.ts…
│   │   ├── data/             # seedDoctors.ts (sample data)
│   │   └── scripts/seed.ts   # seed sample doctors (disposable DB only)
│   ├── fonts/                # NotoSans Devanagari (PDF)
│   ├── patches/              # fontkit Devanagari fix
│   └── Dockerfile
├── frontend/                 # Next.js app
│   └── src/
│       ├── app/               # pages + chat widget mount
│       ├── components/        # ChatInterface (main chat UI + voice input),
│       │                      # ChatWidget (floating bubble), UploadZone,
│       │                      # MedicineEditor…
│       └── lib/api.ts         # API client
├── credentials/               # drop Google Vision JSON here
├── docker-compose.yml         # builds the Node API
├── start.bat / run-backend.bat
└── README.md
```

## Doctor & hospital recommendations

The chat assistant surfaces doctors/hospitals based on speciality/symptom/city
queries. It is a **read-only recommendation service** —
**appointment booking is not implemented** (the "Book Appointment" button on a
doctor card and "Call Ambulance" on a hospital card are the only actions).
`getDoctorRecommendations()` in
[doctorRepository.ts](backend-node/src/services/doctorRepository.ts) is the
core doctor-search operation.

When `USE_REAL_DOCTOR_DB=false`, a search with no local-DB match falls back to:
1. Google Places live search (if `GOOGLE_PLACES_API_KEY` is set)
2. Gemini-generated profiles (if `GEMINI_API_KEY` is set and quota allows)
3. Deterministic mock profiles (always available — no external dependency)

Every step honours a stated budget cap ("under ₹500"), and results from steps
2–4 are labelled AI-generated in the reply so they're never confused with
verified real listings.

> **Seeding:** `npm run seed` clears and repopulates the `doctors` collection
> with ~480 samples. **Do not run it against a database shared with another app**
> — it deletes existing doctors. Set `USE_REAL_DOCTOR_DB=true` to read real data
> only and never seed or generate.

## Out of scope

- Authentication / user accounts
- Appointment booking (doctor cards link out; nothing is booked in-app)
- WhatsApp reminders / voice calling
- Diagnostic symptom checker (input symptoms → get a diagnosis). What exists
  is the reverse: name a condition, get its symptoms and red flags.

## License

MIT
