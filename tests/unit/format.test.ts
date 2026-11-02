import { describe, expect, it } from "vitest";

import { date, dateTime } from "@/lib/format";

// Vercel runs in UTC; developer machines may sit behind or ahead of it.
const ZONES = ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"];

function inTimeZone(zone: string, check: () => void) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    // Output should not depend on the runtime zone, so confirm the switch
    // took effect; otherwise these checks would pass without exercising it.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
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

  it.each(ZONES)("shows timestamps on their Kampala day in %s", (zone) => {
    inTimeZone(zone, () => {
      // 23:30 UTC on 31 December is already 1 January in Kampala (UTC+3).
      expect(date("2026-12-31T23:30:00+00:00")).toBe("1 Jan 2027");
      expect(date("2026-12-31T20:59:00.000Z")).toBe("31 Dec 2026");
    });
  });
});

describe("dateTime", () => {
  it.each(ZONES)("shows timestamps in Kampala time in %s", (zone) => {
    inTimeZone(zone, () => {
      // 23:30 UTC on 31 December is already 1 January in Kampala (UTC+3).
      expect(dateTime("2026-12-31T23:30:00+00:00")).toBe("1 Jan 2027, 02:30");
      expect(dateTime("2026-12-31T21:00:00.000Z")).toBe("1 Jan 2027, 00:00");
      expect(dateTime("2026-12-31T20:59:00.000Z")).toBe("31 Dec 2026, 23:59");
      // Mid-year, while Los Angeles observes daylight saving time.
      expect(dateTime("2026-06-30T09:15:00.000Z")).toBe("30 Jun 2026, 12:15");
    });
  });
});
