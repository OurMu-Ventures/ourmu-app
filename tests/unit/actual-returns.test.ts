import { describe, expect, it } from "vitest";

import {
  actualReturnLocked,
  actualReturnRequired,
  cycleActualReturnUgx,
  formatBpsPercent,
  investmentReturnView,
  kampalaDate,
  parsePercentToBps,
} from "@/lib/actual-returns";
import { maturityNoticeDetail } from "@/lib/maturity";

const BEFORE_MIDNIGHT = new Date("2026-10-30T20:59:59Z"); // 23:59:59 Kampala
const AT_MIDNIGHT = new Date("2026-10-30T21:00:00Z"); // 00:00 Kampala, 31 Oct

describe("parsePercentToBps", () => {
  it("converts percentages with up to two decimals without float drift", () => {
    expect(parsePercentToBps("27.35")).toBe(2735);
    expect(parsePercentToBps("0")).toBe(0);
    expect(parsePercentToBps("0.00")).toBe(0);
    expect(parsePercentToBps("30")).toBe(3000);
    expect(parsePercentToBps("4.1")).toBe(410);
    expect(parsePercentToBps(" 1000 ")).toBe(100000);
  });

  it("rejects losses, extra precision, overflow and junk", () => {
    for (const value of ["-1", "27.355", "1000.01", "", "abc", "1e2", "12,5"])
      expect(parsePercentToBps(value)).toBeNull();
  });
});

describe("formatBpsPercent", () => {
  it("prints the recorded rate", () => {
    expect(formatBpsPercent(2735)).toBe("27.35%");
    expect(formatBpsPercent(3000)).toBe("30%");
    expect(formatBpsPercent(2750)).toBe("27.5%");
    expect(formatBpsPercent(2705)).toBe("27.05%");
    expect(formatBpsPercent(0)).toBe("0%");
  });
});

describe("cycleActualReturnUgx", () => {
  it("rounds the actual value to whole cents like the database", () => {
    expect(cycleActualReturnUgx(333333.33, 2735)).toBe(91166.67);
    expect(cycleActualReturnUgx(125001, 2735)).toBe(34187.77);
    expect(cycleActualReturnUgx(125000.01, 3000)).toBe(37500);
    expect(cycleActualReturnUgx("125000.00000000", 2735)).toBe(34187.5);
    expect(cycleActualReturnUgx(1_000_000, 0)).toBe(0);
  });

  it("rejects rates outside 0% to 1,000%", () => {
    expect(() => cycleActualReturnUgx(125000, -1)).toThrow();
    expect(() => cycleActualReturnUgx(125000, 100001)).toThrow();
    expect(() => cycleActualReturnUgx(125000, 27.5)).toThrow();
  });
});

describe("Kampala timing", () => {
  it("uses Africa/Kampala calendar dates", () => {
    expect(kampalaDate(BEFORE_MIDNIGHT)).toBe("2026-10-30");
    expect(kampalaDate(AT_MIDNIGHT)).toBe("2026-10-31");
  });

  it("locks the rate when the maturity date begins in Kampala", () => {
    expect(actualReturnLocked("2026-10-31", BEFORE_MIDNIGHT)).toBe(false);
    expect(actualReturnLocked("2026-10-31", AT_MIDNIGHT)).toBe(true);
  });

  it("flags a missing rate from the day before maturity", () => {
    expect(
      actualReturnRequired("2026-10-31", null, new Date("2026-10-29T20:59:59Z")),
    ).toBe(false);
    expect(
      actualReturnRequired("2026-10-31", null, new Date("2026-10-29T21:00:00Z")),
    ).toBe(true);
    expect(actualReturnRequired("2026-10-31", 2735, AT_MIDNIGHT)).toBe(false);
  });
});

const investment = {
  principal_ugx: 1_000_000,
  projected_return_ugx: 300_000,
  projected_value_ugx: 1_300_000,
  maturity_date: "2026-10-31",
  payout_basis: "projected",
};

describe("investmentReturnView", () => {
  it("uses the recorded rate immediately and marks it revisable before maturity", () => {
    const view = investmentReturnView(
      investment,
      { actual_return_bps: 2735 },
      BEFORE_MIDNIGHT,
    );
    expect(view).toMatchObject({
      basis: "actual",
      profitUgx: 273_500,
      valueUgx: 1_273_500,
      projectedProfitUgx: 300_000,
      revisable: true,
      pending: false,
    });
  });

  it("stops marking the rate revisable at maturity", () => {
    expect(
      investmentReturnView(investment, { actual_return_bps: 2735 }, AT_MIDNIGHT)
        .revisable,
    ).toBe(false);
  });

  it("applies a zero return", () => {
    expect(
      investmentReturnView(investment, { actual_return_bps: 0 }, AT_MIDNIGHT),
    ).toMatchObject({ basis: "actual", profitUgx: 0, valueUgx: 1_000_000 });
  });

  it("shows the projection, then a pending state once matured without a rate", () => {
    expect(
      investmentReturnView(investment, { actual_return_bps: null }, BEFORE_MIDNIGHT),
    ).toMatchObject({ basis: "projected", valueUgx: 1_300_000, pending: false });
    expect(
      investmentReturnView(investment, { actual_return_bps: null }, AT_MIDNIGHT)
        .pending,
    ).toBe(true);
    expect(
      investmentReturnView(
        investment,
        { actual_return_bps: null, legacy_settlement: true },
        AT_MIDNIGHT,
      ).pending,
    ).toBe(false);
  });

  it("applies the cycle rate to imported placements with a different projection", () => {
    const imported = {
      ...investment,
      projected_return_ugx: 350_000,
      projected_value_ugx: 1_350_000,
    };
    expect(
      investmentReturnView(imported, { actual_return_bps: 2735 }, AT_MIDNIGHT),
    ).toMatchObject({ profitUgx: 273_500, projectedProfitUgx: 350_000 });
  });

  it("never rewrites reported-paid history", () => {
    const paid = {
      ...investment,
      payout_basis: "reported_paid",
      reported_return_ugx: 300_000,
      reported_payout_ugx: 1_300_000,
    };
    expect(
      investmentReturnView(paid, { actual_return_bps: 2735 }, AT_MIDNIGHT),
    ).toMatchObject({ basis: "paid", profitUgx: 300_000, valueUgx: 1_300_000 });
  });
});

describe("maturityNoticeDetail with actual returns", () => {
  const base = {
    principalUgx: 1_000_000,
    projectedReturnUgx: 300_000,
    projectedValueUgx: 1_300_000,
    projectedPercent: 30,
    maturityDate: "31 Oct 2026",
    payoutDate: "15 Nov 2026",
  };

  it("quotes actual amounts and keeps the projection for comparison", () => {
    const detail = maturityNoticeDetail({
      ...base,
      actualReturnUgx: 273_500,
      actualValueUgx: 1_273_500,
      actualPercent: 27.35,
    });
    expect(detail).toContain("actual 27.35% return of UGX 273,500.00");
    expect(detail).toContain("projected 30% return of UGX 300,000.00");
    expect(detail).toContain("UGX 1,273,500.00 payout");
    expect(detail).toContain("UGX 1,273,500.00 reinvested");
    expect(detail).not.toContain("may differ from this projection");
  });

  it("says the actual return is pending when it is missing", () => {
    const detail = maturityNoticeDetail({ ...base, actualPending: true });
    expect(detail).toContain("projected 30% return");
    expect(detail).toContain("actual return for your cycle is pending");
  });
});
