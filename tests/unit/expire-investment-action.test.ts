import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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

import { expireInvestment } from "@/actions/investments";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const rpc = vi.fn();
const assurance = vi.fn();
const initial = { ok: false, message: "" };
function form(confirmation = "EXPIRE") {
  const data = new FormData();
  data.set("investmentId", "investment-1");
  data.set("confirmation", confirmation);
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
describe("expireInvestment action", () => {
  it("rejects incorrect confirmation before accessing the database", async () => {
    expect(await expireInvestment(initial, form("expire"))).toEqual({
      ok: false,
      message: "Type EXPIRE exactly to expire this reservation.",
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("propagates the authentication/MFA redirect without calling the RPC", async () => {
    const redirect = new Error("NEXT_REDIRECT:/admin/mfa");
    vi.mocked(requireAdmin).mockRejectedValueOnce(redirect);
    await expect(expireInvestment(initial, form())).rejects.toBe(redirect);
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("maps database errors without refreshing successful state", async () => {
    rpc.mockResolvedValue({ error: { message: "internal database detail" } });
    expect(await expireInvestment(initial, form())).toEqual({
      ok: false,
      message: "The reservation could not be expired.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("passes verified MFA and refreshes all six affected paths on success", async () => {
    expect(await expireInvestment(initial, form())).toEqual({
      ok: true,
      message: "Reservation expired.",
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("expire_investment", {
      p_admin_id: "admin-1",
      p_investment_id: "investment-1",
      p_confirmation: "EXPIRE",
      p_admin_aal2: true,
      p_request_id: "request-1",
    });
    expect(vi.mocked(revalidatePath).mock.calls.map(([path]) => path)).toEqual([
      "/admin/activations",
      "/admin/investments",
      "/admin",
      "/investments",
      "/investments/investment-1",
      "/dashboard",
    ]);
  });
  it("passes false when the second MFA check no longer reports AAL2", async () => {
    assurance.mockResolvedValue({ data: { currentLevel: "aal1" } });
    rpc.mockResolvedValue({
      error: { message: "active administrator AAL2 required" },
    });
    expect((await expireInvestment(initial, form())).ok).toBe(false);
    expect(rpc).toHaveBeenCalledWith(
      "expire_investment",
      expect.objectContaining({ p_admin_aal2: false }),
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
