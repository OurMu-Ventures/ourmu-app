import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: async () => ({ id: "admin-1" }),
}));
vi.mock("@/lib/db", () => ({ audit: vi.fn(), requestId: () => "request-1" }));
const state = vi.hoisted(() => ({
  aal: "aal2",
  rpc: vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ error: null })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({
          data: { currentLevel: state.aal },
        }),
      },
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: state.rpc }),
}));

import { saveMaturityEmailSettings } from "@/actions/admin";

beforeEach(() => {
  state.aal = "aal2";
  state.rpc.mockClear();
});

describe("maturity email admin settings", () => {
  it("passes the verified admin identity and MFA level to the service-role RPC", async () => {
    const form = new FormData();
    form.set(
      "contacts",
      " Team@Example.test; team@example.test\nother@example.test",
    );
    form.set("enabled", "on");
    const result = await saveMaturityEmailSettings(
      { ok: false, message: "" },
      form,
    );
    expect(result.ok).toBe(true);
    expect(state.rpc).toHaveBeenCalledWith("update_maturity_email_settings", {
      p_admin_id: "admin-1",
      p_admin_aal2: true,
      p_contacts: ["team@example.test", "other@example.test"],
      p_enabled: true,
      p_request_id: "request-1",
    });
  });

  it("does not claim MFA if the session assurance level is lower", async () => {
    state.aal = "aal1";
    const form = new FormData();
    form.set("contacts", "team@example.test");
    form.set("enabled", "on");
    await saveMaturityEmailSettings({ ok: false, message: "" }, form);
    expect(state.rpc.mock.calls[0]?.[1]).toMatchObject({ p_admin_aal2: false });
  });
});
