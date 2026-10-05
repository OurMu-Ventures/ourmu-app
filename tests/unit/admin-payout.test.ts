import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  aal: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
  instruction: { investor_id: "partner", status: "requested" } as {
    investor_id: string;
    status: string;
  } | null,
  partner: { phone: "+256700001234", updated_at: "2026-10-05T00:00:00Z" } as {
    phone: string | null;
    updated_at: string;
  } | null,
  queryError: null as { message: string } | null,
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: state.requireAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    IDENTITY_MASTER_KEY_BASE64: Buffer.alloc(32, 7).toString("base64"),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { mfa: { getAuthenticatorAssuranceLevel: state.aal } },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: state.rpc,
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === "profiles" ? state.partner : state.instruction,
            error: state.queryError,
          }),
        }),
      }),
    }),
  }),
}));
import { saveAdminPayoutDestination } from "@/actions/admin-payout";
import { decryptPayoutReference } from "@/lib/security/crypto";
function form() {
  const f = new FormData();
  Object.entries({
    instructionId: "00000000-0000-4000-8000-000000000001",
    channel: "mobile_money",
    providerLabel: "MTN",
    accountName: "Example Account Holder",
    referenceSource: "profile_phone",
    accountReference: "",
    verificationMethod: "phone",
    offlineVerified: "yes",
  }).forEach(([k, v]) => f.set(k, v));
  return f;
}
beforeEach(() => {
  vi.clearAllMocks();
  state.requireAdmin.mockResolvedValue({ id: "admin" });
  state.aal.mockResolvedValue({ data: { currentLevel: "aal2" }, error: null });
  state.rpc.mockResolvedValue({
    data: { needs_resolution: false },
    error: null,
  });
  state.instruction = { investor_id: "partner", status: "requested" };
  state.partner = {
    phone: "+256700001234",
    updated_at: "2026-10-05T00:00:00Z",
  };
  state.queryError = null;
});
describe("admin offline payout setup", () => {
  it("encrypts the partner phone server-side and never sends plaintext to the RPC", async () => {
    const result = await saveAdminPayoutDestination(
      { ok: false, message: "" },
      form(),
    );
    expect(result.ok).toBe(true);
    const [name, args] = state.rpc.mock.calls[0];
    expect(name).toBe("save_admin_maturity_payout_destination");
    expect(args.p_admin_id).toBe("admin");
    expect(args.p_admin_aal2).toBe(true);
    expect(args.p_expected_profile_updated_at).toBe(state.partner?.updated_at);
    expect(JSON.stringify(args)).not.toContain(state.partner?.phone);
    const d = args.p_destination;
    expect(
      decryptPayoutReference({
        ciphertext: Buffer.from(d.account_ref_ciphertext.slice(2), "hex"),
        iv: Buffer.from(d.account_ref_iv.slice(2), "hex"),
        authTag: Buffer.from(d.account_ref_auth_tag.slice(2), "hex"),
        keyVersion: d.key_version,
      }),
    ).toBe(state.partner?.phone);
    expect(result.message).toContain("No payment or reinvestment");
    expect(state.revalidate).toHaveBeenCalledWith("/admin/maturities");
  });
  it("supports an entered bank account", async () => {
    const f = form();
    f.set("channel", "bank");
    f.set("providerLabel", "Example Bank");
    f.set("referenceSource", "manual");
    f.set("accountReference", "BANK123456");
    expect(
      (await saveAdminPayoutDestination({ ok: false, message: "" }, f)).ok,
    ).toBe(true);
    expect(state.rpc.mock.calls[0][1].p_destination.account_last_four).toBe(
      "3456",
    );
    expect(state.rpc.mock.calls[0][1].p_expected_profile_updated_at).toBeNull();
  });
  it("rejects missing offline confirmation before database access", async () => {
    const f = form();
    f.delete("offlineVerified");
    expect(
      (await saveAdminPayoutDestination({ ok: false, message: "" }, f)).ok,
    ).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("fails closed without AAL2", async () => {
    state.aal.mockResolvedValue({
      data: { currentLevel: "aal1" },
      error: null,
    });
    expect(
      (await saveAdminPayoutDestination({ ok: false, message: "" }, form())).ok,
    ).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("propagates the requireAdmin authorization gate", async () => {
    state.requireAdmin.mockRejectedValue(new Error("not admin"));
    await expect(
      saveAdminPayoutDestination({ ok: false, message: "" }, form()),
    ).rejects.toThrow("not admin");
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("rejects a locked instruction", async () => {
    state.instruction!.status = "processing";
    expect(
      (await saveAdminPayoutDestination({ ok: false, message: "" }, form())).ok,
    ).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("requires a phone on file for the phone option", async () => {
    state.partner!.phone = null;
    expect(
      (await saveAdminPayoutDestination({ ok: false, message: "" }, form())).ok,
    ).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("preserves the warning for unrelated holds", async () => {
    state.rpc.mockResolvedValue({
      data: { needs_resolution: true },
      error: null,
    });
    expect(
      (await saveAdminPayoutDestination({ ok: false, message: "" }, form()))
        .message,
    ).toContain("Other resolution holds remain");
  });
  it("does not expose raw database errors or refresh on failure", async () => {
    state.rpc.mockResolvedValue({
      data: null,
      error: { code: "23514", message: "private account detail" },
    });
    const r = await saveAdminPayoutDestination(
      { ok: false, message: "" },
      form(),
    );
    expect(r.ok).toBe(false);
    expect(r.message).not.toContain("private account detail");
    expect(state.revalidate).not.toHaveBeenCalled();
  });
});
