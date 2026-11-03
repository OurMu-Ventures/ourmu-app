import { z } from "zod";

type HealthIssue = { code: string; detail: string };

/** public.job_dispatch_health's JSON. Timestamps are ISO strings with offset; null when unknown. */
export type JobDispatchHealth = {
  generatedAt: string;
  status: "ok" | "warn" | "fail";
  problems: HealthIssue[];
  warnings: HealthIssue[];
  thresholds: {
    tickStaleSec: number;
    processableDueAgeSec: number;
    expiredLeaseAgeSec: number;
    consecutiveFailures: number;
    pgNetOutstandingSec: number;
    maintenanceAgeSec: number;
    deadWindowHours: number;
  };
  dispatcher: {
    configured: boolean;
    cronInstalled: boolean;
    scheduled: boolean;
    cronLastRunStatus: string | null;
    cronLastRunAgeSec: number | null;
    lastTickAt: string | null;
    lastTickAgeSec: number | null;
    lastReason: string;
    lastDispatchAt: string | null;
    lastDispatchAgeSec: number | null;
    lastOutcome: string | null;
    lastHttpStatus: number | null;
    lastSuccessAt: string | null;
    consecutiveFailures: number;
    noProgressStreak: number;
    noProgressUntil: string | null;
    lastError: string | null;
  };
  pgNet: {
    installed: boolean;
    workerRunning: boolean | null;
    queueDepth: number | null;
    outstandingRequestId: number | null;
    outstandingQueued: boolean;
    outstandingAgeSec: number | null;
  };
  queue: {
    dueCount: number;
    processableDueCount: number;
    oldestDueAgeSec: number | null;
    oldestProcessableDueAgeSec: number | null;
    expiredLeaseCount: number;
    oldestExpiredLeaseAgeSec: number | null;
    emailHold: { code: string; until: string; heldCount: number } | null;
  };
  jobs: {
    /** Dead in 24 h, excluding *_CANCELLED codes and deliberate drops. */
    dead24h: number;
    dead24hByCode: Record<string, number>;
    /** Dead in 24 h with *_CANCELLED codes or deliberate drops: shown, never alerted. */
    dropped24h: number;
    deadWindowSince: string;
    deadInWindow: number;
    openReconciliation: number;
  };
  workerRuns: {
    since: string;
    runs: number;
    notOk: number;
    failed: number;
    stateErrors: number;
    needsReconciliation: number;
    unclaimable: number;
    lastRunAt: string | null;
    lastRunTrigger: string | null;
  };
  maintenance: { lastCompletedAt: string | null; ageSec: number | null };
};

const timestamp = z.iso.datetime({ offset: true });
const issue = z.looseObject({ code: z.string(), detail: z.string() });

// Validates the fields Admin > Jobs renders; the others pass through as sent.
export const jobDispatchHealthSchema = z.looseObject({
  status: z.enum(["ok", "warn", "fail"]),
  problems: z.array(issue),
  warnings: z.array(issue),
  dispatcher: z.looseObject({
    configured: z.boolean(),
    cronInstalled: z.boolean(),
    scheduled: z.boolean(),
    cronLastRunStatus: z.string().nullable(),
    cronLastRunAgeSec: z.int().nullable(),
    lastTickAt: timestamp.nullable(),
    lastTickAgeSec: z.int().nullable(),
    lastReason: z.string(),
    lastDispatchAt: timestamp.nullable(),
    lastDispatchAgeSec: z.int().nullable(),
    lastOutcome: z.string().nullable(),
    lastHttpStatus: z.int().nullable(),
    lastSuccessAt: timestamp.nullable(),
    consecutiveFailures: z.int(),
    noProgressStreak: z.int(),
    noProgressUntil: timestamp.nullable(),
    lastError: z.string().nullable(),
  }),
  pgNet: z.looseObject({
    workerRunning: z.boolean().nullable(),
    queueDepth: z.int().nullable(),
    outstandingRequestId: z.int().nullable(),
    outstandingAgeSec: z.int().nullable(),
  }),
  queue: z.looseObject({
    emailHold: z
      .looseObject({ code: z.string(), until: timestamp, heldCount: z.int() })
      .nullable(),
    oldestProcessableDueAgeSec: z.int().nullable(),
  }),
  jobs: z.looseObject({
    dead24h: z.int(),
    dropped24h: z.int(),
    openReconciliation: z.int(),
  }),
  maintenance: z.looseObject({
    lastCompletedAt: timestamp.nullable(),
    ageSec: z.int().nullable(),
  }),
});

export function parseJobDispatchHealth(
  value: unknown,
): JobDispatchHealth | null {
  const parsed = jobDispatchHealthSchema.safeParse(value);
  // Only the rendered fields are checked; the rest are typed as the RPC
  // defines them.
  return parsed.success ? (parsed.data as JobDispatchHealth) : null;
}
