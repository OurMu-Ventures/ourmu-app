# Hourly queue worker

The worker drains the `jobs` queue in successive batches of 10 (up to 50
claimed jobs or 40 seconds per run) so document generation, recipient
creation, and email delivery complete in the same hourly invocation when time
permits. Hourly GitHub scheduling remains subject to delays; this improves
throughput without promising immediate delivery.

## Schedule (private ops repository)

Production workflows live in the private `OurMu-Ventures/ourmu-ops`
repository, not here. Configure the hourly dispatch there:

```yaml
name: queue-worker
on:
  schedule:
    - cron: "17 * * * *" # hourly; GitHub may delay scheduled runs
  workflow_dispatch:
permissions: { contents: read }
concurrency:
  group: queue-worker
  cancel-in-progress: false # never overlap scheduled/manual runs
jobs:
  dispatch:
    runs-on: ubuntu-latest # standard Linux runner; keep each run under one billable minute
    steps:
      - name: Invoke worker
        env:
          PROD_BASE_URL: ${{ secrets.TEMP_DEPLOYMENT_URL }}
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          response=$(curl --fail --max-time 55 -s -X POST "${PROD_BASE_URL%/}/api/cron/jobs" \
            -H "Authorization: Bearer $CRON_SECRET")
          echo "$response" | jq . > worker-response.json
          echo "$response" | jq -e '.ok == true' > /dev/null
      - name: Validate queue response
        run: |
          # Fail on processing errors or database-state failures. Deliberate
          # quota/budget deferral is a reported condition, not a retry signal.
          jq -e '.jobs.failed == 0' worker-response.json > /dev/null
          jq -e '.jobs.stateErrors == 0' worker-response.json > /dev/null
          jq -e '.jobs.needsReconciliation == 0' worker-response.json > /dev/null
      - name: Summary
        if: always()
        run: |
          {
            echo "### Queue worker"
            echo ""
            jq -r '"- claimed: \(.jobs.claimed), succeeded: \(.jobs.succeeded), failed: \(.jobs.failed), deferred: \(.jobs.deferred), skipped: \(.jobs.skipped)"' worker-response.json
            jq -r '"- documents: \(.jobs.documentsGenerated), recipient jobs: \(.jobs.recipientJobsCreated), provider-accepted: \(.jobs.providerAccepted)"' worker-response.json
            jq -r '"- remaining due: \(.jobs.remainingDue), oldest due: \(.jobs.oldestDueAgeSec // "n/a")s, stop: \(.jobs.stopReason)"' worker-response.json
          } >> "$GITHUB_STEP_SUMMARY"
      - name: Queue age check
        run: |
          # Warn when due work is over two hours old; fail monitoring when it
          # is over six hours old or reconciliation is required.
          oldest=$(jq -r '.jobs.oldestDueAgeSec // 0' worker-response.json)
          if [ "$oldest" -gt 21600 ]; then
            echo "::error::Queue work is over six hours old (${oldest}s). Reconciliation may be required."
            exit 1
          elif [ "$oldest" -gt 7200 ]; then
            echo "::warning::Queue work is over two hours old (${oldest}s)."
          fi
```

Use the existing GitHub workflow notifications for failures. Do not add
recurring Resend alert emails. The existing `TEMP_DEPLOYMENT_URL` secret is the production base URL; the
workflow appends `/api/cron/jobs`. Confirm that the authorization secret name
matches the existing private ops workflow before copying this snippet.

## Worker response

The authenticated `POST /api/cron/jobs` response retains `{ ok, requestId,
jobs: { processed, succeeded, failed, deferred } }` and additionally reports
`claimed`, `skipped`, `providerAccepted` (Resend accepted, distinct from
delivery), `documentsGenerated`, `recipientJobsCreated`, `recoveredLeases`,
`needsReconciliation`, `stateErrors`, `remainingDue`, `oldestDueAgeSec`, and
`stopReason` (`queue_empty` | `job_budget` | `time_budget` |
`single_batch`). Audit records are preserved; recipient addresses and
credentials never appear in workflow logs.

## Safety properties

- Claims carry a unique token with a five-minute lease; completion and
  failure writes must match the token, so an expired worker cannot overwrite a
  newer attempt. Pre-send tracking also matches the token and running status,
  and requires a returned row before contacting the provider. Expired leases
  recover to pending before processing.
- Ambiguous email sends retry only with their original idempotency key inside
  Resend's 24-hour window; outside it they quarantine (`dead`,
  `NEEDS_RECONCILIATION`) for manual reconciliation. Existing dead jobs are
  never retried automatically.
- Removed requests, paid-out investments, removed aliases, and missing or
  not-ready receipt PDFs are checked immediately before sending.
- Provider sends are paced to one request per second per run; provider error
  codes are preserved and `Retry-After` is honoured. Quota, rate-limit, and
  local-budget deferrals never consume the ordinary retry budget, and
  document/recipient preparation continues while sending is deferred.
- Local email budget is a conservative 80 recipient deliveries/day and
  2,400 per rolling 31 days (To + CC + BCC, ambiguous sends counted,
  deduplicated retries consume each budget window once). A private reservation ledger and
  database advisory lock make tracking and reservations atomic across workers.
  Explicit provider rejections retain their reservations conservatively; worker
  retries on the same day do not reserve again. Retries crossing UTC midnight
  must reserve the new day's capacity while retaining one monthly charge.
  Historical sends seed the ledger at rollout. It is reconciled against provider quota responses:
  authentication SMTP and manual sends share the same Resend allowance, so
  local counters alone are not a complete account quota guarantee.

## Rollout

1. Before rollout, measure organization-wide GitHub minutes, Supabase
   database/storage/egress usage, and current Resend usage. Proceed only with
   headroom for backups, maintenance, builds, and login emails.
2. Pause scheduled/manual queue dispatches and let any current invocation
   finish. Apply `20261005000000_queue_worker_throughput.sql`, followed by
   `20261005115634_queue_worker_review_fixes.sql`, before deploying the worker.
   The second migration gives legacy running documents/fan-out jobs five minutes
   to settle and quarantines legacy recipient emails without send tracking as
   `NEEDS_RECONCILIATION`. Inspect these rows before retrying; never bulk-reset
   dead email jobs. Deploy the worker, update the private ops workflow, then
   resume dispatches. A code rollback must retain both migrations and the
   pre-send token/tracking safeguards; old workers cannot enforce these guards.
3. Manually dispatch one monitored production run; verify generated receipts
   and provider acceptance.
4. Observe quota consumption, queue age, and duplicate prevention for 48 hours.
5. If necessary, roll queue draining back to one batch while retaining the
   stale-email protections and recovery safeguards.

## Verification commands

- `npm test`, `npx tsc --noEmit`, and ESLint on touched files.
- `node scripts/test-queue-worker-migration.mjs` checks legacy backfill and
  quarantine in a local transaction that rolls back.
- `supabase test db` includes reservation counting, stale tracking, deduplication,
  monthly rollover, and privilege checks.
- `node scripts/test-queue-budget-concurrency.mjs` uses two local Postgres
  sessions competing for the last daily slot. Run on an empty local test budget.

Cancellation is cooperative: all job Supabase/Storage operations and provider
fetches receive the job signal. A delayed PDF can finish computing but cannot
start an upload, record write, fan-out or send after cancellation. Already
accepted external operations cannot be undone; ambiguous sends retain their
tracking/reservation and the original 24-hour reconciliation protection.
