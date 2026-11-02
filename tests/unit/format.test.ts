import { describe, expect, it } from "vitest";

import { date } from "@/lib/format";

// Vercel runs in UTC; developer machines may sit behind or ahead of it.
const ZONES = ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"];

function inTimeZone(zone: string, check: () => void) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    check();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

describe("date", () => {
  it.each(ZONES)(
    "shows date-only values as their calendar day in %s",
    (zone) => {
      inTimeZone(zone, () => {
        expect(date("2026-12-31")).toBe("31 Dec 2026");
        expect(date("2026-06-30")).toBe("30 Jun 2026");
        expect(date("2028-02-29")).toBe("29 Feb 2028");
        expect(date("2027-01-01")).toBe("1 Jan 2027");
      });
    },
  );

  it("rejects date-only values for days that do not exist", () => {
    // new Date() would roll 2026-02-30 over to 2 March instead.
    expect(() => date("2026-02-30")).toThrow(RangeError);
    expect(() => date("2026-02-29")).toThrow(RangeError);
    expect(() => date("2026-13-01")).toThrow(RangeError);
  });

  it("keeps showing timestamps in the runtime timezone", () => {
    // 23:30 UTC on 31 December is already 1 January at UTC+14.
    inTimeZone("UTC", () => {
      expect(date("2026-12-31T23:30:00.000Z")).toBe("31 Dec 2026");
    });
    inTimeZone("Pacific/Kiritimati", () => {
      expect(date("2026-12-31T23:30:00.000Z")).toBe("1 Jan 2027");
    });
  });
});
