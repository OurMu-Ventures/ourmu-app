// @vitest-environment jsdom
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/form", () => ({
  default: ({ children, action }: { children: ReactNode; action: string }) => (
    <form action={action}>{children}</form>
  ),
}));
vi.mock("@/components/forms", () => ({
  LegacyClaimForm: ({ partnerId }: { partnerId: string }) => (
    <div data-claim-form={partnerId} />
  ),
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/partners", () => ({ loadPartnerListings: vi.fn() }));

import PartnersPage from "@/app/(admin)/admin/(console)/partners/page";
import { requireAdmin } from "@/lib/auth";
import type { PartnerListing } from "@/lib/partner-portfolio";
import { loadPartnerListings } from "@/lib/partners";

function id(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function listing(
  index: number,
  overrides: Partial<PartnerListing> = {},
): PartnerListing {
  return {
    ref: { kind: "profile", id: id(index) },
    name: `Partner ${String(index).padStart(2, "0")}`,
    email: `partner${index}@example.test`,
    additionalEmails: [],
    importedNames: [],
    accessStatus: "active",
    kycStatus: "verified",
    isTest: false,
    phoneHint: null,
    importAccepted: true,
    ...overrides,
  };
}

async function render(search: Record<string, string> = {}) {
  return renderToStaticMarkup(
    await PartnersPage({ searchParams: Promise.resolve(search) }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadPartnerListings).mockResolvedValue([
    listing(1, { name: "Jane Doe" }),
    listing(2, {
      ref: { kind: "legacy", id: id(2) },
      name: "Jane Doe",
      email: null,
      accessStatus: null,
      kycStatus: null,
      phoneHint: "•••• 0123",
    }),
    listing(3, {
      ref: { kind: "legacy", id: id(3) },
      name: "Jane Doe",
      email: null,
      accessStatus: null,
      kycStatus: null,
      importAccepted: false,
    }),
    listing(4, {
      name: "Grace Example",
      email: "grace@example.test",
      importedNames: ["G. Example"],
      additionalEmails: [{ email: "grace.work@example.test", verified: true }],
    }),
  ]);
});

describe("partners directory", () => {
  it("requires admin access before loading partners", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(
      new Error("REDIRECT:/admin/mfa"),
    );
    await expect(render()).rejects.toThrow("REDIRECT:/admin/mfa");
    expect(loadPartnerListings).not.toHaveBeenCalled();
  });

  it("links every partner name and a labelled View portfolio action to the portfolio", async () => {
    const html = await render();
    expect(html).toContain(`href="/admin/partners/profile/${id(1)}"`);
    expect(html).toContain(`href="/admin/partners/legacy/${id(2)}"`);
    expect(html).toContain(
      'View portfolio<span class="visually-hidden"> for Jane Doe</span>',
    );
    expect(html).toContain("Unclaimed import");
    expect(html).toContain("Import not accepted");
    expect(html).toContain("Imported as G. Example");
    expect(html).toContain("grace.work@example.test (verified)");
    expect(html).toContain("Showing 1–4 of 4 partners.");
  });

  it("tells duplicate names apart by email, phone or record", async () => {
    const html = await render({ q: "jane doe" });
    expect(html).toContain("Showing 1–3 of 3 partners matching “jane doe”.");
    expect(html).toContain("partner1@example.test");
    expect(html).toContain("Phone •••• 0123");
    expect(html).toContain(`Record ${id(3).slice(0, 8)}`);
    expect(html).toContain(
      `href="/admin/partners/profile/${id(1)}?from=%2Fadmin%2Fpartners%3Fq%3Djane%2Bdoe"`,
    );
  });

  it("finds partners by verified additional email and explains empty results", async () => {
    expect(await render({ q: "grace.work" })).toContain("Grace Example");
    const empty = await render({ q: "nobody" });
    expect(empty).toContain("No partners match “nobody”");
    expect(empty).toContain('href="/admin/partners">Clear search');
  });

  it("paginates instead of silently hiding partners beyond 25", async () => {
    vi.mocked(loadPartnerListings).mockResolvedValue(
      Array.from({ length: 30 }, (_, index) => listing(index + 1)),
    );
    const first = await render({ q: "partner" });
    expect(first).toContain("Showing 1–25 of 30 partners matching “partner”.");
    expect(first).toContain('href="/admin/partners?q=partner&amp;page=2"');
    const second = await render({ q: "partner", page: "2" });
    expect(second).toContain("Showing 26–30 of 30 partners");
    expect(second).toContain("Partner 30");
    expect(second).not.toContain("Partner 25<");
  });

  it("keeps the account-linking forms for unclaimed imported partners", async () => {
    const html = await render({ q: "grace" });
    expect(html).toContain(`data-claim-form="${id(2)}"`);
    expect(html).toContain(`data-claim-form="${id(3)}"`);
    expect(html).not.toContain(`data-claim-form="${id(1)}"`);
  });
});
