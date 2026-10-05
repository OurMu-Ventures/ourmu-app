import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const send = vi.hoisted(() => vi.fn());
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    RESEND_API_KEY: "test",
    RESEND_FROM_EMAIL: "test@example.test",
  }),
}));
import { sendTransactionalEmail } from "@/lib/email/send";
import { EmailQuotaError, EmailRateLimitError } from "@/lib/email/quota";
afterEach(() => vi.restoreAllMocks());
describe("provider error classification", () => {
  it.each([
    ["daily_quota_exceeded", "EMAIL_DAILY_QUOTA_EXCEEDED"],
    ["monthly_quota_exceeded", "EMAIL_MONTHLY_QUOTA_EXCEEDED"],
  ])(
    "preserves %s without leaking the provider message",
    async (name, code) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      send.mockResolvedValue({
        error: { name, statusCode: 429, message: "private recipient detail" },
        data: null,
      });
      await expect(
        sendTransactionalEmail({
          to: "partner@example.test",
          template: "magic_link",
        }),
      ).rejects.toMatchObject({ message: code, name: "EmailQuotaError" });
      expect(log).toHaveBeenCalledWith(
        "email.transactional.delivery_failed",
        expect.objectContaining({ code: name, statusCode: 429 }),
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain(
        "private recipient detail",
      );
    },
  );
  it("defers ordinary rate limiting with Retry-After instead of failing it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockResolvedValue({
      error: {
        name: "rate_limit_exceeded",
        statusCode: 429,
        headers: { "retry-after": "120" },
      },
      data: null,
    });
    const error = await sendTransactionalEmail({
      to: "partner@example.test",
      template: "magic_link",
    }).catch((e) => e);
    expect(error).not.toBeInstanceOf(EmailQuotaError);
    expect(error).toBeInstanceOf(EmailRateLimitError);
    expect(error.code).toBe("EMAIL_RATE_LIMITED");
    expect(error.retryAfterSec).toBe(120);
  });
});
