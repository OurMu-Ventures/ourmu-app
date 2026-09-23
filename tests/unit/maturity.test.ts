import { describe, expect, it } from "vitest";

import {
  fulfilledSplits,
  isMaturityDayAllowed,
  maturityPayoutDateIso,
  maturitySplits,
} from "@/lib/maturity";

const PRINCIPAL = 1_000_000;
const PROJECTED_RETURN = 300_000; // 30% of principal

describe("maturitySplits", () => {
  it("withdraws principal and ROI as a full payout", () => {
    expect(maturitySplits(PRINCIPAL, PROJECTED_RETURN, "withdraw_all")).toEqual(
      { payoutUgx: 1_300_000, reinvestUgx: 0 },
    );
  });

  it("withdraws ROI and reinvests principal", () => {
    expect(
      maturitySplits(
        PRINCIPAL,
        PROJECTED_RETURN,
        "withdraw_roi_reinvest_principal",
      ),
    ).toEqual({ payoutUgx: 300_000, reinvestUgx: 1_000_000 });
  });

  it("reinvests both principal and ROI", () => {
    expect(maturitySplits(PRINCIPAL, PROJECTED_RETURN, "reinvest_all")).toEqual(
      { payoutUgx: 0, reinvestUgx: 1_300_000 },
    );
  });

  it("always partitions the full projected value", () => {
    for (const choice of [
      "withdraw_all",
      "withdraw_roi_reinvest_principal",
      "reinvest_all",
    ] as const) {
      const splits = maturitySplits(PRINCIPAL, PROJECTED_RETURN, choice);
      expect(splits.payoutUgx + splits.reinvestUgx).toBe(1_300_000);
    }
  });
});

describe("fulfilledSplits", () => {
  it("uses the actual ROI recorded by an admin, not the projection", () => {
    // Fund records 250,000 instead of the projected 300,000.
    expect(fulfilledSplits(PRINCIPAL, 250_000, "withdraw_all")).toEqual({
      payoutUgx: 1_250_000,
      reinvestUgx: 0,
    });
    expect(
      fulfilledSplits(PRINCIPAL, 250_000, "withdraw_roi_reinvest_principal"),
    ).toEqual({ payoutUgx: 250_000, reinvestUgx: 1_000_000 });
    expect(fulfilledSplits(PRINCIPAL, 250_000, "reinvest_all")).toEqual({
      payoutUgx: 0,
      reinvestUgx: 1_250_000,
    });
  });

  it("supports a zero actual return while preserving principal", () => {
    expect(fulfilledSplits(PRINCIPAL, 0, "reinvest_all")).toEqual({
      payoutUgx: 0,
      reinvestUgx: 1_000_000,
    });
  });
});

describe("maturityPayoutDateIso", () => {
  it("schedules payout on the 15th of the maturity month", () => {
    expect(maturityPayoutDateIso("2026-09-03")).toBe("2026-09-15");
    expect(maturityPayoutDateIso("2026-09-15")).toBe("2026-09-15");
    expect(maturityPayoutDateIso("2026-02-28")).toBe("2026-02-15");
  });
});

describe("isMaturityDayAllowed", () => {
  it("allows new cycles maturing on or before the 15th", () => {
    expect(isMaturityDayAllowed("2026-09-01")).toBe(true);
    expect(isMaturityDayAllowed("2026-09-15")).toBe(true);
  });

  it("rejects new cycles maturing after the payout day", () => {
    expect(isMaturityDayAllowed("2026-09-16")).toBe(false);
    expect(isMaturityDayAllowed("2026-09-30")).toBe(false);
  });
});
