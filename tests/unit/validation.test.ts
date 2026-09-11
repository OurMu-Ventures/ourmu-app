import { describe, expect, it } from "vitest";
import { applicationSchema, investmentRequestSchema } from "@/lib/validation";
describe("server input validation", () => {
  it("normalizes applicant email", () => {
    const parsed = applicationSchema.parse({
      legalName: "Test Investor",
      email: " TEST@Example.COM ",
      phone: "+256700000000",
      dateOfBirth: "1990-01-01",
      nin: "CM1234567890",
      address: "Kampala Road",
      district: "Kampala",
      country: "Uganda",
      consent: "yes",
    });
    expect(parsed.email).toBe("test@example.com");
  });
  it("accepts a cash-first investment request with two decimal places", () => {
    expect(
      investmentRequestSchema.safeParse({
        cycleId: "a1b2c3d4-e5f6-47a8-9123-abcdef123456",
        principalUgx: "125000.50",
        agreementAccepted: "yes",
      }).success,
    ).toBe(true);
  });
  it.each(["124999.99", "62500000.01", "125000.001", "not-money"])(
    "rejects invalid portal principal %s",
    (principalUgx) => {
      expect(
        investmentRequestSchema.safeParse({
          cycleId: "a1b2c3d4-e5f6-47a8-9123-abcdef123456",
          principalUgx,
          agreementAccepted: "yes",
        }).success,
      ).toBe(false);
    },
  );
});
