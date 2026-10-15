import { describe, expect, it } from "vitest";
import { requiresMaturityAmountConfirmation } from "@/lib/maturity";

const accepted = { payoutUgx: 1300000, reinvestUgx: 0 };

describe("maturity amount acceptance", () => {
  it("requires confirmation only when the projected return changes", () => {
    expect(requiresMaturityAmountConfirmation(1000000, 300000, accepted)).toBe(
      false,
    );
    expect(requiresMaturityAmountConfirmation(1000000, 200000, accepted)).toBe(
      true,
    );
  });
  it("honors acceptance on the current actual rate", () => {
    expect(
      requiresMaturityAmountConfirmation(1000000, 200000, {
        ...accepted,
        acceptedOnCurrentRate: true,
      }),
    ).toBe(false);
  });
  it("keeps an unconfirmed proposal pending even when it matches the projection", () => {
    expect(
      requiresMaturityAmountConfirmation(1000000, 300000, {
        ...accepted,
        proposedRoiUgx: 300000,
      }),
    ).toBe(true);
  });
  it("honors a matching confirmed proposal", () => {
    expect(
      requiresMaturityAmountConfirmation(1000000, 200000, {
        ...accepted,
        proposedRoiUgx: 200000,
        confirmedRoiUgx: 200000,
      }),
    ).toBe(false);
  });
  it("requires fresh acceptance if the proposed or confirmed ROI differs", () => {
    expect(
      requiresMaturityAmountConfirmation(1000000, 250000, {
        ...accepted,
        proposedRoiUgx: 200000,
        confirmedRoiUgx: 200000,
      }),
    ).toBe(true);
  });
  it("compares at database precision rather than floating-point subtraction", () => {
    expect(
      requiresMaturityAmountConfirmation(125000.01, 37500, {
        payoutUgx: 162500.01,
        reinvestUgx: 0,
      }),
    ).toBe(false);
  });
});
