import { describe, expect, it } from "vitest";

import { renderTransactionalEmail } from "@/lib/email/template";
import { formatUgxExact } from "@/lib/receipts/format";

describe("investment receipt email", () => {
  it("renders a themed bank activation with receipt number and amount", () => {
    const email = renderTransactionalEmail({
      template: "investment_activated",
      activationReceipt: {
        partnerName: "Amina Nakato",
        amountUgx: formatUgxExact("125000"),
        receiptNumber: "OURMU-2026-000001",
        isReinvestment: false,
        actionUrl: "https://example.com/investments/abc",
      },
    });
    expect(email.subject).toContain("active");
    expect(email.html).toContain("background:#f4f7f6");
    expect(email.html).toContain("OURMU VENTURES");
    expect(email.html).toContain("Amina Nakato");
    expect(email.html).toContain("OURMU-2026-000001");
    expect(email.html).toContain("UGX 125,000.00");
    expect(email.html).toContain("Investment Receipt");
    expect(email.html).toContain("background:#176b5b");
    expect(email.html).toContain("View investment");
  });

  it("uses distinct reinvestment wording with the source reference", () => {
    const email = renderTransactionalEmail({
      template: "investment_activated",
      activationReceipt: {
        partnerName: "Joint A and B",
        amountUgx: formatUgxExact("1625000.50"),
        receiptNumber: "OURMU-2026-000002",
        isReinvestment: true,
        originalInvestmentRef: "orig-investment-id",
        actionUrl: "https://example.com/investments/xyz",
      },
    });
    expect(email.html).toContain("Reinvestment Receipt");
    expect(email.html).toContain("transferred from your matured investment");
    expect(email.html).toContain("orig-investment-id");
    expect(email.html).toContain("UGX 1,625,000.50");
  });
});

describe("receipt amount formatting", () => {
  it("preserves fractional precision without silent rounding", () => {
    expect(formatUgxExact("125000")).toBe("UGX 125,000.00");
    expect(formatUgxExact("125000.5")).toBe("UGX 125,000.50");
    expect(formatUgxExact("100.12345678")).toBe("UGX 100.12345678");
    expect(formatUgxExact("62500000")).toBe("UGX 62,500,000.00");
  });
});
