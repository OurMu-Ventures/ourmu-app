import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Op = { m: string; args: unknown[] };

const state = vi.hoisted(() => ({
  send: vi.fn(async () => "resend-1"),
  calls: [] as Array<{ table: string; ops: Op[] }>,
  updates: [] as unknown[],
  upserts: [] as unknown[],
  recipientSingle: { id: "e1" } as unknown,
  recipientList: [{ id: "e1", email: "a@example.com" }] as unknown,
  investorId: "u1",
  receipt: null as null | Record<string, unknown>,
  receiptError: null as null | { message: string },
  trackingError: null as null | { message: string },
  downloadFile: null as null | { arrayBuffer: () => Promise<ArrayBuffer> },
}));

function handle(table: string, ops: Op[]): { data: unknown; error: unknown } {
  state.calls.push({ table, ops });
  const terminal = ops[ops.length - 1]?.m;
  if (table === "account_emails") {
    if (terminal === "maybeSingle")
      return { data: state.recipientSingle, error: null };
    return { data: state.recipientList, error: null };
  }
  if (table === "investment_receipts") {
    if (state.receiptError) return { data: null, error: state.receiptError };
    if (terminal === "maybeSingle") return { data: state.receipt, error: null };
    return { data: state.receipt ? [state.receipt] : [], error: null };
  }
  if (table === "investments")
    return { data: { investor_id: state.investorId }, error: null };
  if (table === "jobs") {
    if (ops.some((op) => op.m === "update")) {
      state.updates.push(ops.find((op) => op.m === "update")?.args[0]);
      return { data: null, error: state.trackingError };
    }
    return { data: null, error: null };
  }
  return { data: null, error: null };
}

function builder(table: string, ops: Op[] = []): Record<string, unknown> {
  const next =
    (m: string) =>
    (...args: unknown[]) =>
      builder(table, [...ops, { m, args }]);
  return {
    select: next("select"),
    eq: next("eq"),
    not: next("not"),
    in: next("in"),
    lte: next("lte"),
    order: next("order"),
    limit: next("limit"),
    update: next("update"),
    insert: next("insert"),
    upsert: (...args: unknown[]) => {
      state.upserts.push(args[0]);
      return { data: null, error: null };
    },
    maybeSingle: () => handle(table, [...ops, { m: "maybeSingle", args: [] }]),
    single: () => handle(table, [...ops, { m: "single", args: [] }]),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve(handle(table, ops)).then(resolve),
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => builder(table),
    storage: {
      from: () => ({
        download: async () =>
          state.downloadFile
            ? { data: state.downloadFile, error: null }
            : { data: null, error: { message: "not found" } },
        upload: async () => ({ error: null }),
      }),
    },
  }),
}));

vi.mock("@/lib/email/send", () => ({
  sendTransactionalEmail: (...args: unknown[]) =>
    (state.send as (...a: unknown[]) => Promise<string>)(...args),
}));

vi.mock("@/lib/env", () => ({
  getPublicEnv: () => ({ NEXT_PUBLIC_APP_URL: "https://example.com" }),
}));

import {
  deliverJobEmail,
  fanOutInvestmentEmails,
  type JobRow,
} from "@/lib/jobs";

function sendEmailJob(
  payload: Record<string, unknown>,
  overrides: Partial<JobRow> = {},
): JobRow {
  return {
    id: "job-1",
    kind: "send_email",
    status: "running",
    entity_type: "investment",
    entity_id: "inv-1",
    payload,
    attempts: 1,
    max_attempts: 8,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  state.calls = [];
  state.updates = [];
  state.upserts = [];
  state.send.mockClear();
  state.recipientSingle = { id: "e1" };
  state.recipientList = [{ id: "e1", email: "a@example.com" }];
  state.receipt = null;
  state.receiptError = null;
  state.trackingError = null;
  state.downloadFile = null;
});

describe("send-attempt tracking gate", () => {
  it("blocks the provider send when tracking fails", async () => {
    state.trackingError = { message: "db down" };
    const job = sendEmailJob({
      template: "agreement_ready",
      to: "a@example.com",
    });
    await expect(deliverJobEmail(job)).rejects.toThrow(
      "SEND_TRACKING_FAILED",
    );
    expect(state.send).not.toHaveBeenCalled();
  });

  it("records the first send attempt before delivering", async () => {
    const job = sendEmailJob({
      template: "agreement_ready",
      to: "a@example.com",
    });
    await expect(deliverJobEmail(job)).resolves.toBe("resend-1");
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.updates).toHaveLength(1);
    const update = state.updates[0] as Record<string, unknown>;
    expect(update.send_attempts).toBe(1);
    expect(typeof update.first_send_attempt_at).toBe("string");
  });
});

describe("receipt fan-out guard", () => {
  const parent = () =>
    sendEmailJob({
      template: "investment_activated",
      receiptId: "rcpt-missing",
    });

  it("rejects a missing receipt instead of queueing legacy children", async () => {
    state.receipt = null;
    await expect(fanOutInvestmentEmails(parent())).rejects.toThrow(
      "RECEIPT_NOT_FOUND",
    );
    expect(state.upserts).toHaveLength(0);
  });

  it("preserves the receipt id on child deliveries", async () => {
    state.receipt = { id: "rcpt-1" };
    await fanOutInvestmentEmails(parent());
    expect(state.upserts).toHaveLength(1);
    const rows = state.upserts[0] as Array<{
      payload: Record<string, unknown>;
      email_dedupe_key: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.receiptId).toBe("rcpt-1");
    expect(rows[0].email_dedupe_key).toBe("receipt:rcpt-1:e1");
    expect(rows[0].payload.idempotencyKey).toBe("receipt-rcpt-1-e1");
  });

  it("never lets a child delivery with a missing receipt reach the provider", async () => {
    state.receipt = null;
    const job = sendEmailJob({
      template: "investment_activated",
      to: "a@example.com",
      accountEmailId: "e1",
      receiptId: "rcpt-missing",
    });
    await expect(deliverJobEmail(job)).rejects.toThrow("RECEIPT_NOT_FOUND");
    expect(state.send).not.toHaveBeenCalled();
  });

  it("delivers a ready receipt with its PDF attached", async () => {
    state.receipt = {
      id: "rcpt-1",
      investment_id: "inv-1",
      investor_id: "u1",
      source: "bank_activation",
      receipt_number: "OURMU-2026-000007",
      is_test: false,
      partner_name: "Test Partner",
      partner_phone: null,
      company_name: "OurMu Ventures Limited",
      company_address: "Katabbi Town Council, Entebbe, Wakiso",
      amount_ugx: "500000",
      transaction_date: "2026-09-20",
      account_description: "Accounts payable — Test Partner",
      original_investment_id: null,
      pdf_status: "ready",
      pdf_path: "u1/rcpt-1.pdf",
      template_version: "receipt-v1",
    };
    state.downloadFile = {
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    };
    const job = sendEmailJob({
      template: "investment_activated",
      to: "a@example.com",
      accountEmailId: "e1",
      receiptId: "rcpt-1",
    });
    await expect(deliverJobEmail(job)).resolves.toBe("resend-1");
    const calls = state.send.mock.calls as unknown as unknown[][];
    const sent = calls[0]?.[0] as Record<string, unknown>;
    expect(sent.idempotencyKey).toBe("receipt-rcpt-1-e1");
    const attachments = sent.attachments as Array<{ filename: string }>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0].filename).toBe("OURMU-2026-000007.pdf");
  });
});
