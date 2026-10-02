// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  payoutBasis: "reported_paid",
  status: "requested",
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
        select: () => query,
        order: () => query,
        limit: async () => ({
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
        }),
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
      const html = renderToStaticMarkup(await AdminMaturitiesPage());
      expect(html).toContain("Reported paid");
      expect(html).not.toContain("Begin processing");
      expect(html).not.toContain("Fulfill instruction");
      expect(html).not.toContain("Reopen instruction");
    },
  );
  it("keeps processing available for unpaid requests", async () => {
    state.payoutBasis = "projected";
    state.status = "requested";
    expect(renderToStaticMarkup(await AdminMaturitiesPage())).toContain(
      "Begin processing",
    );
  });
});
