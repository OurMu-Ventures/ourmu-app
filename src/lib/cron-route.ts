import "server-only";

import type { WorkerTrigger } from "@/lib/cron-auth";
import type { Json } from "@/lib/database.types";
import { WORKER_TIME_BUDGET_MS, type ProcessDueJobsResult } from "@/lib/jobs";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export type WorkerRunRoute = "jobs" | "maintenance";
export type MaintenanceStatus = "completed" | "skipped_concurrent" | "failed";
export type WorkerRunInput = {
  route: WorkerRunRoute;
  trigger: WorkerTrigger;
  requestId: string;
  dispatchId: string | null;
  startedAt: Date;
  finishedAt: Date;
  ok: boolean;
  errorCode: string | null;
  maintenanceStatus?: MaintenanceStatus | null;
  jobs: ProcessDueJobsResult | null;
  /** The health's generatedAt when this run read health, else null. */
  healthCheckedAt: string | null;
};

// One private.job_worker_runs row, keyed exactly as
// public.record_job_worker_run reads it: counts and codes only, never
// recipients or payloads.
export function workerRunRecord(input: WorkerRunInput): {
  [key: string]: Json;
} {
  const jobs = input.jobs;
  return {
    route: input.route,
    trigger: input.trigger,
    request_id: input.requestId,
    dispatch_id: input.dispatchId,
    started_at: input.startedAt.toISOString(),
    finished_at: input.finishedAt.toISOString(),
    ok: input.ok,
    error_code: input.errorCode?.slice(0, 80) ?? null,
    stop_reason: jobs?.stopReason ?? null,
    maintenance_status: input.maintenanceStatus ?? null,
    claimed: jobs?.claimed ?? 0,
    succeeded: jobs?.succeeded ?? 0,
    failed: jobs?.failed ?? 0,
    deferred: jobs?.deferred ?? 0,
    skipped: jobs?.skipped ?? 0,
    unclaimable: jobs?.unclaimable ?? 0,
    provider_accepted: jobs?.providerAccepted ?? 0,
    documents_generated: jobs?.documentsGenerated ?? 0,
    recipient_jobs_created: jobs?.recipientJobsCreated ?? 0,
    recovered_leases: jobs?.recoveredLeases ?? 0,
    needs_reconciliation: jobs?.needsReconciliation ?? 0,
    state_errors: jobs?.stateErrors ?? 0,
    due_before: jobs?.dueBefore ?? null,
    processable_due_before: jobs?.processableDueBefore ?? null,
    oldest_due_age_sec_before: jobs?.oldestDueAgeSecBefore ?? null,
    expired_leases_before: jobs?.expiredLeasesBefore ?? null,
    remaining_due: jobs?.remainingDue ?? null,
    remaining_processable_due: jobs?.remainingProcessableDue ?? null,
    remaining_expired_leases: jobs?.remainingExpiredLeases ?? null,
    oldest_due_age_sec: jobs?.oldestDueAgeSec ?? null,
    email_hold_code: jobs?.emailHold?.code ?? null,
    email_hold_until: jobs?.emailHold?.until ?? null,
    health_checked_at: input.healthCheckedAt,
  };
}

/** Records the run in private.job_worker_runs; false when it was not recorded. Never throws. */
export async function recordWorkerRun(
  admin: AdminClient,
  input: WorkerRunInput,
): Promise<boolean> {
  let code: string;
  try {
    const { error } = await admin.rpc("record_job_worker_run", {
      p_run: workerRunRecord(input),
    });
    if (!error) return true;
    code = error.code || "unknown";
  } catch {
    code = "exception";
  }
  console.error("jobs.worker_run.record_failed", {
    route: input.route,
    trigger: input.trigger,
    code,
  });
  return false;
}

/** Reads public.job_dispatch_health; checkedAt is its generatedAt. Never throws. */
export async function readJobDispatchHealth(
  admin: AdminClient,
  sinceLastWatchdog: boolean,
): Promise<
  | { health: Json; checkedAt: string | null }
  | { healthError: "JOB_HEALTH_FAILED" }
> {
  let code: string;
  try {
    const { data, error } = await admin.rpc("job_dispatch_health", {
      p_since_last_watchdog: sinceLastWatchdog,
    });
    if (!error) {
      const generatedAt =
        data && typeof data === "object" && !Array.isArray(data)
          ? data.generatedAt
          : null;
      return {
        health: data,
        checkedAt: typeof generatedAt === "string" ? generatedAt : null,
      };
    }
    code = error.code || "unknown";
  } catch {
    code = "exception";
  }
  console.error("jobs.health.read_failed", { code });
  return { healthError: "JOB_HEALTH_FAILED" };
}

// The maintenance route drains with what remains of the worker's time budget
// after maintenance, never less than 5 s.
export function maintenanceDrainBudgetMs(
  startedAtMs: number,
  nowMs = Date.now(),
): number {
  return Math.max(5_000, WORKER_TIME_BUDGET_MS - (nowMs - startedAtMs));
}

export function noStoreJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
