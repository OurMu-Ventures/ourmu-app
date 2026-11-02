// @vitest-environment jsdom
import type { ReactNode } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/form", () => ({
  default: ({ children, action }: { children: ReactNode; action: string }) => (
    <form action={action}>{children}</form>
  ),
}));
vi.mock("@/components/forms", () => ({ ActivationForm: () => null }));
vi.mock("@/actions/receipts", () => ({
  getReceiptDownloadUrl: vi.fn(),
}));

const PROFILE = "5a1c7f9e-2b4d-4e6f-8a0b-1c2d3e4f5a6b";
const CLAIMED = "73a1f123-cdb8-5359-9075-f36604131850";
const UNCLAIMED = "84b2a234-dec9-546a-a186-a47715242961";
const CYCLE = "c1000000-0000-4000-8000-000000000001";

const state = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({ id: "admin-1" })),
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  investmentCount: 0,
  tables: {} as Record<string, Record<string, unknown>[]>,
}));

vi.mock("@/lib/auth", () => ({ requireAdmin: state.requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const record = (method: string, ...args: unknown[]) => {
        state.calls.push({ table, method, args });
        return query;
      };
      const result = () => ({
        data: (state.tables[table] ?? []).filter((row) =>
          filters.every((filter) => filter(row)),
        ),
        count: table === "investments" ? state.investmentCount : null,
        error: null,
      });
      const query = {
        select: (...args: unknown[]) => record("select", ...args),
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return record("eq", column, value);
        },
        is: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return record("is", column, value);
        },
        or: (...args: unknown[]) => record("or", ...args),
        order: (...args: unknown[]) => record("order", ...args),
        maybeSingle: () =>
          Promise.resolve({ data: result().data[0] ?? null, error: null }),
        range: (...args: unknown[]) => {
          record("range", ...args);
          return Promise.resolve(result());
        },
        then: (resolve: (value: ReturnType<typeof result>) => unknown) =>
          Promise.resolve(result()).then(resolve),
      };
      return query;
    },
  }),
}));

import AdminInvestmentsPage from "@/app/(admin)/admin/(console)/investments/page";

function call(table: string, method: string) {
  return state.calls.filter(
    (item) => item.table === table && item.method === method,
  );
}

async function render(search: Record<string, string> = {}) {
  return renderToStaticMarkup(
    await AdminInvestmentsPage({ searchParams: Promise.resolve(search) }),
  );
}

// Investment records include the async receipt line, which needs a
// streaming render that waits for every component.
async function renderRecords(search: Record<string, string> = {}) {
  const stream = await renderToReadableStream(
    await AdminInvestmentsPage({ searchParams: Promise.resolve(search) }),
  );
  await stream.allReady;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return html;
    html += decoder.decode(value, { stream: true });
  }
}

beforeEach(() => {
  state.calls = [];
  state.investmentCount = 0;
  state.requireAdmin.mockClear();
  state.tables = {
    profiles: [
      {
        id: PROFILE,
        role: "investor",
        legal_name: "Partner One",
        email: "one@example.test",
        access_status: "active",
        kyc_status: "verified",
        is_test: false,
      },
    ],
    account_emails: [],
    legacy_partner_identities: [
      {
        id: CLAIMED,
        canonical_name: "Partner One",
        normalized_email: null,
        normalized_phone: null,
        source_aliases: [],
        profile_id: PROFILE,
        import_batches: { status: "accepted" },
      },
      {
        id: UNCLAIMED,
        canonical_name: "Unclaimed Partner",
        normalized_email: null,
        normalized_phone: null,
        source_aliases: [],
        profile_id: null,
        import_batches: { status: "accepted" },
      },
    ],
    investment_cycles: [{ id: CYCLE, name: "September 2026" }],
    investments: [],
  };
});

describe("admin investment filters", () => {
  it("requires admin access and paginates all investments without a silent 100-row cap", async () => {
    state.investmentCount = 52;
    const html = await render();

    expect(state.requireAdmin).toHaveBeenCalledOnce();
    expect(call("investments", "select")[0]?.args[1]).toEqual({
      count: "exact",
    });
    expect(call("investments", "select")[0]?.args[0]).toContain(
      "investment_receipts!investment_receipts_investment_id_fkey(",
    );
    expect(call("investments", "range")[0]?.args).toEqual([0, 24]);
    expect(html).toContain("Find a partner’s portfolio");
    expect(html).not.toContain('name="partner"');
    expect(html).toContain("All cycles");
    expect(html).toContain("page=2");
    // No partner lookups happen until someone searches.
    expect(call("profiles", "select")).toHaveLength(0);
  });

  it("filters a claimed partner's legacy investments within a cycle before paging", async () => {
    const html = await render({
      partner: `profile:${PROFILE}`,
      cycle: CYCLE,
      page: "2",
    });

    expect(call("investments", "or")[0]?.args).toEqual([
      `investor_id.eq.${PROFILE},legacy_partner_id.in.(${CLAIMED})`,
    ]);
    expect(call("investments", "eq")[0]?.args).toEqual(["cycle_id", CYCLE]);
    expect(call("investments", "range")[0]?.args).toEqual([25, 49]);
    expect(html).toContain(
      "Showing investments for <strong>Partner One</strong>",
    );
    expect(html).toContain(`href="/admin/partners/profile/${PROFILE}?from=`);
    expect(html).toContain(`value="profile:${PROFILE}"`);
  });

  it("supports unclaimed partner records, resolves claimed ones and rejects unknown filter values", async () => {
    await render({ partner: `legacy:${UNCLAIMED}` });
    expect(call("investments", "or")[0]?.args).toEqual([
      `legacy_partner_id.eq.${UNCLAIMED}`,
    ]);

    state.calls = [];
    await render({ partner: `legacy:${CLAIMED}` });
    expect(call("investments", "or")[0]?.args).toEqual([
      `investor_id.eq.${PROFILE},legacy_partner_id.in.(${CLAIMED})`,
    ]);

    for (const partner of [
      "profile:unknown",
      `profile:${PROFILE},investor_id.not.is.null`,
      "profile:00000000-0000-4000-8000-000000000000",
    ]) {
      state.calls = [];
      const html = await render({ partner });
      expect(call("investments", "select")).toHaveLength(0);
      expect(html).toContain("Select a valid partner and cycle");
    }
  });

  it("shows visible partner results with portfolio links instead of a dropdown", async () => {
    state.investmentCount = 40;
    const html = await render({ partnerSearch: "partner", cycle: CYCLE });

    expect(html).toContain("2 partners match “partner”.");
    expect(html).toContain(
      `href="/admin/partners/profile/${PROFILE}?from=%2Fadmin%2Finvestments%3FpartnerSearch%3Dpartner%26cycle%3D${CYCLE}"`,
    );
    expect(html).toContain(`href="/admin/partners/legacy/${UNCLAIMED}?from=`);
    expect(html).toContain("Unclaimed import");
    expect(html).not.toContain('<select name="partner"');
    // A search keeps the register's other filters.
    expect(html).toContain(`name="cycle" value="${CYCLE}"`);
    expect(html).toContain(
      `partnerSearch=partner&amp;cycle=${CYCLE}&amp;page=2`,
    );
  });

  it("searches names literally", async () => {
    const html = await render({ partnerSearch: "%_" });
    expect(html).toContain("No partners match “%_”.");
    expect(html).not.toContain("View portfolio<span");
  });

  it("links each investment record to its owner's portfolio", async () => {
    state.investmentCount = 3;
    const base = {
      cycle_id: CYCLE,
      record_origin: "legacy_import",
      status: "active",
      units: 8,
      principal_ugx: 1_000_000,
      projected_value_ugx: 1_300_000,
      reported_payout_ugx: null,
      requested_at: "2026-09-01T10:00:00Z",
      maturity_date: "2027-02-28",
      investment_cycles: { name: "September 2026" },
      investment_receipts: null,
    };
    state.tables.investments = [
      {
        ...base,
        id: "i1",
        investor_id: PROFILE,
        legacy_partner_id: null,
        record_origin: "portal",
        profiles: { legal_name: "Partner One", email: "one@example.test" },
        legacy_partner_identities: null,
      },
      {
        ...base,
        id: "i2",
        investor_id: null,
        legacy_partner_id: CLAIMED,
        profiles: null,
        legacy_partner_identities: {
          canonical_name: "Partner One",
          normalized_email: null,
          profile_id: PROFILE,
        },
      },
      {
        ...base,
        id: "i3",
        investor_id: null,
        legacy_partner_id: UNCLAIMED,
        profiles: null,
        legacy_partner_identities: {
          canonical_name: "Unclaimed Partner",
          normalized_email: null,
          profile_id: null,
        },
      },
    ];
    const html = await renderRecords();
    expect(
      html.match(new RegExp(`/admin/partners/profile/${PROFILE}`, "g")),
    ).toHaveLength(2);
    expect(html).toContain(`/admin/partners/legacy/${UNCLAIMED}`);
  });
});
