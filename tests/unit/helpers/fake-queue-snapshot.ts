import { isEmailDeferralCode } from "@/lib/email/quota";

type FakeJobRow = Record<string, unknown>;

function timestamp(job: FakeJobRow, column: string): string | null {
  const value = job[column];
  return typeof value === "string" ? value : null;
}

function earliest(values: Array<string | null>): string | null {
  return (
    values.filter((value): value is string => value !== null).sort()[0] ?? null
  );
}

function latest(values: Array<string | null>): string | null {
  return (
    values
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null
  );
}

// public.job_queue_snapshot over fake jobs, with the SQL semantics: the email
// hold is global, due work and expired leases are filtered by campaign, and
// timestamps compare as ISO strings like the fake query builders do.
export function fakeQueueSnapshotRow(
  jobs: readonly FakeJobRow[],
  campaignId: string | null = null,
  nowMs = Date.now(),
) {
  const now = new Date(nowMs).toISOString();
  const queued = (job: FakeJobRow) =>
    job.status === "pending" || job.status === "failed";
  const inCampaign = (job: FakeJobRow) =>
    campaignId === null ||
    (job.entity_type === "email_campaign" && job.entity_id === campaignId);
  const holdRows = jobs.filter((job) => {
    const availableAt = timestamp(job, "available_at");
    return (
      job.kind === "send_email" &&
      queued(job) &&
      isEmailDeferralCode(job.last_error_code) &&
      availableAt !== null &&
      availableAt > now
    );
  });
  // order by available_at desc, last_error_code
  const hold = [...holdRows].sort((a, b) => {
    const aUntil = String(timestamp(a, "available_at"));
    const bUntil = String(timestamp(b, "available_at"));
    if (aUntil !== bUntil) return aUntil < bUntil ? 1 : -1;
    const aCode = String(a.last_error_code);
    const bCode = String(b.last_error_code);
    return aCode < bCode ? -1 : aCode > bCode ? 1 : 0;
  })[0];
  const heldBack = (job: FakeJobRow) =>
    job.kind === "send_email" && holdRows.length > 0;
  const due = jobs.filter((job) => {
    const availableAt = timestamp(job, "available_at");
    return (
      queued(job) &&
      availableAt !== null &&
      availableAt <= now &&
      inCampaign(job)
    );
  });
  const processable = due.filter((job) => !heldBack(job));
  const leases = jobs.filter((job) => {
    const leaseExpiresAt = timestamp(job, "lease_expires_at");
    return (
      job.status === "running" &&
      leaseExpiresAt !== null &&
      leaseExpiresAt < now &&
      inCampaign(job)
    );
  });
  const availableAt = (job: FakeJobRow) => timestamp(job, "available_at");
  const leaseExpiresAt = (job: FakeJobRow) =>
    timestamp(job, "lease_expires_at");
  return {
    snapshot_at: now,
    email_hold_code: hold ? String(hold.last_error_code) : null,
    email_hold_until: hold ? availableAt(hold) : null,
    held_email_count: holdRows.length + due.filter(heldBack).length,
    due_count: due.length,
    processable_due_count: processable.length,
    oldest_due_at: earliest(due.map(availableAt)),
    oldest_processable_due_at: earliest(processable.map(availableAt)),
    // greatest() ignores nulls.
    newest_ready_at: latest([
      latest(processable.map(availableAt)),
      latest(leases.map(leaseExpiresAt)),
    ]),
    expired_lease_count: leases.length,
    oldest_expired_lease_at: earliest(leases.map(leaseExpiresAt)),
  };
}
