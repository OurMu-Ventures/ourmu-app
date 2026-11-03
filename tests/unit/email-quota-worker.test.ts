import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeQueueSnapshotRow } from "./helpers/fake-queue-snapshot";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  send: vi.fn(),
  queries: [] as string[],
  deferError: false,
  budgetError: null as null | string,
  investment: null as null | Record<string, unknown>,
}));
vi.mock("@/lib/email/send", () => ({
  sendTransactionalEmail: (...args: unknown[]) => state.send(...args),
}));
vi.mock("@/lib/env", () => ({
  getPublicEnv: () => ({ NEXT_PUBLIC_APP_URL: "https://example.test" }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      let patch: Record<string, unknown> | undefined;
      let columns = "*",
        maximum = Infinity,
        order = "",
        ascending = true;
      const result = () => {
        if (table === "investments")
          return {
            data: state.investment ? [state.investment] : [],
            error: null,
          };
        if (table !== "jobs") return { data: null, error: null };
        let rows = state.rows.filter((row) =>
          filters.every((filter) => filter(row)),
        );
        if (order)
          rows = [...rows].sort(
            (a, b) =>
              String(a[order]).localeCompare(String(b[order])) *
              (ascending ? 1 : -1),
          );
        rows = rows.slice(0, maximum);
        if (patch) {
          if (
            state.deferError &&
            patch.last_error_code === "EMAIL_DAILY_QUOTA_EXCEEDED"
          )
            return { data: null, error: { message: "write failed" } };
          // Only pre-send tracking writes the payload; the ledger refuses it.
          if (state.budgetError && "payload" in patch)
            return { data: null, error: { message: state.budgetError } };
          for (const row of rows) Object.assign(row, patch);
        }
        return {
          data: rows.map((row) =>
            columns === "id" ? { id: row.id } : { ...row },
          ),
          error: null,
        };
      };
      const q = {
        select: (value: string) => {
          columns = value;
          return q;
        },
        update: (value: Record<string, unknown>) => {
          patch = value;
          return q;
        },
        eq: (field: string, value: unknown) => {
          filters.push((row) => row[field] === value);
          return q;
        },
        neq: (field: string, value: unknown) => {
          state.queries.push(`neq:${field}:${value}`);
          filters.push((row) => row[field] !== value);
          return q;
        },
        in: (field: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[field]));
          return q;
        },
        gt: (field: string, value: string) => {
          filters.push(
            (row) => row[field] != null && String(row[field]) > value,
          );
          return q;
        },
        lt: (field: string, value: string) => {
          filters.push(
            (row) => row[field] != null && String(row[field]) < value,
          );
          return q;
        },
        gte: (field: string, value: string) => {
          filters.push(
            (row) => row[field] != null && String(row[field]) >= value,
          );
          return q;
        },
        lte: (field: string, value: string) => {
          filters.push(
            (row) => row[field] != null && String(row[field]) <= value,
          );
          return q;
        },
        order: (field: string, options: { ascending?: boolean } = {}) => {
          order = field;
          ascending = options.ascending !== false;
          return q;
        },
        limit: (value: number) => {
          maximum = value;
          return q;
        },
        maybeSingle: async () => {
          const r = result();
          return { ...r, data: r.data?.[0] ?? null };
        },
        single: async () => ({ data: null, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(result()).then(resolve),
      };
      return q;
    },
    rpc: async (name: string, args?: { p_campaign_id?: string }) =>
      name === "job_queue_snapshot"
        ? {
            data: [
              fakeQueueSnapshotRow(state.rows, args?.p_campaign_id ?? null),
            ],
            error: null,
          }
        : { data: 1, error: null },
  }),
}));
import { processDueJobs } from "@/lib/jobs";
import { EmailQuotaError, quotaRetryAt } from "@/lib/email/quota";
const start = Date.parse("2026-10-03T19:00:00Z");
function job(id = "job-1", overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: "send_email",
    status: "pending",
    entity_type: "test",
    entity_id: "test-1",
    payload: {
      to: "partner@example.test",
      template: "magic_link",
      actionUrl: "https://example.test",
      idempotencyKey: id,
    },
    attempts: 0,
    max_attempts: 8,
    created_at: "2026-10-01T00:00:00Z",
    available_at: "2026-10-01T00:00:00Z",
    first_send_attempt_at: null,
    send_attempts: 0,
    last_error_code: null,
    ...overrides,
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(start);
  state.rows = [job()];
  state.send.mockReset().mockResolvedValue("provider-1");
  state.queries = [];
  state.deferError = false;
  state.budgetError = null;
  state.investment = null;
});
afterEach(() => vi.useRealTimers());
describe("quota-aware email worker", () => {
  it("defers at the retry ceiling, retains its budget, and pauses later emails in the batch", async () => {
    state.rows = [job("first", { attempts: 7 }), job("second")];
    state.send.mockRejectedValue(
      new EmailQuotaError("EMAIL_DAILY_QUOTA_EXCEEDED"),
    );
    expect(await processDueJobs()).toMatchObject({
      processed: 1,
      succeeded: 0,
      failed: 0,
      deferred: 1,
      claimed: 1,
    });
    expect(state.rows[0]).toMatchObject({
      status: "pending",
      attempts: 7,
      available_at: "2026-10-03T22:00:00.000Z",
      first_send_attempt_at: null,
      send_attempts: 0,
      last_error_code: "EMAIL_DAILY_QUOTA_EXCEEDED",
    });
    expect(state.rows[1]).toMatchObject({ status: "pending", attempts: 0 });
    expect(state.send).toHaveBeenCalledOnce();
  });
  it("persists the hold across worker invocations and excludes email work from the fetch", async () => {
    state.send.mockRejectedValueOnce(
      new EmailQuotaError("EMAIL_DAILY_QUOTA_EXCEEDED"),
    );
    await processDueJobs();
    state.rows.push(job("pdf", { kind: "generate_agreement_pdf" }));
    await processDueJobs();
    expect(state.queries).toContain("neq:kind:send_email");
    expect(state.rows[1].attempts).toBe(1); // PDF work is still attempted, even without a fixture investment.
    expect(state.send).toHaveBeenCalledOnce();
  });
  it("resumes at the UTC reset and succeeds with the same idempotency key", async () => {
    state.send.mockRejectedValueOnce(
      new EmailQuotaError("EMAIL_DAILY_QUOTA_EXCEEDED"),
    );
    await processDueJobs();
    vi.setSystemTime("2026-10-04T00:01:00Z");
    await processDueJobs();
    expect(state.rows[0]).toMatchObject({
      status: "succeeded",
      attempts: 1,
      provider_message_id: "provider-1",
    });
    expect(
      state.send.mock.calls.map(([input]) => input.idempotencyKey),
    ).toEqual(["job-1", "job-1"]);
  });
  it("resumes daily budget holds at the next UTC reset", async () => {
    state.budgetError = "EMAIL_DAILY_BUDGET_DEFERRED";
    expect(await processDueJobs()).toMatchObject({ deferred: 1, claimed: 1 });
    expect(state.rows[0]).toMatchObject({
      status: "pending",
      attempts: 0,
      available_at: "2026-10-04T00:01:00.000Z",
      last_error_code: "EMAIL_BUDGET_DEFERRED",
    });
    state.budgetError = null;
    vi.setSystemTime("2026-10-04T00:01:00Z");
    await processDueJobs();
    expect(state.rows[0]).toMatchObject({ status: "succeeded", attempts: 1 });
    expect(state.send).toHaveBeenCalledOnce();
  });
  it("probes monthly budget holds once a day", async () => {
    state.budgetError = "EMAIL_MONTHLY_BUDGET_DEFERRED";
    await processDueJobs();
    expect(state.rows[0]).toMatchObject({
      status: "pending",
      available_at: "2026-10-04T19:00:00.000Z",
      last_error_code: "EMAIL_BUDGET_DEFERRED",
    });
    expect(state.send).not.toHaveBeenCalled();
  });
  it("can recover after repeated monthly refusals beyond the 24h idempotency window", async () => {
    state.send.mockRejectedValueOnce(
      new EmailQuotaError("EMAIL_MONTHLY_QUOTA_EXCEEDED"),
    );
    await processDueJobs();
    vi.setSystemTime(start + 24 * 3600000);
    state.send.mockRejectedValueOnce(
      new EmailQuotaError("EMAIL_MONTHLY_QUOTA_EXCEEDED"),
    );
    await processDueJobs();
    vi.setSystemTime(start + 48 * 3600000);
    await processDueJobs();
    expect(state.rows[0]).toMatchObject({ status: "succeeded", attempts: 1 });
  });
  it("preserves an earlier ambiguous attempt and still requires reconciliation after 24h", async () => {
    const prior = "2026-10-03T00:00:00Z";
    state.rows = [
      job("ambiguous", {
        first_send_attempt_at: prior,
        send_attempts: 1,
        attempts: 1,
      }),
    ];
    state.send.mockRejectedValueOnce(
      new EmailQuotaError("EMAIL_DAILY_QUOTA_EXCEEDED"),
    );
    await processDueJobs();
    expect(state.rows[0]).toMatchObject({
      first_send_attempt_at: prior,
      send_attempts: 1,
      attempts: 1,
    });
    vi.setSystemTime("2026-10-04T00:01:00Z");
    await processDueJobs();
    expect(state.rows[0]).toMatchObject({
      status: "dead",
      last_error_code: "NEEDS_RECONCILIATION",
    });
    expect(state.send).toHaveBeenCalledOnce();
  });
  it("resumes before reset when an admin clears the hold after an upgrade", async () => {
    state.send.mockRejectedValueOnce(
      new EmailQuotaError("EMAIL_DAILY_QUOTA_EXCEEDED"),
    );
    await processDueJobs();
    Object.assign(state.rows[0], {
      last_error_code: null,
      available_at: new Date(start).toISOString(),
    });
    await processDueJobs();
    expect(state.rows[0]).toMatchObject({ status: "succeeded", attempts: 1 });
  });
  it("keeps ordinary provider failures on the existing retry budget", async () => {
    state.rows = [job("generic", { attempts: 7 })];
    state.send.mockRejectedValue(new Error("EMAIL_DELIVERY_FAILED"));
    await processDueJobs();
    expect(state.rows[0]).toMatchObject({
      status: "dead",
      attempts: 8,
      last_error_code: "EMAIL_DELIVERY_FAILED",
    });
  });
  it("marks a missing reservation investment dead on its first attempt", async () => {
    state.rows = [
      job("missing-reservation", {
        entity_type: "investment",
        payload: { template: "reservation_created" },
      }),
    ];
    expect(await processDueJobs()).toMatchObject({ failed: 0, skipped: 1 });
    expect(state.rows[0]).toMatchObject({
      status: "dead",
      attempts: 1,
      last_error_code: "RESERVATION_NOT_FOUND",
    });
    expect(state.send).not.toHaveBeenCalled();
  });
  it("marks a reservation email dead once the investment is no longer reserved", async () => {
    state.investment = { status: "active" };
    state.rows = [
      job("stale-reservation", {
        entity_type: "investment",
        payload: { template: "reservation_created" },
      }),
    ];
    expect(await processDueJobs()).toMatchObject({ failed: 0, skipped: 1 });
    expect(state.rows[0]).toMatchObject({
      status: "dead",
      attempts: 1,
      last_error_code: "STALE_RESERVATION",
    });
    expect(state.send).not.toHaveBeenCalled();
  });
  it("surfaces a failed defer write rather than claiming a successful pause", async () => {
    state.deferError = true;
    state.send.mockRejectedValue(
      new EmailQuotaError("EMAIL_DAILY_QUOTA_EXCEEDED"),
    );
    await expect(processDueJobs()).rejects.toThrow("EMAIL_QUOTA_DEFER_FAILED");
  });
  it("handles month/year boundaries and does not guess the monthly billing reset", () => {
    expect(
      quotaRetryAt(
        "EMAIL_DAILY_QUOTA_EXCEEDED",
        Date.parse("2026-12-31T23:59:59Z"),
      ),
    ).toBe("2027-01-01T00:01:00.000Z");
    expect(quotaRetryAt("EMAIL_MONTHLY_QUOTA_EXCEEDED", start)).toBe(
      "2026-10-04T19:00:00.000Z",
    );
  });
});
