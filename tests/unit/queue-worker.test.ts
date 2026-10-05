import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  EmailBudgetDeferredError,
  EmailQuotaError,
  EmailRateLimitError,
  deferRetryAt,
  quotaRetryAt,
} from "@/lib/email/quota";

type FakeJob = {
  id: string;
  kind: string;
  status: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  created_at: string;
  available_at?: string | null;
  locked_at?: string | null;
  claim_token?: string | null;
  lease_expires_at?: string | null;
  last_error_code?: string | null;
  completed_at?: string | null;
  first_send_attempt_at?: string | null;
  send_attempts?: number;
  provider_message_id?: string | null;
};

type Op = { m: string; col?: string; val?: unknown };

const PAST = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const ENTITY_ID = "00000000-0000-4000-8000-000000000001";

const state = vi.hoisted(() => ({
  send: vi.fn<(...args: unknown[]) => Promise<string>>(async () => "resend-1"),
  jobs: [] as FakeJob[],
  raceClaimIds: new Set<string>(),
  staleTokenIds: new Set<string>(),
  trackingError: null as null | { message: string },
  upsertError: null as null | { message: string },
  recipientSingle: { id: "e1" } as unknown,
  recipientList: [{ id: "e1", email: "a@example.com" }] as unknown,
  investmentRow: null as null | Record<string, unknown>,
  instructionRow: null as null | Record<string, unknown>,
  receiptRow: null as null | Record<string, unknown>,
  receiptError: null as null | { message: string },
  sentPayloads: [] as unknown[],
}));

let jobSeq = 0;

function pastIso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
}

function makeJob(overrides: Partial<FakeJob> = {}): FakeJob {
  jobSeq += 1;
  return {
    id: `job-${jobSeq}`,
    kind: "send_email",
    status: "pending",
    entity_type: "test",
    entity_id: ENTITY_ID,
    payload: { template: "agreement_ready", to: "a@example.com" },
    attempts: 0,
    max_attempts: 8,
    created_at: PAST,
    available_at: PAST,
    ...overrides,
  };
}

function matches(row: FakeJob, ops: Op[]): boolean {
  const record = row as unknown as Record<string, unknown>;
  for (const op of ops) {
    const value = op.col ? record[op.col] : undefined;
    switch (op.m) {
      case "eq":
        if (value !== op.val) return false;
        break;
      case "neq":
        if (value === op.val) return false;
        break;
      case "in":
        if (!Array.isArray(op.val) || !(op.val as unknown[]).includes(value))
          return false;
        break;
      case "lte":
        if (value == null || (value as string) > (op.val as string))
          return false;
        break;
      case "lt":
        if (value == null || (value as string) >= (op.val as string))
          return false;
        break;
      case "gte":
        if (value == null || (value as string) < (op.val as string))
          return false;
        break;
      case "gt":
        if (value == null || (value as string) <= (op.val as string))
          return false;
        break;
      case "not":
        // Only `.not(col, "is", null)` is used by the worker paths under test.
        if (value == null) return false;
        break;
      default:
        break;
    }
  }
  return true;
}

class FakeQuery {
  constructor(
    private table: string,
    private ops: Op[] = [],
    private patch?: Record<string, unknown>,
    private headCount = false,
    private orderBy?: { col: string; asc: boolean },
    private limitN?: number,
  ) {}

  private fork(extra: Partial<{ ops: Op[]; patch: Record<string, unknown>; headCount: boolean; orderBy: { col: string; asc: boolean }; limitN: number }>): FakeQuery {
    return new FakeQuery(
      this.table,
      extra.ops ?? this.ops,
      extra.patch ?? this.patch,
      extra.headCount ?? this.headCount,
      extra.orderBy ?? this.orderBy,
      extra.limitN ?? this.limitN,
    );
  }

  select = (_cols: string, opts?: { count?: string; head?: boolean }): FakeQuery =>
    this.fork({ headCount: opts?.head === true && opts?.count === "exact" });

  eq = (col: string, val: unknown): FakeQuery =>
    this.fork({ ops: [...this.ops, { m: "eq", col, val }] });

  neq = (col: string, val: unknown): FakeQuery =>
    this.fork({ ops: [...this.ops, { m: "neq", col, val }] });

  in = (col: string, val: unknown): FakeQuery =>
    this.fork({ ops: [...this.ops, { m: "in", col, val }] });

  lte = (col: string, val: unknown): FakeQuery =>
    this.fork({ ops: [...this.ops, { m: "lte", col, val }] });

  lt = (col: string, val: unknown): FakeQuery =>
    this.fork({ ops: [...this.ops, { m: "lt", col, val }] });

  gte = (col: string, val: unknown): FakeQuery =>
    this.fork({ ops: [...this.ops, { m: "gte", col, val }] });

  gt = (col: string, val: unknown): FakeQuery =>
    this.fork({ ops: [...this.ops, { m: "gt", col, val }] });

  not = (col: string): FakeQuery =>
    this.fork({ ops: [...this.ops, { m: "not", col }] });

  order = (col: string, opts?: { ascending?: boolean }): FakeQuery =>
    this.fork({ orderBy: { col, asc: opts?.ascending !== false } });

  limit = (n: number): FakeQuery => this.fork({ limitN: n });

  update = (patch: Record<string, unknown>): FakeQuery =>
    this.fork({ patch });

  insert = (row: Record<string, unknown>): Promise<{ data: null; error: null }> => {
    state.jobs.push({
      id: `job-inserted-${state.jobs.length + 1}`,
      kind: "send_email",
      status: "pending",
      entity_type: "test",
      entity_id: ENTITY_ID,
      payload: {},
      attempts: 0,
      max_attempts: 8,
      created_at: new Date().toISOString(),
      available_at: new Date().toISOString(),
      ...(row as Partial<FakeJob>),
    });
    return Promise.resolve({ data: null, error: null });
  };

  upsert = (
    rows: Array<Record<string, unknown>>,
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): Promise<{ data: null; error: unknown }> => {
    if (state.upsertError) return Promise.resolve({ data: null, error: state.upsertError });
    for (const row of rows) {
      const key = (row as Record<string, unknown>).email_dedupe_key as string | undefined;
      if (
        opts?.ignoreDuplicates &&
        key &&
        state.jobs.some(
          (job) => (job.payload as Record<string, unknown> | undefined) && (job as unknown as Record<string, unknown>).email_dedupe_key === key,
        )
      )
        continue;
      state.jobs.push({
        id: `job-upserted-${state.jobs.length + 1}`,
        kind: "send_email",
        status: "pending",
        entity_type: "test",
        entity_id: ENTITY_ID,
        payload: {},
        attempts: 0,
        max_attempts: 8,
        created_at: new Date().toISOString(),
        available_at: new Date().toISOString(),
        ...(row as Partial<FakeJob>),
      } as FakeJob);
    }
    return Promise.resolve({ data: null, error: null });
  };

  private cannedSingle(): { data: unknown; error: unknown } {
    if (this.table === "account_emails")
      return { data: state.recipientSingle, error: null };
    if (this.table === "investments")
      return state.investmentRow
        ? { data: state.investmentRow, error: null }
        : { data: null, error: { message: "no rows" } };
    if (this.table === "maturity_instructions")
      return { data: state.instructionRow, error: null };
    if (this.table === "investment_receipts")
      return { data: state.receiptRow, error: state.receiptError };
    return { data: null, error: null };
  }

  private cannedList(): { data: unknown; error: unknown } {
    if (this.table === "account_emails")
      return { data: state.recipientList, error: null };
    if (this.table === "investments")
      return {
        data: state.investmentRow ? [state.investmentRow] : [],
        error: null,
      };
    if (this.table === "investment_receipts")
      return {
        data: state.receiptRow ? [state.receiptRow] : [],
        error: state.receiptError,
      };
    return { data: [], error: null };
  }

  private jobsExec(): { data: unknown; count?: number; error: unknown } {
    let rows = state.jobs.filter((row) => matches(row, this.ops));
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      rows = [...rows].sort((a, b) => {
        const av = (a as unknown as Record<string, unknown>)[col] as string;
        const bv = (b as unknown as Record<string, unknown>)[col] as string;
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (asc ? 1 : -1);
      });
    }
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    if (this.patch) {
      const patchKeys = Object.keys(this.patch);
      const isTracking =
        patchKeys.length === 3 &&
        patchKeys.includes("send_attempts") &&
        patchKeys.includes("first_send_attempt_at");
      if (isTracking && !rows[0]?.first_send_attempt_at &&
          state.jobs.filter((job) => job.first_send_attempt_at).length >= 80)
        return { data: null, error: { message: "EMAIL_DAILY_BUDGET_DEFERRED" } };
      if (isTracking && state.trackingError)
        return { data: null, error: state.trackingError };
      const idOp = this.ops.find((op) => op.m === "eq" && op.col === "id");
      const targetId = idOp?.val as string | undefined;
      const hasTokenGuard = this.ops.some(
        (op) => op.m === "eq" && op.col === "claim_token",
      );
      if (targetId && hasTokenGuard && state.staleTokenIds.has(targetId))
        return { data: [], error: null };
      if (
        targetId &&
        state.raceClaimIds.has(targetId) &&
        this.patch.status === "running" &&
        typeof this.patch.claim_token === "string"
      ) {
        // A concurrent worker won the race: it now owns the row, so later
        // batches in this run no longer see it as due.
        const winner = state.jobs.find((job) => job.id === targetId);
        if (winner) {
          winner.status = "running";
          winner.locked_at = new Date().toISOString();
          winner.lease_expires_at = new Date(Date.now() + 300_000).toISOString();
          winner.attempts += 1;
        }
        return { data: [], error: null };
      }
      for (const row of rows)
        Object.assign(row, JSON.parse(JSON.stringify(this.patch)));
      if (this.headCount) return { data: [], count: rows.length, error: null };
      return { data: rows.map((row) => ({ ...row })), error: null };
    }
    if (this.headCount) return { data: [], count: rows.length, error: null };
    return { data: rows.map((row) => ({ ...row })), error: null };
  }

  maybeSingle = (): Promise<{ data: unknown; error: unknown }> => {
    if (this.table !== "jobs") return Promise.resolve(this.cannedSingle());
    const result = this.fork({ limitN: 1 }).jobsExec();
    const rows = result.data as FakeJob[];
    return Promise.resolve({ data: rows[0] ?? null, error: result.error });
  };

  single = (): Promise<{ data: unknown; error: unknown }> => {
    if (this.table !== "jobs") {
      const result = this.cannedSingle();
      if (result.data == null && result.error == null)
        return Promise.resolve({ data: null, error: { message: "no rows" } });
      return Promise.resolve(result);
    }
    const result = this.fork({ limitN: 1 }).jobsExec();
    const rows = result.data as FakeJob[];
    if (rows.length === 0)
      return Promise.resolve({ data: null, error: { message: "no rows" } });
    return Promise.resolve({ data: rows[0], error: null });
  };

  then = <T,>(
    resolve: (value: { data: unknown; count?: number; error: unknown }) => T,
  ): Promise<T> => {
    if (this.table !== "jobs")
      return Promise.resolve(this.cannedList()).then(resolve);
    return Promise.resolve(this.jobsExec()).then(resolve);
  };
}

function fakeAdmin() {
  return {
    from: (table: string) => new FakeQuery(table),
    rpc: async () => ({ data: 1, error: null }),
    storage: {
      from: () => ({
        download: async () => ({ data: null, error: { message: "not found" } }),
        upload: async () => ({ error: null }),
      }),
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => fakeAdmin(),
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
  needsReconciliation,
  processDueJobs,
  recipientsForPayload,
  type JobRow,
} from "@/lib/jobs";

function sendEmailJob(
  payload: Record<string, unknown> = {},
  overrides: Partial<FakeJob> = {},
): FakeJob {
  return makeJob({
    payload: { template: "agreement_ready", to: "a@example.com", ...payload },
    ...overrides,
  });
}

beforeEach(() => {
  jobSeq = 0;
  state.jobs = [];
  state.raceClaimIds = new Set<string>();
  state.staleTokenIds = new Set<string>();
  state.trackingError = null;
  state.upsertError = null;
  state.send.mockReset();
  state.send.mockImplementation(async () => "resend-1");
  state.recipientSingle = { id: "e1" };
  state.recipientList = [{ id: "e1", email: "a@example.com" }];
  state.investmentRow = null;
  state.instructionRow = null;
  state.receiptRow = null;
  state.receiptError = null;
  state.sentPayloads = [];
});

describe("queue draining", () => {
  it("processes successive batches so queues larger than 10 drain in one run", async () => {
    for (let i = 0; i < 12; i += 1) state.jobs.push(sendEmailJob({}));
    const result = await processDueJobs(10, undefined, {
      drainQueue: true,
      pacingMs: 0,
    });
    expect(result.claimed).toBe(12);
    expect(result.succeeded).toBe(12);
    expect(result.processed).toBe(12);
    expect(result.stopReason).toBe("queue_empty");
    expect(result.remainingDue).toBe(0);
    expect(result.oldestDueAgeSec).toBeNull();
    expect(result.providerAccepted).toBe(12);
  });

  it("stops at the job budget and reports remaining work", async () => {
    for (let i = 0; i < 4; i += 1)
      state.jobs.push(sendEmailJob({}, { created_at: pastIso(180 - i) }));
    const result = await processDueJobs(10, undefined, {
      drainQueue: true,
      pacingMs: 0,
      maxJobs: 2,
    });
    expect(result.claimed).toBe(2);
    expect(result.stopReason).toBe("job_budget");
    expect(result.remainingDue).toBe(2);
    expect(result.oldestDueAgeSec).toBeGreaterThan(0);
  });

  it("does not start another job after the time budget elapses", async () => {
    state.jobs.push(sendEmailJob({}));
    const result = await processDueJobs(10, undefined, {
      drainQueue: true,
      pacingMs: 0,
      timeBudgetMs: 0,
    });
    expect(result.claimed).toBe(0);
    expect(result.processed).toBe(0);
    expect(result.stopReason).toBe("time_budget");
    expect(state.send).not.toHaveBeenCalled();
  });

  it("keeps single-batch behaviour for the campaign worker", async () => {
    for (let i = 0; i < 12; i += 1)
      state.jobs.push(
        sendEmailJob({}, { entity_type: "email_campaign", entity_id: "camp-1" }),
      );
    state.jobs.push(sendEmailJob({}, { entity_type: "other" }));
    const result = await processDueJobs(10, "camp-1", { pacingMs: 0 });
    expect(result.processed).toBe(10);
    expect(result.claimed).toBe(10);
    expect(result.stopReason).toBe("single_batch");
    expect(result.remainingDue).toBe(2);
  });
});

describe("leases and overlapping workers", () => {
  it("recovers expired leases before processing", async () => {
    state.jobs.push(
      sendEmailJob(
        {},
        {
          status: "running",
          claim_token: "old-token",
          lease_expires_at: pastIso(10),
          locked_at: pastIso(10),
          attempts: 1,
        },
      ),
    );
    const result = await processDueJobs(10, undefined, {
      drainQueue: true,
      pacingMs: 0,
    });
    expect(result.recoveredLeases).toBe(1);
    expect(result.succeeded).toBe(1);
  });

  it("skips jobs lost to a concurrent worker instead of double-processing", async () => {
    const contested = sendEmailJob({});
    const other = sendEmailJob({});
    state.jobs.push(contested, other);
    state.raceClaimIds.add(contested.id);
    const result = await processDueJobs(10, undefined, {
      drainQueue: true,
      pacingMs: 0,
    });
    expect(result.skipped).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.claimed).toBe(1);
    expect(state.send).toHaveBeenCalledTimes(1);
  });

  it("recovers recorded acceptance without resending or counting a new acceptance", async () => {
    const job = sendEmailJob({}, { status: "running", claim_token: "expired", lease_expires_at: pastIso(10), provider_message_id: "already-accepted", first_send_attempt_at: pastIso(2000) });
    state.jobs.push(job);
    const result = await processDueJobs(10, undefined, { pacingMs: 0 });
    expect(result.recoveredLeases).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.providerAccepted).toBe(0);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("does not send or change tracking when the pre-send lease is lost", async () => {
    const job = sendEmailJob({}, { status: "running", claim_token: "new-owner", send_attempts: 2 });
    state.jobs.push(job);
    await expect(deliverJobEmail({ ...job, claim_token: "old-owner" } as JobRow))
      .rejects.toThrow("JOB_CLAIM_LOST");
    expect(state.send).not.toHaveBeenCalled();
    expect(job.send_attempts).toBe(2);
  });

  it("reports provider acceptance separately when completion loses its lease race", async () => {
    const job = sendEmailJob({});
    state.jobs.push(job);
    state.send.mockImplementation(async () => {
      state.staleTokenIds.add(job.id);
      return "resend-1";
    });
    const result = await processDueJobs(10, undefined, {
      drainQueue: true,
      pacingMs: 0,
    });
    expect(result.providerAccepted).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.stateErrors).toBe(1);
  });
});

describe("deferrals preserve the retry budget", () => {
  it("defers quota refusals without consuming attempts and pauses email", async () => {
    state.send.mockRejectedValueOnce(
      new EmailQuotaError("EMAIL_DAILY_QUOTA_EXCEEDED"),
    );
    state.jobs.push(
      sendEmailJob({}),
      sendEmailJob({}),
      makeJob({ kind: "unknown_kind", payload: {} }),
    );
    const result = await processDueJobs(10, undefined, {
      drainQueue: true,
      pacingMs: 0,
    });
    expect(result.deferred).toBe(1);
    // The second email is left untouched for a later run; non-email work continues.
    expect(result.failed).toBe(1);
    expect(state.send).toHaveBeenCalledTimes(1);
    const deferredJob = state.jobs[0];
    expect(deferredJob.status).toBe("pending");
    expect(deferredJob.attempts).toBe(0);
    expect(deferredJob.last_error_code).toBe("EMAIL_DAILY_QUOTA_EXCEEDED");
    expect(
      new Date(deferredJob.available_at as string).getTime(),
    ).toBeGreaterThan(Date.now());
  });

  it("honours Retry-After on rate limits", async () => {
    state.send.mockRejectedValueOnce(new EmailRateLimitError(120, "rate_limit_exceeded"));
    state.jobs.push(sendEmailJob({}));
    const before = Date.now();
    const result = await processDueJobs(10, undefined, {
      drainQueue: true,
      pacingMs: 0,
    });
    expect(result.deferred).toBe(1);
    const retryAt = new Date(state.jobs[0].available_at as string).getTime();
    expect(retryAt - before).toBeGreaterThan(100 * 1000);
    expect(retryAt - before).toBeLessThanOrEqual(130 * 1000);
    expect(state.jobs[0].attempts).toBe(0);
  });

  it("defers first sends over the daily recipient budget without double-counting retries", async () => {
    for (let i = 0; i < 80; i += 1)
      state.jobs.push(
        sendEmailJob(
          {},
          {
            status: "succeeded",
            first_send_attempt_at: pastIso(60),
            send_attempts: 1,
            provider_message_id: `resend-${i}`,
          },
        ),
      );
    // A retry of an already-attempted row never reserves budget twice.
    const retry = sendEmailJob(
      { template: "agreement_ready", to: "b@example.com", idempotencyKey: "k-1" },
      { first_send_attempt_at: pastIso(60), send_attempts: 1 },
    );
    const fresh = sendEmailJob({
      template: "agreement_ready",
      to: "c@example.com",
    });
    state.jobs.push(retry, fresh);
    const result = await processDueJobs(100, undefined, {
      drainQueue: true,
      pacingMs: 0,
      batchSize: 100,
    });
    expect(result.providerAccepted).toBe(1);
    expect(result.deferred).toBe(1);
    expect(fresh.last_error_code).toBe("EMAIL_BUDGET_DEFERRED");
    expect(fresh.attempts).toBe(0);
    expect(state.send).toHaveBeenCalledTimes(1);
  });
});

describe("delivery guards", () => {
  it("retries ambiguous sends inside the idempotency window with the original key", async () => {
    const job = sendEmailJob(
      { template: "agreement_ready", to: "a@example.com", idempotencyKey: "orig-key" },
      { first_send_attempt_at: new Date().toISOString(), send_attempts: 1 },
    );
    job.status = "running";
    job.claim_token = "current-claim";
    state.jobs.push(job);
    await expect(deliverJobEmail(job as JobRow)).resolves.toBe("resend-1");
    expect(state.send).toHaveBeenCalledTimes(1);
    const firstSend = state.send.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(firstSend?.idempotencyKey).toBe("orig-key");
  });

  it("quarantines ambiguous sends outside the idempotency window", async () => {
    state.jobs.push(
      sendEmailJob(
        {},
        {
          first_send_attempt_at: pastIso(60 * 25),
          send_attempts: 1,
          attempts: 0,
        },
      ),
    );
    const result = await processDueJobs(10, undefined, {
      drainQueue: true,
      pacingMs: 0,
    });
    expect(result.needsReconciliation).toBe(1);
    expect(result.failed).toBe(1);
    expect(state.jobs[0].status).toBe("dead");
    expect(state.send).not.toHaveBeenCalled();
  });

  it("never sends a confirmation for a removed request or paid-out investment", async () => {
    state.investmentRow = {
      principal_ugx: "1000000",
      projected_return_ugx: "300000",
      projected_return_bps: 3000,
      projected_value_ugx: "1300000",
      maturity_date: "2026-09-30",
      payout_basis: "reported_paid",
    };
    state.instructionRow = { choice: "reinvest_all", status: "requested" };
    const paid = sendEmailJob(
      {
        template: "maturity_choice_confirmed",
        to: "a@example.com",
      },
      { entity_type: "investment" },
    );
    await expect(deliverJobEmail(paid as JobRow)).rejects.toThrow(
      "STALE_MATURITY_CONFIRMATION",
    );

    state.investmentRow = {
      principal_ugx: "1000000",
      projected_return_ugx: "300000",
      projected_return_bps: 3000,
      projected_value_ugx: "1300000",
      maturity_date: "2026-09-30",
      payout_basis: "projected",
    };
    state.instructionRow = null;
    const removed = sendEmailJob(
      {
        template: "maturity_choice_confirmed",
        to: "a@example.com",
      },
      { entity_type: "investment" },
    );
    await expect(deliverJobEmail(removed as JobRow)).rejects.toThrow(
      "STALE_MATURITY_CONFIRMATION",
    );
    expect(state.send).not.toHaveBeenCalled();
  });

  it("suppresses delivery to removed aliases without sending", async () => {
    state.recipientSingle = null;
    state.jobs.push(
      sendEmailJob({ template: "agreement_ready", to: "gone@example.com", accountEmailId: "e1" }),
    );
    const result = await processDueJobs(10, undefined, {
      drainQueue: true,
      pacingMs: 0,
    });
    expect(result.skipped).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("retries when the receipt PDF is not ready instead of sending", async () => {
    state.receiptRow = {
      id: "rcpt-1",
      pdf_status: "generating",
      pdf_path: null,
    };
    state.jobs.push(
      sendEmailJob(
        {
          template: "investment_activated",
          to: "a@example.com",
          receiptId: "rcpt-1",
        },
        { entity_type: "investment" },
      ),
    );
    const result = await processDueJobs(10, undefined, {
      drainQueue: true,
      pacingMs: 0,
    });
    expect(result.failed).toBe(1);
    expect(state.jobs[0].status).toBe("failed");
    expect(state.send).not.toHaveBeenCalled();
  });

  it("marks jobs dead after the retry budget is exhausted", async () => {
    state.send.mockRejectedValueOnce(new Error("EMAIL_DELIVERY_FAILED:validation_error"));
    state.jobs.push(sendEmailJob({}, { attempts: 7, max_attempts: 8 }));
    const result = await processDueJobs(10, undefined, {
      drainQueue: true,
      pacingMs: 0,
    });
    expect(result.failed).toBe(1);
    expect(state.jobs[0].status).toBe("dead");
  });
});

describe("reporting compatibility", () => {
  it("retains processed/succeeded/failed/deferred alongside new counters", async () => {
    state.jobs.push(sendEmailJob());
    const result = await processDueJobs(10, undefined, { pacingMs: 0 });
    expect(result).toMatchObject({
      processed: 1,
      succeeded: 1,
      failed: 0,
      deferred: 0,
      claimed: 1,
      providerAccepted: 1,
      stopReason: "single_batch",
    });
    expect(result).toHaveProperty("documentsGenerated");
    expect(result).toHaveProperty("recipientJobsCreated");
    expect(result).toHaveProperty("recoveredLeases");
    expect(result).toHaveProperty("remainingDue");
    expect(result).toHaveProperty("oldestDueAgeSec");
    expect(result).toHaveProperty("needsReconciliation");
    expect(result).toHaveProperty("stateErrors");
  });
});

describe("pure helpers", () => {
  it("counts To/CC/BCC recipients", () => {
    expect(recipientsForPayload({ to: "a@example.com" })).toBe(1);
    expect(
      recipientsForPayload({
        to: "a@example.com",
        routing: { revision: 1, cc: ["t@example.com"], replyTo: [], teamCopySelected: false },
      }),
    ).toBe(2);
    expect(
      recipientsForPayload({ to: "a@example.com", bcc: ["x@example.com", "y@example.com"] }),
    ).toBe(3);
  });

  it("keys reconciliation off the first provider send, not job creation", () => {
    expect(
      needsReconciliation({ firstSendAttemptAt: null, providerMessageId: null }),
    ).toBe(false);
    expect(
      needsReconciliation({
        firstSendAttemptAt: new Date().toISOString(),
        providerMessageId: null,
      }),
    ).toBe(false);
    expect(
      needsReconciliation({
        firstSendAttemptAt: pastIso(60 * 25),
        providerMessageId: null,
      }),
    ).toBe(true);
    expect(
      needsReconciliation({
        firstSendAttemptAt: pastIso(60 * 25),
        providerMessageId: "resend-1",
      }),
    ).toBe(false);
  });

  it("schedules quota and rate-limit retries", () => {
    const daily = quotaRetryAt("EMAIL_DAILY_QUOTA_EXCEEDED", Date.UTC(2026, 9, 5, 12));
    expect(daily).toBe(new Date(Date.UTC(2026, 9, 6, 0, 1)).toISOString());
    const rate = deferRetryAt("EMAIL_RATE_LIMITED", 1_000_000, 120);
    expect(rate).toBe(new Date(1_000_000 + 120_000).toISOString());
    // Retry-After is bounded so a bad header cannot stall the queue.
    expect(deferRetryAt("EMAIL_RATE_LIMITED", 1_000_000, 10_000)).toBe(
      new Date(1_000_000 + 900_000).toISOString(),
    );
  });

  it("distinguishes budget deferrals from quota errors", () => {
    expect(new EmailBudgetDeferredError("daily").code).toBe("EMAIL_BUDGET_DEFERRED");
    expect(new EmailRateLimitError(45).retryAfterSec).toBe(45);
  });
});
