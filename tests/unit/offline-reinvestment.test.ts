import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  aal: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { mfa: { getAuthenticatorAssuranceLevel: mocks.aal } },
  }),
}));
import {
  recordOfflineReinvestment,
  completeOfflineReinvestment,
  revokeOfflineReinvestment,
} from "@/actions/offline-reinvestment";
import { canChooseMaturity } from "@/lib/investments";
const initial = { ok: false, message: "" };
function evidence() {
  const form = new FormData();
  Object.entries({
    investmentId: "10000000-0000-4000-8000-000000000001",
    cycleId: "10000000-0000-4000-8000-000000000002",
    agreementHash: "a".repeat(64),
    amount: "169000.00",
    targetMaturityDate: "2027-03-31",
    targetReturnBps: "3000",
    authorizedOn: "2026-10-20",
    method: "signed_document",
    evidenceReference: "Offline file AUTH-123",
    verificationNotes: "Identity and external payment records checked",
    identityVerified: "yes",
    settlementChecked: "yes",
    agreementAccepted: "yes",
    adminId: "untrusted-admin",
  }).forEach(([key, value]) => form.set(key, value));
  return form;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.admin.mockResolvedValue({ id: "authenticated-admin" });
  mocks.aal.mockResolvedValue({ data: { currentLevel: "aal2" }, error: null });
  mocks.rpc.mockResolvedValue({
    data: "10000000-0000-4000-8000-000000000003",
    error: null,
  });
});
describe("offline authorizations", () => {
  it("keeps settled offline sources out of new maturity choices after a later account claim", () => {
    expect(
      canChooseMaturity({
        status: "matured",
        record_origin: "legacy_import",
        payout_basis: "projected",
        offline_settlement_id: "recorded-authority",
      }),
    ).toBe(false);
  });
  it("records actual offline provenance with the authenticated administrator and no invented browser or account evidence", async () => {
    expect((await recordOfflineReinvestment(initial, evidence())).ok).toBe(
      true,
    );
    const [name, params] = mocks.rpc.mock.calls[0];
    expect(name).toBe("record_offline_reinvestment");
    expect(params).toMatchObject({
      p_admin_id: "authenticated-admin",
      p_admin_aal2: true,
      p_amount: 169000,
      p_authorized_on: "2026-10-20",
      p_evidence_reference: "Offline file AUTH-123",
    });
    expect(params).not.toHaveProperty("p_ip_fingerprint");
    expect(params).not.toHaveProperty("p_email");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([
    "identityVerified",
    "settlementChecked",
    "agreementAccepted",
    "evidenceReference",
  ])("rejects missing %s before any mutation", async (field) => {
    const form = evidence();
    form.delete(field);
    expect((await recordOfflineReinvestment(initial, form)).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("fails closed when MFA verification returns an error", async () => {
    mocks.aal.mockResolvedValue({
      data: { currentLevel: "aal2" },
      error: new Error("auth failure"),
    });
    expect((await recordOfflineReinvestment(initial, evidence())).ok).toBe(
      false,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not claim completion or refresh records after a database refusal", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "23514", message: "Destination cycle capacity exceeded" },
    });
    const form = new FormData();
    form.set("authorizationId", "10000000-0000-4000-8000-000000000003");
    form.set("confirmation", "REINVEST");
    expect((await completeOfflineReinvestment(initial, form)).ok).toBe(false);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("requires typed confirmation before settlement", async () => {
    const form = new FormData();
    form.set("authorizationId", "10000000-0000-4000-8000-000000000003");
    expect((await completeOfflineReinvestment(initial, form)).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("records a revocation reason under the authenticated administrator", async () => {
    const form = new FormData();
    form.set("authorizationId", "10000000-0000-4000-8000-000000000003");
    form.set("reason", "Partner withdrew the instruction");
    expect((await revokeOfflineReinvestment(initial, form)).ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "revoke_offline_reinvestment",
      expect.objectContaining({
        p_admin_id: "authenticated-admin",
        p_reason: "Partner withdrew the instruction",
      }),
    );
  });
});
