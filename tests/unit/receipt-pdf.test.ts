import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildReceiptPdf } from "@/lib/receipts/pdf";

describe("receipt PDF rendering", () => {
  it("renders bank and reinvestment receipts with Open Sans", async () => {
    const bank = await buildReceiptPdf({
      title: "Investment Receipt",
      receiptNumber: "OURMU-2026-000001",
      partnerName: "Amina Nakato Ssematimba-Mukasa the Second of a Very Long Family Name Consortium International",
      partnerPhone: "+256 700 123456",
      companyName: "OURMU Ventures",
      companyAddress: "Kampala, Uganda",
      accountDescription: "Accounts payable — Amina Nakato Ssematimba-Mukasa the Second of a Very Long Family Name Consortium International",
      amountUgx: "1625000.50",
      transactionDate: "15 Sep 2026",
      isTest: false,
    });
    const reinvest = await buildReceiptPdf({
      title: "Reinvestment Receipt",
      receiptNumber: "TEST-OURMU-2026-000001",
      partnerName: "José María Núñez-Träger Østergård",
      partnerPhone: "+256 772 000001",
      companyName: "OURMU Ventures",
      companyAddress: "Kampala, Uganda",
      accountDescription: "Accounts payable — José María Núñez-Träger Østergård",
      amountUgx: "100.12345678",
      transactionDate: "15 Sep 2026",
      originalInvestmentRef: "orig-123",
      transferNote: "This amount was transferred from the matured investment listed above.",
      isTest: true,
    });
    expect(bank.bytes.length).toBeGreaterThan(5000);
    expect(reinvest.bytes.length).toBeGreaterThan(5000);
    expect(bank.hash).toMatch(/^[0-9a-f]{64}$/);
    await mkdir("tmp/receipts", { recursive: true });
    await writeFile("tmp/receipts/bank-sample.pdf", bank.bytes);
    await writeFile("tmp/receipts/reinvest-sample.pdf", reinvest.bytes);
  });
});
