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
  investorEmail: string;
  units: number;
  principalUgx: number;
  projectedReturnUgx: number;
  projectedValueUgx: number;
  maturityDate: string;
  acceptedAt: string;
}) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page = document.addPage([595, 842]);
  let y = 790;
  const addPage = () => {
    page = document.addPage([595, 842]);
    y = 790;
  };
  const ensureSpace = (height: number) => {
    if (y - height < 48) addPage();
  };
  const line = (text: string, font = regular, size = 9.5) => {
    ensureSpace(size + 4);
    page.drawText(text, { x: 52, y, size, font, color: rgb(0.06, 0.16, 0.13) });
    y -= size + 4;
  };
  line("OURMU VENTURES", bold, 16);
  line(input.title, bold, 14);
  y -= 8;
  line(`Investor: ${input.investorName}`);
  line(`Email: ${input.investorEmail}`);
  line(`Units: ${input.units}`);
  line(`Principal: UGX ${input.principalUgx.toLocaleString("en-UG")}`);
  line(
    `Projected return (30%): UGX ${input.projectedReturnUgx.toLocaleString("en-UG")}`,
  );
  line(
    `Projected value: UGX ${input.projectedValueUgx.toLocaleString("en-UG")}`,
  );
  line(`Maturity date: ${input.maturityDate}`);
  const acceptedAt = new Date(input.acceptedAt).toLocaleString("en-UG", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Africa/Kampala",
  });
  line(`Accepted electronically: ${acceptedAt}`);
  y -= 12;
  const personalized = input.template
    .replaceAll("{{MEMBER_NAME}}", input.investorName)
    .replaceAll("{{MEMBER_EMAIL}}", input.investorEmail)
    .replaceAll("{{UNITS}}", String(input.units))
    .replaceAll(
      "{{UNIT_PRICE}}",
      (input.principalUgx / input.units).toLocaleString("en-UG"),
    )
    .replaceAll(
      "{{PRINCIPAL}}",
      input.principalUgx.toLocaleString("en-UG"),
    )
    .replaceAll(
      "{{PROJECTED_RETURN}}",
      input.projectedReturnUgx.toLocaleString("en-UG"),
    )
    .replaceAll(
      "{{PROJECTED_VALUE}}",
      input.projectedValueUgx.toLocaleString("en-UG"),
    )
    .replaceAll("{{MATURITY_DATE}}", input.maturityDate)
    .replaceAll("{{ACCEPTED_AT}}", acceptedAt);
  const paragraphs = personalized.split(/\n\s*\n/);
  for (const [index, paragraph] of paragraphs.entries()) {
    if (paragraph.startsWith("## ")) {
      const nextParagraph = paragraphs[index + 1] ?? "";
      const nextParagraphHeight = wrap(nextParagraph, 92).length * 13.5 + 5;
      ensureSpace(17 + nextParagraphHeight);
      y -= 2;
      line(paragraph.slice(3), bold, 11);
      continue;
    }
    const wrappedLines = wrap(paragraph, 92);
    ensureSpace(wrappedLines.length * 13.5 + 5);
    for (const wrapped of wrappedLines) line(wrapped);
    y -= 5;
  }
  const pages = document.getPages();
  pages.forEach((item, index) => {
    item.drawText(`Page ${index + 1} of ${pages.length}`, {
      x: 485,
      y: 28,
      size: 8,
      font: regular,
      color: rgb(0.35, 0.42, 0.4),
    });
  });
  const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
  return { bytes, hash: createHash("sha256").update(bytes).digest("hex") };
}
