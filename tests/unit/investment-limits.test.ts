import { describe, expect, it } from "vitest";
import { effectiveInvestmentLimit } from "@/lib/investment-limits";
import { customWithdrawalError } from "@/lib/maturity";

describe("runtime partner investment limits", () => {
  it.each([100_000_000, "100000000"])("coerces %s", (value) => {
    expect(effectiveInvestmentLimit(value)).toBe(100_000_000);
  });
  it.each([
    null,
    undefined,
    "",
    "bad",
    0,
    -1,
    49_000_000,
    NaN,
    Infinity,
    {},
    true,
  ])("defaults invalid or lower values %s", (value) => {
    expect(effectiveInvestmentLimit(value)).toBe(50_000_000);
  });
  it("honors the override in custom maturity withdrawal validation", () => {
    expect(
      customWithdrawalError("5000000", 65_000_000, 100_000_000),
    ).toBeNull();
    expect(customWithdrawalError("5000000", 65_000_000)).not.toBeNull();
  });
});
