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
import { EmailQuotaError } from "@/lib/email/quota";
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
        error: { name, message: "private recipient detail" },
        data: null,
      });
      await expect(
        sendTransactionalEmail({
          to: "partner@example.test",
          template: "magic_link",
        }),
      ).rejects.toMatchObject({ message: code, name: "EmailQuotaError" });
      expect(JSON.stringify(log.mock.calls)).not.toContain(
        "private recipient detail",
      );
    },
  );
  it("does not classify ordinary rate limiting as quota exhaustion", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockResolvedValue({
      error: { name: "rate_limit_exceeded" },
      data: null,
    });
    const error = await sendTransactionalEmail({
      to: "partner@example.test",
      template: "magic_link",
    }).catch((e) => e);
    expect(error).not.toBeInstanceOf(EmailQuotaError);
    expect(error.message).toBe("EMAIL_DELIVERY_FAILED");
  });
});
