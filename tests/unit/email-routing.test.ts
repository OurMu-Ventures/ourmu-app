import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const send = vi.hoisted(() =>
  vi.fn(async () => ({ data: { id: "synthetic-message" }, error: null })),
);
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    RESEND_API_KEY: "synthetic",
    RESEND_FROM_EMAIL: "test@ourmu.org",
  }),
}));

import { sendTransactionalEmail } from "@/lib/email/send";

beforeEach(() => send.mockClear());

describe("outbound email headers", () => {
  it("passes the snapshotted maturity CC and reply recipients to Resend", async () => {
    await sendTransactionalEmail({
      to: "partner@example.com",
      template: "maturity_choice_confirmed",
      cc: ["one@example.test", "two@example.test", "three@example.test"],
      replyTo: ["one@example.test", "two@example.test", "three@example.test"],
      idempotencyKey: "synthetic-maturity-1",
    });
    const [message, options] = send.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(message.to).toBe("partner@example.com");
    expect(message.cc).toEqual([
      "one@example.test",
      "two@example.test",
      "three@example.test",
    ]);
    expect(message.replyTo).toEqual(message.cc);
    expect(options.idempotencyKey).toBe("synthetic-maturity-1");
  });

  it("keeps the legacy reply address and no CC without a routing snapshot", async () => {
    await sendTransactionalEmail({
      to: "partner@example.com",
      template: "maturity_notice",
    });
    const [message] = send.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(message.replyTo).toBe("community@ourmu.org");
    expect(message.cc).toBeUndefined();
  });
});
