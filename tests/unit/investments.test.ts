import { describe, expect, it } from "vitest";

import { investmentPeriod, maturityProgress } from "@/lib/investments";

const START = "2026-01-01T00:00:00.000Z";
const MATURITY = "2026-07-01T00:00:00.000Z"; // 181 days later
const MID = new Date(
  (Date.parse(START) + Date.parse(MATURITY)) / 2,
).getTime();

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

// Midday mid-month timestamps keep the calendar month stable in every
// timezone, unlike midnight boundary timestamps.
describe("investmentPeriod", () => {
  it("reads the full duration from start to maturity months", () => {
    expect(
      investmentPeriod("2026-06-15T12:00:00.000Z", "2026-12-15T12:00:00.000Z"),
    ).toBe("June 2026 - December 2026");
  });

  it("reads a single month when start and maturity share it", () => {
    expect(
      investmentPeriod("2026-06-15T12:00:00.000Z", "2026-06-20T12:00:00.000Z"),
    ).toBe("June 2026");
  });

  it("reads the start month alone when maturity is missing", () => {
    expect(investmentPeriod("2026-06-15T12:00:00.000Z", null)).toBe(
      "June 2026",
    );
  });

  it("reads null when the start is missing or invalid", () => {
    expect(investmentPeriod(null, "2026-12-15T12:00:00.000Z")).toBeNull();
    expect(
      investmentPeriod("not-a-date", "2026-12-15T12:00:00.000Z"),
    ).toBeNull();
  });

  it("reads date-only first-of-month values without timezone shifts", () => {
    // maturity_date is a PostgreSQL `date` returned as YYYY-MM-DD; it must
    // read as that calendar month in any runtime timezone.
    expect(investmentPeriod("2026-06-01", "2026-12-01")).toBe(
      "June 2026 - December 2026",
    );
    expect(investmentPeriod("2026-01-01", "2026-01-31")).toBe("January 2026");
  });

  it("reads Kampala business time for month-boundary timestamps", () => {
    // 2026-05-31T21:30Z is 00:30 on June 1st in Kampala: June, not May.
    expect(
      investmentPeriod("2026-05-31T21:30:00.000Z", "2026-12-15T12:00:00.000Z"),
    ).toBe("June 2026 - December 2026");
    // 2026-06-30T21:00Z is 00:00 on July 1st in Kampala: July, not June.
    expect(
      investmentPeriod("2026-01-15T12:00:00.000Z", "2026-06-30T21:00:00.000Z"),
    ).toBe("January 2026 - July 2026");
  });

  it("rejects impossible calendar dates", () => {
    expect(investmentPeriod("2026-13-01", "2026-12-01")).toBeNull();
    expect(investmentPeriod("2026-02-30", "2026-12-01")).toBeNull();
  });

  it("holds month boundaries under a non-UTC runtime timezone", () => {
    const previous = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(investmentPeriod("2026-07-01", "2026-07-31")).toBe("July 2026");
      expect(investmentPeriod("2026-01-01", "2026-12-01")).toBe(
        "January 2026 - December 2026",
      );
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
