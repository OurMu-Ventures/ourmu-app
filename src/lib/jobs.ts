import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { guardOperation, runBoundedOperation } from "@/lib/jobs/operation";

import { randomUUID } from "node:crypto";
import {
  deferralCode,
  deferRetryAt,
  EmailBudgetDeferredError,
  EmailRateLimitError,
  isEmailDeferralError,
  type EmailDeferralCode,
} from "@/lib/email/quota";

import { investmentReturnView } from "@/lib/actual-returns";
import { buildAgreementPdf } from "@/lib/agreements/pdf";
import { sendTransactionalEmail, type EmailTemplate } from "@/lib/email/send";
import { getPublicEnv } from "@/lib/env";
import { bpsToPercent, date, ugx } from "@/lib/format";
import {
  safeFulfilledSplits,
  UNAVAILABLE_MATURITY_AMOUNTS,
  maturityChoiceLabel,
  maturityInstructionTerms,
  maturityNoticeDetail,
  maturityPayoutDateIso,
  type MaturityChoice,
  type MaturityNoticeInput,
} from "@/lib/maturity";
import { ensureReceiptPdf, type ReceiptRow } from "@/lib/receipts/generate";
import { formatUgxExact } from "@/lib/receipts/format";
import { createAdminClient } from "@/lib/supabase/admin";

const MATURITY_TEMPLATES: EmailTemplate[] = [
  "maturity_notice",
  "maturity_choice_confirmed",
  "maturity_action_needed",
  "maturity_fulfilled",
];

export type JobRow = {
  id: string;
  kind: string;
  status: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  created_at: string;
  provider_message_id?: string | null;
  first_send_attempt_at?: string | null;
  send_attempts?: number;
  claim_token?: string | null;
  lease_expires_at?: string | null;
  available_at?: string | null;
  last_error_code?: string | null;
};

// Queue-draining budgets for the free-tier worker. Supabase Cron dispatches it
// every 2 minutes while work is due; an hourly watchdog and the daily
// maintenance run drain as fallbacks. Each invocation processes successive
// small batches so newly created receipt and email jobs can run immediately,
// stopping when the queue is empty, the job budget is reached, or the time
// budget elapses. No new job starts after the deadline.
export const JOB_BATCH_SIZE = 10;
export const MAX_JOBS_PER_RUN = 50;
export const WORKER_TIME_BUDGET_MS = 40_000;
export const JOB_LEASE_MS = 5 * 60 * 1000;
export const PROVIDER_PACING_MS = 1000;
export const JOB_OPERATION_TIMEOUT_MS = 25_000;

export type StopReason = "queue_empty" | "job_budget" | "time_budget" | "single_batch";

export type ProcessDueJobsOptions = {
  /** Fetch successive batches until the queue is empty or a budget hits. */
  drainQueue?: boolean;
  batchSize?: number;
  maxJobs?: number;
  timeBudgetMs?: number;
  /** Milliseconds between provider send attempts (default 1000). */
  pacingMs?: number;
  /** Per-job operation timeout in ms (default 25000). */
  jobTimeoutMs?: number;
};

export type ProcessDueJobsResult = {
  processed: number;
  succeeded: number;
  failed: number;
  deferred: number;
  /** Jobs claimed with a lease token this run. */
  claimed: number;
  /** Skipped: lost claims, stale completions, suppressed deliveries, deliberate drops. */
  skipped: number;
  /** Distinct due jobs whose claim matched no row this run. */
  unclaimable: number;
  /** Provider-accepted sends (Resend id returned), distinct from delivery. */
  providerAccepted: number;
  documentsGenerated: number;
  recipientJobsCreated: number;
  recoveredLeases: number;
  needsReconciliation: number;
  /** Database state-transition failures (completion/record writes). */
  stateErrors: number;
  /** Before the drain: all due jobs, including emails held by a deferral. */
  dueBefore: number;
  /** Before the drain: due jobs the worker may process (held emails excluded). */
  processableDueBefore: number;
  /** Before the drain: seconds since the oldest processable job became due. */
  oldestDueAgeSecBefore: number | null;
  /** Before the drain: expired leases the recovery step could not recover. */
  expiredLeasesBefore: number;
  /** After the drain: all due jobs, including held emails. */
  remainingDue: number;
  /** After the drain: due jobs the worker may process. */
  remainingProcessableDue: number;
  /** After the drain: running jobs whose lease has expired. */
  remainingExpiredLeases: number;
  /**
   * After the drain: seconds since the oldest processable job became due
   * (available_at, not created_at), held emails excluded.
   */
  oldestDueAgeSec: number | null;
  /** After the drain: the active email deferral, if any. */
  emailHold: EmailHold | null;
  stopReason: StopReason;
};

export type EmailHold = { code: EmailDeferralCode; until: string };

export type QueueSnapshot = {
  snapshotAt: string;
  emailHold: (EmailHold & { heldCount: number }) | null;
  dueCount: number;
  processableDueCount: number;
  oldestDueAt: string | null;
  oldestProcessableDueAt: string | null;
  newestReadyAt: string | null;
  expiredLeaseCount: number;
  oldestExpiredLeaseAt: string | null;
};

// public.job_queue_snapshot's row. The generated types mark every column
// non-null, but the timestamps and the hold are null when there is nothing
// to report.
type QueueSnapshotRow = {
  snapshot_at: string;
  email_hold_code: string | null;
  email_hold_until: string | null;
  held_email_count: number;
  due_count: number;
  processable_due_count: number;
  oldest_due_at: string | null;
  oldest_processable_due_at: string | null;
  newest_ready_at: string | null;
  expired_lease_count: number;
  oldest_expired_lease_at: string | null;
};

// Retry delays after failures 1-7: 5, 15, 45, 135, 300, 300 and 300 minutes,
// 18 h 20 min in total, inside Resend's 24h idempotency window (see
// IDEMPOTENCY_WINDOW_MS) so retries of an ambiguous send keep their key.
// Deferrals (quota, rate limit, budget) consume no attempts.
export const RETRY_BASE_DELAY_MS = 5 * 60 * 1000;
export const RETRY_BACKOFF_FACTOR = 3;
export const RETRY_MAX_DELAY_MS = 5 * 60 * 60 * 1000;
export const DEFAULT_MAX_ATTEMPTS = 8;

export function retryDelayMs(attemptsBeforeClaim: number): number {
  return Math.min(
    RETRY_MAX_DELAY_MS,
    RETRY_BASE_DELAY_MS *
      RETRY_BACKOFF_FACTOR **
        Math.min(Math.max(0, Math.floor(attemptsBeforeClaim)), 10),
  );
}

export function retryScheduleTotalMs(
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): number {
  let total = 0;
  for (let attempts = 0; attempts <= maxAttempts - 2; attempts += 1)
    total += retryDelayMs(attempts);
  return total;
}

/** Terminal codes for emails deliberately not sent because they are no longer relevant.
 *  Mirrored after the marker comment in public.job_dispatch_health (parity unit test). */
export const DELIBERATE_DROP_CODES = [
  "RESERVATION_NOT_FOUND",
  "STALE_MATURITY_CONFIRMATION",
  "STALE_RESERVATION",
] as const;
export type DeliberateDropCode = (typeof DELIBERATE_DROP_CODES)[number];

export function isDeliberateDropCode(
  value: unknown,
): value is DeliberateDropCode {
  return DELIBERATE_DROP_CODES.some((code) => code === value);
}

export type SendEmailPayload = {
  template?: EmailTemplate;
  to?: string;
  cc?: string[];
  bcc?: string[];
  actionUrl?: string;
  // Queued notices (e.g. primary-email change confirmations) carry their own
  // body; investment templates still compute theirs at send time.
  detail?: string;
  accountEmailId?: string;
  receiptId?: string;
  idempotencyKey?: string;
  routing?: {
    revision: number;
    cc: string[];
    replyTo: string[];
    teamCopySelected: boolean;
  };
};

// Resend honours an idempotency key for 24h. A retry outside that window
// with an ambiguous prior send must reconcile before resending.
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

// Pure reconciliation decision, unit-tested. Keys off the first actual
// provider send attempt — never job creation — so jobs that failed before
// ever sending stay retryable, and only genuinely ambiguous sends block.
export function needsReconciliation(input: {
  firstSendAttemptAt?: string | null;
  providerMessageId?: string | null;
  nowMs?: number;
}): boolean {
  if (input.providerMessageId) return false;
  if (!input.firstSendAttemptAt) return false;
  const now = input.nowMs ?? Date.now();
  return (
    now - new Date(input.firstSendAttemptAt).getTime() > IDEMPOTENCY_WINDOW_MS
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const operationScope = new AsyncLocalStorage<AbortSignal>();

function jobAdminClient() {
  const signal = operationScope.getStore();
  const admin = createAdminClient(signal);
  return signal ? guardOperation(admin, signal) : admin;
}

async function withJobTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  return runBoundedOperation(
    (signal) => operationScope.run(signal, operation), timeoutMs,
  );
}

// Recover workers that died mid-job: running rows whose five-minute lease
// expired return to pending with their attempts intact. Document jobs retry
// safely; ambiguous email sends retry with their original idempotency key
// inside its validity window (see needsReconciliation) and quarantine after.
async function recoverExpiredLeases(
  admin: ReturnType<typeof createAdminClient>,
): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("jobs")
    .update({
      status: "pending",
      locked_at: null,
      claim_token: null,
      lease_expires_at: null,
      available_at: now,
    })
    .eq("status", "running")
    .lt("lease_expires_at", now)
    .select("id");
  if (error) throw new Error("JOB_LEASE_RECOVERY_FAILED");
  return ((data ?? []) as unknown[]).length;
}

export function recipientsForPayload(payload: SendEmailPayload): number {
  const cc = payload.routing?.cc?.length ?? payload.cc?.length ?? 0;
  return 1 + cc + (payload.bcc?.length ?? 0);
}

// The queue as public.job_queue_snapshot sees it: the single definition of
// the email hold, due, processable and expired-lease work, shared with the
// Supabase Cron dispatcher and the health RPC. The hold is global; due work
// and leases are filtered by campaign when one is given.
export async function fetchQueueSnapshot(
  admin: ReturnType<typeof createAdminClient>,
  campaignId?: string,
): Promise<QueueSnapshot> {
  const { data, error } = await admin.rpc(
    "job_queue_snapshot",
    campaignId ? { p_campaign_id: campaignId } : {},
  );
  const row: QueueSnapshotRow | undefined = Array.isArray(data)
    ? data[0]
    : undefined;
  if (error || !row) throw new Error("JOB_QUEUE_SNAPSHOT_FAILED");
  return {
    snapshotAt: row.snapshot_at,
    // Fail closed: any hold the database reports pauses email. The parity
    // unit test keeps its codes equal to EMAIL_DEFERRAL_CODES.
    emailHold:
      row.email_hold_code === null
        ? null
        : {
            code: row.email_hold_code as EmailDeferralCode,
            until: row.email_hold_until ?? row.snapshot_at,
            heldCount: row.held_email_count,
          },
    dueCount: row.due_count,
    processableDueCount: row.processable_due_count,
    oldestDueAt: row.oldest_due_at,
    oldestProcessableDueAt: row.oldest_processable_due_at,
    newestReadyAt: row.newest_ready_at,
    expiredLeaseCount: row.expired_lease_count,
    oldestExpiredLeaseAt: row.oldest_expired_lease_at,
  };
}

// Whole seconds from a snapshot timestamp back to the snapshot time, on the
// database clock.
function snapshotAgeSec(snapshot: QueueSnapshot, at: string | null) {
  return at === null
    ? null
    : Math.max(
        0,
        Math.floor((Date.parse(snapshot.snapshotAt) - Date.parse(at)) / 1000),
      );
}

// Campaign worker compatibility: processDueJobs(limit, campaignId?) keeps its
// historical single-batch behaviour unless options.drainQueue is set. The cron
// endpoint enables draining so successive batches (including newly created
// receipt and email jobs) run in the same invocation.
export async function processDueJobs(
  limit = 10,
  campaignId?: string,
  options: ProcessDueJobsOptions = {},
): Promise<ProcessDueJobsResult> {
  const admin = createAdminClient();
  const batchSize = Math.max(1, Math.min(limit, options.batchSize ?? JOB_BATCH_SIZE));
  const maxJobs = options.maxJobs ?? MAX_JOBS_PER_RUN;
  const timeBudgetMs = options.timeBudgetMs ?? WORKER_TIME_BUDGET_MS;
  const pacingMs = options.pacingMs ?? PROVIDER_PACING_MS;
  const jobTimeoutMs = options.jobTimeoutMs ?? JOB_OPERATION_TIMEOUT_MS;
  const drainQueue = options.drainQueue ?? false;

  const result: ProcessDueJobsResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    deferred: 0,
    claimed: 0,
    skipped: 0,
    unclaimable: 0,
    providerAccepted: 0,
    documentsGenerated: 0,
    recipientJobsCreated: 0,
    recoveredLeases: 0,
    needsReconciliation: 0,
    stateErrors: 0,
    dueBefore: 0,
    processableDueBefore: 0,
    oldestDueAgeSecBefore: null,
    expiredLeasesBefore: 0,
    remainingDue: 0,
    remainingProcessableDue: 0,
    remainingExpiredLeases: 0,
    oldestDueAgeSec: null,
    emailHold: null,
    stopReason: drainQueue ? "queue_empty" : "single_batch",
  };

  const startedAt = Date.now();
  const deadline = startedAt + timeBudgetMs;

  result.recoveredLeases = await recoverExpiredLeases(admin);

  const before = await fetchQueueSnapshot(admin, campaignId);
  result.dueBefore = before.dueCount;
  result.processableDueBefore = before.processableDueCount;
  result.oldestDueAgeSecBefore = snapshotAgeSec(
    before,
    before.oldestProcessableDueAt,
  );
  result.expiredLeasesBefore = before.expiredLeaseCount;
  let emailPaused = before.emailHold !== null;

  let lastProviderSendAt = 0;
  // Due rows whose claim matched nothing (for example confirmations the
  // database refuses to claim) would refill every batch: later fetches in this
  // run exclude them, so a few cannot crowd out newer work.
  const unclaimable = new Set<string>();

  const maxBatches = drainQueue
    ? Math.ceil(maxJobs / batchSize) + 1
    : 1;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    if (Date.now() >= deadline) {
      result.stopReason = "time_budget";
      break;
    }
    let query = admin
      .from("jobs")
      .select("*")
      .in("status", ["pending", "failed"])
      .lte("available_at", new Date().toISOString());
    if (emailPaused) query = query.neq("kind", "send_email");
    if (unclaimable.size > 0) query = query.notIn("id", [...unclaimable]);
    if (campaignId)
      query = query
        .eq("entity_type", "email_campaign")
        .eq("entity_id", campaignId);
    const { data: jobs, error } = await query
      .order("created_at")
      .limit(batchSize);
    if (error) throw new Error("JOB_FETCH_FAILED");
    const due = (jobs ?? []) as JobRow[];
    if (due.length === 0) {
      // No fetchable work: the queue is empty or only holds deferred emails
      // waiting for quota. Deferred emails stay queued; the final snapshot
      // still reports them in remainingDue.
      result.stopReason = "queue_empty";
      break;
    }
    for (const raw of due) {
      if (result.claimed >= maxJobs) {
        result.stopReason = "job_budget";
        break;
      }
      if (Date.now() >= deadline) {
        result.stopReason = "time_budget";
        break;
      }
      if (emailPaused && raw.kind === "send_email") continue;
      result.processed += 1;
      // Atomic claim with a unique token and five-minute lease. A concurrent
      // worker whose UPDATE matches zero rows must skip processing, and all
      // later completion/failure writes match the token so an expired worker
      // cannot overwrite a newer attempt.
      const claimToken = randomUUID();
      const claimNow = new Date().toISOString();
      const { data: claimed, error: claimError } = await admin
        .from("jobs")
        .update({
          status: "running",
          locked_at: claimNow,
          lease_expires_at: new Date(Date.now() + JOB_LEASE_MS).toISOString(),
          claim_token: claimToken,
          attempts: raw.attempts + 1,
        })
        .eq("id", raw.id)
        .eq("attempts", raw.attempts)
        .lte("available_at", claimNow)
        .in("status", ["pending", "failed"])
        .select("id");
      if (claimError) throw new Error("JOB_CLAIM_FAILED");
      if (!claimed || (claimed as unknown[]).length === 0) {
        unclaimable.add(raw.id);
        result.skipped += 1;
        continue;
      }
      result.claimed += 1;

      // Pace provider sends to one request per second within this run.
      const claimedJob: JobRow = { ...raw, claim_token: claimToken, attempts: raw.attempts + 1 };
      const willSend =
        raw.kind === "send_email" &&
        (claimedJob.payload as SendEmailPayload).to;
      if (willSend && pacingMs > 0) {
        const wait = pacingMs - (Date.now() - lastProviderSendAt);
        if (wait > 0 && lastProviderSendAt > 0) await sleep(wait);
      }

      let providerMessageId: string | null = null;
      let outcome: EmailOutcome = { messageId: null, fanOutCount: 0, suppressed: false };
      const remainingMs = Math.max(0, deadline - Date.now());
      if (remainingMs === 0) {
        const { error: releaseError } = await admin.from("jobs").update({
          status: "pending", attempts: raw.attempts, locked_at: null,
          claim_token: null, lease_expires_at: null,
        }).eq("id", raw.id).eq("claim_token", claimToken);
        if (releaseError) throw new Error("JOB_RELEASE_FAILED");
        result.stopReason = "time_budget";
        break;
      }
      try {
        if (raw.kind === "generate_agreement_pdf") {
          await withJobTimeout(
            () => generateAgreement(raw.entity_id),
            Math.min(jobTimeoutMs, remainingMs),
          );
          result.documentsGenerated += 1;
        } else if (raw.kind === "generate_receipt_pdf") {
          await withJobTimeout(
            () => generateReceipt(raw.entity_id),
            Math.min(jobTimeoutMs, remainingMs),
          );
          result.documentsGenerated += 1;
          // Receipt generation queues its activation email for this run to pick up.
          result.recipientJobsCreated += 1;
        } else if (raw.kind === "send_email") {
          outcome = await withJobTimeout(
            () => deliverJobEmailWithOutcome(claimedJob),
            Math.min(jobTimeoutMs, remainingMs),
          );
          providerMessageId = outcome.messageId;
          if (providerMessageId && !raw.provider_message_id) {
            result.providerAccepted += 1;
            lastProviderSendAt = Date.now();
          }
          if (outcome.fanOutCount > 0)
            result.recipientJobsCreated += outcome.fanOutCount;
          if (outcome.suppressed) result.skipped += 1;
        } else {
          throw new Error("JOB_KIND_UNKNOWN");
        }
        const { data: completed, error: completionError } = await admin
          .from("jobs")
          .update({
            status: "succeeded",
            completed_at: new Date().toISOString(),
            locked_at: null,
            claim_token: null,
            lease_expires_at: null,
            last_error_code: null,
            ...(providerMessageId
              ? { provider_message_id: providerMessageId }
              : {}),
          })
          .eq("id", raw.id)
          .eq("claim_token", claimToken)
          .select("id");
        if (completionError) throw new Error("JOB_COMPLETION_FAILED");
        if (!completed || (completed as unknown[]).length === 0) {
          // Stale completion: the lease expired and a newer worker reclaimed
          // the job. Never overwrite the newer attempt.
          result.skipped += 1;
          result.stateErrors += 1;
          continue;
        }
        result.succeeded += 1;
      } catch (jobError) {
        if (
          raw.kind === "send_email" &&
          isEmailDeferralError(jobError)
        ) {
          // The provider or local budget explicitly deferred this request:
          // restore prior tracking so an earlier ambiguous send keeps its
          // reconciliation protection, and never exhaust the retry budget.
          const code = deferralCode(jobError);
          const retryAfterSec =
            jobError instanceof EmailRateLimitError
              ? jobError.retryAfterSec
              : undefined;
          const budgetScope =
            jobError instanceof EmailBudgetDeferredError
              ? jobError.scope
              : undefined;
          const retryAt = deferRetryAt(
            code,
            Date.now(),
            retryAfterSec,
            budgetScope,
          );
          const { data: deferred, error: deferError } = await admin
            .from("jobs")
            .update({
              status: "pending",
              attempts: raw.attempts,
              locked_at: null,
              claim_token: null,
              lease_expires_at: null,
              last_error_code: code,
              available_at: retryAt,
              first_send_attempt_at: raw.first_send_attempt_at ?? null,
              send_attempts: raw.send_attempts ?? 0,
            })
            .eq("id", raw.id)
            .eq("claim_token", claimToken)
            .select("id");
          if (deferError) throw new Error("EMAIL_QUOTA_DEFER_FAILED");
          if (!deferred || (deferred as unknown[]).length === 0) {
            result.skipped += 1;
            result.stateErrors += 1;
            continue;
          }
          emailPaused = true;
          result.deferred += 1;
          continue;
        }
        if (
          jobError instanceof Error &&
          jobError.message === "NEEDS_RECONCILIATION"
        )
          result.needsReconciliation += 1;
        const terminal =
          raw.attempts + 1 >= raw.max_attempts ||
          (jobError instanceof Error &&
            ["NEEDS_RECONCILIATION", ...DELIBERATE_DROP_CODES].includes(
              jobError.message,
            ));
        const code =
          jobError instanceof Error
            ? jobError.message.slice(0, 80)
            : "JOB_FAILED";
        const { data: recorded, error: failureError } = await admin
          .from("jobs")
          .update({
            status: terminal ? "dead" : "failed",
            locked_at: terminal ? null : claimNow,
            claim_token: terminal ? null : claimToken,
            lease_expires_at: terminal
              ? null
              : new Date(Date.now() + JOB_LEASE_MS).toISOString(),
            last_error_code: code,
            available_at: new Date(
              Date.now() + retryDelayMs(raw.attempts),
            ).toISOString(),
            ...(providerMessageId
              ? { provider_message_id: providerMessageId }
              : {}),
          })
          .eq("id", raw.id)
          .eq("claim_token", claimToken)
          .select("id");
        if (failureError) throw new Error("JOB_FAILURE_RECORD_FAILED");
        if (!recorded || (recorded as unknown[]).length === 0) {
          // Provider acceptance is still reported separately even when the
          // state write loses its lease race; the newer attempt owns the row.
          result.skipped += 1;
          result.stateErrors += 1;
          continue;
        }
        // A deliberate drop (the email is no longer relevant) is recorded
        // dead with its code but is not a failure.
        if (jobError instanceof Error && isDeliberateDropCode(jobError.message))
          result.skipped += 1;
        else result.failed += 1;
      }
    }
    if (
      result.stopReason === "job_budget" ||
      result.stopReason === "time_budget"
    )
      break;
    if (!drainQueue) break;
  }
  result.unclaimable = unclaimable.size;

  const after = await fetchQueueSnapshot(admin, campaignId);
  result.remainingDue = after.dueCount;
  result.remainingProcessableDue = after.processableDueCount;
  result.remainingExpiredLeases = after.expiredLeaseCount;
  result.oldestDueAgeSec = snapshotAgeSec(after, after.oldestProcessableDueAt);
  result.emailHold = after.emailHold
    ? { code: after.emailHold.code, until: after.emailHold.until }
    : null;
  return result;
}

async function generateAgreement(investmentId: string) {
  const admin = jobAdminClient();
  const { data: investment } = await admin
    .from("investments")
    .select(
      "id,units,principal_ugx,projected_return_ugx,projected_value_ugx,maturity_date,investor_id",
    )
    .eq("id", investmentId)
    .single();
  const { data: acceptance } = await admin
    .from("investment_agreements")
    .select("id,accepted_at,agreement_version_id")
    .eq("investment_id", investmentId)
    .single();
  if (!investment || !acceptance) throw new Error("AGREEMENT_DATA_MISSING");
  if (!investment.investor_id) throw new Error("AGREEMENT_INVESTOR_MISSING");
  const [{ data: profile }, { data: version }] = await Promise.all([
    admin
      .from("profiles")
      .select("legal_name,email")
      .eq("id", investment.investor_id)
      .single(),
    admin
      .from("agreement_versions")
      .select("title,template_markdown,is_legally_approved")
      .eq("id", acceptance.agreement_version_id)
      .single(),
  ]);
  if (
    !profile ||
    !version?.is_legally_approved ||
    /PLACEHOLDER|TBD/i.test(version.template_markdown)
  )
    throw new Error("LEGAL_TEMPLATE_NOT_APPROVED");
  const pdf = await buildAgreementPdf({
    title: version.title,
    template: version.template_markdown,
    investorName: profile.legal_name,
    investorEmail: profile.email,
    units: Number(investment.units),
    principalUgx: Number(investment.principal_ugx),
    projectedReturnUgx: Number(investment.projected_return_ugx),
    projectedValueUgx: Number(investment.projected_value_ugx),
    maturityDate: investment.maturity_date,
    acceptedAt: acceptance.accepted_at,
  });
  const path = `${investment.investor_id}/${investment.id}.pdf`;
  const { error: uploadError } = await admin.storage
    .from("agreements")
    .upload(path, pdf.bytes, { contentType: "application/pdf", upsert: false });
  if (
    uploadError &&
    !uploadError.message.toLowerCase().includes("already exists")
  )
    throw new Error("PDF_UPLOAD_FAILED");
  const { error: updateError } = await admin
    .from("investment_agreements")
    .update({
      pdf_status: "ready",
      pdf_path: path,
      pdf_hash: pdf.hash,
      generated_at: new Date().toISOString(),
    })
    .eq("id", acceptance.id);
  if (updateError) throw new Error("PDF_RECORD_FAILED");
  const { error: queueError } = await admin.from("jobs").insert({
    kind: "send_email",
    entity_type: "investment",
    entity_id: investment.id,
    payload: { template: "agreement_ready" },
  });
  if (queueError) throw new Error("EMAIL_QUEUE_FAILED");
}

async function fetchReceipt(receiptId: string): Promise<ReceiptRow | null> {
  const admin = jobAdminClient() as never as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          k: string,
          v: string,
        ) => {
          maybeSingle: () => Promise<{
            data: ReceiptRow | null;
            error: unknown;
          }>;
        };
      };
    };
  };
  const { data, error } = await admin
    .from("investment_receipts")
    .select("*")
    .eq("id", receiptId)
    .maybeSingle();
  // Never silently degrade to a receipt-less send: surface lookup failures
  // so the job retries instead of delivering without its PDF.
  if (error) throw new Error("RECEIPT_LOOKUP_FAILED");
  return data;
}

async function generateReceipt(receiptId: string) {
  const receipt = await fetchReceipt(receiptId);
  if (!receipt) throw new Error("RECEIPT_NOT_FOUND");
  const ready = await ensureReceiptPdf(jobAdminClient(), receipt);
  await queueActivationEmail(ready);
}

async function queueActivationEmail(receipt: ReceiptRow) {
  const admin = jobAdminClient();
  const { error } = await admin.from("jobs").insert({
    kind: "send_email",
    entity_type: "investment",
    entity_id: receipt.investment_id,
    payload: {
      template: "investment_activated",
      receiptId: receipt.id,
    },
  });
  if (error) throw new Error("EMAIL_QUEUE_FAILED");
}

async function receiptForInvestment(
  investmentId: string,
): Promise<ReceiptRow | null> {
  const admin = jobAdminClient() as never as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          k: string,
          v: string,
        ) => {
          order: (
            c: string,
            o: object,
          ) => {
            limit: (n: number) => Promise<{
              data: ReceiptRow[] | null;
              error: unknown;
            }>;
          };
        };
      };
    };
  };
  const { data, error } = await admin
    .from("investment_receipts")
    .select("*")
    .eq("investment_id", investmentId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error("RECEIPT_LOOKUP_FAILED");
  return data?.[0] ?? null;
}

export type EmailOutcome = {
  messageId: string | null;
  /** Recipient delivery jobs ensured by fan-out (0 for direct sends). */
  fanOutCount: number;
  /** True when delivery was suppressed (removed alias) without sending. */
  suppressed: boolean;
};

// Exported for worker-level regression tests (the production caller is
// processDueJobs above).
export async function deliverJobEmail(job: JobRow): Promise<string | null> {
  const outcome = await deliverJobEmailWithOutcome(job);
  return outcome.messageId;
}

export async function deliverJobEmailWithOutcome(
  job: JobRow,
): Promise<EmailOutcome> {
  // A recovered job with recorded provider acceptance needs state repair,
  // never another send (including after the provider idempotency window).
  if (job.provider_message_id)
    return { messageId: job.provider_message_id, fanOutCount: 0, suppressed: true };
  const admin = jobAdminClient();
  const payload = job.payload as SendEmailPayload;
  const to = payload.to;
  if (
    job.entity_type === "investment" &&
    payload.template === "reservation_created"
  ) {
    const { data: investment, error } = await admin
      .from("investments")
      .select("status")
      .eq("id", job.entity_id)
      .maybeSingle();
    if (error) throw new Error("RESERVATION_LOOKUP_FAILED");
    if (!investment) throw new Error("RESERVATION_NOT_FOUND");
    if (investment.status !== "reserved") throw new Error("STALE_RESERVATION");
  }
  if (to && payload.accountEmailId) {
    const { data: activeRecipient, error: recipientError } = await admin
      .from("account_emails")
      .select("id")
      .eq("id", payload.accountEmailId)
      .eq("email", to)
      .not("verified_at", "is", null)
      .maybeSingle();
    // A lookup failure must retry — never confuse it with a removed alias.
    if (recipientError) throw new Error("RECIPIENT_LOOKUP_FAILED");
    // Removing an alias immediately suppresses any queued delivery to it.
    if (!activeRecipient) {
      if (payload.routing?.teamCopySelected) {
        const { error: flagError } = await admin
          .from("jobs")
          .update({ cc_review_required: true })
          .eq("id", job.id);
        if (flagError) throw new Error("CC_REVIEW_FLAG_FAILED");
      }
      return { messageId: null, fanOutCount: 0, suppressed: true };
    }
  }
  if (!to && job.entity_type === "investment") {
    const fanOutCount = await fanOutInvestmentEmails(job);
    return { messageId: null, fanOutCount, suppressed: false };
  }
  if (!to || !payload.template) throw new Error("EMAIL_JOB_INVALID");
  // Ambiguous sends outside Resend's 24h idempotency window need human
  // reconciliation before retrying, otherwise a retry could double-send.
  // Keys off the first actual provider send, not job creation, so jobs that
  // failed before ever sending stay retryable.
  if (
    needsReconciliation({
      firstSendAttemptAt: job.first_send_attempt_at,
      providerMessageId: job.provider_message_id,
    })
  ) {
    throw new Error("NEEDS_RECONCILIATION");
  }
  let actionUrl = payload.actionUrl;
  let detail: string | undefined =
    typeof payload.detail === "string" && payload.detail.length > 0
      ? payload.detail
      : undefined;
  let maturityNotice: MaturityNoticeInput | undefined;
  let activationReceipt:
    import("@/lib/email/template").ActivationReceiptInput | undefined;
  let attachments: { filename: string; content: Buffer }[] | undefined;
  let idempotencyKey = payload.idempotencyKey;
  if (
    job.entity_type === "investment" &&
    MATURITY_TEMPLATES.includes(payload.template)
  ) {
    const content = await maturityEmailContent(job.entity_id, payload.template);
    actionUrl = payload.actionUrl ?? content.actionUrl;
    detail = content.detail;
    maturityNotice = content.maturityNotice;
  }
  if (
    job.entity_type === "investment" &&
    payload.template === "reservation_created"
  ) {
    const content = await reservationEmailContent(job.entity_id);
    actionUrl = payload.actionUrl ?? content.actionUrl;
    detail = content.detail;
  }
  if (
    job.entity_type === "investment" &&
    payload.template === "investment_activated"
  ) {
    // When the job names a receipt, the email must carry its PDF: a missing
    // row or a not-yet-ready document retries without sending. Only the
    // legacy path (no receiptId, e.g. pre-rollout activations) may send
    // without an attachment.
    const receipt = payload.receiptId
      ? await fetchReceipt(payload.receiptId)
      : await receiptForInvestment(job.entity_id);
    if (payload.receiptId && !receipt) throw new Error("RECEIPT_NOT_FOUND");
    if (
      payload.receiptId &&
      (!receipt || receipt.pdf_status !== "ready" || !receipt.pdf_path)
    )
      throw new Error("RECEIPT_NOT_READY");
    const baseUrl = getPublicEnv().NEXT_PUBLIC_APP_URL;
    actionUrl = payload.actionUrl ?? `${baseUrl}/investments/${job.entity_id}`;
    if (receipt) {
      activationReceipt = {
        partnerName: receipt.partner_name,
        amountUgx: formatUgxExact(receipt.amount_ugx),
        receiptNumber: receipt.receipt_number,
        isReinvestment: receipt.source === "reinvestment",
        originalInvestmentRef: receipt.original_investment_id,
        actionUrl,
      };
      if (receipt.pdf_path && receipt.pdf_status === "ready") {
        const { data: file, error } = await admin.storage
          .from("receipts")
          .download(receipt.pdf_path);
        if (error) throw new Error("RECEIPT_DOWNLOAD_FAILED");
        const bytes = Buffer.from(await file.arrayBuffer());
        attachments = [
          {
            filename: `${receipt.receipt_number}.pdf`,
            content: bytes,
          },
        ];
      }
      idempotencyKey =
        payload.idempotencyKey ??
        `receipt-${receipt.id}-${payload.accountEmailId ?? to}`;
    } else {
      // Historical activation without a receipt (no backfill): themed email
      // without attachment.
      const { data: investment, error: legacyError } = await admin
        .from("investments")
        .select("principal_ugx,investor_id")
        .eq("id", job.entity_id)
        .single();
      if (legacyError) throw new Error("INVESTMENT_LOOKUP_FAILED");
      let partnerName: string | undefined;
      if (investment?.investor_id) {
        const { data: profile } = await admin
          .from("profiles")
          .select("legal_name")
          .eq("id", investment.investor_id)
          .single();
        partnerName = profile?.legal_name ?? undefined;
      }
      activationReceipt = {
        partnerName,
        amountUgx: investment
          ? formatUgxExact(String(investment.principal_ugx))
          : undefined,
        actionUrl,
      };
      idempotencyKey =
        payload.idempotencyKey ??
        `job-${job.id}-${payload.accountEmailId ?? to}`;
    }
  }
  // Record the first actual provider send attempt (separate from worker
  // claim attempts) before calling the provider, so the idempotency guard
  // and any later reconciliation key off real sends. This write must succeed
  // first: if tracking is lost while Resend accepts the email, a retry past
  // the 24h window could otherwise bypass reconciliation and double-send.
  const sendAttemptAt = new Date().toISOString();
  let tracking = admin
    .from("jobs")
    .update({
      payload: { ...job.payload, providerIdempotencyKey: idempotencyKey },
      send_attempts: (job.send_attempts ?? 0) + 1,
      first_send_attempt_at: job.first_send_attempt_at ?? sendAttemptAt,
    })
    .eq("id", job.id);
  // Direct helper callers must also supply an active lease; never send on a
  // missing or superseded claim.
  if (!job.claim_token) throw new Error("JOB_CLAIM_LOST");
  tracking = tracking.eq("claim_token", job.claim_token).eq("status", "running");
  const { data: tracked, error: trackingError } = await tracking.select("id");
  if (trackingError) {
    if (trackingError.message.includes("EMAIL_DAILY_BUDGET_DEFERRED"))
      throw new EmailBudgetDeferredError("daily");
    if (trackingError.message.includes("EMAIL_MONTHLY_BUDGET_DEFERRED"))
      throw new EmailBudgetDeferredError("monthly");
    throw new Error("SEND_TRACKING_FAILED");
  }
  if (!tracked?.length) throw new Error("JOB_CLAIM_LOST");
  operationScope.getStore()?.throwIfAborted();
  const messageId = await sendTransactionalEmail({
    to,
    cc: MATURITY_TEMPLATES.includes(payload.template)
      ? (payload.routing?.cc ?? payload.cc)
      : (payload.cc ?? undefined),
    bcc: payload.bcc?.length ? payload.bcc : undefined,
    replyTo: MATURITY_TEMPLATES.includes(payload.template)
      ? payload.routing?.replyTo
      : undefined,
    template: payload.template,
    actionUrl,
    detail,
    maturityNotice,
    activationReceipt,
    attachments,
    idempotencyKey,
    signal: operationScope.getStore(),
  });
  return { messageId, fanOutCount: 0, suppressed: false };
}

// Reservation emails explain the manual expiry policy.
async function reservationEmailContent(
  investmentId: string,
): Promise<{ detail: string; actionUrl: string }> {
  const admin = jobAdminClient();
  const actionUrl = `${getPublicEnv().NEXT_PUBLIC_APP_URL}/investments/${investmentId}`;
  const { data: investment, error: reservationError } = await admin
    .from("investments")
    .select("principal_ugx,investment_cycles(name)")
    .eq("id", investmentId)
    .single();
  if (reservationError) throw new Error("RESERVATION_LOOKUP_FAILED");
  if (!investment) throw new Error("EMAIL_JOB_INVALID");
  const cycle = Array.isArray(investment.investment_cycles)
    ? investment.investment_cycles[0]
    : investment.investment_cycles;
  const detail =
    `Your OURMU investment reservation of ${ugx(Number(investment.principal_ugx))}` +
    `${cycle?.name ? ` for ${cycle.name}` : ""} is recorded. ` +
    "Transfer the exact amount shown. Your reservation does not expire automatically; " +
    "it stays pending until an administrator activates or expires it, or you cancel it. " +
    "Payments must match the reserved cycle. Contact our team if the cycle closes before you transfer. " +
    "If you already transferred, do not pay again.";
  return { detail, actionUrl };
}

// Maturity emails carry the figures that prompt the partner's decision:
// principal, projected ROI, payout date, the three choices with their
// splits, and a link to the investment — never just the subject line.
async function maturityEmailContent(
  investmentId: string,
  template: EmailTemplate,
): Promise<{
  detail: string;
  actionUrl: string;
  maturityNotice?: MaturityNoticeInput;
}> {
  const admin = jobAdminClient();
  const actionUrl = `${getPublicEnv().NEXT_PUBLIC_APP_URL}/investments/${investmentId}`;
  const { data: investment, error: investmentError } = await admin
    .from("investments")
    .select(
      "principal_ugx,projected_return_ugx,projected_return_bps,projected_value_ugx,maturity_date,payout_basis,reported_return_ugx,reported_payout_ugx,investment_cycles(actual_return_bps,legacy_settlement)",
    )
    .eq("id", investmentId)
    .single();
  if (investmentError) throw new Error("INVESTMENT_LOOKUP_FAILED");
  if (!investment) throw new Error("EMAIL_JOB_INVALID");
  const principal = Number(investment.principal_ugx);
  const projectedReturn = Number(investment.projected_return_ugx);
  const returns = investmentReturnView(investment, investment.investment_cycles);
  const actual = returns.basis === "actual";
  const payoutDate = date(maturityPayoutDateIso(investment.maturity_date));
  const { data: instruction, error: instructionError } = await admin
    .from("maturity_instructions")
    .select(
      "choice,requested_withdrawal_ugx,status,amount_basis,projected_payout_ugx,projected_reinvest_ugx,actual_payout_ugx,actual_reinvest_ugx,actual_roi_ugx,proposed_actual_roi_ugx,resolution_notes,target_cycle_id",
    )
    .eq("investment_id", investmentId)
    .maybeSingle();
  if (instructionError) throw new Error("INSTRUCTION_LOOKUP_FAILED");
  // A removed request (no instruction), a paid-out investment, or a fulfilled
  // instruction makes a confirmation stale: never send it, quarantine instead.
  // Checked immediately before sending so a choice removed or paid while the
  // job waited cannot go out.
  if (
    template === "maturity_choice_confirmed" &&
    (investment.payout_basis === "reported_paid" ||
      !instruction ||
      instruction.status === "fulfilled")
  ) {
    throw new Error("STALE_MATURITY_CONFIRMATION");
  }
  const basis =
    `Your OURMU investment of ${ugx(principal)} matured on ${date(investment.maturity_date)} ` +
    (actual
      ? `with an actual ${bpsToPercent(returns.actualReturnBps ?? 0)}% return of ` +
        `${ugx(returns.profitUgx)} (actual value ${ugx(returns.valueUgx)}). `
      : `with a projected ${bpsToPercent(investment.projected_return_bps)}% return of ` +
        `${ugx(projectedReturn)} (projected value ${ugx(investment.projected_value_ugx)}). `) +
    `Payouts are scheduled for ${payoutDate}.`;
  if (template === "maturity_notice") {
    const maturityNotice: MaturityNoticeInput = {
      principalUgx: principal,
      projectedReturnUgx: projectedReturn,
      projectedValueUgx: Number(investment.projected_value_ugx),
      projectedPercent: bpsToPercent(investment.projected_return_bps),
      maturityDate: date(investment.maturity_date),
      payoutDate,
      actualReturnUgx: actual ? returns.profitUgx : null,
      actualValueUgx: actual ? returns.valueUgx : null,
      actualPercent: actual
        ? bpsToPercent(returns.actualReturnBps ?? 0)
        : null,
      actualPending: returns.pending,
    };
    return {
      actionUrl,
      detail: maturityNoticeDetail(maturityNotice),
      maturityNotice,
    };
  }
  if (template === "maturity_choice_confirmed" && instruction) {
    const instructionTerms = maturityInstructionTerms(
      instruction.choice as MaturityChoice,
      instruction.requested_withdrawal_ugx,
    );
    const { data: assigned } = instruction.target_cycle_id
      ? await admin
          .from("investment_cycles")
          .select("name,maturity_date")
          .eq("id", instruction.target_cycle_id)
          .maybeSingle()
      : { data: null };
    const instructionBasis =
      instruction.amount_basis === "actual" ? "actual" : "projected";
    const pendingSuffix =
      instructionBasis === "projected" && returns.pending
        ? " The actual return for your cycle is pending; you will confirm any revised amounts before anything is paid or reinvested."
        : "";
    const cycleSuffix =
      assigned && Number(instruction.projected_reinvest_ugx) > 0
        ? ` Assigned cycle ${assigned.name} (matures ${date(assigned.maturity_date)}). The cycle was assigned automatically when your choice was recorded.`
        : "";
    return {
      actionUrl,
      detail:
        `Your maturity choice (${maturityChoiceLabel(instruction.choice)}) is recorded: ${instructionBasis} payout ` +
        `${ugx(instruction.projected_payout_ugx)}, ${instructionBasis} reinvestment ` +
        `${ugx(instruction.projected_reinvest_ugx)}.${cycleSuffix} ${instructionTerms ? `${instructionTerms} ` : ""}You can revise it until our team begins ` +
        `processing. Scheduled payout date: ${payoutDate}.${pendingSuffix}`,
    };
  }
  if (template === "maturity_fulfilled" && instruction) {
    return {
      actionUrl,
      detail:
        `Your maturity instruction is fulfilled from an actual return of ` +
        `${ugx(instruction.actual_roi_ugx ?? projectedReturn)}: payout ` +
        `${ugx(instruction.actual_payout_ugx ?? 0)}, reinvestment ` +
        `${ugx(instruction.actual_reinvest_ugx ?? 0)}.`,
    };
  }
  if (
    template === "maturity_action_needed" &&
    instruction?.proposed_actual_roi_ugx != null
  ) {
    const proposed = safeFulfilledSplits(
      principal,
      Number(instruction.proposed_actual_roi_ugx),
      instruction.choice as MaturityChoice,
      instruction.requested_withdrawal_ugx == null
        ? undefined
        : {
            requestedWithdrawalUgx: Number(
              instruction.requested_withdrawal_ugx,
            ),
            projectedPayoutUgx: Number(instruction.projected_payout_ugx),
            projectedReinvestUgx: Number(instruction.projected_reinvest_ugx),
            projectedTotalUgx:
              Number(instruction.projected_payout_ugx) +
              Number(instruction.projected_reinvest_ugx),
          },
    );
    if (!proposed) return { actionUrl, detail: UNAVAILABLE_MATURITY_AMOUNTS };
    return {
      actionUrl,
      detail:
        `The fund recorded an actual return of ${ugx(instruction.proposed_actual_roi_ugx)} ` +
        `instead of the projected ${ugx(projectedReturn)}. Your updated amounts for ` +
        `(${maturityChoiceLabel(instruction.choice)}): payout ${ugx(proposed.payoutUgx)}, reinvestment ` +
        `${ugx(proposed.reinvestUgx)}. Open your investment to confirm before anything is paid or reinvested.`,
    };
  }
  if (template === "maturity_action_needed" && instruction?.resolution_notes) {
    return {
      actionUrl,
      detail:
        `Our team needs your input before your maturity choice can proceed: ` +
        `${instruction.resolution_notes} Open your investment to revise your choice.`,
    };
  }
  return { actionUrl, detail: basis };
}

// Exported for worker-level regression tests (the production caller is
// deliverJobEmail above). Returns the number of recipient delivery jobs
// ensured so the worker can report recipient preparation separately.
export async function fanOutInvestmentEmails(job: JobRow): Promise<number> {
  const payload = job.payload as SendEmailPayload;
  const template = payload.template;
  if (!template) throw new Error("EMAIL_JOB_INVALID");
  if (MATURITY_TEMPLATES.includes(template)) {
    const actionUrl = `${getPublicEnv().NEXT_PUBLIC_APP_URL}/investments/${job.entity_id}`;
    const { error } = await jobAdminClient().rpc("fan_out_maturity_email", {
      p_job_id: job.id,
      p_action_url: actionUrl,
    });
    if (error) throw new Error("EMAIL_FANOUT_FAILED");
    return 0;
  }
  const admin = jobAdminClient();
  const { data: investment } = await admin
    .from("investments")
    .select("investor_id")
    .eq("id", job.entity_id)
    .single();
  const { data: recipients } = investment?.investor_id
    ? await admin
        .from("account_emails")
        .select("id,email")
        .eq("user_id", investment.investor_id)
        .not("verified_at", "is", null)
    : { data: null };
  if (!recipients?.length) throw new Error("EMAIL_JOB_INVALID");
  const actionUrl = `${getPublicEnv().NEXT_PUBLIC_APP_URL}/investments/${job.entity_id}`;
  // One delivery record per receipt and verified recipient: the dedupe key
  // is stable per (receipt, recipient) so retries never duplicate queued
  // deliveries and reuse the same receipt number. A parent job that names a
  // receipt must resolve it here — never fan out receipt-less children that
  // would bypass the RECEIPT_NOT_FOUND guard and send legacy emails.
  let receipt: ReceiptRow | null = null;
  if (template === "investment_activated") {
    if (payload.receiptId) {
      receipt = await fetchReceipt(payload.receiptId);
      if (!receipt) throw new Error("RECEIPT_NOT_FOUND");
    } else {
      receipt = await receiptForInvestment(job.entity_id);
    }
  }
  const rows = recipients.map((recipient) => ({
    kind: "send_email" as const,
    entity_type: "investment",
    entity_id: job.entity_id,
    payload: {
      template,
      to: recipient.email,
      accountEmailId: recipient.id,
      actionUrl,
      ...(receipt
        ? {
            receiptId: receipt.id,
            idempotencyKey: `receipt-${receipt.id}-${recipient.id}`,
          }
        : { idempotencyKey: `job-${job.id}-${recipient.id}` }),
    },
    email_dedupe_key: receipt
      ? `receipt:${receipt.id}:${recipient.id}`
      : `${job.id}:${recipient.id}`,
  }));
  const { error } = await admin.from("jobs").upsert(rows, {
    onConflict: "email_dedupe_key",
    ignoreDuplicates: true,
  });
  if (error) throw new Error("EMAIL_FANOUT_FAILED");
  return rows.length;
}
