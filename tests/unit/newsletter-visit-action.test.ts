import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ profile: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentProfile: mocks.profile }));
vi.mock("@/lib/newsletters", () => ({ getPublishedNewsletter: (slug: string) => slug === "october-2026" ? {} : null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
import { recordNewsletterVisit } from "@/actions/newsletters";

const input = { slug: "october-2026", visitId: "00000000-0000-4000-8000-000000000201", event: "opened" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile.mockResolvedValue({ id: "signed-in-partner", role: "investor", access_status: "active", is_test: false });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});

describe("newsletter visit authorization", () => {
  it("uses the signed-in identity, never a supplied partner ID", async () => {
    expect(await recordNewsletterVisit({ ...input, partnerId: "someone-else" })).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("record_newsletter_visit", {
      p_partner_id: "signed-in-partner", p_newsletter_slug: input.slug, p_visit_id: input.visitId, p_event: "opened",
    });
  });
  it.each([null, { role: "admin", access_status: "active" }, { role: "investor", access_status: "disabled" }, { role: "investor", access_status: "active", is_test: true }])("ignores ineligible sessions: %j", async (profile) => {
    mocks.profile.mockResolvedValue(profile);
    expect(await recordNewsletterVisit(input)).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ ...input, slug: "draft-issue" }, { ...input, visitId: "invalid" }, { ...input, event: "bad" }])("rejects invalid or unpublished events: %j", async (event) => {
    expect(await recordNewsletterVisit(event)).toBe(false);
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not interrupt reading when storage fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.rpc.mockRejectedValue(new Error("offline"));
    expect(await recordNewsletterVisit(input)).toBe(false);
    warning.mockRestore();
  });
});
