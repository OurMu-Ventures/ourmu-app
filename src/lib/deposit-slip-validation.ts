import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

export const SLIP_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];
export async function validateDepositSlip(bytes: Uint8Array, mime: string) {
  if (!bytes.length || bytes.length > 2097152 || !SLIP_TYPES.includes(mime))
    throw new Error("Use a photo or PDF up to 2 MiB.");
  if (mime === "application/pdf") {
    if (Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-")
      throw new Error("Invalid PDF.");
    const pdf = await PDFDocument.load(bytes);
    if (pdf.isEncrypted || pdf.getPageCount() < 1)
      throw new Error("Use an unencrypted PDF.");
  } else {
    const image = sharp(bytes, { limitInputPixels: 25000000 });
    const metadata = await image.metadata();
    const expected = mime === "image/jpeg" ? "jpeg" : mime.split("/")[1];
    if (metadata.format !== expected || (metadata.pages ?? 1) > 1)
      throw new Error("Invalid photo.");
    await image.stats();
  }
}
