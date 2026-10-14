import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  aal: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireAdmin: mocks.admin,
  requireInvestor: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({
  requestId: () => "request",
  publicError: (_: unknown, fallback: string) => fallback,
  toBytea: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { mfa: { getAuthenticatorAssuranceLevel: mocks.aal } },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));
import { fulfillMaturityInstruction } from "@/actions/maturity";

function submission(confirmation?: string) {
  const data = new FormData();
  data.set("instructionId", "00000000-0000-4000-8000-000000000002");
  data.set("actualRoiUgx", "300000");
  data.set("payoutReference", "TRANSFER-123");
  data.set("destinationVerified", "yes");
  if (confirmation !== undefined) data.set("confirmation", confirmation);
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.admin.mockResolvedValue({ id: "admin" });
  mocks.aal.mockResolvedValue({ data: { currentLevel: "aal2" } });
  mocks.rpc.mockResolvedValue({ data: { fulfilled: true }, error: null });
});

describe("completion confirmation action", () => {
  it.each([undefined, "", "FULFILL"])(
    "rejects unconfirmed submissions (%s)",
    async (confirmation) => {
      expect(
        (
          await fulfillMaturityInstruction(
            { ok: false, message: "" },
            submission(confirmation),
          )
        ).ok,
      ).toBe(false);
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it("maps explicit dialog confirmation to the existing database contract", async () => {
    expect(
      (
        await fulfillMaturityInstruction(
          { ok: false, message: "" },
          submission("yes"),
        )
      ).ok,
    ).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "fulfill_maturity_instruction",
      expect.objectContaining({
        p_admin_id: "admin",
        p_admin_aal2: true,
        p_confirmation: "FULFILL",
        p_actual_roi_ugx: 300000,
        p_destination_verified: true,
        p_payout_reference: "TRANSFER-123",
      }),
    );
  });

  it("continues to require administrator authorization", async () => {
    mocks.admin.mockRejectedValue(new Error("not admin"));
    await expect(
      fulfillMaturityInstruction({ ok: false, message: "" }, submission("yes")),
    ).rejects.toThrow("not admin");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("preserves the database's MFA gate and safe error response", async () => {
    mocks.aal.mockResolvedValue({ data: { currentLevel: "aal1" } });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "private detail" },
    });
    const result = await fulfillMaturityInstruction(
      { ok: false, message: "" },
      submission("yes"),
    );
    expect(mocks.rpc.mock.calls[0][1].p_admin_aal2).toBe(false);
    expect(result).toEqual({
      ok: false,
      message: "Fulfillment failed. No records were moved.",
    });
  });

  it("preserves the revised-amount confirmation response", async () => {
    mocks.rpc.mockResolvedValue({
      data: { pending_partner_confirmation: true },
      error: null,
    });
    const result = await fulfillMaturityInstruction(
      { ok: false, message: "" },
      submission("yes"),
    );
    expect(result.message).toContain("pending partner confirmation");
    expect(result.message).toContain("Nothing was paid or reinvested");
  });
});
