import { reconcileJobDelivery, retryJob } from "@/actions/admin";
import { ResolveMaturityCcReviewForm } from "@/components/ResolveMaturityCcReviewForm";
import { SubmitButton } from "@/components/SubmitButton";
import { requireAdmin } from "@/lib/auth";
import {
  isEmailDeferralCode,
  QUEUED_EMAIL_DAILY_BUDGET,
  QUEUED_EMAIL_MONTHLY_BUDGET,
} from "@/lib/email/quota";
import { dateTime } from "@/lib/format";
import {
  parseJobDispatchHealth,
  type JobDispatchHealth,
} from "@/lib/job-health";
import { createAdminClient } from "@/lib/supabase/admin";

// public.job_worker_recent_runs. The generated types mark every column
// non-null, but codes and reasons are null when a run did not record them.
type WorkerRun = {
  id: number;
  route: string;
  trigger: string;
  started_at: string;
  finished_at: string;
  ok: boolean;
  error_code: string | null;
  stop_reason: string | null;
  maintenance_status: string | null;
  claimed: number;
  succeeded: number;
  failed: number;
  deferred: number;
  unclaimable: number;
};

function counted(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function holdNotice(code: string, until: string) {
  switch (code) {
    case "EMAIL_DAILY_QUOTA_EXCEEDED":
      return `Email sending is paused: Resend's daily quota was reached. The next check is at ${until}; checks repeat at least every 3 hours and at 00:01 UTC (03:01 Kampala).`;
    case "EMAIL_MONTHLY_QUOTA_EXCEEDED":
      return `Email sending is paused: Resend's monthly quota was reached. The next check is at ${until} and repeats daily.`;
    case "EMAIL_RATE_LIMITED":
      return `Email sending is paused by Resend's rate limit until ${until}.`;
    case "EMAIL_BUDGET_DEFERRED":
      return `Email sending is paused by the portal's own budget (${QUEUED_EMAIL_DAILY_BUDGET} a day and ${QUEUED_EMAIL_MONTHLY_BUDGET.toLocaleString("en-UG")} per 31 days, which keeps room for sign-in links) until ${until}.`;
    default:
      return `Email sending is paused (${code}) until ${until}.`;
  }
}

function runResult(run: WorkerRun) {
  const result = run.ok ? "OK" : (run.error_code ?? "Failed");
  return run.maintenance_status
    ? `${result} (${run.maintenance_status})`
    : result;
}

// Health details quote times in UTC, as the watchdog's annotations show them;
// this page shows every time in Africa/Kampala. A value that is not a real
// date stays as sent, so dateTime() cannot throw.
function kampalaDetail(detail: string) {
  return detail.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g, (utc) =>
    Number.isFinite(Date.parse(utc)) ? dateTime(utc) : utc,
  );
}

function WorkerTrigger({ health }: { health: JobDispatchHealth }) {
  const { dispatcher, pgNet } = health;
  // The outcome belongs to the last scored request: while the latest dispatch
  // awaits its response, that is the one before it.
  const awaitingResponse = pgNet.outstandingRequestId !== null;
  return (
    <>
      <p>
        Status: <strong>{health.status}</strong>
      </p>
      {health.problems.length + health.warnings.length > 0 && (
        <ul>
          {health.problems.map((item, index) => (
            <li key={`problem-${index}`}>
              Problem <strong>{item.code}</strong>: {kampalaDetail(item.detail)}
            </li>
          ))}
          {health.warnings.map((item, index) => (
            <li key={`warning-${index}`}>
              Warning <strong>{item.code}</strong>: {kampalaDetail(item.detail)}
            </li>
          ))}
        </ul>
      )}
      <div className="grid">
        <article className="card">
          <p className="muted">Dispatcher</p>
          <p>
            {dispatcher.configured ? "Configured" : "Not configured"} ·{" "}
            {dispatcher.scheduled ? "scheduled" : "not scheduled"}
          </p>
          <p>
            Last tick:{" "}
            {dispatcher.lastTickAgeSec === null
              ? "never"
              : `${dispatcher.lastTickAgeSec} s ago`}{" "}
            ({dispatcher.lastReason})
          </p>
          <p>
            Last dispatch:{" "}
            {dispatcher.lastDispatchAt
              ? dateTime(dispatcher.lastDispatchAt)
              : "never"}
            {awaitingResponse ? (
              ", awaiting response"
            ) : (
              <>
                {dispatcher.lastOutcome && `, ${dispatcher.lastOutcome}`}
                {dispatcher.lastHttpStatus !== null &&
                  `, HTTP ${dispatcher.lastHttpStatus}`}
              </>
            )}
          </p>
          <p>Consecutive failures: {dispatcher.consecutiveFailures}</p>
          <p>
            No-progress backoff:{" "}
            {dispatcher.noProgressUntil
              ? `until ${dateTime(dispatcher.noProgressUntil)}`
              : "none"}
          </p>
        </article>
        <article className="card">
          <p className="muted">pg_net</p>
          <p>
            Worker{" "}
            {pgNet.workerRunning === null
              ? "not installed"
              : pgNet.workerRunning
                ? "running"
                : "not running"}{" "}
            · queue depth {pgNet.queueDepth ?? "—"}
          </p>
        </article>
        <article className="card">
          <p className="muted">Deliberately dropped emails (24 h)</p>
          <p className="stat">{health.jobs.dropped24h}</p>
          <p className="muted">Shown, never alerted.</p>
        </article>
        <article className="card">
          <p className="muted">Last maintenance</p>
          <p>
            {health.maintenance.lastCompletedAt
              ? dateTime(health.maintenance.lastCompletedAt)
              : "Never"}
          </p>
        </article>
      </div>
    </>
  );
}

function WorkerRuns({ runs }: { runs: WorkerRun[] }) {
  if (runs.length === 0)
    return <p className="muted">No worker runs recorded yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Started</th>
            <th>Route</th>
            <th>Trigger</th>
            <th>Duration (s)</th>
            <th>Claimed</th>
            <th>Succeeded</th>
            <th>Failed</th>
            <th>Deferred</th>
            <th>Unclaimable</th>
            <th>Stop</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>{dateTime(run.started_at)}</td>
              <td>{run.route}</td>
              <td>{run.trigger}</td>
              <td>
                {(
                  (Date.parse(run.finished_at) - Date.parse(run.started_at)) /
                  1000
                ).toFixed(1)}
              </td>
              <td>{run.claimed}</td>
              <td>{run.succeeded}</td>
              <td>{run.failed}</td>
              <td>{run.deferred}</td>
              <td>{run.unclaimable}</td>
              <td>{run.stop_reason ?? "—"}</td>
              <td>{runResult(run)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function JobsPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const [{ data }, { data: flaggedJobsData }, healthResult, runsResult] =
    await Promise.all([
      admin
        .from("jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(250),
      admin
        .from("jobs")
        .select("*")
        .eq("cc_review_required", true)
        .order("created_at", { ascending: false }),
      admin.rpc("job_dispatch_health", { p_since_last_watchdog: false }),
      admin.rpc("job_worker_recent_runs", { p_limit: 20 }),
    ]);
  // Health and the run log are diagnostics: when either cannot be read the
  // page says so and still lists the jobs.
  const health = healthResult.error
    ? null
    : parseJobDispatchHealth(healthResult.data);
  const runs: WorkerRun[] | null = runsResult.error
    ? null
    : (runsResult.data ?? []);
  const flaggedJobs = flaggedJobsData ?? [];
  const visibleJobs = [
    ...flaggedJobs,
    ...(data ?? []).filter(
      (job) => !flaggedJobs.some((flagged) => flagged.id === job.id),
    ),
  ];
  const hold = health?.queue.emailHold ?? null;
  const dead = health?.jobs.dead24h ?? 0;
  const openReconciliation = health?.jobs.openReconciliation ?? 0;
  return (
    <>
      <p className="eyebrow">Durable side effects</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Jobs</h1>
      {hold && (
        <p className="notice" role="status">
          {holdNotice(hold.code, dateTime(hold.until))}{" "}
          {counted(
            hold.heldCount,
            "email is waiting and uses",
            "emails are waiting and use",
          )}{" "}
          no retry attempts. PDF jobs continue. To check sooner, Retry every
          deferred email: while any one is still deferred, all email stays
          paused.
        </p>
      )}
      {(dead > 0 || openReconciliation > 0) && (
        <p className="notice" role="alert">
          {[
            dead > 0 &&
              `${counted(dead, "job", "jobs")} failed permanently in the last 24 hours. Review them below; Retry gives one more attempt.`,
            openReconciliation > 0 &&
              `${counted(openReconciliation, "email delivery needs", "email deliveries need")} reconciliation. Check Resend before choosing Confirm delivered or Authorize resend.`,
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      )}
      {flaggedJobs.length > 0 && (
        <div className="notice" role="alert">
          {flaggedJobs.length} maturity email team{" "}
          {flaggedJobs.length === 1 ? "copy needs" : "copies need"} review.
          Confirm the partner recipient and contact the team manually before
          marking reviewed.
        </div>
      )}
      <section style={{ marginTop: "2rem" }} aria-labelledby="worker-trigger">
        <h2 id="worker-trigger">Worker trigger</h2>
        {health ? (
          <WorkerTrigger health={health} />
        ) : (
          <p className="notice" role="alert">
            Worker trigger health is unavailable.
          </p>
        )}
      </section>
      <section style={{ marginTop: "2rem" }} aria-labelledby="worker-runs">
        <h2 id="worker-runs">Recent worker runs</h2>
        {runs ? (
          <WorkerRuns runs={runs} />
        ) : (
          <p className="notice" role="alert">
            Recent worker runs are unavailable.
          </p>
        )}
      </section>
      <div className="table-wrap" style={{ marginTop: "2rem" }}>
        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Kind</th>
              <th>Entity</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Error code</th>
              <th>Next check</th>
              <th>CC review</th>
              <th>Provider message</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visibleJobs.map((item) => (
              <tr key={item.id}>
                <td>{dateTime(item.created_at)}</td>
                <td>{item.kind}</td>
                <td>
                  {item.entity_type} · {item.entity_id}
                </td>
                <td>{item.status}</td>
                <td>
                  {item.attempts}/{item.max_attempts}
                </td>
                <td>{item.last_error_code ?? "—"}</td>
                <td>
                  {item.status === "pending" &&
                  isEmailDeferralCode(item.last_error_code)
                    ? item.available_at > now
                      ? dateTime(item.available_at)
                      : "Ready — awaiting worker"
                    : item.status === "failed"
                      ? dateTime(item.available_at)
                      : "—"}
                </td>
                <td>
                  {item.cc_review_required
                    ? "Team copy missed; review recipient"
                    : "—"}
                </td>
                <td>
                  {(item as { provider_message_id?: string | null })
                    .provider_message_id ?? "—"}
                </td>
                <td>
                  {item.cc_review_required && (
                    <ResolveMaturityCcReviewForm jobId={item.id} />
                  )}
                  {item.last_error_code === "NEEDS_RECONCILIATION" ? (
                    <>
                      <form action={reconcileJobDelivery}>
                        <input type="hidden" name="jobId" value={item.id} />
                        <input
                          type="hidden"
                          name="outcome"
                          value="confirmed_delivered"
                        />
                        <SubmitButton pendingLabel="Confirming…">
                          Confirm delivered
                        </SubmitButton>
                      </form>
                      <form action={reconcileJobDelivery}>
                        <input type="hidden" name="jobId" value={item.id} />
                        <input
                          type="hidden"
                          name="outcome"
                          value="authorize_resend"
                        />
                        <SubmitButton pendingLabel="Authorizing…">
                          Authorize resend
                        </SubmitButton>
                      </form>
                    </>
                  ) : (
                    (["failed", "dead"].includes(item.status) ||
                      (item.status === "pending" &&
                        isEmailDeferralCode(item.last_error_code))) && (
                      <form action={retryJob}>
                        <input type="hidden" name="jobId" value={item.id} />
                        <SubmitButton pendingLabel="Retrying…">
                          Retry
                        </SubmitButton>
                      </form>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
