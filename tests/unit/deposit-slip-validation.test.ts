import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { validateDepositSlip } from "@/lib/deposit-slip-validation";
describe("deposit slip validation", () => {
  it("accepts genuine JPEG, PNG, WebP and PDF files", async () => {
    for (const format of ["jpeg", "png", "webp"] as const) {
      const bytes = await sharp({
        create: { width: 20, height: 20, channels: 3, background: "white" },
      })
        .toFormat(format)
        .toBuffer();
      await expect(
        validateDepositSlip(bytes, `image/${format}`),
      ).resolves.toBeUndefined();
    }
    const pdf = await PDFDocument.create();
    pdf.addPage();
    await expect(
      validateDepositSlip(await pdf.save(), "application/pdf"),
    ).resolves.toBeUndefined();
  });
  it("rejects empty, oversized, unsupported and disguised files", async () => {
    for (const [bytes, mime] of [
      [new Uint8Array(), "image/jpeg"],
      [new Uint8Array(2097153), "application/pdf"],
      [new Uint8Array([1, 2]), "image/heic"],
      [Buffer.from("%PDF-broken"), "application/pdf"],
      [Buffer.from("not an image"), "image/png"],
    ] as const) {
      await expect(validateDepositSlip(bytes, mime)).rejects.toThrow();
    }
  });
  it("rejects an image whose declared type differs", async () => {
    const png = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    await expect(validateDepositSlip(png, "image/jpeg")).rejects.toThrow();
  });
});
