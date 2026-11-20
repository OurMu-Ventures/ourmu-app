import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { allocateBankDeposit } from "@/actions/bank-deposits";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const rpc = vi.fn();
const assurance = vi.fn();
const initial = { ok: false, message: "" };
const request = "6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a01";
const account = "6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a04";
function form() {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    requestId: request,
    investorId: "6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a02",
    cycleId: "6d1c4f63-6c7a-4b8e-9f1e-0d4f2c3b1a03",
    agreementHash: "ab".repeat(32),
    bankReference: "DEP-SYNTH-1",
    receivedAmountUgx: "3000000",
    receivedDate: "2026-11-20",
    authorizedOn: "2026-11-20",
    authorizationMethod: "email",
    evidenceReference: "Mailbox: split instruction email",
    verificationNotes: "Matched statement line and partner instruction email.",
    identityVerified: "yes",
    splitVerified: "yes",
    agreementAccepted: "yes",
    confirmation: "ALLOCATE",
    "placementAccount.0": account,
    "placementAmount.0": "3000000",
  }))
    data.set(name, value);
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({ id: "admin-1" } as Awaited<
    ReturnType<typeof requireAdmin>
  >);
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<
    typeof createAdminClient
  >);
  vi.mocked(createClient).mockResolvedValue({
    auth: { mfa: { getAuthenticatorAssuranceLevel: assurance } },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  assurance.mockResolvedValue({ data: { currentLevel: "aal2" } });
  rpc.mockResolvedValue({ data: { deposit_id: "deposit-1" }, error: null });
});

describe("allocate bank deposit action", () => {
  it("posts with the session admin, its MFA level and the form's request ID", async () => {
    await expect(allocateBankDeposit(initial, form())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/deposits?allocated=deposit-1#allocation-success",
    );
    expect(rpc).toHaveBeenCalledWith("allocate_bank_deposit", expect.objectContaining({
      p_admin_id: "admin-1",
      p_admin_aal2: true,
      p_request_id: request,
      p_received_date: "2026-11-20",
      p_agreement_accepted_offline: true,
      p_allocations: [{ kind: "offline_placement", account_id: account, amount_ugx: "3000000" }],
    }));
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_received_at");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/deposits");
  });

  it("passes AAL1 through so the database refuses it", async () => {
    assurance.mockResolvedValue({ data: { currentLevel: "aal1" } });
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "active administrator AAL2 required" },
    });
    const result = await allocateBankDeposit(initial, form());
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_admin_aal2: false });
    expect(result.message).toContain("two-factor");
  });

  it("returns recognized rules without leaking or revalidating", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({
      data: null,
      error: { code: "23514", message: "investor cycle limit exceeded; held for staff resolution", details: "private" },
    });
    const result = await allocateBankDeposit(initial, form());
    expect(result).toEqual({
      ok: false,
      message: "This would exceed the partner’s limit for this cycle across all their accounts. No records were changed.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
    log.mockRestore();
  });

  it("hides unrecognized database errors behind the request reference", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "internal detail" } });
    const result = await allocateBankDeposit(initial, form());
    expect(result.message).toContain(request);
    expect(result.message).not.toContain("internal detail");
  });

  it("validates before calling the database", async () => {
    const data = form();
    data.set("confirmation", "nope");
    const result = await allocateBankDeposit(initial, data);
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
