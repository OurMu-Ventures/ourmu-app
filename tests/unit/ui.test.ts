import { describe, expect, it } from "vitest";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("merges conflicting layout classes deterministically", () => {
    expect(cn("flex flex-col", "flex-row")).toBe("flex flex-row");
    expect(cn("px-4", "px-6")).toBe("px-6");
  });
});

describe("buttonVariants", () => {
  it("keeps a 44px minimum touch target on every size", () => {
    expect(buttonVariants({ size: "default" })).toContain("min-h-11");
    expect(buttonVariants({ size: "lg" })).toContain("min-h-12");
    expect(buttonVariants({ size: "icon" })).toContain("size-11");
  });

  it("preserves the brand button variants", () => {
    expect(buttonVariants({ variant: "default" })).toContain("bg-[var(--gold)]");
    expect(buttonVariants({ variant: "secondary" })).toContain(
      "border-[var(--ink)]",
    );
    expect(buttonVariants({ variant: "danger" })).toContain(
      "bg-[var(--danger)]",
    );
  });
});
