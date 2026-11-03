import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProcessDueJobsResult } from "@/lib/jobs";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  process: vi.fn(),
  rpc: vi.fn(),
  maintenance: { data: null, error: null } as {
    data: unknown;
    error: unknown;
  },
  maintenanceMs: 0,
}));
vi.mock("@/lib/jobs", () => ({
  WORKER_TIME_BUDGET_MS: 40_000,
  processDueJobs: mocks.process,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));
import * as route from "@/app/api/cron/maintenance/route";
import { GET, POST } from "@/app/api/cron/maintenance/route";

const CRON = "cron-secret-for-unit-tests-".padEnd(40, "0");
const JOB = "job-trigger-secret-for-unit-tests-".padEnd(48, "0");
const GENERATED_AT = "2026-11-03T04:17:00.123456+00:00";
const completed = {
  expired: 0,
  matured: 1,
  anonymized: 0,
  maturity_emails: 1,
  auto_reinvested: 0,
  pending_followup: 0,
  awaiting_actual_return: 0,
};

const jobs = {
  claimed: 1,
  succeeded: 1,
  failed: 0,
  stopReason: "queue_empty",
} as ProcessDueJobsResult;

function call(
  handler: typeof GET,
  headers: Record<string, string> = { authorization: `Bearer ${CRON}` },
  method = "GET",
) {
  return handler(
    new Request("https://partners.example.test/api/cron/maintenance", {
      method,
      headers,
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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-03T04:16:00Z"));
  vi.stubEnv("CRON_SECRET", CRON);
  vi.stubEnv("JOB_TRIGGER_SECRET", JOB);
  mocks.calls = [];
  mocks.maintenance = { data: completed, error: null };
  mocks.maintenanceMs = 3_000;
  mocks.process.mockReset().mockImplementation(async () => {
    mocks.calls.push("processDueJobs");
    return jobs;
  });
  mocks.rpc.mockReset().mockImplementation(async (name: string) => {
    mocks.calls.push(name);
    if (name === "run_maintenance_exclusive") {
      vi.setSystemTime(Date.now() + mocks.maintenanceMs);
      return mocks.maintenance;
    }
    if (name === "job_dispatch_health")
      return { data: { generatedAt: GENERATED_AT, status: "ok" }, error: null };
    if (name === "record_job_worker_run") return { data: 1, error: null };
    return { data: null, error: { code: "PGRST202", message: "unknown" } };
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("/api/cron/maintenance", () => {
  it("handles GET (Vercel Cron) and POST (fallback) the same way", async () => {
    const viaGet = await call(GET);
    const viaPost = await call(POST, undefined, "POST");
    const [getBody, postBody] = [await viaGet.json(), await viaPost.json()];
    expect(viaGet.status).toBe(200);
    expect(viaPost.status).toBe(200);
    expect(viaGet.headers.get("Cache-Control")).toBe("no-store");
    expect(viaPost.headers.get("Cache-Control")).toBe("no-store");
    expect({ ...getBody, requestId: null }).toEqual({
      ...postBody,
      requestId: null,
    });
    expect(getBody).toMatchObject({
      ok: true,
      trigger: "unknown",
      maintenance: completed,
      jobs,
      health: { generatedAt: GENERATED_AT },
      runRecorded: true,
    });
    expect(Object.keys(route).sort()).toEqual([
      "GET",
      "POST",
      "dynamic",
      "maxDuration",
    ]);
  });

  it("rejects the dispatcher secret", async () => {
    const response = await call(GET, { authorization: `Bearer ${JOB}` });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "unauthorized",
      requestId: expect.any(String),
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it("identifies Vercel Cron and passes the request id to maintenance", async () => {
    const response = await call(GET, {
      authorization: `Bearer ${CRON}`,
      "user-agent": "vercel-cron/1.0",
    });
    const body = await response.json();
    expect(body.trigger).toBe("vercel_cron");
    expect(mocks.rpc).toHaveBeenCalledWith("run_maintenance_exclusive", {
      p_request_id: body.requestId,
    });
    expect(recorded()).toMatchObject({
      route: "maintenance",
      trigger: "vercel_cron",
      request_id: body.requestId,
      dispatch_id: null,
      ok: true,
      maintenance_status: "completed",
      health_checked_at: GENERATED_AT,
    });
  });

  it("drains after a concurrent duplicate was skipped", async () => {
    mocks.maintenance = { data: { skipped: "concurrent" }, error: null };
    const response = await call(POST, undefined, "POST");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      maintenance: { skipped: "concurrent" },
      jobs,
    });
    expect(mocks.process).toHaveBeenCalledOnce();
    expect(recorded()).toMatchObject({
      ok: true,
      maintenance_status: "skipped_concurrent",
      error_code: null,
    });
  });

  it("still drains after maintenance fails and records the failure", async () => {
    mocks.maintenance = {
      data: null,
      error: { code: "57014", message: "canceling statement" },
    };
    const response = await call(GET);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "maintenance_failed",
      maintenance: null,
      jobs,
      runRecorded: true,
    });
    expect(mocks.process).toHaveBeenCalledOnce();
    expect(recorded()).toMatchObject({
      ok: false,
      error_code: "maintenance_failed",
      maintenance_status: "failed",
      claimed: 1,
    });
  });

  it("reports a drain failure after completed maintenance", async () => {
    mocks.process.mockRejectedValue(new Error("JOB_FETCH_FAILED"));
    const response = await call(GET);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "JOB_FETCH_FAILED",
      maintenance: completed,
      jobs: null,
    });
    expect(recorded()).toMatchObject({
      ok: false,
      error_code: "JOB_FETCH_FAILED",
      maintenance_status: "completed",
    });
  });

  it.each([
    [12_000, 28_000],
    [38_000, 5_000],
  ])(
    "gives the drain what remains of 40 s after %i ms of maintenance",
    async (maintenanceMs, budgetMs) => {
      mocks.maintenanceMs = maintenanceMs;
      await call(GET);
      expect(mocks.process).toHaveBeenCalledWith(10, undefined, {
        drainQueue: true,
        timeBudgetMs: budgetMs,
      });
    },
  );

  it("reads 24-hour health after the drain", async () => {
    await call(GET);
    expect(mocks.calls).toEqual([
      "run_maintenance_exclusive",
      "processDueJobs",
      "job_dispatch_health",
      "record_job_worker_run",
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith("job_dispatch_health", {
      p_since_last_watchdog: false,
    });
  });
});
