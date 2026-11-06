import { cleanupDepositSlips } from "@/lib/deposit-slips";
import { randomUUID } from "node:crypto";
import {
  authorizeCronRequest,
  dispatchIdFrom,
  identifyTrigger,
} from "@/lib/cron-auth";
import {
  noStoreJson,
  readJobDispatchHealth,
  recordWorkerRun,
} from "@/lib/cron-route";
import { processDueJobs, type ProcessDueJobsResult } from "@/lib/jobs";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The Supabase Cron dispatcher calls this with JOB_TRIGGER_SECRET while work
// is due; the hourly ourmu-ops watchdog and manual runs use CRON_SECRET.
// Successive batches of 10 (up to 50 jobs or 40s) let document generation,
// recipient creation, and email delivery complete in the same run when time
// permits. The dispatcher scores each run from ok and the jobs counters.
export async function POST(request: Request) {
  const requestId = randomUUID();
  const caller = authorizeCronRequest(request, [
    "CRON_SECRET",
    "JOB_TRIGGER_SECRET",
  ]);
  if (!caller) return noStoreJson({ error: "unauthorized", requestId }, 401);
  const trigger = identifyTrigger(request, caller);
  const dispatchId = dispatchIdFrom(request, trigger);
  const startedAt = new Date();

  let admin: ReturnType<typeof createAdminClient> | null = null;
  try {
    admin = createAdminClient();
  } catch {
    // processDueJobs then fails on its own and the route answers 503.
  }

  // Health is read before the drain, which would otherwise hide the work the
  // dispatcher left waiting. The dispatcher's own runs skip it.
  const healthRead =
    admin && trigger !== "pg_cron"
      ? await readJobDispatchHealth(admin, trigger === "github")
      : null;

  let jobs: ProcessDueJobsResult | null = null;
  let errorCode: string | null = null;
  try {
    jobs = await processDueJobs(10, undefined, { drainQueue: true });
  } catch (error) {
    errorCode =
      error instanceof Error ? error.message.slice(0, 80) : "WORKER_FAILED";
  }
  const depositSlips = await cleanupDepositSlips().catch(() => ({
    deleted: 0,
    failed: 1,
  }));
  if (depositSlips.failed > 0 && errorCode === null)
    errorCode = "DEPOSIT_SLIP_CLEANUP_FAILED";
  const finishedAt = new Date();

  // Recorded last: the next watchdog run counts only events after this row,
  // and this run's own result already reports its drain.
  const runRecorded = admin
    ? await recordWorkerRun(admin, {
        route: "jobs",
        trigger,
        requestId,
        dispatchId,
        startedAt,
        finishedAt,
        ok: errorCode === null,
        errorCode,
        jobs,
        healthCheckedAt:
          healthRead && "health" in healthRead ? healthRead.checkedAt : null,
      })
    : false;

  // health describes the queue and the dispatcher before this run's drain.
  const health = !healthRead
    ? {}
    : "health" in healthRead
      ? { health: healthRead.health }
      : { healthError: healthRead.healthError };
  if (errorCode !== null)
    return noStoreJson(
      {
        ok: false,
        requestId,
        trigger,
        error: errorCode,
        ...health,
        runRecorded,
      },
      503,
    );
  return noStoreJson({
    ok: true,
    requestId,
    trigger,
    jobs,
    depositSlips,
    ...health,
    runRecorded,
  });
}
