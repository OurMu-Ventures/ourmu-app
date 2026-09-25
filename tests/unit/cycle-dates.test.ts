import { describe, expect, it } from "vitest";
import { cycleDayBounds } from "@/lib/cycle-dates";

describe("cycleDayBounds", () => {
  it("uses the full selected days in Kampala time", () => {
    expect(cycleDayBounds("2026-09-01", "2026-09-15")).toEqual({
      opensAt: "2026-08-31T21:00:00.000Z",
      closesAt: "2026-09-15T20:59:59.999Z",
    });
  });

  it("allows an opening and closing on the same day", () => {
    expect(cycleDayBounds("2026-09-15", "2026-09-15")).toEqual({
      opensAt: "2026-09-14T21:00:00.000Z",
      closesAt: "2026-09-15T20:59:59.999Z",
    });
  });

  it("rejects reversed or invalid calendar dates", () => {
    expect(cycleDayBounds("2026-09-16", "2026-09-15")).toBeNull();
    expect(cycleDayBounds("2026-02-30", "2026-09-15")).toBeNull();
  });
});
