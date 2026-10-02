// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  payoutBasis: "reported_paid",
  status: "requested",
  calls: [] as unknown[][],
  error: null as { message: string } | null,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireAdmin: async () => ({ id: "admin-1" }),
}));
vi.mock("@/actions/maturity", () => ({ beginMaturityProcessing: vi.fn() }));
vi.mock("@/components/SubmitButton", () => ({
  SubmitButton: () => <button>Begin processing</button>,
}));
vi.mock("@/components/maturity-forms", () => ({
  MaturityFulfillmentForm: () => <form>Fulfill instruction</form>,
  MaturityReopenForm: () => <form>Reopen instruction</form>,
}));
vi.mock("@/lib/security/crypto", () => ({ decryptPayoutReference: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const query = {
        select: (...args: unknown[]) => { state.calls.push(["select", ...args]); return query; },
        order: () => query,
        eq: (...args: unknown[]) => { state.calls.push(["eq", ...args]); return query; },
        neq: (...args: unknown[]) => { state.calls.push(["neq", ...args]); return query; },
        gt: (...args: unknown[]) => { state.calls.push(["gt", ...args]); return query; },
        in: (...args: unknown[]) => { state.calls.push(["in", ...args]); return query; },
        or: (...args: unknown[]) => { state.calls.push(["or", ...args]); return query; },
        range: async (...args: unknown[]) => { state.calls.push(["range", ...args]); return ({
          error: state.error,
          data: [
            {
              id: "instruction-1",
              status: state.status,
              choice: "reinvest_all",
              needs_resolution: false,
              revision_count: 0,
              created_at: "2026-10-01T12:00:00Z",
              projected_payout_ugx: 0,
              projected_reinvest_ugx: 325000,
              profiles: { legal_name: "Partner" },
              investments: {
                principal_ugx: 250000,
                payout_basis: state.payoutBasis,
              },
              investment_cycles: null,
              payout_destinations: null,
            },
          ],
        }); },
      };
      return query;
    },
  }),
}));

import AdminMaturitiesPage from "@/app/(admin)/admin/(console)/maturities/page";

describe("paid records in the admin maturity queue", () => {
  it.each(["requested", "processing"])(
    "blocks actions on paid %s instructions",
    async (status) => {
      state.payoutBasis = "reported_paid";
      state.status = status;
      const html = renderToStaticMarkup(await AdminMaturitiesPage({ searchParams: Promise.resolve({ tab: "history" }) }));
      expect(html).toContain("Reported paid");
      expect(html).not.toContain("Begin processing");
      expect(html).not.toContain("Fulfill instruction");
      expect(html).not.toContain("Reopen instruction");
    },
  );
  it("keeps processing available for unpaid requests", async () => {
    state.payoutBasis = "projected";
    state.status = "requested";
    expect(renderToStaticMarkup(await AdminMaturitiesPage({}))).toContain(
      "Begin processing",
    );
  });
});

describe("maturity views", () => {
  it("joins the investor profile explicitly rather than the processing admin", async () => {
    state.calls = [];
    await AdminMaturitiesPage({});
    const select = state.calls.find(([method]) => method === "select")?.[1];
    expect(select).toContain("profiles!maturity_instructions_investor_id_fkey(legal_name,email)");
    expect(select).not.toContain("profiles(legal_name,email)");
  });
  it("defaults to pending withdrawals without search params", async () => {
    state.calls = [];
    const html = renderToStaticMarkup(await AdminMaturitiesPage({}));
    expect(state.calls).toContainEqual(["gt", "projected_payout_ugx", 0]);
    expect(state.calls).not.toContainEqual(["eq", "paid_investment.payout_basis", "reported_paid"]);
    const container = document.createElement("div");
    container.innerHTML = html;
    expect(container.querySelector('nav[aria-label="Maturity views"] [aria-current="page"]')?.textContent).toBe("Withdrawals");
  });
  it("surfaces query failures instead of reporting an empty queue", async () => {
    state.error = { message: "query failed" };
    try {
      await expect(AdminMaturitiesPage({})).rejects.toThrow("Unable to load maturity instructions.");
    } finally { state.error = null; }
  });
  it.each(["withdrawals", "reinvestments"])("filters pending %s before pagination", async (tab) => {
    state.calls = [];
    await AdminMaturitiesPage({ searchParams: Promise.resolve({ tab, page: "2" }) });
    expect(state.calls).toContainEqual(["in", "status", ["requested", "processing"]]);
    expect(state.calls).toContainEqual(["neq", "investments.payout_basis", "reported_paid"]);
    expect(state.calls).toContainEqual(["gt", tab === "withdrawals" ? "projected_payout_ugx" : "projected_reinvest_ugx", 0]);
    expect(state.calls).toContainEqual(["range", 25, 49]);
    expect(state.calls).not.toContainEqual(["eq", "paid_investment.payout_basis", "reported_paid"]);
  });
  it("includes completed and legacy paid records in history", async () => {
    state.calls = [];
    await AdminMaturitiesPage({ searchParams: Promise.resolve({ tab: "history" }) });
    expect(state.calls).toContainEqual(["eq", "paid_investment.payout_basis", "reported_paid"]);
    expect(state.calls).toContainEqual(["or", "status.eq.fulfilled,paid_investment.not.is.null"]);
    expect(state.calls.some(([method]) => method === "gt")).toBe(false);
  });
});
