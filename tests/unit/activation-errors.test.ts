import { describe, expect, it } from "vitest";
import {
  activationErrorCode,
  activationErrorMessage,
} from "@/lib/activation-errors";

describe("activation error messages", () => {
  it.each([
    [
      "received amount must exactly match expected principal",
      "reserved principal",
    ],
    [
      "payment timestamp predates the reservation; held for staff resolution",
      "earlier than this reservation",
    ],
    ["payment timestamp cannot be in the future", "Uganda time zone"],
    [
      "received date must match the Kampala date of the verified payment timestamp",
      "Uganda calendar date",
    ],
    [
      "valid payment received date is required",
      "Uganda’s calendar date",
    ],
    ["active administrator AAL2 required", "two-factor"],
    ["cycle capacity exceeded; held for staff resolution", "capacity"],
    [
      "investor cycle limit exceeded; held for staff resolution",
      "partner’s limit",
    ],
    [
      "cancelled reservations cannot be revived; create a new reservation",
      "cancelled",
    ],
    [
      "payment timestamp resolves to a different cycle; held for staff resolution without moving funds",
      "different investment cycle",
    ],
  ])("maps a structured Supabase error: %s", (message, expected) => {
    expect(activationErrorMessage({ message, code: "23514" })).toContain(
      expected,
    );
  });
  it("supports Error instances too", () => {
    expect(
      activationErrorMessage(
        new Error("received amount must exactly match expected principal"),
      ),
    ).toContain("reserved principal");
  });
  it("identifies only the known duplicate payment constraint", () => {
    expect(
      activationErrorMessage({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "bank_receipts_bank_reference_key"',
      }),
    ).toContain("already recorded");
    expect(
      activationErrorMessage({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "private_other_key"',
      }),
    ).toBeNull();
  });
  it("does not expose unknown errors or permissive message prefixes", () => {
    for (const error of [
      null,
      "secret",
      { message: "received amount secret SQL detail" },
      { message: "password=secret", details: "private table" },
      { message: "toString" },
    ])
      expect(activationErrorMessage(error)).toBeNull();
  });
  it("logs only bounded database codes", () => {
    expect(activationErrorCode({ code: "PGRST202" })).toBe("PGRST202");
    expect(activationErrorCode({ code: "23514" })).toBe("23514");
    expect(activationErrorCode({ code: "secret value" })).toBe("unknown");
    expect(activationErrorCode(null)).toBe("unknown");
  });
});
