import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  result: vi.fn(),
  filter: vi.fn(),
  audit: vi.fn(),
  from: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ id: "admin" }) }));
vi.mock("@/lib/db", () => ({ audit: mocks.audit, requestId: () => "request" }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.from }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: vi.fn() }));
import { reconcileJobDelivery, retryJob } from "@/actions/admin";
import { EMAIL_DEFERRAL_CODES } from "@/lib/email/quota";
const jobId = "11111111-1111-4111-8111-111111111111";
function form(fields: Record<string, string> = {}) {
  const data = new FormData();
  data.set("jobId", jobId);
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  const builder = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    or: mocks.filter.mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    maybeSingle: mocks.result,
  };
  mocks.from.mockReturnValue(builder);
});
describe("admin job retry", () => {
  it("uses the shared deferral codes and audits the matched job", async () => {
    mocks.result.mockResolvedValue({
      data: { id: jobId, kind: "send_email", status: "pending" },
      error: null,
    });
    await retryJob(form());
    expect(mocks.filter).toHaveBeenCalledWith(
      `status.in.(failed,dead),and(status.eq.pending,last_error_code.in.(${EMAIL_DEFERRAL_CODES.join(",")}))`,
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "job.retried", entityId: jobId }),
    );
  });
  it("rejects a no-op without auditing success or changing receipts", async () => {
    mocks.result.mockResolvedValue({ data: null, error: null });
    await expect(retryJob(form())).rejects.toThrow("no longer eligible");
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
  it("rejects a stale confirmation the database retired instead of re-queuing", async () => {
    mocks.result.mockResolvedValue({
      data: { id: jobId, kind: "send_email", status: "dead" },
      error: null,
    });
    await expect(retryJob(form())).rejects.toThrow("no longer eligible");
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
describe("admin delivery reconciliation", () => {
  const awaiting = {
    id: jobId,
    status: "dead",
    last_error_code: "NEEDS_RECONCILIATION",
  };
  it("audits an authorized resend once the job is queued again", async () => {
    mocks.result
      .mockResolvedValueOnce({ data: awaiting, error: null })
      .mockResolvedValueOnce({ data: { status: "pending" }, error: null });
    await reconcileJobDelivery(form({ outcome: "authorize_resend" }));
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "job.delivery_reconciled",
        metadata: { outcome: "authorize_resend", notes: null },
      }),
    );
  });
  it("rejects a resend the database refuses for a stale confirmation", async () => {
    mocks.result
      .mockResolvedValueOnce({ data: awaiting, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    await expect(
      reconcileJobDelivery(form({ outcome: "authorize_resend" })),
    ).rejects.toThrow("no longer eligible");
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
