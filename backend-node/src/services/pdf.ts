/**
 * Medicine-schedule PDF generation.
 *
 * Port of the Python ReportLab pdf_generator.py. ReportLab has no direct Node
 * equivalent, so the table is rendered imperatively with pdfkit. Output matches
 * the original visually (same columns, teal theme, bilingual EN/Hindi runs)
 * rather than byte-for-byte.
 */
import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MedicineItem } from "../models/Prescription.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.resolve(__dirname, "..", "..", "fonts");
const DEVANAGARI_REGULAR = path.join(FONTS_DIR, "NotoSansDevanagari-Regular.ttf");
const DEVANAGARI_BOLD = path.join(FONTS_DIR, "NotoSansDevanagari-Bold.ttf");

const CM = 28.3465; // points per cm
const TEAL = "#0f766e";
const TEAL_GRID = "#99f6e4";
const ROW_ALT = "#f0fdfa";
const GREY = "#808080";

type Lang = "en" | "hi" | "both";
type FontKey = "en" | "enBold" | "hi" | "hiBold";
interface Run {
  text: string;
  font: FontKey;
}
type Line = Run[];
type Cell = Line[];

function hindiAvailable(): boolean {
  return fs.existsSync(DEVANAGARI_REGULAR) && fs.existsSync(DEVANAGARI_BOLD);
}

function hasDevanagari(s: string): boolean {
  return /[ऀ-ॿ]/.test(s);
}

// ── Cell content builders (mirror the Python helpers) ─────────────────────
function timingCell(timing: string, lang: Lang): Cell {
  const parts = timing.replace(/ /g, "").split("-");
  if (parts.length !== 3) return [[{ text: timing || "—", font: "en" }]];
  const en = ["Morning", "Afternoon", "Night"];
  const hi = ["सुबह", "दोपहर", "रात"];
  const lines: Line[] = [];
  parts.forEach((p, i) => {
    if (p && p !== "0") {
      if (lang === "hi") lines.push([{ text: hi[i], font: "hi" }, { text: `: ${p}`, font: "en" }]);
      else if (lang === "en") lines.push([{ text: `${en[i]}: ${p}`, font: "en" }]);
      else
        lines.push([
          { text: `${en[i]} / `, font: "en" },
          { text: hi[i], font: "hi" },
          { text: `: ${p}`, font: "en" },
        ]);
    }
  });
  return lines.length ? lines : [[{ text: timing || "—", font: "en" }]];
}

function foodCell(food: string, lang: Lang): Cell {
  const f = (food || "").toUpperCase().trim();
  if (lang === "hi") {
    if (f === "AC") return [[{ text: "खाने से पहले", font: "hi" }]];
    if (f === "PC") return [[{ text: "खाने के बाद", font: "hi" }]];
  } else if (lang === "en") {
    if (f === "AC") return [[{ text: "Before food", font: "en" }]];
    if (f === "PC") return [[{ text: "After food", font: "en" }]];
  } else {
    if (f === "AC")
      return [[{ text: "Before food", font: "en" }], [{ text: "खाने से पहले", font: "hi" }]];
    if (f === "PC")
      return [[{ text: "After food", font: "en" }], [{ text: "खाने के बाद", font: "hi" }]];
  }
  return [[{ text: f || "—", font: "en" }]];
}

function purposeCell(purpose: string, lang: Lang): Cell {
  if (!purpose || purpose === "—") return [[{ text: "—", font: "en" }]];
  if (purpose.includes(" / ")) {
    const idx = purpose.indexOf(" / ");
    const en = purpose.slice(0, idx);
    const hi = purpose.slice(idx + 3);
    if (lang === "en") return [[{ text: en, font: "en" }]];
    if (lang === "hi") return [[{ text: hi, font: "hi" }]];
    return [[{ text: en, font: "en" }], [{ text: hi, font: "hi" }]];
  }
  if (hasDevanagari(purpose)) {
    return [[{ text: purpose, font: lang === "en" ? "en" : "hi" }]];
  }
  return [[{ text: purpose, font: "en" }]];
}

function plain(text: string): Cell {
  return [[{ text: text || "—", font: "en" }]];
}

function headerCell(en: string, hi: string, lang: Lang): Cell {
  if (lang === "hi") return [[{ text: hi, font: "hiBold" }]];
  if (lang === "en") return [[{ text: en, font: "enBold" }]];
  return [[{ text: en, font: "enBold" }], [{ text: hi, font: "hiBold" }]];
}

// ── Layout helpers ────────────────────────────────────────────────────────
const PDFFONT: Record<FontKey, string> = {
  en: "Helvetica",
  enBold: "Helvetica-Bold",
  hi: "NotoHindi",
  hiBold: "NotoHindi-Bold",
};

interface Ctx {
  doc: PDFKit.PDFDocument;
  fontSize: number;
  leading: number;
}

/** Wrap a single logical line (array of runs) into sublines fitting `width`. */
function wrapLine(ctx: Ctx, line: Line, width: number): Line[] {
  const { doc, fontSize } = ctx;
  // Tokenize each run into words, preserving its font.
  const tokens: Run[] = [];
  for (const run of line) {
    const words = run.text.split(/(\s+)/).filter((w) => w !== "");
    for (const w of words) tokens.push({ text: w, font: run.font });
  }
  const sublines: Line[] = [];
  let current: Line = [];
  let curWidth = 0;
  for (const tok of tokens) {
    doc.font(PDFFONT[tok.font]).fontSize(fontSize);
    const tokWidth = doc.widthOfString(tok.text);
    if (curWidth + tokWidth > width && current.length > 0) {
      sublines.push(current);
      current = [];
      curWidth = 0;
      if (/^\s+$/.test(tok.text)) continue; // drop leading whitespace after wrap
    }
    current.push(tok);
    curWidth += tokWidth;
  }
  if (current.length) sublines.push(current);
  return sublines.length ? sublines : [[{ text: "", font: "en" }]];
}

function cellHeight(ctx: Ctx, cell: Cell, width: number): number {
  let lines = 0;
  for (const line of cell) lines += wrapLine(ctx, line, width).length;
  return lines * ctx.leading;
}

/** Draw a cell's text at (x, y) within column width; returns nothing. */
function drawCell(
  ctx: Ctx,
  cell: Cell,
  x: number,
  y: number,
  width: number,
  color: string
): void {
  const { doc, fontSize, leading } = ctx;
  let cursorY = y;
  for (const line of cell) {
    for (const subline of wrapLine(ctx, line, width)) {
      let cursorX = x;
      for (const run of subline) {
        doc.font(PDFFONT[run.font]).fontSize(fontSize).fillColor(color);
        doc.text(run.text, cursorX, cursorY, { lineBreak: false });
        cursorX += doc.widthOfString(run.text);
      }
      cursorY += leading;
    }
  }
}

export interface PdfOptions {
  patientNote?: string;
  lang?: Lang;
}

export function generateMedicineSchedulePdf(
  prescriptionId: string,
  medicines: MedicineItem[],
  options: PdfOptions = {}
): Promise<Buffer> {
  const lang: Lang = options.lang ?? "both";
  const patientNote = options.patientNote ?? "";
  const hasHindi = hindiAvailable();
  const effectiveLang: Lang = hasHindi ? lang : "en";
  const showEn = effectiveLang === "en" || effectiveLang === "both";
  const showHi = (effectiveLang === "hi" || effectiveLang === "both") && hasHindi;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 2 * CM, bottom: 2 * CM, left: 2 * CM, right: 2 * CM } });
    if (hasHindi) {
      doc.registerFont("NotoHindi", DEVANAGARI_REGULAR);
      doc.registerFont("NotoHindi-Bold", DEVANAGARI_BOLD);
    }

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = 2 * CM;
    const pageWidth = doc.page.width - 4 * CM;
    let y = 2 * CM;

    // ── Title ──
    if (showEn) {
      doc.font("Helvetica-Bold").fontSize(18).fillColor(TEAL).text("DOCTAR — Medicine Schedule", left, y);
      y = doc.y + 2;
    }
    if (showHi) {
      doc.font("NotoHindi").fontSize(13).fillColor(TEAL).text("DOCTAR — दवा अनुसूची", left, y);
      y = doc.y + 8;
    }

    // ── Subtitle ──
    const now = new Date();
    const dateStr = now.toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
    });
    const ref = prescriptionId.slice(0, 8);
    doc.fontSize(9).fillColor(GREY);
    if (effectiveLang === "en") {
      doc.font("Helvetica").text(`Generated: ${dateStr}  ·  Ref: ${ref}`, left, y);
    } else if (effectiveLang === "hi") {
      doc.font("NotoHindi").text(`तैयार किया गया: ${dateStr}  ·  संदर्भ: ${ref}`, left, y);
    } else {
      doc.font("Helvetica").text(`Generated / `, left, y, { continued: true });
      doc.font("NotoHindi").text(`तैयार किया गया`, { continued: true });
      doc.font("Helvetica").text(`: ${dateStr}  ·  Ref / `, { continued: true });
      doc.font("NotoHindi").text(`संदर्भ`, { continued: true });
      doc.font("Helvetica").text(`: ${ref}`);
    }
    y = doc.y + 14;

    if (patientNote) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor("black").text("Note: ", left, y, { continued: true });
      doc.font("Helvetica").text(patientNote);
      y = doc.y + 10;
    }

    // ── Table ──
    const ctx: Ctx = { doc, fontSize: 8, leading: 11 };
    const colWidths = [0.7, 3.5, 4, 2.5, 3.2, 1.8, 2.8].map((c) => c * CM);
    // Scale columns to fit page width exactly.
    const totalCol = colWidths.reduce((a, b) => a + b, 0);
    const scale = pageWidth / totalCol;
    const widths = colWidths.map((w) => w * scale);
    const xs: number[] = [];
    let acc = left;
    for (const w of widths) {
      xs.push(acc);
      acc += w;
    }
    const padX = 5;
    const padY = 5;
    const headerPadY = 7;

    const headers: Cell[] = [
      headerCell("#", "क्र.", effectiveLang),
      headerCell("Medicine", "दवा का नाम", effectiveLang),
      headerCell("Purpose", "उपयोग", effectiveLang),
      headerCell("Dosage", "खुराक", effectiveLang),
      headerCell("Schedule", "समय", effectiveLang),
      headerCell("Duration", "अवधि", effectiveLang),
      headerCell("Food", "भोजन", effectiveLang),
    ];

    const rows: Cell[][] = [headers];
    medicines.forEach((med, i) => {
      rows.push([
        plain(String(i + 1)),
        plain(med.name || "—"),
        purposeCell(med.purpose || "—", effectiveLang),
        plain(med.dosage || "—"),
        timingCell(med.timing, effectiveLang),
        plain(med.duration || "—"),
        foodCell(med.food_instructions, effectiveLang),
      ]);
    });

    const drawHeaderRow = (rowY: number): number => {
      const innerWidths = widths.map((w) => w - 2 * padX);
      const h = Math.max(...headers.map((c, i) => cellHeight(ctx, c, innerWidths[i]))) + 2 * headerPadY;
      doc.rect(left, rowY, pageWidth, h).fill(TEAL);
      headers.forEach((cell, i) => {
        drawCell(ctx, cell, xs[i] + padX, rowY + headerPadY, innerWidths[i], "#f5f5f5");
      });
      drawGrid(rowY, h);
      return rowY + h;
    };

    const drawGrid = (rowY: number, h: number) => {
      doc.lineWidth(0.5).strokeColor(TEAL_GRID);
      // verticals
      let gx = left;
      doc.moveTo(gx, rowY).lineTo(gx, rowY + h).stroke();
      for (const w of widths) {
        gx += w;
        doc.moveTo(gx, rowY).lineTo(gx, rowY + h).stroke();
      }
      // horizontals
      doc.moveTo(left, rowY).lineTo(left + pageWidth, rowY).stroke();
      doc.moveTo(left, rowY + h).lineTo(left + pageWidth, rowY + h).stroke();
    };

    const bottomLimit = doc.page.height - 2 * CM;

    y = drawHeaderRow(y);

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const innerWidths = widths.map((w) => w - 2 * padX);
      const h = Math.max(...row.map((c, i) => cellHeight(ctx, c, innerWidths[i]))) + 2 * padY;

      if (y + h > bottomLimit) {
        doc.addPage();
        y = 2 * CM;
        y = drawHeaderRow(y);
      }

      // alternating row background (white / mint)
      if ((r - 1) % 2 === 1) {
        doc.rect(left, y, pageWidth, h).fill(ROW_ALT);
      }
      row.forEach((cell, i) => {
        drawCell(ctx, cell, xs[i] + padX, y + padY, innerWidths[i], "black");
      });
      drawGrid(y, h);
      y += h;
    }

    y += 16;

    // ── Footer ──
    if (showEn) {
      doc.font("Helvetica").fontSize(7).fillColor(GREY).text(
        "Timing: Morning-Afternoon-Night (e.g. 1-0-1 = morning and night). This schedule is for reference only. Follow your doctor's advice.",
        left, y, { width: pageWidth }
      );
      y = doc.y + 3;
    }
    if (showHi) {
      doc.font("NotoHindi").fontSize(7).fillColor(GREY).text(
        "समय: सुबह-दोपहर-रात (उदा. 1-0-1 = सुबह और रात)। यह अनुसूची केवल संदर्भ के लिए है। अपने डॉक्टर की सलाह का पालन करें।",
        left, y, { width: pageWidth }
      );
    }

    doc.end();
  });
}
