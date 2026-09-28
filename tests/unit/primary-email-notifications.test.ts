import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  sent: [] as unknown[],
  trackingError: null as null | { message: string },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "jobs") throw new Error(`unexpected table ${table}`);
      return {
        update: () => ({ eq: () => Promise.resolve({ error: state.trackingError }) }),
      };
    },
  }),
}));

vi.mock("@/lib/email/send", () => ({
  sendTransactionalEmail: async (input: unknown) => {
    state.sent.push(input);
    return "message-1";
  },
}));

vi.mock("@/lib/env", () => ({
  getPublicEnv: () => ({ NEXT_PUBLIC_APP_URL: "https://example.com" }),
}));

import { deliverJobEmail, type JobRow } from "@/lib/jobs";

function noticeJob(overrides: Record<string, unknown> = {}): JobRow {
  return {
    id: "job-1",
    kind: "send_email",
    status: "pending",
    entity_type: "profile",
    entity_id: "user-1",
    payload: {
      template: "primary_email_changed",
      to: "old@example.test",
      detail: "Your primary email was changed.",
      idempotencyKey: "primary-email-change-req-old",
    },
    attempts: 1,
    max_attempts: 8,
    created_at: new Date().toISOString(),
    ...overrides,
  } as JobRow;
}

beforeEach(() => {
  state.sent = [];
  state.trackingError = null;
});

describe("primary email change notifications", () => {
  it("delivers the queued notice body recorded by the finalizer", async () => {
    const messageId = await deliverJobEmail(noticeJob());
    expect(messageId).toBe("message-1");
    const sent = state.sent[0] as Record<string, unknown>;
    expect(sent.to).toBe("old@example.test");
    expect(sent.template).toBe("primary_email_changed");
    expect(sent.detail).toBe("Your primary email was changed.");
    expect(sent.cc).toBeUndefined();
  });

  it("records the send attempt before calling the provider", async () => {
    state.trackingError = { message: "db down" };
    await expect(deliverJobEmail(noticeJob())).rejects.toThrow("SEND_TRACKING_FAILED");
    expect(state.sent).toHaveLength(0);
  });
});
