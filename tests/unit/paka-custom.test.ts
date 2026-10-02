import { describe, expect, it } from "vitest";
import {
  customWithdrawalError,
  fulfilledSplits,
  safeFulfilledSplits,
  maturitySplits,
  maturityInstructionTerms,
} from "@/lib/maturity";
import { maturityInstructionSchema } from "@/lib/validation";

const choice = "withdraw_roi_reinvest_principal" as const;
describe("custom Paka Paka splits", () => {
  it("supports the requested partner example", () => {
    expect(maturitySplits(4_569_760, 1_370_928, choice, 5_000_000)).toEqual({
      payoutUgx: 5_000_000,
      reinvestUgx: 940_688,
    });
  });
  it.each([
    [1_370_928, 5_000_000, 940_688],
    [2_000_000, 5_529_460.56, 1_040_299.44],
    [0, 3_846_153.85, 723_606.15],
  ])(
    "preserves the proportion for actual ROI %s",
    (actual, payout, reinvest) => {
      const result = fulfilledSplits(4_569_760, actual, choice, {
        requestedWithdrawalUgx: 5_000_000,
        projectedTotalUgx: 5_940_688,
      });
      expect(result).toEqual({ payoutUgx: payout, reinvestUgx: reinvest });
      expect(result.payoutUgx + result.reinvestUgx).toBeCloseTo(
        4_569_760 + actual,
        8,
      );
    },
  );
  it("matches decimal half-up rounding without binary floating-point drift", () => {
    expect(
      fulfilledSplits(1_000_000, 1.01, choice, {
        requestedWithdrawalUgx: 650_000,
        projectedTotalUgx: 1_300_000,
      }),
    ).toEqual({ payoutUgx: 500_000.51, reinvestUgx: 500_000.5 });
    expect(maturitySplits(1_000_000, 300_000, choice, 1_000_000.01)).toEqual({
      payoutUgx: 1_000_000.01,
      reinvestUgx: 299_999.99,
    });
  });
  it("retains the accepted terms of old instructions", () => {
    expect(fulfilledSplits(1_000_000, 250_000, choice)).toEqual({
      payoutUgx: 250_000,
      reinvestUgx: 1_000_000,
    });
    expect(maturityInstructionTerms(choice, null)).toContain(
      "Original Paka Paka terms",
    );
  });
  it.each([
    "",
    "abc",
    "-1",
    "1.234",
    "NaN",
    "Infinity",
    "1e6",
    "5,000,000",
    "9".repeat(200),
  ])("rejects malformed or excessive input %s", (amount) => {
    expect(customWithdrawalError(amount, 5_940_688)).not.toBeNull();
  });
  it("directs the endpoints to the other options", () => {
    expect(customWithdrawalError("0", 5_940_688)).toContain("Dobolo");
    expect(customWithdrawalError("5940688", 5_940_688)).toContain("Bijjodolo");
    expect(customWithdrawalError("6000000", 5_940_688)).not.toBeNull();
  });
  it("enforces both reinvestment boundaries", () => {
    expect(customWithdrawalError("100000", 225_000)).toBeNull();
    expect(customWithdrawalError("100000.01", 225_000)).not.toBeNull();
    expect(customWithdrawalError("15000000", 65_000_000)).toBeNull();
    expect(customWithdrawalError("14999999.99", 65_000_000)).not.toBeNull();
  });
  it.each([NaN, Infinity, -1, 0])(
    "handles unavailable total %s without throwing",
    (total) => {
      expect(customWithdrawalError("5000000", total)).toBe(
        "This investment total is unavailable. Please reload.",
      );
    },
  );
  it.each([NaN, Infinity, -1, 0, 1e22])(
    "holds invalid stored projected total %s",
    (total) => {
      expect(
        safeFulfilledSplits(1_000_000, 300_000, choice, {
          requestedWithdrawalUgx: 500_000,
          projectedTotalUgx: total,
        }),
      ).toBeNull();
    },
  );
  it("holds invalid stored amounts and preserves valid legacy previews", () => {
    expect(safeFulfilledSplits(NaN, 300_000, choice)).toBeNull();
    expect(safeFulfilledSplits(1_000_000, Infinity, choice)).toBeNull();
    expect(
      safeFulfilledSplits(1_000_000, 300_000, choice, {
        requestedWithdrawalUgx: NaN,
        projectedTotalUgx: 1_300_000,
      }),
    ).toBeNull();
    expect(
      safeFulfilledSplits(1_000_000, 300_000, choice, {
        requestedWithdrawalUgx: 500_000,
        projectedTotalUgx: 1_300_000,
        projectedPayoutUgx: -1,
        projectedReinvestUgx: 1_300_001,
      }),
    ).toBeNull();
    expect(safeFulfilledSplits(1_000_000, 300_000, choice)).toEqual({
      payoutUgx: 300_000,
      reinvestUgx: 1_000_000,
    });
  });
  it("requires the field only for new Paka Paka submissions", () => {
    const base = { investmentId: "f7213635-be92-5ebe-b501-b39276a45bf1" };
    expect(
      maturityInstructionSchema.safeParse({ ...base, choice }).success,
    ).toBe(false);
    expect(
      maturityInstructionSchema.safeParse({
        ...base,
        choice,
        requestedWithdrawalUgx: "5000000",
      }).success,
    ).toBe(true);
    expect(
      maturityInstructionSchema.safeParse({ ...base, choice: "withdraw_all" })
        .success,
    ).toBe(true);
    expect(
      maturityInstructionSchema.safeParse({
        ...base,
        choice: "reinvest_all",
        requestedWithdrawalUgx: "invalid",
      }).success,
    ).toBe(true);
  });
});
