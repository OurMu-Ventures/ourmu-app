import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildAgreementPdf } from "@/lib/agreements/pdf";
import { buildReceiptPdf } from "@/lib/receipts/pdf";
import { investmentAccountLabel } from "@/lib/investment-account-context";
import { maturityNoticeDetail } from "@/lib/maturity";
import { renderTransactionalEmail } from "@/lib/email/template";

const accountId = "12345678-1234-4234-8234-123456789012";
describe("readable investment account evidence", () => {
  it("uses the name and a stable short reference", () => {
    expect(investmentAccountLabel("School Fees", accountId)).toBe(
      "School Fees (ref 12345678)",
    );
  });
  it("renders long account names on new agreement and receipt PDFs", async () => {
    const label = investmentAccountLabel(
      "Education Épargne " + "W".repeat(60),
      accountId,
    );
    const agreement = await buildAgreementPdf({
      title: "Investment Agreement",
      template: "Approved synthetic agreement text.",
      investorName: "Test Partner",
      investorEmail: "partner@test.local",
      investmentAccountLabel: label,
      units: 2,
      principalUgx: 250000,
      projectedReturnUgx: 75000,
      projectedValueUgx: 325000,
      maturityDate: "2027-05-31",
      acceptedAt: "2026-11-13T12:00:00Z",
    });
    const receipt = await buildReceiptPdf({
      title: "Investment Receipt",
      receiptNumber: "TEST-2026-000001",
      partnerName: "Test Partner",
      companyName: "OurMu Ventures",
      companyAddress: "Kampala",
      accountDescription: `Accounts payable - Test Partner | Investment account: ${label}`,
      amountUgx: 250000,
      transactionDate: "13 Nov 2026",
      isTest: true,
    });
    expect(agreement.bytes.length).toBeGreaterThan(5000);
    expect(receipt.bytes.length).toBeGreaterThan(5000);
    await mkdir("tmp/pdfs", { recursive: true });
    await writeFile("tmp/pdfs/account-agreement.pdf", agreement.bytes);
    await writeFile("tmp/pdfs/account-receipt.pdf", receipt.bytes);
  });
  it("names the account in both plain-text and HTML maturity notices", () => {
    const notice = {
      accountName: "School Fees <family>",
      principalUgx: 250000,
      projectedReturnUgx: 75000,
      projectedValueUgx: 325000,
      projectedPercent: 30,
      maturityDate: "31 May 2027",
      payoutDate: "15 Jun 2027",
    };
    const detail = maturityNoticeDetail(notice);
    const email = renderTransactionalEmail({
      template: "maturity_notice",
      maturityNotice: notice,
      detail,
    });
    expect("text" in email ? email.text : undefined).toContain("Investment account: School Fees <family>");
    expect(email.html).toContain("School Fees &lt;family&gt;");
    expect(email.html).not.toContain("School Fees <family>");
  });
});
