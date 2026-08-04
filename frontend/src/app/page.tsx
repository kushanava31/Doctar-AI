"use client";

import { useState } from "react";
import MedicineEditor from "@/components/MedicineEditor";
import StepIndicator from "@/components/StepIndicator";
import UploadZone from "@/components/UploadZone";
import {
  imageUrl,
  pdfDownloadUrl,
  processPrescription,
  type MedicineItem,
  updatePrescription,
  uploadPrescription,
} from "@/lib/api";

type Step = "upload" | "processing" | "review" | "done";

export default function HomePage() {
  const [step, setStep] = useState<Step>("upload");
  const [prescriptionId, setPrescriptionId] = useState<string | null>(null);
  const [medicines, setMedicines] = useState<MedicineItem[]>([]);
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filename, setFilename] = useState("");
  const [mimeType, setMimeType] = useState("");

  const handleUpload = async (file: File) => {
    setError(null);
    setLoading(true);
    setFilename(file.name);
    setMimeType(file.type);
    try {
      const upload = await uploadPrescription(file);
      setPrescriptionId(upload.id);
      setStep("processing");

      const result = await processPrescription(upload.id);
      setOcrText(result.ocr_text);
      setMedicines(result.medicines || []);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStep("upload");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAndPdf = async () => {
    if (!prescriptionId) return;
    setError(null);
    setLoading(true);
    try {
      await updatePrescription(prescriptionId, medicines);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep("upload");
    setPrescriptionId(null);
    setMedicines([]);
    setOcrText(null);
    setError(null);
    setFilename("");
    setMimeType("");
  };

  return (
    <main className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-5">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-doctar-800">
              DOCTAR
            </h1>
            <p className="text-sm text-slate-500">AI Prescription Reader</p>
          </div>
          {step !== "upload" && (
            <button
              type="button"
              onClick={reset}
              className="text-sm text-slate-600 hover:text-doctar-700"
            >
              New prescription
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-8">
        <StepIndicator current={step} />

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {step === "upload" && (
          <section>
            <h2 className="mb-2 text-2xl font-semibold text-slate-900">
              Upload your prescription
            </h2>
            <p className="mb-6 text-slate-600">
              We&apos;ll read the image with OCR and extract medicine details using AI.
            </p>
            <UploadZone onFileSelect={handleUpload} disabled={loading} />
            {loading && (
              <p className="mt-4 text-center text-sm text-doctar-600">
                Uploading and analyzing…
              </p>
            )}
          </section>
        )}

        {step === "processing" && (
          <section className="py-16 text-center">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-doctar-200 border-t-doctar-600" />
            <h2 className="text-xl font-semibold">Analyzing prescription</h2>
            <p className="mt-2 text-slate-600">OCR → medicine extraction…</p>
            {filename && (
              <p className="mt-1 text-sm text-slate-400">{filename}</p>
            )}
          </section>
        )}

        {step === "review" && prescriptionId && (
          <section>
            <h2 className="mb-2 text-2xl font-semibold">Review medicines</h2>
            <p className="mb-6 text-slate-600">
              Correct any mistakes before generating your schedule PDF.
            </p>

            <div className="mb-6 grid gap-4 sm:grid-cols-2">
              {prescriptionId && (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {mimeType === "application/pdf" ? (
                    <iframe
                      src={imageUrl(prescriptionId)}
                      title="Prescription PDF"
                      className="h-48 w-full"
                    />
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={imageUrl(prescriptionId)}
                      alt="Prescription"
                      className="max-h-48 w-full object-contain"
                    />
                  )}
                </div>
              )}
              {ocrText && (
                <details className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-slate-700">
                    OCR text
                  </summary>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-slate-600">
                    {ocrText}
                  </pre>
                </details>
              )}
            </div>

            <MedicineEditor medicines={medicines} onChange={setMedicines} />

            <button
              type="button"
              onClick={handleSaveAndPdf}
              disabled={loading || medicines.length === 0}
              className="mt-8 w-full rounded-xl bg-doctar-600 py-3 font-semibold text-white hover:bg-doctar-700 disabled:opacity-50"
            >
              {loading ? "Saving…" : "Save & generate PDF"}
            </button>
          </section>
        )}

        {step === "done" && prescriptionId && (
          <section className="py-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-doctar-100 text-3xl">
              ✓
            </div>
            <h2 className="text-2xl font-semibold text-slate-900">Schedule ready</h2>
            <p className="mt-2 text-slate-600">
              Your medicine schedule PDF has been prepared.
            </p>
            <a
              href={pdfDownloadUrl(prescriptionId)}
              download
              className="mt-8 inline-block rounded-xl bg-doctar-600 px-8 py-3 font-semibold text-white hover:bg-doctar-700"
            >
              Download PDF
            </a>
            <button
              type="button"
              onClick={reset}
              className="mt-4 block w-full text-sm text-slate-600 hover:text-doctar-700"
            >
              Process another prescription
            </button>
          </section>
        )}
      </div>

      <footer className="mt-16 border-t border-slate-200 py-6 text-center text-xs text-slate-400">
        For reference only. Always follow your doctor&apos;s advice.
      </footer>
    </main>
  );
}
