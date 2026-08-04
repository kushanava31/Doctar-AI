# DOCTAR API — Node.js + TypeScript + MongoDB

Standalone REST API for DOCTAR (prescription OCR, medicine info, doctor/hospital
chat assistant). This is a 1:1 port of the original Python/FastAPI backend
(`../backend`) onto Node.js + Express + Mongoose. **Routes and JSON shapes are
identical**, so any frontend that talked to the Python API works unchanged.

## Stack

- **Express** — HTTP server & routing
- **TypeScript** — typed source (ESM, NodeNext)
- **MongoDB + Mongoose** — data store (Doctor collection + Prescription docs)
- **Gemini / Google Vision / OpenAI** — AI OCR, extraction, chat (env-keyed)
- **pdfkit** — bilingual (English/Hindi) medicine-schedule PDFs

## Quick start

```bash
cp .env.example .env          # then fill in MONGODB_URI and any API keys
npm install                   # also applies the fontkit patch (postinstall)
npm run dev                   # start with hot reload on http://localhost:8000
```

> ⚠️ **Do NOT run `npm run seed` against a database shared with the main site.**
> Seeding calls `Doctor.deleteMany({})` and would wipe the existing `doctors`
> collection. This deployment uses `USE_REAL_DOCTOR_DB=true` so the API only
> reads real doctor data and never seeds. `npm run seed` is for a disposable /
> standalone database only.

Production:

```bash
npm run build && npm start
```

## Configuration (`.env`)

| Var | Purpose |
|-----|---------|
| `MONGODB_URI` | Mongo connection string (local or Atlas) |
| `PORT` | HTTP port (default 8000) |
| `CORS_ORIGINS` | Comma-separated allowed origins, or `*` for any |
| `GEMINI_API_KEY` | Primary AI (OCR, extraction, chat, medicine info) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to Vision service-account JSON (optional) |
| `GOOGLE_PLACES_API_KEY` | Live doctor/hospital search (optional) |
| `OPENAI_API_KEY` | Fallback medicine extraction (optional) |
| `ANTHROPIC_API_KEY` | Reserved for medicine lookup (optional) |
| `USE_MOCK_OCR` / `USE_REAL_DOCTOR_DB` / `USE_REAL_MEDICINE_DB` | Feature flags |

## API surface

| Method | Route |
|--------|-------|
| POST | `/api/prescriptions/upload` |
| POST | `/api/prescriptions/:id/process` |
| GET | `/api/prescriptions/:id` |
| PATCH | `/api/prescriptions/:id` |
| GET | `/api/prescriptions/:id/pdf?lang=en\|hi\|both` |
| GET | `/api/prescriptions/:id/image` |
| POST | `/api/chat` |
| POST | `/api/chat/analyze-medicine-label` |

## Connecting your website

Point your frontend at this service's base URL and set `CORS_ORIGINS` to your
site's domain(s). The DOCTAR Next.js frontend uses `NEXT_PUBLIC_API_URL` — set it
to `http://localhost:8000` (dev) or your deployed API URL.

## Notes on the port

- `pdf_generator.py` (ReportLab) → `services/pdf.ts` (pdfkit). Output matches
  visually, not byte-for-byte. The bundled `NotoSansDevanagari` fonts trigger a
  null-anchor bug in fontkit; `patches/fontkit+2.0.4.patch` guards it and is
  applied automatically on `npm install`.
- The Windows-only offline OCR path (`winocr`) in the label analyzer has no Node
  equivalent and is omitted; the Gemini Vision + Google Vision paths remain.
- Doctor `id` (was auto-increment int) and Prescription `id` (UUID) are both
  surfaced as a stable string `id` in responses, preserving the API contract.
