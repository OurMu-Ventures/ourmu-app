import { describe, expect, it } from "vitest";

import {
  canChooseMaturity,
  investmentCycleTitle,
  investmentRecordedDate,
  maturityProgress,
  pendingReinvestmentCycle,
} from "@/lib/investments";

const START = "2026-01-01T00:00:00.000Z";
const MATURITY = "2026-07-01T00:00:00.000Z"; // 181 days later
const MID = new Date((Date.parse(START) + Date.parse(MATURITY)) / 2).getTime();

describe("maturityProgress", () => {
  it("reads 100 for matured placements regardless of dates", () => {
    expect(maturityProgress(START, MATURITY, "matured", MID)).toBe(100);
    expect(maturityProgress(null, null, "matured")).toBe(100);
  });

  it("reads 0 before the start date", () => {
    expect(
      maturityProgress(START, MATURITY, "active", Date.parse(START) - 1),
    ).toBe(0);
  });

  it("reads 50 at the midpoint of the cycle", () => {
    expect(maturityProgress(START, MATURITY, "active", MID)).toBe(50);
  });

  it("reads 100 once maturity has passed", () => {
    expect(
      maturityProgress(START, MATURITY, "active", Date.parse(MATURITY) + 1),
    ).toBe(100);
  });

  it("reads 0 for missing or invalid dates", () => {
    expect(maturityProgress(null, MATURITY, "active", MID)).toBe(0);
    expect(maturityProgress(START, null, "active", MID)).toBe(0);
    expect(maturityProgress("not-a-date", MATURITY, "active", MID)).toBe(0);
  });
});

describe("canChooseMaturity", () => {
  const unpaid = {
    status: "matured",
    record_origin: "portal",
    payout_basis: "projected",
  };
  it("allows unpaid portal maturities awaiting a choice", () => {
    expect(canChooseMaturity(unpaid)).toBe(true);
    expect(canChooseMaturity(unpaid, "requested")).toBe(true);
  });
  it("excludes paid records regardless of origin", () => {
    for (const record_origin of ["portal", "legacy_import", "hybrid"]) {
      expect(
        canChooseMaturity({
          ...unpaid,
          record_origin,
          payout_basis: "reported_paid",
        }),
      ).toBe(false);
    }
  });
  it("excludes completed payouts and reinvestments even with projected payout basis", () => {
    expect(canChooseMaturity(unpaid, "fulfilled")).toBe(false);
  });
  it("excludes non-matured placements and permits unpaid imported maturities", () => {
    expect(canChooseMaturity({ ...unpaid, status: "active" })).toBe(false);
    expect(
      canChooseMaturity({ ...unpaid, record_origin: "legacy_import" }),
    ).toBe(true);
  });
});

describe("cycle labels and recorded payment dates", () => {
  it("uses the official cycle name and a neutral fallback for missing cycles", () => {
    expect(investmentCycleTitle(" October 2026 ")).toBe("October 2026 cycle");
    expect(investmentCycleTitle(null)).toBe("OURMU investment");
    expect(investmentCycleTitle(" ")).toBe("OURMU investment");
  });
  it("distinguishes receipt payment dates from entry dates and reinvestments", () => {
    expect(
      investmentRecordedDate(
        { source: "bank_activation", transaction_date: "2026-11-04" },
        "active",
        "2026-11-06",
      ),
    ).toEqual({ label: "Payment received", value: "2026-11-04" });
    expect(
      investmentRecordedDate(
        { source: "reinvestment", transaction_date: "2026-10-20" },
        "active",
        "2026-10-21",
      ),
    ).toEqual({ label: "Reinvested", value: "2026-10-20" });
  });
  it("does not invent a payment date for imports or acknowledgment receipts", () => {
    expect(
      investmentRecordedDate(null, "active", "2026-05-01"),
    ).toBeUndefined();
    expect(
      investmentRecordedDate(
        { source: "investment_record", transaction_date: "2026-05-01" },
        "active",
        "2026-05-01",
      ),
    ).toBeUndefined();
    expect(investmentRecordedDate(null, "reserved", "2026-11-04")).toEqual({
      label: "Reserved",
      value: "2026-11-04",
    });
  });
});

describe("pendingReinvestmentCycle", () => {
  const cycle = { name: "November 2026", maturity_date: "2027-04-30" };
  it.each(["requested", "processing"])(
    "includes %s reinvestments",
    (status) => {
      expect(
        pendingReinvestmentCycle({ status, choice: "reinvest_all" }, cycle),
      ).toBe(cycle);
    },
  );
  it.each(["fulfilled", "cancelled", "awaiting_partner_confirmation"])(
    "excludes %s instructions",
    (status) => {
      expect(
        pendingReinvestmentCycle({ status, choice: "reinvest_all" }, cycle),
      ).toBeNull();
    },
  );
  it("excludes full withdrawals, missing instructions and missing destinations", () => {
    expect(
      pendingReinvestmentCycle(
        { status: "requested", choice: "withdraw_all" },
        cycle,
      ),
    ).toBeNull();
    expect(pendingReinvestmentCycle(null, cycle)).toBeNull();
    expect(
      pendingReinvestmentCycle(
        { status: "processing", choice: "reinvest_all" },
        null,
      ),
    ).toBeNull();
  });
});
