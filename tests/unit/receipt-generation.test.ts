import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/receipts/pdf", () => ({
  RECEIPT_TEMPLATE_VERSION: "receipt-v1",
  buildReceiptPdf: vi.fn(),
}));

import { ensureReceiptPdf, type ReceiptRow } from "@/lib/receipts/generate";
import { buildReceiptPdf } from "@/lib/receipts/pdf";
import type { createAdminClient } from "@/lib/supabase/admin";

const receipt: ReceiptRow = {
  id: "receipt-1",
  investment_id: "investment-1",
  investor_id: "owner-1",
  source: "investment_record",
  receipt_number: "OURMU-2026-000001",
  is_test: false,
  partner_name: "Selebera",
  partner_phone: null,
  company_name: "OurMu Ventures Limited",
  company_address: "Katabbi Town Council, Entebbe, Wakiso",
  amount_ugx: "10000000.12345678",
  transaction_date: "2026-09-01",
  account_description: "Investment record — Selebera",
  original_investment_id: null,
  pdf_status: "generating",
  pdf_path: null,
  template_version: "receipt-v1",
};
const upload = vi.fn();
const download = vi.fn();
const update = vi.fn();
const eq = vi.fn();
const neq = vi.fn();
const from = vi.fn();
let admin: ReturnType<typeof createAdminClient>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(buildReceiptPdf).mockResolvedValue({
    bytes: Buffer.from("new pdf"),
    hash: "new-hash",
  });
  upload.mockResolvedValue({ error: null });
  download.mockResolvedValue({ data: new Blob(["stored pdf"]), error: null });
  neq.mockResolvedValue({ error: null });
  eq.mockReturnValue({ error: null, neq });
  update.mockReturnValue({ eq });
  from.mockReturnValue({ update });
  admin = {
    from,
    storage: { from: () => ({ upload, download }) },
  } as unknown as ReturnType<typeof createAdminClient>;
});

describe("shared receipt PDF generation", () => {
  it("generates the imported investment acknowledgment with the original amount and date", async () => {
    const ready = await ensureReceiptPdf(admin, receipt);
    expect(buildReceiptPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Investment Receipt",
        amountUgx: "10000000.12345678",
        partnerName: "Selebera",
        receiptNumber: receipt.receipt_number,
        transactionDate: "1 Sept 2026",
        transferNote: null,
      }),
    );
    expect(ready.pdf_path).toBe("owner-1/receipt-1.pdf");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ pdf_status: "ready", pdf_hash: "new-hash" }),
    );
    expect(from).toHaveBeenCalledWith("investment_receipts");
    expect(from).not.toHaveBeenCalledWith("jobs");
  });

  it("keeps reinvestment wording and its recorded source reference", async () => {
    await ensureReceiptPdf(admin, {
      ...receipt,
      source: "reinvestment",
      original_investment_id: "original-1",
    });
    expect(buildReceiptPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Reinvestment Receipt",
        originalInvestmentRef: "original-1",
        transferNote:
          "This amount was transferred from the matured investment listed above.",
      }),
    );
  });

  it("reuses ready PDFs without regenerating or uploading", async () => {
    const ready = { ...receipt, pdf_status: "ready", pdf_path: "stored.pdf" };
    expect(await ensureReceiptPdf(admin, ready)).toBe(ready);
    expect(buildReceiptPdf).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it("uses the bytes already stored when concurrent attempts collide", async () => {
    upload.mockResolvedValue({
      error: { message: "The resource already exists" },
    });
    await ensureReceiptPdf(admin, receipt);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        pdf_hash: createHash("sha256").update("stored pdf").digest("hex"),
      }),
    );
  });

  it("keeps simultaneous first-generation attempts on one stored PDF and hash", async () => {
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    let builds = 0;
    let stored: Buffer | undefined;
    vi.mocked(buildReceiptPdf).mockImplementation(async () => {
      const bytes = Buffer.from(`candidate-${++builds}`);
      if (builds === 2) release();
      await bothStarted;
      return { bytes, hash: createHash("sha256").update(bytes).digest("hex") };
    });
    upload.mockImplementation(async (_path: string, bytes: Buffer) => {
      if (stored) return { error: { message: "The resource already exists" } };
      stored = bytes;
      return { error: null };
    });
    download.mockImplementation(async () => ({
      data: new Blob([stored!.toString()]),
      error: null,
    }));

    const ready = await Promise.all([
      ensureReceiptPdf(admin, receipt),
      ensureReceiptPdf(admin, receipt),
    ]);

    expect(builds).toBe(2); // Duplicate rendering is permitted; issuance/storage stay unique.
    expect(download).toHaveBeenCalledTimes(1);
    expect(ready.map((row) => row.receipt_number)).toEqual([
      receipt.receipt_number,
      receipt.receipt_number,
    ]);
    for (const [fields] of update.mock.calls) {
      expect(fields).toMatchObject({
        pdf_status: "ready",
        pdf_path: "owner-1/receipt-1.pdf",
        pdf_hash: createHash("sha256").update(stored!).digest("hex"),
      });
    }
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("allows retrying a failed PDF with the same receipt number", async () => {
    await ensureReceiptPdf(admin, { ...receipt, pdf_status: "failed" });
    expect(buildReceiptPdf).toHaveBeenCalledWith(
      expect.objectContaining({ receiptNumber: receipt.receipt_number }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ pdf_status: "ready", last_error_code: null }),
    );
  });

  it("marks upload failures retryable without downgrading a concurrent success", async () => {
    upload.mockResolvedValue({ error: { message: "network unavailable" } });
    await expect(ensureReceiptPdf(admin, receipt)).rejects.toThrow(
      "PDF_UPLOAD_FAILED",
    );
    expect(update).toHaveBeenCalledWith({
      pdf_status: "failed",
      last_error_code: "PDF_UPLOAD_FAILED",
    });
    expect(neq).toHaveBeenCalledWith("pdf_status", "ready");
  });
});
