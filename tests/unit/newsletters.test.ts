import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getPublishedNewsletter,
  listPublishedNewsletters,
} from "@/lib/newsletters";

describe("newsletters registry", () => {
  it("lists only published issues newest first", () => {
    const issues = listPublishedNewsletters();
    expect(issues.map((issue) => issue.slug)).toEqual(["october-2026", "august-2026"]);
    expect(issues.every((issue) => issue.status === "published")).toBe(true);
    const dates = issues.map((issue) => issue.issueDate);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("resolves the published October 2026 issue", () => {
    const issue = getPublishedNewsletter("october-2026");
    expect(issue?.title).toBe("Partner Update — October 2026");
    expect(issue?.issueMonth).toBe("October 2026");
    expect(issue?.status).toBe("published");
  });

  it("resolves the August 2026 launch issue", () => {
    const issue = getPublishedNewsletter("august-2026");
    expect(issue?.title).toContain("August 2026");
    expect(issue?.issueMonth).toBe("August 2026");
  });

  it("returns null for unknown and unpublished slugs", () => {
    expect(getPublishedNewsletter("does-not-exist")).toBeNull();
    expect(getPublishedNewsletter("draft-issue")).toBeNull();
  });
});
