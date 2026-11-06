import { cleanupDepositSlips } from "@/lib/deposit-slips";
vi.mock("@/lib/deposit-slips", () => ({
  cleanupDepositSlips: vi.fn(async () => ({ deleted: 0, failed: 0 })),
}));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProcessDueJobsResult } from "@/lib/jobs";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  process: vi.fn(),
  rpc: vi.fn(),
  healthError: false,
  recordError: false,
}));
vi.mock("@/lib/jobs", () => ({
  WORKER_TIME_BUDGET_MS: 40_000,
  processDueJobs: mocks.process,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));
import * as route from "@/app/api/cron/jobs/route";
import { POST } from "@/app/api/cron/jobs/route";
import { workerRunRecord } from "@/lib/cron-route";

const CRON = "cron-secret-for-unit-tests-".padEnd(40, "0");
const JOB = "job-trigger-secret-for-unit-tests-".padEnd(48, "0");
const DISPATCH_ID = "88000000-0000-4000-8000-000000000001";
const GENERATED_AT = "2026-11-03T04:17:00.123456+00:00";

const jobs: ProcessDueJobsResult = {
  processed: 3,
  succeeded: 2,
  failed: 1,
  deferred: 0,
  claimed: 3,
  skipped: 1,
  unclaimable: 1,
  providerAccepted: 2,
  documentsGenerated: 0,
  recipientJobsCreated: 0,
  recoveredLeases: 1,
  needsReconciliation: 0,
  stateErrors: 0,
  dueBefore: 4,
  processableDueBefore: 3,
  oldestDueAgeSecBefore: 240,
  expiredLeasesBefore: 0,
  remainingDue: 1,
  remainingProcessableDue: 0,
  remainingExpiredLeases: 0,
  oldestDueAgeSec: null,
  emailHold: null,
  stopReason: "queue_empty",
};

function post(headers: Record<string, string> = {}) {
  return POST(
    new Request("https://partners.example.test/api/cron/jobs", {
      method: "POST",
      headers,
      body: JSON.stringify({ dispatchId: DISPATCH_ID }),
    }),
  );
}

function recorded() {
  const records = mocks.rpc.mock.calls.filter(
    ([name]) => name === "record_job_worker_run",
  );
  expect(records).toHaveLength(1);
  return records[0][1].p_run as Record<string, unknown>;
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", CRON);
  vi.stubEnv("JOB_TRIGGER_SECRET", JOB);
  mocks.calls = [];
  mocks.healthError = false;
  mocks.recordError = false;
  mocks.process.mockReset().mockImplementation(async () => {
    mocks.calls.push("processDueJobs");
    return jobs;
  });
  mocks.rpc.mockReset().mockImplementation(async (name: string) => {
    mocks.calls.push(name);
    if (name === "job_dispatch_health")
      return mocks.healthError
        ? { data: null, error: { code: "PGRST202", message: "missing" } }
        : {
            data: { generatedAt: GENERATED_AT, status: "ok", problems: [] },
            error: null,
          };
    if (name === "record_job_worker_run")
      return mocks.recordError
        ? { data: null, error: { code: "23514", message: "check" } }
        : { data: 1, error: null };
    return { data: null, error: { code: "PGRST202", message: "unknown" } };
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/cron/jobs", () => {
  it.each(["reported", "thrown"])(
    "keeps jobs successful after %s cleanup failures",
    async (mode) => {
      if (mode === "reported")
        vi.mocked(cleanupDepositSlips).mockResolvedValueOnce({
          deleted: 0,
          failed: 20,
        });
      else
        vi.mocked(cleanupDepositSlips).mockRejectedValueOnce(
          new Error("missing migration"),
        );
      const response = await post({
        authorization: `Bearer ${JOB}`,
        "x-ourmu-trigger": "pg_cron",
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        jobs,
        depositSlips: { failed: expect.any(Number) },
      });
      expect(recorded()).toMatchObject({ ok: true, error_code: null });
    },
  );
  it("rejects unauthenticated calls before any processing or RPC", async () => {
    const unauthenticated: Array<Record<string, string>> = [
      {},
      { authorization: "Bearer wrong-secret-of-sufficient-length-000" },
      { authorization: CRON },
    ];
    for (const headers of unauthenticated) {
      const response = await post(headers);
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({
        error: "unauthorized",
        requestId: expect.any(String),
      });
    }
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("records the dispatcher's run with its dispatch id and skips health", async () => {
    const response = await post({
      authorization: `Bearer ${JOB}`,
      "x-ourmu-trigger": "pg_cron",
      "x-ourmu-dispatch-id": DISPATCH_ID,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      trigger: "pg_cron",
      runRecorded: true,
    });
    expect(body).not.toHaveProperty("health");
    expect(body).not.toHaveProperty("healthError");
    expect(mocks.calls).toEqual(["processDueJobs", "record_job_worker_run"]);
    expect(recorded()).toMatchObject({
      route: "jobs",
      trigger: "pg_cron",
      request_id: body.requestId,
      dispatch_id: DISPATCH_ID,
      ok: true,
      error_code: null,
      health_checked_at: null,
    });
  });

  it("reads watchdog health before draining and records the run last", async () => {
    const response = await post({
      authorization: `Bearer ${CRON}`,
      "x-ourmu-trigger": "github",
      "x-ourmu-dispatch-id": DISPATCH_ID,
    });
    expect(response.status).toBe(200);
    expect(mocks.calls).toEqual([
      "job_dispatch_health",
      "processDueJobs",
      "record_job_worker_run",
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith("job_dispatch_health", {
      p_since_last_watchdog: true,
    });
    expect(mocks.process).toHaveBeenCalledWith(10, undefined, {
      drainQueue: true,
    });
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      trigger: "github",
      health: { generatedAt: GENERATED_AT, status: "ok" },
      runRecorded: true,
    });
    // A CRON_SECRET caller never carries a dispatch id.
    expect(recorded()).toMatchObject({
      trigger: "github",
      dispatch_id: null,
      health_checked_at: GENERATED_AT,
    });
  });

  it("reads the 24-hour view of health for manual runs", async () => {
    await post({
      authorization: `Bearer ${CRON}`,
      "x-ourmu-trigger": "manual",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("job_dispatch_health", {
      p_since_last_watchdog: false,
    });
    expect(recorded()).toMatchObject({ trigger: "manual" });
  });

  it("answers 503 and records a failed run when the worker throws", async () => {
    mocks.process.mockRejectedValue(new Error("JOB_FETCH_FAILED"));
    const response = await post({
      authorization: `Bearer ${CRON}`,
      "x-ourmu-trigger": "github",
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({
      ok: false,
      trigger: "github",
      error: "JOB_FETCH_FAILED",
      health: { status: "ok" },
      runRecorded: true,
    });
    expect(body).not.toHaveProperty("jobs");
    expect(recorded()).toMatchObject({
      ok: false,
      error_code: "JOB_FETCH_FAILED",
      claimed: 0,
      remaining_due: null,
    });
  });

  it("still drains when health cannot be read", async () => {
    mocks.healthError = true;
    const response = await post({
      authorization: `Bearer ${CRON}`,
      "x-ourmu-trigger": "github",
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, healthError: "JOB_HEALTH_FAILED" });
    expect(body).not.toHaveProperty("health");
    expect(mocks.process).toHaveBeenCalledOnce();
    expect(recorded()).toMatchObject({ health_checked_at: null });
  });

  it("reports a run it could not record", async () => {
    mocks.recordError = true;
    const response = await post({
      authorization: `Bearer ${JOB}`,
      "x-ourmu-dispatch-id": DISPATCH_ID,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      runRecorded: false,
    });
    expect(console.error).toHaveBeenCalledWith(
      "jobs.worker_run.record_failed",
      { route: "jobs", trigger: "pg_cron", code: "23514" },
    );
  });

  it("returns every counter the dispatcher scores", async () => {
    const response = await post({
      authorization: `Bearer ${JOB}`,
      "x-ourmu-dispatch-id": DISPATCH_ID,
    });
    const body = await response.json();
    for (const counter of [
      "claimed",
      "recoveredLeases",
      "processableDueBefore",
      "expiredLeasesBefore",
      "remainingProcessableDue",
      "remainingExpiredLeases",
    ])
      expect(Number.isInteger(body.jobs[counter])).toBe(true);
  });

  it("exports POST only, so GET answers 405", () => {
    expect(Object.keys(route).sort()).toEqual([
      "POST",
      "dynamic",
      "maxDuration",
    ]);
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.maxDuration).toBe(60);
  });
});

describe("worker run record", () => {
  it("emits exactly the keys public.record_job_worker_run reads", () => {
    const record = workerRunRecord({
      route: "jobs",
      trigger: "pg_cron",
      requestId: "88000000-0000-4000-8000-0000000000aa",
      dispatchId: DISPATCH_ID,
      startedAt: new Date("2026-11-03T04:16:00Z"),
      finishedAt: new Date("2026-11-03T04:16:07Z"),
      ok: true,
      errorCode: null,
      jobs: {
        ...jobs,
        remainingExpiredLeases: 2,
        emailHold: {
          code: "EMAIL_DAILY_QUOTA_EXCEEDED",
          until: "2026-11-03T07:16:00.000Z",
        },
      },
      healthCheckedAt: GENERATED_AT,
    });
    expect(Object.keys(record).sort()).toEqual(
      [
        "route",
        "trigger",
        "request_id",
        "dispatch_id",
        "started_at",
        "finished_at",
        "ok",
        "error_code",
        "stop_reason",
        "maintenance_status",
        "claimed",
        "succeeded",
        "failed",
        "deferred",
        "skipped",
        "unclaimable",
        "provider_accepted",
        "documents_generated",
        "recipient_jobs_created",
        "recovered_leases",
        "needs_reconciliation",
        "state_errors",
        "due_before",
        "processable_due_before",
        "oldest_due_age_sec_before",
        "expired_leases_before",
        "remaining_due",
        "remaining_processable_due",
        "remaining_expired_leases",
        "oldest_due_age_sec",
        "email_hold_code",
        "email_hold_until",
        "health_checked_at",
      ].sort(),
    );
    expect(record).toMatchObject({
      started_at: "2026-11-03T04:16:00.000Z",
      finished_at: "2026-11-03T04:16:07.000Z",
      stop_reason: "queue_empty",
      maintenance_status: null,
      unclaimable: 1,
      remaining_expired_leases: 2,
      email_hold_code: "EMAIL_DAILY_QUOTA_EXCEEDED",
      email_hold_until: "2026-11-03T07:16:00.000Z",
      health_checked_at: GENERATED_AT,
    });
  });

  it("defaults counters to 0 and metrics to null without a worker result", () => {
    const record = workerRunRecord({
      route: "maintenance",
      trigger: "vercel_cron",
      requestId: "88000000-0000-4000-8000-0000000000ab",
      dispatchId: null,
      startedAt: new Date("2026-11-03T04:16:00Z"),
      finishedAt: new Date("2026-11-03T04:16:01Z"),
      ok: false,
      errorCode: "E".repeat(100),
      maintenanceStatus: "failed",
      jobs: null,
      healthCheckedAt: null,
    });
    expect(record).toMatchObject({
      error_code: "E".repeat(80),
      maintenance_status: "failed",
      stop_reason: null,
      claimed: 0,
      state_errors: 0,
      due_before: null,
      remaining_expired_leases: null,
      email_hold_code: null,
      health_checked_at: null,
    });
  });
});
