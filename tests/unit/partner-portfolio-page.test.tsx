// @vitest-environment jsdom
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/form", () => ({
  default: ({
    children,
    action,
    ...props
  }: {
    children: ReactNode;
    action: string;
  }) => (
    <form action={action} {...props}>
      {children}
    </form>
  ),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/actions/receipts", () => ({
  downloadAdminReceipt: vi.fn(),
  getReceiptDownloadUrl: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/partners", () => ({
  resolvePartner: vi.fn(),
  loadPortfolioInvestments: vi.fn(),
}));

import PartnerPortfolioPage from "@/app/(admin)/admin/(console)/partners/[kind]/[id]/page";
import { getReceiptDownloadUrl } from "@/actions/receipts";
import { requireAdmin } from "@/lib/auth";
import { ugx } from "@/lib/format";
import type { PortfolioInvestmentRow } from "@/lib/partner-portfolio";
import {
  loadPortfolioInvestments,
  resolvePartner,
  type PortfolioPartner,
} from "@/lib/partners";

const PROFILE = "5a1c7f9e-2b4d-4e6f-8a0b-1c2d3e4f5a6b";
const LEGACY = "73a1f123-cdb8-5359-9075-f36604131850";
const CYCLE = "c1000000-0000-4000-8000-000000000001";
const OTHER_CYCLE = "c1000000-0000-4000-8000-000000000002";

const partner: PortfolioPartner = {
  kind: "profile",
  ref: { kind: "profile", id: PROFILE },
  name: "Jane Doe",
  email: "jane@example.test",
  accessStatus: "active",
  kycStatus: "verified",
  isTest: false,
  additionalEmails: [{ email: "work@example.test", verified: true }],
  linkedIdentities: [{ id: LEGACY, name: "J. Doe" }],
};

let sequence = 0;
function row(
  overrides: Partial<PortfolioInvestmentRow> = {},
): PortfolioInvestmentRow {
  sequence += 1;
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    cycle_id: CYCLE,
    status: "active",
    record_origin: "portal",
    alias: null,
    principal_ugx: 1_000_000,
    projected_return_ugx: 300_000,
    projected_value_ugx: 1_300_000,
    maturity_date: "2099-12-31",
    requested_at: `2026-06-${String((sequence % 28) + 1).padStart(2, "0")}T10:00:00+00:00`,
    payout_basis: "projected",
    reported_return_ugx: null,
    reported_payout_ugx: null,
    is_test: false,
    administratively_archived_at: null,
    offline_settlement_id: null,
    investment_cycles: {
      name: "June 2026",
      opens_at: "2026-06-01T00:00:00+00:00",
      actual_return_bps: null,
      legacy_settlement: false,
    },
    import_batches: null,
    maturity_instructions: null,
    investment_receipts: null,
    offline_reinvestment_authorizations: [],
    ...overrides,
  };
}

async function render(
  search: Record<string, string> = {},
  params: { kind: string; id: string } = { kind: "profile", id: PROFILE },
) {
  const page = await PartnerPortfolioPage({
    params: Promise.resolve(params),
    searchParams: Promise.resolve(search),
  });
  return renderToStaticMarkup(page);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolvePartner).mockResolvedValue({ status: "found", partner });
  vi.mocked(loadPortfolioInvestments).mockResolvedValue([]);
});

describe("partner portfolio page", () => {
  it("authorizes before reading and rejects malformed partner links without a query", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("REDIRECT:/login"));
    await expect(render()).rejects.toThrow("REDIRECT:/login");
    expect(resolvePartner).not.toHaveBeenCalled();

    for (const params of [
      { kind: "investor", id: PROFILE },
      { kind: "profile", id: "not-an-id" },
    ]) {
      await expect(render({}, params)).rejects.toThrow("NOT_FOUND");
    }
    expect(resolvePartner).not.toHaveBeenCalled();
  });

  it("shows not found for unknown partners and sends claimed imports to their profile", async () => {
    vi.mocked(resolvePartner).mockResolvedValueOnce({ status: "missing" });
    await expect(render()).rejects.toThrow("NOT_FOUND");

    vi.mocked(resolvePartner).mockResolvedValueOnce({
      status: "claimed",
      profile: { kind: "profile", id: PROFILE },
    });
    await expect(
      render(
        { from: "/admin/investments?partnerSearch=jane" },
        { kind: "legacy", id: LEGACY },
      ),
    ).rejects.toThrow(
      `REDIRECT:/admin/partners/profile/${PROFILE}?from=%2Fadmin%2Finvestments%3FpartnerSearch%3Djane`,
    );
    expect(loadPortfolioInvestments).not.toHaveBeenCalled();
  });

  it("heads the page with the partner identity and portfolio-wide totals", async () => {
    vi.mocked(loadPortfolioInvestments).mockResolvedValue([
      row({
        principal_ugx: 2_000_000,
        projected_return_ugx: 600_000,
        projected_value_ugx: 2_600_000,
      }),
      row({ status: "reserved", principal_ugx: 500_000 }),
      row({ status: "matured", maturity_date: "2026-09-30" }),
      row({ status: "cancelled", principal_ugx: 9_000_000 }),
    ]);
    const html = await render();
    expect(html).toContain("Jane Doe’s portfolio");
    expect(html).toContain("jane@example.test");
    expect(html).toContain("work@example.test (verified)");
    expect(html).toContain("Linked imported records: J. Doe");
    expect(html).toContain("All cycles · entire portfolio");
    expect(html).toContain(ugx(2_000_000));
    expect(html).toContain(ugx(2_600_000));
    expect(html).toContain(ugx(500_000));
    expect(html).toContain(ugx(1_300_000));
    expect(html).toContain("1 investment · Estimated");
    // The cancelled record is listed but never added to active principal.
    expect(html).not.toContain(ugx(11_000_000));
    expect(html).toContain("Showing 1–4 of 4 records.");
    expect(html).toContain('href="/admin/partners"');
    expect(html).toContain("Back to");
  });

  it("filters the table by status and cycle while totals keep covering the whole portfolio", async () => {
    vi.mocked(loadPortfolioInvestments).mockResolvedValue([
      row({
        principal_ugx: 2_000_000,
        projected_return_ugx: 600_000,
        projected_value_ugx: 2_600_000,
      }),
      row({
        status: "matured",
        maturity_date: "2026-09-30",
        cycle_id: OTHER_CYCLE,
        investment_cycles: {
          name: "December 2025",
          opens_at: "2025-12-01T00:00:00+00:00",
          actual_return_bps: null,
          legacy_settlement: false,
        },
        maturity_instructions: {
          status: "fulfilled",
          choice: "withdraw_all",
          needs_resolution: false,
          actual_payout_ugx: 1_300_000,
          actual_reinvest_ugx: 0,
          fulfilled_at: "2026-10-15T12:00:00+00:00",
        },
      }),
    ]);
    const html = await render({ status: "settled", cycle: OTHER_CYCLE });
    expect(html).toContain("Showing 1–1 of 1 records.");
    expect(html).toContain("Totals above still cover the entire portfolio.");
    expect(html).toContain("Settled · December 2025");
    expect(html).toContain(`Paid ${ugx(1_300_000)}`);
    // The active record stays in the totals although it is filtered out.
    expect(html).toContain(ugx(2_000_000));
    expect(html).toMatch(/aria-current="page"[^>]*>Settled \(1\)/);
    expect(html).toContain('name="status" value="settled"');
  });

  it("ignores filter values that do not belong to this portfolio", async () => {
    vi.mocked(loadPortfolioInvestments).mockResolvedValue([row()]);
    const html = await render({ status: "bogus", cycle: OTHER_CYCLE });
    expect(html).toContain("That filter is not available for this portfolio");
    expect(html).toContain("Showing 1–1 of 1 records.");
  });

  it("paginates beyond 25 records and keeps the return path", async () => {
    vi.mocked(loadPortfolioInvestments).mockResolvedValue(
      Array.from({ length: 30 }, () => row()),
    );
    const from = "/admin/partners?q=jane";
    const first = await render({ from });
    expect(first).toContain("Showing 1–25 of 30 records.");
    expect(first).toContain(
      `href="/admin/partners/profile/${PROFILE}?page=2&amp;from=%2Fadmin%2Fpartners%3Fq%3Djane"`,
    );
    expect(first).toContain('href="/admin/partners?q=jane"');
    const second = await render({ from, page: "2" });
    expect(second).toContain("Showing 26–30 of 30 records.");
  });

  it("explains an empty portfolio", async () => {
    const html = await render();
    expect(html).toContain("No investment records for this partner yet.");
    expect(html).toContain("No active investments");
    expect(html).toContain("Nothing awaiting settlement");
  });

  it("offers receipts on demand instead of minting download links while rendering", async () => {
    vi.mocked(loadPortfolioInvestments).mockResolvedValue([
      row({
        investment_receipts: {
          id: "9d1c7f9e-2b4d-4e6f-8a0b-1c2d3e4f5a6b",
          receipt_number: "OURMU-2026-000123",
          pdf_status: "ready",
        },
      }),
      row({
        investment_receipts: {
          id: "8d1c7f9e-2b4d-4e6f-8a0b-1c2d3e4f5a6b",
          receipt_number: "OURMU-2026-000124",
          pdf_status: "failed",
        },
      }),
    ]);
    const html = await render();
    expect(html).toContain("Receipt OURMU-2026-000123");
    expect(html).toContain("OURMU-2026-000124: failed");
    expect(getReceiptDownloadUrl).not.toHaveBeenCalled();
  });

  it("only links back to the lists an admin came from", async () => {
    expect(
      await render({ from: "/admin/investments?partnerSearch=jane" }),
    ).toContain('href="/admin/investments?partnerSearch=jane"');
    const html = await render({ from: "https://evil.example/admin/partners" });
    expect(html).not.toContain("evil.example");
    expect(html).toContain("Back to");
  });

  it("labels unclaimed imported partners and test accounts", async () => {
    vi.mocked(resolvePartner).mockResolvedValueOnce({
      status: "found",
      partner: {
        kind: "legacy",
        ref: { kind: "legacy", id: LEGACY },
        name: "J. Doe",
        email: null,
        phoneHint: "•••• 0123",
        importAccepted: true,
      },
    });
    const unclaimed = await render({}, { kind: "legacy", id: LEGACY });
    expect(unclaimed).toContain("Unclaimed import");
    expect(unclaimed).toContain("No email on file");
    expect(unclaimed).toContain("phone •••• 0123");

    vi.mocked(resolvePartner).mockResolvedValueOnce({
      status: "found",
      partner: { ...partner, isTest: true },
    });
    expect(await render()).toContain("Test account.");
  });
});
