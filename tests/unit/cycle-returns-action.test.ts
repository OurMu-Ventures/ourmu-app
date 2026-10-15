import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  aal: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: state.requireAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { mfa: { getAuthenticatorAssuranceLevel: state.aal } },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: state.rpc }),
}));
import {
  previewCycleActualReturn,
  recordCycleActualReturn,
} from "@/actions/cycle-returns";

const CYCLE = "00000000-0000-4000-8000-000000000001";
const REQUEST = "00000000-0000-4000-8000-0000000000aa";
const initial = { ok: false, message: "" };
const snapshot = {
  actual_return_bps: null,
  actual_return_revision: 0,
  investment_count: 2,
  test_investment_count: 1,
  principal_ugx: 458333.33,
  projected_profit_ugx: 137499.999,
  actual_profit_ugx: 125354.165755,
  total_value_ugx: 583687.495755,
  difference_from_projection_ugx: -12145.833245,
  late_entry: false,
  can_record: true,
  blocked_reason: null,
};

function form(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}
const recordForm = (overrides: Record<string, string> = {}) =>
  form({
    cycleId: CYCLE,
    actualReturnBps: "2735",
    expectedRevision: "0",
    expectedInvestmentCount: "2",
    expectedPrincipalUgx: "458333.33",
    requestId: REQUEST,
    confirmed: "yes",
    ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
  state.requireAdmin.mockResolvedValue({ id: "admin" });
  state.aal.mockResolvedValue({ data: { currentLevel: "aal2" }, error: null });
  state.rpc.mockResolvedValue({ data: snapshot, error: null });
});

describe("previewCycleActualReturn", () => {
  it("previews the parsed rate with the database totals", async () => {
    const result = await previewCycleActualReturn(
      initial,
      form({ cycleId: CYCLE, actualReturnPercent: "27.35" }),
    );
    expect(state.rpc).toHaveBeenCalledWith("preview_cycle_actual_return", {
      p_admin_id: "admin",
      p_admin_aal2: true,
      p_cycle_id: CYCLE,
      p_actual_return_bps: 2735,
    });
    expect(result.ok).toBe(true);
    expect(result.preview).toMatchObject({
      actualReturnBps: 2735,
      revision: 0,
      investmentCount: 2,
      principalUgx: 458333.33,
      actualProfitUgx: 125354.165755,
      totalValueUgx: 583687.495755,
      differenceUgx: -12145.833245,
    });
    expect(result.preview?.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("requires administrator MFA", async () => {
    state.aal.mockResolvedValue({ data: { currentLevel: "aal1" }, error: null });
    const result = await previewCycleActualReturn(
      initial,
      form({ cycleId: CYCLE, actualReturnPercent: "27.35" }),
    );
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toMatch(/two-factor/);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("rejects invalid percentages before calling the database", async () => {
    for (const value of ["-1", "27.355", "1000.01", ""]) {
      const result = await previewCycleActualReturn(
        initial,
        form({ cycleId: CYCLE, actualReturnPercent: value }),
      );
      expect(result.ok).toBe(false);
    }
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("explains why a cycle cannot record a rate", async () => {
    state.rpc.mockResolvedValue({
      data: { ...snapshot, can_record: false, blocked_reason: "legacy_settlement" },
      error: null,
    });
    const result = await previewCycleActualReturn(
      initial,
      form({ cycleId: CYCLE, actualReturnPercent: "27.35" }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/per-investment workflow/);
  });
});

describe("recordCycleActualReturn", () => {
  it("sends the previewed expectations for stale-update protection", async () => {
    const result = await recordCycleActualReturn(initial, recordForm());
    expect(state.rpc).toHaveBeenCalledWith("record_cycle_actual_return", {
      p_admin_id: "admin",
      p_admin_aal2: true,
      p_cycle_id: CYCLE,
      p_actual_return_bps: 2735,
      p_expected_revision: 0,
      p_expected_investment_count: 2,
      p_expected_principal_ugx: 458333.33,
      p_confirmed: true,
      p_request_id: REQUEST,
    });
    expect(result).toMatchObject({ ok: true, savedRequestId: REQUEST });
    expect(state.revalidate).toHaveBeenCalledWith("/admin/cycles");
    expect(state.revalidate).toHaveBeenCalledWith("/dashboard");
  });

  it("requires explicit confirmation", async () => {
    const result = await recordCycleActualReturn(
      initial,
      recordForm({ confirmed: "" }),
    );
    expect(result.ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("surfaces stale-form rejections from the database", async () => {
    state.rpc.mockResolvedValue({
      data: null,
      error: new Error(
        "the actual return changed since you loaded this page; review the refreshed figures and confirm again",
      ),
    });
    const result = await recordCycleActualReturn(initial, recordForm());
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/changed since you loaded this page/);
    expect(state.revalidate).not.toHaveBeenCalled();
  });

  it("surfaces the maturity lock", async () => {
    state.rpc.mockResolvedValue({
      data: null,
      error: new Error(
        "the actual return is locked at maturity and can no longer be revised",
      ),
    });
    const result = await recordCycleActualReturn(initial, recordForm());
    expect(result.message).toMatch(/locked at maturity/);
  });
});
