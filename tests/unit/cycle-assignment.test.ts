import { describe, expect, it } from "vitest";

import {
  kampalaLocalToIso,
  reservationDeadlineIso,
} from "@/lib/cycle-assignment";
import { activationSchema } from "@/lib/validation";

describe("automatic cycle assignment helpers", () => {
  it("caps the payment deadline at the cycle closing time", () => {
    expect(
      reservationDeadlineIso(
        "2026-10-01T00:00:00.000Z",
        "2026-10-31T20:59:59.999Z",
      ),
    ).toBe("2026-10-03T00:00:00.000Z");
  });

  it("shortens the deadline when the cycle closes within 48 hours", () => {
    expect(
      reservationDeadlineIso(
        "2026-10-30T12:00:00.000Z",
        "2026-10-31T20:59:59.999Z",
      ),
    ).toBe("2026-10-31T20:59:59.999Z");
  });

  it("converts a Kampala wall-clock timestamp to UTC", () => {
    // 14:30 in Kampala (UTC+3) is 11:30 UTC.
    expect(kampalaLocalToIso("2026-10-03T14:30")).toBe(
      "2026-10-03T11:30:00.000Z",
    );
  });

  it("rejects malformed Kampala timestamps", () => {
    expect(kampalaLocalToIso("not-a-date")).toBeNull();
  });

  it.each([
    "2026-02-30T12:00",
    "2026-13-01T12:00",
    "2026-01-01T24:00",
    "2026-01-01T12:60",
    "2026-01-01T12:00:60",
  ])("rejects invalid calendar values %s", (value) => {
    expect(kampalaLocalToIso(value)).toBeNull();
  });
  it("preserves seconds across Kampala midnight", () => {
    expect(kampalaLocalToIso("2026-10-01T00:00:01")).toBe(
      "2026-09-30T21:00:01.000Z",
    );
  });
  it("accepts the verified payment timestamp in the activation form", () => {
    const parsed = activationSchema.safeParse({
      investmentId: "f7213635-be92-5ebe-b501-b39276a45bf1",
      bankReference: "REF-1",
      receivedAmountUgx: "125000",
      receivedDate: "2026-10-03",
      receivedAt: "2026-10-03T14:30",
      confirmation: "ACTIVATE",
    });
    expect(parsed.success).toBe(true);
  });

  it("keeps the activation timestamp optional for legacy callers", () => {
    const parsed = activationSchema.safeParse({
      investmentId: "f7213635-be92-5ebe-b501-b39276a45bf1",
      bankReference: "REF-1",
      receivedAmountUgx: "125000",
      receivedDate: "2026-10-03",
      confirmation: "ACTIVATE",
    });
    expect(parsed.success).toBe(true);
  });
});
