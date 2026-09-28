// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/forms", () => ({ ActivationForm: () => null }));
vi.mock("@/actions/receipts", () => ({
  getReceiptDownloadUrl: vi.fn(),
}));

const state = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({ id: "admin-1" })),
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  investmentCount: 0,
  profiles: [
    { id: "profile-1", legal_name: "Partner One", email: "one@example.test" },
  ],
  identities: [
    {
      id: "legacy-1",
      canonical_name: "Partner One",
      normalized_email: null,
      profile_id: "profile-1",
    },
    {
      id: "legacy-2",
      canonical_name: "Unclaimed Partner",
      normalized_email: null,
      profile_id: null,
    },
  ],
  cycles: [{ id: "cycle-1", name: "September 2026" }],
}));

vi.mock("@/lib/auth", () => ({ requireAdmin: state.requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const record = (method: string, ...args: unknown[]) => {
        state.calls.push({ table, method, args });
        return query;
      };
      const result = () => ({
        data:
          table === "profiles"
            ? state.profiles
            : table === "legacy_partner_identities"
              ? state.identities
              : table === "investment_cycles"
                ? state.cycles
                : [],
        count: table === "investments" ? state.investmentCount : null,
        error: null,
      });
      const query = {
        select: (...args: unknown[]) => record("select", ...args),
        eq: (...args: unknown[]) => record("eq", ...args),
        or: (...args: unknown[]) => record("or", ...args),
        order: (...args: unknown[]) => record("order", ...args),
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

beforeEach(() => {
  state.calls = [];
  state.investmentCount = 0;
  state.requireAdmin.mockClear();
});

describe("admin investment filters", () => {
  it("requires admin access and paginates all investments without a silent 100-row cap", async () => {
    state.investmentCount = 52;
    const page = await AdminInvestmentsPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);

    expect(state.requireAdmin).toHaveBeenCalledOnce();
    expect(call("investments", "select")[0]?.args[1]).toEqual({
      count: "exact",
    });
    expect(call("investments", "range")[0]?.args).toEqual([0, 24]);
    expect(html).toContain("All partners");
    expect(html).toContain("All cycles");
    expect(html).toContain("page=2");
  });

  it("filters a claimed partner's legacy investments within a cycle before paging", async () => {
    await AdminInvestmentsPage({
      searchParams: Promise.resolve({
        partner: "profile:profile-1",
        cycle: "cycle-1",
        page: "2",
      }),
    });

    expect(call("investments", "or")[0]?.args).toEqual([
      "investor_id.eq.profile-1,legacy_partner_id.in.(legacy-1)",
    ]);
    expect(call("investments", "eq")[0]?.args).toEqual(["cycle_id", "cycle-1"]);
    expect(call("investments", "range")[0]?.args).toEqual([25, 49]);
  });

  it("supports unclaimed partner records and rejects unknown filter values", async () => {
    await AdminInvestmentsPage({
      searchParams: Promise.resolve({ partner: "legacy:legacy-2" }),
    });
    expect(call("investments", "eq")[0]?.args).toEqual([
      "legacy_partner_id",
      "legacy-2",
    ]);

    state.calls = [];
    const page = await AdminInvestmentsPage({
      searchParams: Promise.resolve({ partner: "profile:unknown" }),
    });
    expect(call("investments", "select")).toHaveLength(0);
    expect(renderToStaticMarkup(page)).toContain(
      "Select a valid partner and cycle",
    );
  });
});
