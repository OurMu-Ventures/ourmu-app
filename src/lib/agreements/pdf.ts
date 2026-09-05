import "server-only";

import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function wrap(text: string, length = 88) {
  const words = text.replace(/[#*_`]/g, "").split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length > length) {
      lines.push(line);
      line = word;
    } else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  return lines;
}

export async function buildAgreementPdf(input: {
  title: string;
  template: string;
  investorName: string;
  units: number;
  principalUgx: number;
  projectedValueUgx: number;
  maturityDate: string;
  acceptedAt: string;
}) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page = document.addPage([595, 842]);
  let y = 790;
  const line = (text: string, font = regular, size = 10) => {
    if (y < 55) {
      page = document.addPage([595, 842]);
      y = 790;
    }
    page.drawText(text, { x: 52, y, size, font, color: rgb(0.06, 0.16, 0.13) });
    y -= size + 5;
  };
  line("OURMU VENTURES", bold, 16);
  line(input.title, bold, 14);
  y -= 8;
  line(`Investor: ${input.investorName}`);
  line(`Units: ${input.units}`);
  line(`Principal: UGX ${input.principalUgx.toLocaleString("en-UG")}`);
  line(
    `Projected value: UGX ${input.projectedValueUgx.toLocaleString("en-UG")}`,
  );
  line(`Maturity date: ${input.maturityDate}`);
  line(`Accepted electronically: ${input.acceptedAt}`);
  y -= 12;
  for (const paragraph of input.template.split(/\n\s*\n/)) {
    for (const wrapped of wrap(paragraph)) line(wrapped);
    y -= 8;
  }
  const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
  return { bytes, hash: createHash("sha256").update(bytes).digest("hex") };
}
