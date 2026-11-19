import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import NewsletterDetailPage from "@/app/(admin)/admin/(console)/newsletters/[slug]/page";
import NewslettersPage from "@/app/(admin)/admin/(console)/newsletters/page";
import { requireAdmin } from "@/lib/auth";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/components/ui/link-status", () => ({ LinkStatus: () => null }));
vi.mock("@/components/NewsletterReadTracker", () => ({
  NewsletterReadTracker: () => {
    throw new Error("Admin newsletters must not track reading");
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({} as Awaited<ReturnType<typeof requireAdmin>>);
});

describe("admin newsletters", () => {
  const issue = { params: Promise.resolve({ slug: "october-2026" }) };

  it("links to published issues in the admin console after admin authorization", async () => {
    const html = renderToStaticMarkup(await NewslettersPage());

    // No options means the default AAL2 check applies.
    expect(requireAdmin).toHaveBeenCalledWith();
    expect(html).toContain('href="/admin/newsletters/october-2026"');
    expect(html).toContain("not counted in partner reading analytics");
    expect(html).not.toContain("WhatsApp");
  });

  it("renders the issue with a link back to the admin archive", async () => {
    const html = renderToStaticMarkup(await NewsletterDetailPage(issue));

    expect(requireAdmin).toHaveBeenCalledWith();
    expect(html).toContain('href="/admin/newsletters"');
    expect(html).toContain("Back to newsletters");
  });

  it("blocks both pages when admin authorization fails", async () => {
    const denied = new Error("Admin access required");
    vi.mocked(requireAdmin).mockRejectedValue(denied);

    await expect(NewslettersPage()).rejects.toBe(denied);
    await expect(NewsletterDetailPage(issue)).rejects.toBe(denied);
  });
});
