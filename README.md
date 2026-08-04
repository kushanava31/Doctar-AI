# DOCTAR — AI Prescription Reader

Upload a prescription image (JPG, PNG, PDF), extract medicines via OCR + AI,
review and edit, then download a bilingual (English/Hindi) medicine schedule PDF.
Also includes a chat assistant for doctor/hospital lookup, medicine information,
and medicine-label scanning.

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
for the API only). Then open **http://localhost:3000**.

## MVP flow

```
Upload → OCR (Gemini multimodal) → AI extraction (Gemini) → Review/Edit → PDF (pdfkit)
```

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
| Chat AI | Gemini 2.5 Flash-Lite |
| PDF | pdfkit + NotoSans Devanagari (bilingual EN/HI) |

## Configuration

All config is via `backend-node/.env` (see `.env.example`):

| Var | Purpose |
|-----|---------|
| `MONGODB_URI` | MongoDB connection string (local or Atlas) |
| `PORT` | API port (default 8000) |
| `CORS_ORIGINS` | Comma-separated allowed origins, or `*` |
| `GEMINI_API_KEY` | Primary AI — OCR, extraction, chat, medicine info |
| `GOOGLE_APPLICATION_CREDENTIALS` | Vision service-account JSON (optional) |
| `GOOGLE_PLACES_API_KEY` | Live doctor/hospital search (optional) |
| `OPENAI_API_KEY` | Fallback medicine extraction (optional) |
| `ANTHROPIC_API_KEY` | Reserved for medicine lookup (optional) |
| `USE_MOCK_OCR` | Force mock OCR + rule-based extraction (no external calls) |
| `USE_REAL_DOCTOR_DB` | Read real doctors only — never seed/generate |
| `USE_REAL_MEDICINE_DB` | Disable the built-in medicine fallback dict |

### Getting a Gemini key

1. Create a free key at <https://aistudio.google.com/apikey>
2. Set `GEMINI_API_KEY=AIza...` in `backend-node/.env`
3. Restart the API

With no keys set, the app still runs — OCR/extraction/chat fall back to
rule-based/mock paths.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/prescriptions/upload` | Upload image/PDF |
| POST | `/api/prescriptions/:id/process` | Run OCR + AI extraction |
| GET | `/api/prescriptions/:id` | Get prescription |
| PATCH | `/api/prescriptions/:id` | Update medicines |
| GET | `/api/prescriptions/:id/pdf` | Download schedule PDF (`?lang=en\|hi\|both`) |
| GET | `/api/prescriptions/:id/image` | View uploaded file |
| POST | `/api/chat` | Chat assistant (doctor recommendations, health advice) |
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
│   │   ├── services/         # OCR, LLM extraction, PDF, chat, doctor, medicine…
│   │   ├── data/             # seedDoctors.ts (sample data)
│   │   └── scripts/seed.ts   # seed sample doctors (disposable DB only)
│   ├── fonts/                # NotoSans Devanagari (PDF)
│   ├── patches/              # fontkit Devanagari fix
│   └── Dockerfile
├── frontend/                 # Next.js app
│   └── src/
│       ├── app/              # pages + chat widget
│       ├── components/       # UploadZone, MedicineEditor, ChatWidget…
│       └── lib/api.ts        # API client
├── credentials/              # drop Google Vision JSON here
├── docker-compose.yml        # builds the Node API
├── start.bat / run-backend.bat
└── README.md
```

## Doctor recommendations

The chat assistant surfaces relevant doctors from the `doctors` collection based
on symptom/speciality queries. It is a **read-only recommendation service** —
**appointment booking is not implemented.** `getDoctorRecommendations()` in
[doctorRepository.ts](backend-node/src/services/doctorRepository.ts) is the only
doctor operation.

When `USE_REAL_DOCTOR_DB=false`, missing-city lookups fall back to:
1. Google Places live search (if `GOOGLE_PLACES_API_KEY` is set)
2. Gemini-generated profiles (if `GEMINI_API_KEY` is set)
3. Deterministic mock profiles (always available)

> **Seeding:** `npm run seed` clears and repopulates the `doctors` collection
> with ~480 samples. **Do not run it against a database shared with another app**
> — it deletes existing doctors. Set `USE_REAL_DOCTOR_DB=true` to read real data
> only and never seed.

## Out of scope

- Authentication / user accounts
- Appointment booking
- WhatsApp reminders / voice calling
- Symptom checker beyond basic OTC advice

## License

MIT
