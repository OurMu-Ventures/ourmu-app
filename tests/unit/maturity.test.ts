import { describe, expect, it } from "vitest";

import {
  fulfilledSplits,
  impliedProjectedRoi,
  isMaturityDayAllowed,
  maturityChoiceLabel,
  maturityNoticeDetail,
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

describe("impliedProjectedRoi", () => {
  it("recovers the projected ROI from an instruction's splits", () => {
    expect(impliedProjectedRoi(PRINCIPAL, 1_300_000, 0)).toBe(300_000);
    expect(impliedProjectedRoi(PRINCIPAL, 300_000, 1_000_000)).toBe(300_000);
    expect(impliedProjectedRoi(PRINCIPAL, 0, 1_300_000)).toBe(300_000);
  });

  it("detects when an admin-recorded ROI differs from the projection", () => {
    const basis = impliedProjectedRoi(PRINCIPAL, 0, 1_300_000);
    expect(250_000 === basis).toBe(false);
    expect(300_000 === basis).toBe(true);
  });
});

describe("maturityNoticeDetail", () => {
  const detail = maturityNoticeDetail({
    principalUgx: PRINCIPAL,
    projectedReturnUgx: PROJECTED_RETURN,
    projectedValueUgx: 1_300_000,
    projectedPercent: 30,
    maturityDate: "10 Aug 2026",
    payoutDate: "15 Aug 2026",
  });

  it("quotes the full-reinvestment amount for option three", () => {
    expect(detail).toContain(
      "C. Dobolo Payout (UGX 1,300,000.00 reinvested)",
    );
    expect(detail).not.toContain("UGX 0.00 reinvested");
  });

  it("covers the other choices, dates, and the projection caveat", () => {
    expect(detail).toContain("A. Bijjodolo payout");
    expect(detail).toContain("B. Paka Paka payout");
    expect(detail).toContain("UGX 1,300,000.00 payout");
    expect(detail).toContain(
      "UGX 300,000.00 payout, UGX 1,000,000.00 reinvested",
    );
    expect(detail).toContain("15 Aug 2026");
    expect(detail).toContain("may differ from this projection");
  });
});

describe("maturityChoiceLabel", () => {
  it("uses the three payout-plan names from the partner notice", () => {
    expect(maturityChoiceLabel("withdraw_all")).toBe("A. Bijjodolo payout");
    expect(maturityChoiceLabel("withdraw_roi_reinvest_principal")).toBe("B. Paka Paka payout");
    expect(maturityChoiceLabel("reinvest_all")).toBe("C. Dobolo Payout");
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
