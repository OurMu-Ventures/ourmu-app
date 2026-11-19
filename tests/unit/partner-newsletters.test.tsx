import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import NewsletterDetailPage from "@/app/(investor)/newsletters/[slug]/page";
import NewslettersPage from "@/app/(investor)/newsletters/page";
import { requireInvestor } from "@/lib/auth";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireInvestor: vi.fn() }));
vi.mock("@/components/ui/link-status", () => ({ LinkStatus: () => null }));
vi.mock("@/components/NewsletterReadTracker", () => ({
  NewsletterReadTracker: ({ children }: { children: React.ReactNode }) => (
    <div data-tracked="true">{children}</div>
  ),
}));

type Profile = Awaited<ReturnType<typeof requireInvestor>>;
const signIn = (profile: Partial<Profile>) =>
  vi.mocked(requireInvestor).mockResolvedValue(profile as Profile);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("partner newsletters", () => {
  const issue = { params: Promise.resolve({ slug: "october-2026" }) };

  it("tracks reading for real partners", async () => {
    signIn({ role: "investor", is_test: false });
    const html = renderToStaticMarkup(await NewsletterDetailPage(issue));
    expect(html).toContain('data-tracked="true"');
    expect(html).toContain('href="/newsletters"');
  });

  it("does not track test partners", async () => {
    signIn({ role: "investor", is_test: true });
    const html = renderToStaticMarkup(await NewsletterDetailPage(issue));
    expect(html).not.toContain("data-tracked");
  });

  it("does not track admins reading on the partner route", async () => {
    signIn({ role: "admin", is_test: false });
    const html = renderToStaticMarkup(await NewsletterDetailPage(issue));
    expect(html).not.toContain("data-tracked");
  });

  it("keeps partner wording and links on the archive", async () => {
    signIn({ role: "investor", is_test: false });
    const html = renderToStaticMarkup(await NewslettersPage());
    expect(html).toContain("Partner updates");
    expect(html).toContain('href="/newsletters/october-2026"');
  });
});
