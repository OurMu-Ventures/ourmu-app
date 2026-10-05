import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    RESEND_API_KEY: "test",
    RESEND_FROM_EMAIL: "test@example.test",
  }),
}));
import { sendTransactionalEmail } from "@/lib/email/send";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("installed Resend SDK transport", () => {
  it("uses the SDK's real top-level response headers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              name: "rate_limit_exceeded",
              statusCode: 429,
              message: "limited",
            }),
            { status: 429, headers: { "Retry-After": "95" } },
          ),
      ),
    );
    await expect(
      sendTransactionalEmail({ to: "a@example.test", template: "magic_link" }),
    ).rejects.toMatchObject({ retryAfterSec: 95 });
  });
  it("aborts the actual fetch when the provider deadline expires", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    let receivedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, options: RequestInit) => {
        receivedSignal = options.signal ?? undefined;
        return new Promise((_resolve, reject) =>
          receivedSignal?.addEventListener(
            "abort",
            () => reject(receivedSignal?.reason),
            { once: true },
          ),
        );
      }),
    );
    const result = sendTransactionalEmail({
      to: "a@example.test",
      template: "magic_link",
    });
    const rejected = expect(result).rejects.toThrow("EMAIL_PROVIDER_TIMEOUT");
    await vi.advanceTimersByTimeAsync(15_001);
    await rejected;
    expect(receivedSignal?.aborted).toBe(true);
  });
});
