import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  requireInvestor: vi.fn(),
  requireAdmin: vi.fn(),
}));
vi.mock("@/lib/security/crypto", () => ({
  fingerprintRequestValue: () => "fingerprint",
}));
vi.mock("@/lib/db", () => ({
  requestId: () => "request-1",
  toBytea: () => "\\x01",
  publicError: (_: unknown, fallback: string) => fallback,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { requestInvestment } from "@/actions/investments";
import { requireInvestor } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const rpc = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<
    typeof createAdminClient
  >);
  rpc.mockResolvedValue({ error: null });
});
function form(amount: string) {
  const data = new FormData();
  data.set("cycleId", "a1b2c3d4-e5f6-47a8-9123-abcdef123456");
  data.set("agreementVersionId", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  data.set("principalUgx", amount);
  data.set("agreementAccepted", "yes");
  data.set("investmentLimitUgx", "999999999");
  return data;
}
function profile(limit: number | string | null) {
  vi.mocked(requireInvestor).mockResolvedValue({
    id: "partner-1",
    investment_limit_ugx: limit,
  } as Awaited<ReturnType<typeof requireInvestor>>);
}
describe("authenticated investment limit validation", () => {
  it("ignores a forged client limit", async () => {
    profile(null);
    expect(
      (await requestInvestment({ ok: false, message: "" }, form("60000000")))
        .ok,
    ).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("accepts 60m using the authenticated 100m override", async () => {
    profile("100000000");
    expect(
      (await requestInvestment({ ok: false, message: "" }, form("60000000")))
        .ok,
    ).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "request_investment",
      expect.objectContaining({
        p_investor_id: "partner-1",
        p_principal_ugx: 60_000_000,
      }),
    );
  });
  it("rejects amounts above the authenticated override", async () => {
    profile(100_000_000);
    const result = await requestInvestment(
      { ok: false, message: "" },
      form("100000000.01"),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("100,000,000");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("retains database enforcement if the limit changes after authentication", async () => {
    profile(100_000_000);
    rpc.mockResolvedValue({
      error: { message: "investor cycle limit exceeded" },
    });
    expect(
      (await requestInvestment({ ok: false, message: "" }, form("60000000")))
        .ok,
    ).toBe(false);
  });
});
