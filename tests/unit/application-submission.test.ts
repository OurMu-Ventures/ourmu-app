import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ rpc: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: state.rpc }),
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    LEGAL_PRIVACY_VERSION: "v1",
    IDENTITY_MASTER_KEY_BASE64: Buffer.alloc(32, 7).toString("base64"),
  }),
}));
vi.mock("@/lib/db", () => ({
  audit: state.audit,
  requestId: () => "00000000-0000-4000-8000-000000000001",
  toBytea: (b: Buffer) => `\\x${b.toString("hex")}`,
}));
import { submitApplication } from "@/actions/applications";
function form() {
  const f = new FormData();
  Object.entries({
    legalName: "Example Partner",
    email: "Partner@Example.com",
    phone: "+256700000000",
    dateOfBirth: "1990-01-01",
    nin: "TESTNIN12345",
    address: "Example address",
    district: "Kampala",
    country: "Uganda",
    consent: "yes",
  }).forEach(([k, v]) => f.set(k, v));
  return f;
}
beforeEach(() => {
  vi.clearAllMocks();
  state.rpc.mockResolvedValue({ error: null });
});
describe("partner application submission", () => {
  it("sends only the encrypted envelope through one public RPC", async () => {
    expect(
      (
        await submitApplication(
          "raw-invite-token",
          { ok: false, message: "" },
          form(),
        )
      ).ok,
    ).toBe(true);
    expect(state.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = state.rpc.mock.calls[0];
    expect(name).toBe("submit_partner_application");
    expect(args.p_application.email).toBe("partner@example.com");
    expect(args.p_identity.nin_last_four).toBe("2345");
    expect(args.p_identity.nin_ciphertext).toMatch(/^\\x[0-9a-f]+$/);
    expect(JSON.stringify(args)).not.toContain("TESTNIN12345");
    expect(JSON.stringify(args)).not.toContain("raw-invite-token");
    expect(state.audit).toHaveBeenCalledOnce();
  });
  it.each([
    ["23505", "already in progress"],
    ["P0001", "invalid or no longer available"],
    ["42501", "could not be secured"],
  ])(
    "handles database error %s without recording submission",
    async (code, message) => {
      state.rpc.mockResolvedValue({
        error: { code, message: "sensitive database detail" },
      });
      const result = await submitApplication(
        "token",
        { ok: false, message: "" },
        form(),
      );
      expect(result.ok).toBe(false);
      expect(result.message).toContain(message);
      expect(result.message).not.toContain("sensitive");
      expect(state.audit).not.toHaveBeenCalled();
    },
  );
  it("validates consent before invoking the RPC", async () => {
    const f = form();
    f.delete("consent");
    expect(
      (await submitApplication("token", { ok: false, message: "" }, f)).ok,
    ).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
