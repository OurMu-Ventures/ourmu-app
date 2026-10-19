import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  send: vi.fn(),
  audit: vi.fn(),
  refresh: vi.fn(),
  requireAdmin: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.from }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: mocks.send }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    NEXT_PUBLIC_APP_URL: "https://example.com",
    RESEND_API_KEY: "test",
  }),
}));
vi.mock("@/lib/security/crypto", () => ({
  newInviteToken: () => ({ token: "test", hash: Buffer.from("test") }),
}));
vi.mock("@/lib/db", () => ({
  audit: mocks.audit,
  requestId: () => "request",
  toBytea: () => "hash",
}));
import {
  createInvitation,
  reissueInvitation,
  revokeInvitation,
} from "@/actions/applications";
function query(result: unknown) {
  const q = {
    select: vi.fn(() => q),
    insert: vi.fn(() => q),
    update: vi.fn(() => q),
    eq: vi.fn(() => q),
    is: vi.fn(() => q),
    single: vi.fn(async () => result),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(result).then(resolve),
  };
  return q;
}
const form = () => {
  const data = new FormData();
  data.set("invitationId", "invitation-1");
  data.set("email", "sample@example.com");
  return data;
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAdmin.mockResolvedValue({ id: "admin-1" });
  mocks.audit.mockResolvedValue(undefined);
  mocks.send.mockResolvedValue(undefined);
});
describe("invitation action feedback", () => {
  it("refreshes the combined page after sending", async () => {
    mocks.from.mockReturnValue(query({ data: { id: "new" }, error: null }));
    expect(
      (await createInvitation({ ok: false, message: "" }, form())).ok,
    ).toBe(true);
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledWith("/admin/applications");
  });
  it("returns revoke feedback and enforces an unused invitation", async () => {
    const q = query({ error: null });
    mocks.from.mockReturnValue(q);
    expect(await revokeInvitation(form())).toEqual({
      ok: true,
      message: "Invitation revoked.",
    });
    expect(q.is).toHaveBeenCalledWith("used_at", null);
    expect(mocks.refresh).toHaveBeenCalledWith("/admin/applications");
  });
  it("returns a safe revocation error", async () => {
    mocks.from.mockReturnValue(query({ error: { message: "private detail" } }));
    expect(await revokeInvitation(form())).toEqual({
      ok: false,
      message: "Invitation revocation failed. Please try again.",
    });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("rejects reissuing a used invitation before sending", async () => {
    mocks.from.mockReturnValue(
      query({ data: { id: "prior", used_at: "2026-10-19" }, error: null }),
    );
    expect((await reissueInvitation(form())).ok).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("reissues unused invitations and refreshes the combined page", async () => {
    mocks.from
      .mockReturnValueOnce(
        query({
          data: {
            id: "prior",
            invited_email: "sample@example.com",
            used_at: null,
          },
        }),
      )
      .mockReturnValueOnce(query({ error: null }))
      .mockReturnValueOnce(query({ data: { id: "replacement" }, error: null }));
    expect((await reissueInvitation(form())).ok).toBe(true);
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledWith("/admin/applications");
  });
  it("reports a delivery failure and revokes the unused replacement", async () => {
    const revoke = query({ error: null });
    mocks.from
      .mockReturnValueOnce(
        query({
          data: {
            id: "prior",
            invited_email: "sample@example.com",
            used_at: null,
          },
        }),
      )
      .mockReturnValueOnce(query({ error: null }))
      .mockReturnValueOnce(query({ data: { id: "replacement" }, error: null }))
      .mockReturnValueOnce(revoke);
    mocks.send.mockRejectedValue(new Error("private provider response"));
    const result = await reissueInvitation(form());
    expect(result.ok).toBe(false);
    expect(result.message).toContain("email delivery failed");
    expect(revoke.eq).toHaveBeenCalledWith("id", "replacement");
    expect(mocks.refresh).toHaveBeenCalledWith("/admin/applications");
  });
});
