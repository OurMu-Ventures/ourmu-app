import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  requireInvestor: vi.fn(),
  requireAdmin: vi.fn(),
}));
vi.mock("@/lib/security/crypto", () => ({ fingerprintRequestValue: vi.fn() }));
vi.mock("@/lib/db", () => ({
  requestId: () => "request-1",
  toBytea: vi.fn(),
  publicError: (_: unknown, fallback: string) => fallback,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { activateInvestment } from "@/actions/investments";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const rpc = vi.fn();
const assurance = vi.fn();
const initial = { ok: false, message: "" };
function form() {
  const data = new FormData();
  data.set("investmentId", "aaea827d-83cf-407a-a3f4-8a7e91af181f");
  data.set("confirmation", "ACTIVATE");
  data.set("bankReference", "TEST-REFERENCE");
  data.set("receivedAmountUgx", "1250000");
  data.set("receivedDate", "2026-10-15");
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
  rpc.mockResolvedValue({ error: null });
});

describe("activation error reporting action", () => {
  it("returns actionable structured database errors without revalidation", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({
      error: {
        code: "23514",
        message:
          "payment timestamp predates the reservation; held for staff resolution",
        details: "private",
      },
    });
    const result = await activateInvestment(initial, form());
    expect(result.ok).toBe(false);
    expect(result.message).toContain("earlier than this reservation");
    expect(result.message).toContain("No records were changed");
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("investment.activation_failed", {
      requestId: "request-1",
      investmentId: "aaea827d-83cf-407a-a3f4-8a7e91af181f",
      code: "23514",
      recognized: true,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
    log.mockRestore();
  });
  it("returns the same support reference used in the RPC and sanitized log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({
      error: { code: "XX000", message: "sensitive internal detail" },
    });
    const result = await activateInvestment(initial, form());
    expect(result.message).toContain("reference request-1");
    expect(result.message).not.toContain("sensitive");
    expect(rpc).toHaveBeenCalledWith(
      "activate_investment",
      expect.objectContaining({
        p_request_id: "request-1",
        p_received_amount_ugx: 1250000,
        p_received_date: "2026-10-15",
      }),
    );
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_received_at");
    expect(log).toHaveBeenCalledWith(
      "investment.activation_failed",
      expect.objectContaining({
        requestId: "request-1",
        code: "XX000",
        recognized: false,
      }),
    );
    log.mockRestore();
  });
  it("leaves the successful activation path intact", async () => {
    await expect(activateInvestment(initial, form())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/activations?activated=aaea827d-83cf-407a-a3f4-8a7e91af181f#activation-success",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/activations");
  });
});
