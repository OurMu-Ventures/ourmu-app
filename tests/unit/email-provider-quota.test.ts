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
  it.each([new Headers({ "Retry-After": "75" }), { "retry-after": "75" }])("reads response headers in both SDK forms", async (headers) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockResolvedValue({ data: null, error: { name: "rate_limit_exceeded", statusCode: 429 }, headers });
    await expect(sendTransactionalEmail({ to: "a@example.test", template: "magic_link" }))
      .rejects.toMatchObject({ retryAfterSec: 75 });
  });
  it("passes cancellation through the installed SDK request options", async () => {
    send.mockResolvedValue({ data: { id: "accepted" }, error: null, headers: {} });
    const controller = new AbortController();
    await sendTransactionalEmail({ to: "a@example.test", template: "magic_link", signal: controller.signal });
    expect(send.mock.lastCall?.[1].signal).toBeInstanceOf(AbortSignal);
  });
  it("keeps a 503 ambiguous rather than restoring send tracking", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockResolvedValue({ data: null, error: { name: "application_error", statusCode: 503 }, headers: {} });
    await expect(sendTransactionalEmail({ to: "a@example.test", template: "magic_link" }))
      .rejects.toThrow("EMAIL_DELIVERY_FAILED:application_error");
  });
  it("defers ordinary rate limiting with Retry-After instead of failing it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockResolvedValue({
      error: {
        name: "rate_limit_exceeded",
        statusCode: 429,

      },
      data: null,
      headers: { "retry-after": "120" },
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
