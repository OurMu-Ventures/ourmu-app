import { randomUUID } from "node:crypto";
import { authorizeCronRequest, identifyTrigger } from "@/lib/cron-auth";
import {
  maintenanceDrainBudgetMs,
  noStoreJson,
  readJobDispatchHealth,
  recordWorkerRun,
  type MaintenanceStatus,
} from "@/lib/cron-route";
import type { Json } from "@/lib/database.types";
import { processDueJobs, type ProcessDueJobsResult } from "@/lib/jobs";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel Cron calls GET once a day (04:00-04:59 UTC); the ourmu-ops
// maintenance.yml fallback and manual runs use POST. CRON_SECRET only.
export async function GET(request: Request) {
  return runMaintenance(request);
}

export async function POST(request: Request) {
  return runMaintenance(request);
}

async function runMaintenance(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const caller = authorizeCronRequest(request, ["CRON_SECRET"]);
  if (!caller) return noStoreJson({ error: "unauthorized", requestId }, 401);
  const trigger = identifyTrigger(request, caller);
  const startedAt = new Date();

  let admin: ReturnType<typeof createAdminClient> | null = null;
  try {
    admin = createAdminClient();
  } catch {
    // Maintenance fails and processDueJobs fails on its own: 503.
  }

  // run_maintenance under advisory try-lock 87005/2: a concurrent duplicate
  // (Vercel may deliver twice, the fallback may overlap) is skipped.
  let maintenanceStatus: MaintenanceStatus = "failed";
  let maintenance: Json = null;
  if (admin) {
    try {
      const { data, error } = await admin.rpc("run_maintenance_exclusive", {
        p_request_id: requestId,
      });
      if (!error) {
        maintenance = data;
        maintenanceStatus =
          data !== null &&
          typeof data === "object" &&
          !Array.isArray(data) &&
          data.skipped === "concurrent"
            ? "skipped_concurrent"
            : "completed";
      }
    } catch {
      // Same as an RPC error: maintenance failed and the drain still runs.
    }
  }

  // Always drain, even after a maintenance failure, so email never waits on
  // maintenance. The drain gets what remains of the worker's time budget.
  let jobs: ProcessDueJobsResult | null = null;
  let drainError: string | null = null;
  try {
    jobs = await processDueJobs(10, undefined, {
      drainQueue: true,
      timeBudgetMs: maintenanceDrainBudgetMs(startedAt.getTime()),
    });
  } catch (error) {
    drainError =
      error instanceof Error ? error.message.slice(0, 80) : "WORKER_FAILED";
  }
  const finishedAt = new Date();

  // Informational only: nothing alerts on this route's health.
  const healthRead = admin ? await readJobDispatchHealth(admin, false) : null;
  const errorCode =
    maintenanceStatus === "failed" ? "maintenance_failed" : drainError;
  const runRecorded = admin
    ? await recordWorkerRun(admin, {
        route: "maintenance",
        trigger,
        requestId,
        dispatchId: null,
        startedAt,
        finishedAt,
        ok: errorCode === null,
        errorCode,
        maintenanceStatus,
        jobs,
        healthCheckedAt:
          healthRead && "health" in healthRead ? healthRead.checkedAt : null,
      })
    : false;

  const health = !healthRead
    ? {}
    : "health" in healthRead
      ? { health: healthRead.health }
      : { healthError: healthRead.healthError };
  const body = {
    requestId,
    trigger,
    maintenance,
    jobs,
    ...health,
    runRecorded,
  };
  if (errorCode !== null)
    return noStoreJson({ ok: false, ...body, error: errorCode }, 503);
  return noStoreJson({ ok: true, ...body });
}
