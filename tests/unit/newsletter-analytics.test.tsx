import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/newsletters", () => ({ listPublishedNewsletters: () => [{ slug: "october-2026", title: "October" }] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
import { getNewsletterReadingAnalytics } from "@/lib/newsletter-analytics";
import { NewsletterReadingAnalytics } from "@/components/NewsletterReadingAnalytics";

const rows = [
  { newsletter_slug: "october-2026", partner_id: "00000000-0000-4000-8000-000000000101", legal_name: "Synthetic Reader", opens: 3, first_opened_at: "2026-10-07T10:00:00Z", last_opened_at: "2026-10-07T11:00:00Z", reached_end_at: "2026-10-07T11:01:00Z" },
  { newsletter_slug: "october-2026", partner_id: "00000000-0000-4000-8000-000000000102", legal_name: "Synthetic Unread", opens: 0, first_opened_at: null, last_opened_at: null, reached_end_at: null },
];
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue({}); mocks.rpc.mockResolvedValue({ data: rows, error: null }); });

describe("admin newsletter analytics", () => {
  it("counts unique readers separately from repeat opens", async () => {
    const issues = await getNewsletterReadingAnalytics();
    expect(issues?.[0]).toMatchObject({ audience: 2, readers: 1, opens: 3, reachedEnd: 1 });
  });
  it("checks AAL2 admin access before querying names or analytics", async () => {
    mocks.admin.mockRejectedValue(new Error("MFA required"));
    await expect(getNewsletterReadingAnalytics()).rejects.toThrow("MFA required");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("renders reader and unread statuses with partner names", async () => {
    const html = renderToStaticMarkup(await NewsletterReadingAnalytics());
    expect(html).toContain("Synthetic Reader");
    expect(html).toContain("Reached the end");
    expect(html).toContain("Synthetic Unread");
    expect(html).toContain("Not opened");
    expect(html).toContain("50%");
  });
  it("shows unavailable, rather than zero reads, when the query fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    const html = renderToStaticMarkup(await NewsletterReadingAnalytics());
    expect(html).toContain("Reading analytics are temporarily unavailable");
    expect(html).not.toContain("Not opened");
  });
  it("handles an empty audience without dividing by zero", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const html = renderToStaticMarkup(await NewsletterReadingAnalytics());
    expect(html).toContain("No active partners");
    expect(html).not.toContain("NaN");
  });
});
