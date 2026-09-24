import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";

import { formatUgxExact } from "@/lib/receipts/format";

export const RECEIPT_TEMPLATE_VERSION = "receipt-v1";
export const RECEIPT_COMPANY_NAME = "OURMU Ventures";
export const RECEIPT_COMPANY_ADDRESS = "Kampala, Uganda";

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 52;
const INK = rgb(0.09, 0.2, 0.18); // dark green #18332f-ish
const MUTED = rgb(0.35, 0.44, 0.42);
const ACCENT = rgb(0.09, 0.42, 0.36); // #176b5b-ish
const RULE = rgb(0.86, 0.9, 0.89);

async function loadFontBytes(name: string): Promise<Buffer | null> {
  for (const base of [
    join(process.cwd(), "public", "fonts", name),
    join(process.cwd(), "..", "public", "fonts", name),
  ]) {
    try {
      return await readFile(base);
    } catch {
      // try next candidate
    }
  }
  return null;
}

export type ReceiptPdfInput = {
  title: "Investment Receipt" | "Reinvestment Receipt";
  receiptNumber: string;
  partnerName: string;
  partnerPhone?: string | null;
  companyName: string;
  companyAddress: string;
  accountDescription: string;
  amountUgx: string | number;
  transactionDate: string; // already formatted display date
  originalInvestmentRef?: string | null;
  transferNote?: string | null;
  isTest: boolean;
};

/** Wrap text by measured width so long names never clip. */
function wrapMeasured(
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    // Break an overlong single word by characters.
    if (font.widthOfTextAtSize(word, size) > maxWidth) {
      let chunk = "";
      for (const ch of word) {
        const next = chunk + ch;
        if (font.widthOfTextAtSize(next, size) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = ch;
        } else chunk = next;
      }
      line = chunk;
    } else line = word;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function buildReceiptPdf(input: ReceiptPdfInput) {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all([
    loadFontBytes("OpenSans-Regular.ttf"),
    loadFontBytes("OpenSans-Bold.ttf"),
  ]);
  // Open Sans everywhere (per product direction); fall back to Helvetica
  // only if the bundled TTFs are missing at runtime.
  const { StandardFonts } = await import("pdf-lib");
  const regular = regularBytes
    ? await document.embedFont(regularBytes, { subset: true })
    : await document.embedFont(StandardFonts.Helvetica);
  const bold = boldBytes
    ? await document.embedFont(boldBytes, { subset: true })
    : await document.embedFont(StandardFonts.HelveticaBold);

  let page = document.addPage([PAGE_W, PAGE_H]);
  let y = 790;
  const ensureSpace = (height: number) => {
    if (y - height < 60) {
      page = document.addPage([PAGE_W, PAGE_H]);
      y = 790;
    }
  };
  const drawLines = (
    lines: string[],
    font = regular,
    size = 10,
    gap = 4,
    color = INK,
  ) => {
    for (const text of lines) {
      ensureSpace(size + gap);
      page.drawText(text, { x: MARGIN, y, size, font, color });
      y -= size + gap;
    }
  };
  const maxWidth = PAGE_W - MARGIN * 2;

  // Header: brand + company address.
  drawLines(["OURMU VENTURES"], bold, 13, 2, ACCENT);
  drawLines(
    wrapMeasured(input.companyName, regular, 10, maxWidth),
    regular,
    10,
    2,
  );
  drawLines(
    wrapMeasured(input.companyAddress, regular, 9, maxWidth),
    regular,
    9,
    2,
    MUTED,
  );
  y -= 4;
  ensureSpace(2);
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 1,
    color: RULE,
  });
  y -= 16;

  // Title + receipt meta.
  drawLines([input.title], bold, 20, 6);
  drawLines(
    wrapMeasured(`Receipt number: ${input.receiptNumber}`, bold, 10, maxWidth),
    bold,
    10,
    3,
  );
  drawLines([`Date: ${input.transactionDate}`], regular, 10, 3);
  y -= 8;

  // Partner block.
  drawLines(["Received from"], bold, 11, 4);
  drawLines(
    wrapMeasured(input.partnerName, regular, 11, maxWidth),
    regular,
    11,
    4,
  );
  if (input.partnerPhone?.trim()) {
    drawLines(
      wrapMeasured(`Phone: ${input.partnerPhone.trim()}`, regular, 10, maxWidth),
      regular,
      10,
      3,
      MUTED,
    );
  }
  y -= 8;

  // Account / amount block.
  drawLines(["Account"], bold, 11, 4);
  drawLines(
    wrapMeasured(input.accountDescription, regular, 10, maxWidth),
    regular,
    10,
    4,
  );
  if (input.originalInvestmentRef) {
    drawLines(
      wrapMeasured(
        `Original investment: ${input.originalInvestmentRef}`,
        regular,
        10,
        maxWidth,
      ),
      regular,
      10,
      3,
    );
  }
  if (input.transferNote) {
    drawLines(
      wrapMeasured(input.transferNote, regular, 10, maxWidth),
      regular,
      10,
      3,
    );
  }
  y -= 6;
  ensureSpace(2);
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 1,
    color: RULE,
  });
  y -= 14;

  drawLines(["Total received"], bold, 11, 4);
  const total = formatUgxExact(input.amountUgx);
  drawLines(wrapMeasured(total, bold, 18, maxWidth), bold, 18, 6, ACCENT);
  y -= 6;
  drawLines(
    wrapMeasured(
      "This is an investment acknowledgment issued by OURMU Ventures. It is not a tax invoice.",
      regular,
      8,
      maxWidth,
    ),
    regular,
    8,
    3,
    MUTED,
  );

  // Visible test watermark for test investments.
  if (input.isTest) {
    const first = document.getPages()[0];
    first.drawText("TEST — NOT A REAL RECEIPT", {
      x: 70,
      y: 420,
      size: 28,
      font: bold,
      color: rgb(0.75, 0.2, 0.2),
      opacity: 0.18,
      rotate: { type: "degrees", angle: 30 } as never,
    });
    drawLines(["Test investment — not a real receipt."], bold, 9, 3, rgb(0.75, 0.2, 0.2));
  }

  // Footer page numbers.
  const pages = document.getPages();
  pages.forEach((item, index) => {
    item.drawText(`Page ${index + 1} of ${pages.length}`, {
      x: 485,
      y: 28,
      size: 8,
      font: regular,
      color: MUTED,
    });
    item.drawText(`${input.receiptNumber}`, {
      x: MARGIN,
      y: 28,
      size: 8,
      font: regular,
      color: MUTED,
    });
  });

  const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
  return { bytes, hash: createHash("sha256").update(bytes).digest("hex") };
}
