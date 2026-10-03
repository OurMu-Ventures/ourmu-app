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
import { retryJob } from "@/actions/admin";
import { EMAIL_QUOTA_CODES } from "@/lib/email/quota";
const jobId = "11111111-1111-4111-8111-111111111111";
function form() {
  const data = new FormData();
  data.set("jobId", jobId);
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
  it("uses shared quota codes and audits the matched job", async () => {
    mocks.result.mockResolvedValue({
      data: { id: jobId, kind: "send_email" },
      error: null,
    });
    await retryJob(form());
    expect(mocks.filter).toHaveBeenCalledWith(
      `status.in.(failed,dead),and(status.eq.pending,last_error_code.in.(${EMAIL_QUOTA_CODES.join(",")}))`,
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
});
