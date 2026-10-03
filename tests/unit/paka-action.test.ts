import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  investment: {} as Record<string, unknown> | null,
  from: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  requireInvestor: async () => ({ id: "partner" }),
  requireAdmin: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: state.from, rpc: state.rpc }),
}));
vi.mock("@/lib/db", () => ({
  requestId: () => "request",
  toBytea: () => "\\x05",
  publicError: (_: unknown, fallback: string) => fallback,
}));
vi.mock("@/lib/security/crypto", () => ({
  encryptPayoutReference: vi.fn(),
  fingerprintRequestValue: () => "test",
}));
import { submitMaturityInstruction } from "@/actions/maturity";

function form(amount: string, choice = "withdraw_roi_reinvest_principal") {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    investmentId: "f7213635-be92-5ebe-b501-b39276a45bf1",
    choice,
    requestedWithdrawalUgx: amount,
    payoutDestinationId: "99999999-9999-4999-8999-999999999999",
    destinationConfirmed: "yes",
    targetCycleId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    agreementAccepted: "yes",
    expectedAgreementVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  }))
    data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  state.investment = {
    status: "matured",
    payout_basis: "projected",
    principal_ugx: 4_569_760,
    projected_return_ugx: 1_370_928,
    maturity_instructions: null,
  };
  state.from.mockImplementation((table: string) => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => ({
        data:
          table === "investments" ? state.investment : { id: "destination" },
      })),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    return query;
  });
  state.rpc.mockResolvedValue({ error: null });
});
describe("custom maturity action", () => {
  it("validates the authoritative total before touching destinations", async () => {
    const result = await submitMaturityInstruction(
      { ok: false, message: "" },
      form("6000000"),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Bijjodolo");
    expect(state.from.mock.calls.map(([table]) => table)).toEqual([
      "investments",
    ]);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { status: "matured", payout_basis: "reported_paid" },
    { status: "active", payout_basis: "projected" },
    {
      status: "matured",
      payout_basis: "projected",
      maturity_instructions: { status: "processing" },
    },
  ])(
    "rejects ineligible or locked instructions before saving a destination",
    async (override) => {
      state.investment = { ...state.investment, ...override };
      expect(
        (
          await submitMaturityInstruction(
            { ok: false, message: "" },
            form("5000000"),
          )
        ).ok,
      ).toBe(false);
      expect(state.from.mock.calls.map(([table]) => table)).toEqual([
        "investments",
      ]);
      expect(state.rpc).not.toHaveBeenCalled();
    },
  );
  it("passes the custom amount and mode to the RPC", async () => {
    expect(
      (
        await submitMaturityInstruction(
          { ok: false, message: "" },
          form("5000000"),
        )
      ).ok,
    ).toBe(true);
    expect(state.rpc).toHaveBeenCalledWith(
      "submit_maturity_instruction",
      expect.objectContaining({
        p_requested_withdrawal_ugx: 5_000_000,
        p_custom_split: true,
      }),
    );
  });
  it.each(["withdraw_all", "reinvest_all"])(
    "clears a stale amount for %s",
    async (choice) => {
      expect(
        (
          await submitMaturityInstruction(
            { ok: false, message: "" },
            form("invalid", choice),
          )
        ).ok,
      ).toBe(true);
      expect(state.rpc).toHaveBeenCalledWith(
        "submit_maturity_instruction",
        expect.objectContaining({
          p_requested_withdrawal_ugx: null,
          p_custom_split: false,
          p_expected_agreement_version_id:
            choice === "withdraw_all"
              ? null
              : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
      );
    },
  );
});
