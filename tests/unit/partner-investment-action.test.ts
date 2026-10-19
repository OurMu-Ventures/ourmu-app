import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { revalidatePath } from "next/cache";

const rpc = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<
    typeof createAdminClient
  >);
  rpc.mockResolvedValue({ error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
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

describe("reservation error reporting", () => {
  it.each([
    ["next of kin is required", "next-of-kin details in Profile"],
    ["investor is not eligible", "active and KYC verified"],
    ["cycle capacity exceeded", "insufficient remaining capacity"],
    ["investor cycle limit exceeded", "pending reservations"],
    [
      "the displayed cycle changed; review the refreshed terms and accept again",
      "investment cycle changed",
    ],
    [
      "the agreement changed; review the refreshed terms and accept again",
      "participation agreement changed",
    ],
    [
      "no eligible cycle is available for this timestamp",
      "No investment cycle",
    ],
    ["approved agreement is required", "Contact support"],
  ])("explains structured database error: %s", async (message, expected) => {
    profile(null);
    rpc.mockResolvedValue({
      error: { code: "23514", message, details: "private" },
    });
    const result = await requestInvestment(
      { ok: false, message: "" },
      form("125000"),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain(expected);
    expect(result.message).toContain("No reservation was created.");
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "investment.reservation_failed",
      {
        requestId: "request-1",
        code: "23514",
        recognized: true,
      },
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "private",
    );
  });

  it("keeps unknown errors private and supplies a matching support reference", async () => {
    profile(null);
    rpc.mockResolvedValue({
      error: {
        code: "XX000",
        message: "next of kin is required: secret SQL detail",
        details: "private",
      },
    });
    const result = await requestInvestment(
      { ok: false, message: "" },
      form("125000"),
    );
    expect(result).toEqual({
      ok: false,
      message:
        "The reservation could not be created. Contact support with reference request-1.",
    });
    expect(rpc).toHaveBeenCalledWith(
      "request_investment",
      expect.objectContaining({
        p_request_id: "request-1",
      }),
    );
    expect(console.error).toHaveBeenCalledWith(
      "investment.reservation_failed",
      {
        requestId: "request-1",
        code: "XX000",
        recognized: false,
      },
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "secret",
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
