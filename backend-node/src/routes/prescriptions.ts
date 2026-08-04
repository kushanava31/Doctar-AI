import { Router, Request, Response } from "express";
import { Prescription, prescriptionToResponse, medicineToDoc, MedicineItem } from "../models/Prescription.js";
import { asyncHandler, HttpError } from "../middleware/errorHandler.js";
import { upload } from "../middleware/upload.js";
import { saveUpload, readFileBytes } from "../storage.js";
import { analyzePrescriptionImage } from "../services/prescriptionAi.js";
import { extractTextFromFile } from "../services/ocr.js";
import { extractMedicines } from "../services/llm.js";
import { generateMedicineSchedulePdf } from "../services/pdf.js";

const router = Router();

// POST /api/prescriptions/upload
router.post(
  "/upload",
  upload.single("file"),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw new HttpError(400, "No file uploaded");

    let saved;
    try {
      saved = await saveUpload(req.file);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }

    const prescription = await Prescription.create({
      imagePath: saved.imagePath,
      originalFilename: saved.originalFilename,
      mimeType: saved.mimeType,
      status: "uploaded",
      medicines: [],
    });

    res.json({
      id: String(prescription._id),
      status: prescription.status,
      message: "Prescription uploaded. Call /process to run OCR and extraction.",
    });
  })
);

// POST /api/prescriptions/:id/process
router.post(
  "/:id/process",
  asyncHandler(async (req: Request, res: Response) => {
    const prescription = await Prescription.findById(req.params.id);
    if (!prescription) throw new HttpError(404, "Prescription not found");

    try {
      prescription.status = "processing";
      await prescription.save();
      console.log(
        `▶ PROCESS  id=${prescription._id}  file=${prescription.originalFilename}  mime=${prescription.mimeType}`
      );

      const content = await readFileBytes(prescription.imagePath);
      console.log(`  📂 File read  ${(content.length / 1024).toFixed(1)} KB`);

      // Preferred path: single Gemini multimodal call (OCR + extraction).
      console.log("  🤖 Gemini multimodal OCR + extraction …");
      const combined = await analyzePrescriptionImage(content, prescription.mimeType);

      let ocrText: string;
      let medicines: MedicineItem[];

      if (combined && combined[1].length) {
        [ocrText, medicines] = combined;
        console.log(`  ✅ Gemini combined path — ${ocrText.length} chars OCR, ${medicines.length} medicines`);
      } else {
        console.log("  ↩ Gemini combined unavailable — falling back to OCR + rule parser");
        ocrText = (combined ? combined[0] : "") || (await extractTextFromFile(content, prescription.mimeType));
        console.log(`  📝 OCR text — ${ocrText.length} chars`);
        medicines = await extractMedicines(ocrText);
        console.log(`  💊 Extraction — ${medicines.length} medicines found`);
      }

      prescription.ocrText = ocrText;
      prescription.status = "ocr_complete";
      await prescription.save();

      prescription.medicines = medicines.map(medicineToDoc) as any;
      prescription.status = "ready";
      await prescription.save();
      console.log(`  ✔ Done — status=ready  medicines=${medicines.map((m) => m.name).join(", ")}`);

      res.json({
        id: String(prescription._id),
        status: prescription.status,
        ocr_text: prescription.ocrText,
        medicines,
      });
    } catch (e) {
      console.error(`Processing failed for ${req.params.id}:`, e);
      prescription.status = "error";
      await prescription.save();
      throw new HttpError(500, (e as Error).message);
    }
  })
);

// GET /api/prescriptions/:id
router.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const prescription = await Prescription.findById(req.params.id);
    if (!prescription) throw new HttpError(404, "Prescription not found");
    res.json(prescriptionToResponse(prescription));
  })
);

// PATCH /api/prescriptions/:id
router.patch(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const prescription = await Prescription.findById(req.params.id);
    if (!prescription) throw new HttpError(404, "Prescription not found");

    const medicines = (req.body?.medicines ?? []) as Partial<MedicineItem>[];
    prescription.medicines = medicines.map(medicineToDoc) as any;
    if (prescription.status === "ocr_complete") prescription.status = "ready";
    await prescription.save();

    res.json(prescriptionToResponse(prescription));
  })
);

// GET /api/prescriptions/:id/pdf?lang=en|hi|both
router.get(
  "/:id/pdf",
  asyncHandler(async (req: Request, res: Response) => {
    const lang = (req.query.lang as string) || "both";
    if (!["en", "hi", "both"].includes(lang)) {
      throw new HttpError(400, "lang must be 'en', 'hi', or 'both'");
    }

    const prescription = await Prescription.findById(req.params.id);
    if (!prescription) throw new HttpError(404, "Prescription not found");

    const medicines = (prescription.medicines ?? []).map((m: any) => ({
      name: m.name ?? "",
      dosage: m.dosage ?? "",
      timing: m.timing ?? "",
      duration: m.duration ?? "",
      food_instructions: m.foodInstructions ?? "",
      purpose: m.purpose ?? "",
    })) as MedicineItem[];

    if (!medicines.length) throw new HttpError(400, "No medicines to include in PDF");

    const pdfBytes = await generateMedicineSchedulePdf(String(prescription._id), medicines, {
      lang: lang as "en" | "hi" | "both",
    });
    const suffix = { en: "english", hi: "hindi", both: "bilingual" }[lang as "en" | "hi" | "both"];
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="doctar-schedule-${suffix}-${prescription._id}.pdf"`
    );
    res.send(pdfBytes);
  })
);

// GET /api/prescriptions/:id/image
router.get(
  "/:id/image",
  asyncHandler(async (req: Request, res: Response) => {
    const prescription = await Prescription.findById(req.params.id);
    if (!prescription) throw new HttpError(404, "Prescription not found");
    const content = await readFileBytes(prescription.imagePath);
    res.setHeader("Content-Type", prescription.mimeType);
    res.send(content);
  })
);

export default router;
