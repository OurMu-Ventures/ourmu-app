import { describe, expect, it } from "vitest";

import { amountPrincipal, formatAmountInput } from "@/lib/amount-input";

describe("formatAmountInput", () => {
  it("groups digits and keeps the caret after the typed digit", () => {
    // Typing "1" at the start of "25,000" -> "125,000", caret after the 1.
    expect(formatAmountInput("25,000", "125,000", 1)).toEqual({
      value: "125,000",
      caret: 1,
    });
    expect(formatAmountInput("12,500", "125,000", 7)).toEqual({
      value: "125,000",
      caret: 7,
    });
  });

  it("deletes the digit before a comma on Backspace", () => {
    // "125,|000" -> Backspace removes the comma -> "125|000".
    expect(
      formatAmountInput("125,000", "125000", 3, "deleteContentBackward"),
    ).toEqual({ value: "12,000", caret: 2 });
  });

  it("deletes the digit after a comma on Delete", () => {
    // "125|,000" -> Delete removes the comma -> "125|000".
    expect(
      formatAmountInput("125,000", "125000", 3, "deleteContentForward"),
    ).toEqual({ value: "12,500", caret: 4 });
  });

  it("drops leading zeros and moves the caret with them", () => {
    expect(formatAmountInput("", "0125000", 7)).toEqual({
      value: "125,000",
      caret: 7,
    });
    expect(formatAmountInput("", "000", 3)).toEqual({ value: "0", caret: 1 });
  });

  it("keeps decimals and adds a zero before a bare decimal point", () => {
    expect(formatAmountInput("", "125000.5", 8).value).toBe("125,000.5");
    expect(formatAmountInput("", ".5", 2)).toEqual({ value: "0.5", caret: 3 });
  });

  it("accepts pasted spaces and a UGX prefix", () => {
    expect(formatAmountInput("", "125 000", 7).value).toBe("125,000");
    expect(formatAmountInput("", "UGX 125,000", 11).value).toBe("125,000");
  });

  it("leaves malformed input unchanged", () => {
    expect(formatAmountInput("", "12a", 3)).toEqual({ value: "12a", caret: 3 });
    expect(formatAmountInput("", "1.2.3", 5).value).toBe("1.2.3");
  });
});

describe("amountPrincipal", () => {
  it("removes grouping and a trailing decimal point", () => {
    expect(amountPrincipal("125,000.50")).toBe("125000.50");
    expect(amountPrincipal("125,000.")).toBe("125000");
  });
});
