import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderTransactionalEmail } from "@/lib/email/template";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

type Call = { table: string; method: string; args: unknown[] };
type Terminal = { data: unknown; error: unknown };

const state = vi.hoisted(() => ({
  profile: { id: "user-1", role: "investor" } as { id: string; role: string },
  iat: Math.floor(Date.now() / 1000),
  calls: [] as Call[],
  terminals: {} as Record<string, Terminal[]>,
  send: vi.fn(async (...args: unknown[]) => {
    void args;
    return "message-1";
  }),
  audit: vi.fn(async (...args: unknown[]) => {
    void args;
    return undefined;
  }),
  updateUser: vi.fn(
    async (...args: unknown[]): Promise<{ data: unknown; error: { message: string } | null }> => {
      void args;
      return {
        data: { user: { id: "user-1" } },
        error: null,
      };
    },
  ),
}));

function script(table: string, method: string, data: unknown, error: unknown = null) {
  const key = `${table}:${method}`;
  state.terminals[key] = [...(state.terminals[key] ?? []), { data, error }];
}

function take(table: string, method: string) {
  const key = `${table}:${method}`;
  const next = state.terminals[key]?.shift();
  if (!next) throw new Error(`unscripted terminal ${key}`);
  return next;
}

// Mirrors the supabase-js builder closely enough for these actions: every
// chain step records its call, `maybeSingle`/`single` resolve scripted rows,
// and awaiting any other chain (list/select/update/delete) resolves a
// scripted `list` result for that table.
function chain(table: string): Record<string, unknown> {
  const next =
    (method: string) =>
    (...args: unknown[]) => {
      state.calls.push({ table, method, args });
      if (method === "maybeSingle" || method === "single") {
        return Promise.resolve(take(table, method));
      }
      return chain(table);
    };
  return {
    select: next("select"),
    eq: next("eq"),
    neq: next("neq"),
    is: next("is"),
    lte: next("lte"),
    order: next("order"),
    limit: next("limit"),
    insert: next("insert"),
    update: next("update"),
    delete: next("delete"),
    maybeSingle: () => next("maybeSingle")(),
    single: () => next("single")(),
    then: (resolve: (value: Terminal) => unknown) => resolve(take(table, "list")),
  };
}

vi.mock("@/lib/auth", () => ({
  requireInvestor: async () => state.profile,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { iat: state.iat } } }),
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => chain(table),
    auth: { admin: { updateUserById: (...args: unknown[]) => state.updateUser(...args) } },
  }),
}));
vi.mock("@/lib/email/send", () => ({
  sendTransactionalEmail: (...args: unknown[]) => state.send(...args),
}));
vi.mock("@/lib/env", () => ({
  getPublicEnv: () => ({ NEXT_PUBLIC_APP_URL: "https://example.com" }),
}));
vi.mock("@/lib/db", () => ({
  audit: (...args: unknown[]) => state.audit(...args),
  requestId: () => "request-1",
  toBytea: (value: Buffer) => `\\x${value.toString("hex")}`,
}));
vi.mock("@/lib/security/crypto", () => ({
  newAccountEmailToken: () => ({ token: "raw-token", hash: Buffer.from("hash") }),
  fingerprintRequestValue: () => Buffer.from("hash"),
}));

import {
  confirmPrimaryEmailChange,
  promoteAdditionalEmail,
  requestPrimaryEmailChange,
} from "@/actions/profile";

const PRIMARY = { id: "11111111-1111-4111-8111-111111111111", email: "old@example.test", is_primary: true };
const ALIAS_VERIFIED = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "alias@example.test",
  is_primary: false,
  verified_at: "2026-01-01T00:00:00Z",
};
const ALIAS_PENDING = {
  id: "33333333-3333-4333-8333-333333333333",
  email: "pending@example.test",
  is_primary: false,
  verified_at: null,
};

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

function callsTo(table: string, method: string) {
  return state.calls.filter((call) => call.table === table && call.method === method);
}

beforeEach(() => {
  state.profile = { id: "user-1", role: "investor" };
  state.iat = Math.floor(Date.now() / 1000);
  state.calls = [];
  state.terminals = {};
  state.send.mockClear();
  state.audit.mockClear();
  state.updateUser.mockClear();
  state.updateUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
});

describe("requestPrimaryEmailChange", () => {
  it("sends a mailbox confirmation link and audits the request", async () => {
    script("account_emails", "list", [PRIMARY]);
    script("account_emails", "maybeSingle", null); // no other account holds it
    script("profiles", "maybeSingle", null);
    script("primary_email_change_requests", "maybeSingle", null); // no live request
    script("primary_email_change_requests", "single", { id: "req-1" });
    const result = await requestPrimaryEmailChange(
      { ok: false, message: "" },
      form({ email: "New@Example.test" }),
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Nothing changes until you open it and confirm");
    const firstSend = state.send.mock.calls[0];
    expect(firstSend).toBeDefined();
    const sent = (firstSend?.[0] ?? {}) as Record<string, unknown>;
    expect(sent.to).toBe("new@example.test");
    expect(sent.template).toBe("primary_email_change_verification");
    expect(String(sent.actionUrl)).toContain("/profile/emails/confirm?token=raw-token");
    expect(state.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "account_email.primary_change_requested", entityId: "req-1" }),
    );
  });

  it("succeeds without growing the alias list when two aliases exist", async () => {
    script("account_emails", "list", [PRIMARY, ALIAS_VERIFIED, ALIAS_PENDING]);
    script("account_emails", "maybeSingle", null);
    script("profiles", "maybeSingle", null);
    script("primary_email_change_requests", "maybeSingle", null);
    script("primary_email_change_requests", "single", { id: "req-2" });
    const result = await requestPrimaryEmailChange(
      { ok: false, message: "" },
      form({ email: "extra@example.test" }),
    );
    expect(result.ok).toBe(true);
  });

  it("clears an expired pending request before accepting a different address", async () => {
    script("account_emails", "list", [PRIMARY]);
    script("account_emails", "maybeSingle", null);
    script("profiles", "maybeSingle", null);
    script("primary_email_change_requests", "maybeSingle", {
      id: "expired-req",
      new_email: "expired@example.test",
      mode: "new_address",
      confirmed_at: null,
      finalized_at: null,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    script("primary_email_change_requests", "list", { data: null, error: null });
    script("primary_email_change_requests", "single", { id: "req-2" });

    const result = await requestPrimaryEmailChange(
      { ok: false, message: "" },
      form({ email: "replacement@example.test" }),
    );

    expect(result.ok).toBe(true);
    expect(callsTo("primary_email_change_requests", "delete")).toHaveLength(1);
    expect(callsTo("primary_email_change_requests", "lte")).toContainEqual(
      expect.objectContaining({ args: ["expires_at", expect.any(String)] }),
    );
    expect(state.send).toHaveBeenCalledOnce();
  });

  it("rejects stale sessions and administrator accounts", async () => {
    state.iat = Math.floor(Date.now() / 1000) - 601;
    const stale = await requestPrimaryEmailChange({ ok: false, message: "" }, form({ email: "a@example.test" }));
    expect(stale.ok).toBe(false);
    expect(stale.message).toContain("fresh sign-in");
    expect(state.calls).toHaveLength(0);

    state.iat = Math.floor(Date.now() / 1000);
    state.profile = { id: "admin-1", role: "admin" };
    const admin = await requestPrimaryEmailChange({ ok: false, message: "" }, form({ email: "a@example.test" }));
    expect(admin.ok).toBe(false);
    expect(admin.message).toContain("partner accounts");
  });

  it("rejects invalid addresses, the current primary, and own aliases", async () => {
    const invalid = await requestPrimaryEmailChange({ ok: false, message: "" }, form({ email: "not-an-email" }));
    expect(invalid.ok).toBe(false);

    script("account_emails", "list", [PRIMARY, ALIAS_VERIFIED]);
    const ownPrimary = await requestPrimaryEmailChange(
      { ok: false, message: "" },
      form({ email: "old@example.test" }),
    );
    expect(ownPrimary.message).toContain("already your primary email");

    script("account_emails", "list", [PRIMARY, ALIAS_VERIFIED]);
    const ownAlias = await requestPrimaryEmailChange(
      { ok: false, message: "" },
      form({ email: "alias@example.test" }),
    );
    expect(ownAlias.message).toContain("Make primary");
    expect(state.send).not.toHaveBeenCalled();
  });

  it("rejects addresses linked to another account", async () => {
    script("account_emails", "list", [PRIMARY]);
    script("account_emails", "maybeSingle", { id: "other-1" });
    script("profiles", "maybeSingle", null);
    const conflict = await requestPrimaryEmailChange(
      { ok: false, message: "" },
      form({ email: "taken@example.test" }),
    );
    expect(conflict.ok).toBe(false);
    expect(conflict.message).toContain("already linked to another account");
    expect(state.send).not.toHaveBeenCalled();
  });

  it("rotates the token when the same unverified address is requested again", async () => {
    script("account_emails", "list", [PRIMARY]);
    script("account_emails", "maybeSingle", null);
    script("profiles", "maybeSingle", null);
    script("primary_email_change_requests", "maybeSingle", {
      id: "req-1",
      new_email: "same@example.test",
      mode: "new_address",
      confirmed_at: null,
      finalized_at: null,
    });
    script("primary_email_change_requests", "list", { data: null, error: null });
    const result = await requestPrimaryEmailChange(
      { ok: false, message: "" },
      form({ email: "same@example.test" }),
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain("new confirmation link");
    expect(callsTo("primary_email_change_requests", "update")).toHaveLength(1);
    expect(state.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "account_email.primary_change_resent" }),
    );
  });

  it("refuses a different address while one is pending, and points at verified links", async () => {
    script("account_emails", "list", [PRIMARY]);
    script("account_emails", "maybeSingle", null);
    script("profiles", "maybeSingle", null);
    script("primary_email_change_requests", "maybeSingle", {
      id: "req-1",
      new_email: "first@example.test",
      confirmed_at: null,
      finalized_at: null,
    });
    const pending = await requestPrimaryEmailChange(
      { ok: false, message: "" },
      form({ email: "second@example.test" }),
    );
    expect(pending.ok).toBe(false);
    expect(pending.message).toContain("first@example.test");
    expect(pending.message).toContain("already pending");

    state.terminals = {};
    script("account_emails", "list", [PRIMARY]);
    script("account_emails", "maybeSingle", null);
    script("profiles", "maybeSingle", null);
    script("primary_email_change_requests", "maybeSingle", {
      id: "req-1",
      new_email: "first@example.test",
      confirmed_at: "2026-09-28T00:00:00Z",
      finalized_at: null,
    });
    const verified = await requestPrimaryEmailChange(
      { ok: false, message: "" },
      form({ email: "first@example.test" }),
    );
    expect(verified.message).toContain("already verified");
    expect(state.send).not.toHaveBeenCalled();
  });

  it("cleans up the request when the verification email cannot be sent", async () => {
    script("account_emails", "list", [PRIMARY]);
    script("account_emails", "maybeSingle", null);
    script("profiles", "maybeSingle", null);
    script("primary_email_change_requests", "maybeSingle", null);
    script("primary_email_change_requests", "single", { id: "req-9" });
    script("primary_email_change_requests", "list", { data: null, error: null });
    state.send.mockRejectedValueOnce(new Error("provider down"));
    const result = await requestPrimaryEmailChange(
      { ok: false, message: "" },
      form({ email: "unsent@example.test" }),
    );
    expect(result.ok).toBe(false);
    expect(callsTo("primary_email_change_requests", "delete")).toHaveLength(1);
    expect(state.audit).not.toHaveBeenCalled();
  });
});

describe("promoteAdditionalEmail", () => {
  it("promotes a verified alias through the admin email API and verifies finalization", async () => {
    script("account_emails", "maybeSingle", ALIAS_VERIFIED);
    script("primary_email_change_requests", "maybeSingle", null);
    script("primary_email_change_requests", "single", { id: "req-2" });
    script("primary_email_change_requests", "maybeSingle", { finalized_at: "2026-09-28T00:00:00Z" });
    script("profiles", "maybeSingle", { email: "alias@example.test" });
    const result = await promoteAdditionalEmail(
      { ok: false, message: "" },
      form({ emailId: "22222222-2222-4222-8222-222222222222" }),
    );
    expect(result.ok).toBe(true);
    expect(state.updateUser).toHaveBeenCalledWith("user-1", {
      email: "alias@example.test",
      email_confirm: true,
    });
    expect(state.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "account_email.primary_change_confirmed" }),
    );
  });

  it("only promotes verified additional emails owned by the caller", async () => {
    script("account_emails", "maybeSingle", ALIAS_PENDING);
    const pending = await promoteAdditionalEmail(
      { ok: false, message: "" },
      form({ emailId: "33333333-3333-4333-8333-333333333333" }),
    );
    expect(pending.ok).toBe(false);
    expect(pending.message).toContain("Only verified additional emails");
    expect(state.updateUser).not.toHaveBeenCalled();

    state.terminals = {};
    script("account_emails", "maybeSingle", null);
    const missing = await promoteAdditionalEmail(
      { ok: false, message: "" },
      form({ emailId: "00000000-0000-4000-8000-000000000000" }),
    );
    expect(missing.ok).toBe(false);
  });

  it("blocks promotion while another change is pending", async () => {
    script("account_emails", "maybeSingle", ALIAS_VERIFIED);
    script("primary_email_change_requests", "maybeSingle", { id: "req-1", new_email: "other@example.test" });
    const result = await promoteAdditionalEmail(
      { ok: false, message: "" },
      form({ emailId: "22222222-2222-4222-8222-222222222222" }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("already pending");
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it("leaves the existing primary usable when the Auth update fails", async () => {
    script("account_emails", "maybeSingle", ALIAS_VERIFIED);
    script("primary_email_change_requests", "maybeSingle", null);
    script("primary_email_change_requests", "single", { id: "req-3" });
    script("primary_email_change_requests", "list", { data: null, error: null });
    state.updateUser.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const result = await promoteAdditionalEmail(
      { ok: false, message: "" },
      form({ emailId: "22222222-2222-4222-8222-222222222222" }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("existing primary still works");
    expect(callsTo("primary_email_change_requests", "delete")).toHaveLength(1);
  });

  it("maps provider conflicts to the linked-account message", async () => {
    script("account_emails", "maybeSingle", ALIAS_VERIFIED);
    script("primary_email_change_requests", "maybeSingle", null);
    script("primary_email_change_requests", "single", { id: "req-4" });
    script("primary_email_change_requests", "list", { data: null, error: null });
    state.updateUser.mockResolvedValueOnce({ data: null, error: { message: "email address already exists" } });
    const result = await promoteAdditionalEmail(
      { ok: false, message: "" },
      form({ emailId: "22222222-2222-4222-8222-222222222222" }),
    );
    expect(result.message).toContain("already linked to another account");
  });
});

describe("confirmPrimaryEmailChange", () => {
  const liveRequest = {
    id: "req-5",
    user_id: "user-1",
    new_email: "fresh@example.test",
    mode: "new_address",
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    confirmed_at: null,
    finalized_at: null,
  };

  it("confirms the mailbox, finalizes through Auth, and reports success", async () => {
    script("primary_email_change_requests", "maybeSingle", { ...liveRequest });
    script("primary_email_change_requests", "list", { data: null, error: null });
    script("account_emails", "maybeSingle", null);
    script("profiles", "maybeSingle", null);
    script("primary_email_change_requests", "maybeSingle", { finalized_at: "2026-09-28T00:00:00Z" });
    script("profiles", "maybeSingle", { email: "fresh@example.test" });
    const result = await confirmPrimaryEmailChange(
      { ok: false, message: "" },
      form({ token: "raw-token" }),
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain("fresh@example.test");
    expect(state.updateUser).toHaveBeenCalledWith("user-1", {
      email: "fresh@example.test",
      email_confirm: true,
    });
  });

  it("rejects expired, completed, foreign, and unknown links", async () => {
    script("primary_email_change_requests", "maybeSingle", {
      ...liveRequest,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    const expired = await confirmPrimaryEmailChange({ ok: false, message: "" }, form({ token: "raw-token" }));
    expect(expired.message).toContain("expired");

    state.terminals = {};
    script("primary_email_change_requests", "maybeSingle", { ...liveRequest, finalized_at: "2026-09-28T00:00:00Z" });
    const reused = await confirmPrimaryEmailChange({ ok: false, message: "" }, form({ token: "raw-token" }));
    expect(reused.message).toContain("already complete");

    state.terminals = {};
    script("primary_email_change_requests", "maybeSingle", { ...liveRequest, user_id: "user-9" });
    const foreign = await confirmPrimaryEmailChange({ ok: false, message: "" }, form({ token: "raw-token" }));
    expect(foreign.message).toContain("different account");
    expect(state.updateUser).not.toHaveBeenCalled();

    state.terminals = {};
    script("primary_email_change_requests", "maybeSingle", null);
    const unknown = await confirmPrimaryEmailChange({ ok: false, message: "" }, form({ token: "raw-token" }));
    expect(unknown.message).toContain("invalid or has already been used");
  });

  it("re-checks address conflicts at confirmation time", async () => {
    script("primary_email_change_requests", "maybeSingle", { ...liveRequest });
    script("primary_email_change_requests", "list", { data: null, error: null });
    script("account_emails", "maybeSingle", { id: "other-1", user_id: "user-2" });
    script("profiles", "maybeSingle", null);
    const result = await confirmPrimaryEmailChange(
      { ok: false, message: "" },
      form({ token: "raw-token" }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("already linked to another account");
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it("keeps the existing primary usable when the Auth update fails", async () => {
    script("primary_email_change_requests", "maybeSingle", { ...liveRequest });
    script("primary_email_change_requests", "list", { data: null, error: null });
    script("account_emails", "maybeSingle", null);
    script("profiles", "maybeSingle", null);
    state.updateUser.mockResolvedValueOnce({ data: null, error: { message: "timeout" } });
    const result = await confirmPrimaryEmailChange(
      { ok: false, message: "" },
      form({ token: "raw-token" }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("existing primary email still works");
  });

  it("requires a fresh session at confirmation time", async () => {
    state.iat = Math.floor(Date.now() / 1000) - 601;
    const result = await confirmPrimaryEmailChange(
      { ok: false, message: "" },
      form({ token: "raw-token" }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("fresh sign-in");
    expect(state.updateUser).not.toHaveBeenCalled();
  });
});

describe("primary email template rendering", () => {
  it("renders verification and change notices with the shared layout", () => {
    const verification = renderTransactionalEmail({
      template: "primary_email_change_verification",
      actionUrl: "https://example.com/profile/emails/confirm?token=abc",
      detail: "Confirm it.",
    });
    expect(verification.subject).toContain("primary email");
    expect(verification.html).toContain("Confirm it.");
    expect(verification.html).toContain("Continue securely");
    const changed = renderTransactionalEmail({
      template: "primary_email_changed",
      detail: "It changed.",
    });
    expect(changed.subject).toContain("changed");
    expect(changed.html).toContain("It changed.");
  });
});
