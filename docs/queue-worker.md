# Job worker and Supabase Cron dispatcher

The worker drains the `jobs` queue in successive batches of 10 (up to 50
claimed jobs or 40 seconds per run) so document generation, recipient
creation, and email delivery complete in the same invocation when time
permits. A Supabase Cron dispatcher starts it within about two minutes of work
becoming due; a daily Vercel Cron and an hourly GitHub watchdog back it up.

## Triggers

Three independent triggers call the worker:

- **Supabase Cron** (primary): the `ourmu-job-dispatch` job runs
  `private.dispatch_job_worker()` every 2 minutes. It calls
  `POST /api/cron/jobs` through pg_net with `JOB_TRIGGER_SECRET`, and only
  when processable work is due or a lease has expired. Idle ticks never reach
  Vercel.
- **Vercel Cron** (daily): `vercel.json` schedules `GET /api/cron/maintenance`
  at `0 4 * * *` with `CRON_SECRET`. Hobby delivers it once, anywhere between
  04:00 and 04:59 UTC (07:00-07:59 Kampala), without retries. The route runs
  maintenance, then drains the queue.
- **ourmu-ops** (watchdog and fallback): `jobs.yml` calls
  `POST /api/cron/jobs` with `CRON_SECRET` at minute 17 of every hour; GitHub
  delivers about 4-5 of those runs a day. `maintenance.yml` posts to
  `/api/cron/maintenance` at `0 4 * * *` as the late maintenance fallback;
  GitHub usually starts it hours late.

They overlap safely: claims carry tokens and leases, the email budget ledger
takes a lock, sends reuse their idempotency keys, and maintenance runs under
advisory try-lock `87005/2` (`public.run_maintenance_exclusive`), so a
concurrent duplicate returns `{"skipped": "concurrent"}` and a later one
re-runs idempotent maintenance.

`/api/cron/jobs` accepts only `POST` (`GET` gets 405) with either
`CRON_SECRET` or `JOB_TRIGGER_SECRET`. `/api/cron/maintenance` accepts `GET`
(Vercel Cron) and `POST` (GitHub, manual) with `CRON_SECRET` only. Both need
`Authorization: Bearer <secret>`; a secret is compared only when it is
configured with 32 to 512 characters, and a missing scheme or an empty token
is rejected before any comparison. Every authenticated run is recorded in
`private.job_worker_runs` (counts and codes only, kept 30 days) with its
trigger: `pg_cron` for `JOB_TRIGGER_SECRET`, `vercel_cron` for the
`vercel-cron/1.0` user agent, `github` or `manual` from the `x-ourmu-trigger`
header, otherwise `unknown`.

The maintenance route always drains after maintenance, also when maintenance
failed, so email is never blocked by it. The drain gets
`max(5 s, 40 s - elapsed)`; PostgREST's 8-second statement timeout caps
maintenance, so the route ends well inside its 60-second `maxDuration`.

## Dispatcher

`private.dispatch_job_worker(p_probe boolean default false)` keeps its state
in the single row of `private.job_dispatch_state`. pg_cron runs it as
`postgres`, its owner; no API role can execute it. It never raises and returns
the tick's reason (`cron.job_run_details.return_message` shows only `1 row`).
Each tick takes advisory lock `87005/3` (a concurrent tick returns `busy` and
changes nothing), then:

1. **Scores the previous request** once its outcome is known (table below).
   There is never more than one outstanding request.
2. **Checks the configuration** on every tick, before it looks at the queue,
   so a broken setup stays visible as `DISPATCHER_ERROR` while the queue is
   idle or held. It reads the Vault secrets `ourmu_job_worker_url` and
   `ourmu_job_trigger_secret`, with no network call:
   - a secret that does not decrypt (for example after a restore into another
     project) gives `secret_unreadable`, with
     `last_error = 'VAULT <sqlstate>: <message>'`;
   - a missing secret gives `not_configured`;
   - a URL other than `https://<host>[:<port>]/api/cron/jobs` gives
     `invalid_url`: `http`, userinfo, a query, a fragment, a trailing slash
     and any other path are rejected. In production it must be
     `https://partners.ourmu.org/api/cron/jobs`, the canonical host, which
     answers without a redirect;
   - a token shorter than 32 or longer than 512 characters, or with whitespace
     or control characters, gives `invalid_secret`.
3. **Reads the queue** with `public.job_queue_snapshot()`. With nothing
   processable and no expired lease, nothing is stuck any more: the tick ends
   the no-progress backoff and stops as `held` (an email hold is active) or
   `idle`. Consecutive failures stay counted.
4. **Failure backoff**: after 3 consecutive failures it dispatches at most once
   per 15 minutes (`failure_backoff`).
5. **No-progress backoff**: during a no-progress wait it does not dispatch
   (`no_progress`) unless new work became ready since the stuck dispatch. New
   jobs, retries that became due and newly expired leases bypass the wait; the
   stuck set does not.
6. **Dispatches** one `POST` with `Authorization: Bearer <token>`,
   `x-ourmu-trigger: pg_cron`, `x-ourmu-dispatch-id: <uuid>` and a 120-second
   pg_net timeout (`dispatched`).

An error anywhere in a tick rolls the tick back, including a request queued in
that tick and with it the plaintext bearer, and records
`last_reason = 'error'` with `last_error = '<sqlstate>: <message>'`.

Scoring the previous request:

| Observation | Outcome | Effect |
| --- | --- | --- |
| 2xx, a JSON object with `ok: true` and a `jobs` object holding the six counters as integers, where nothing was claimed or recovered although work was due, and work is still left | `no_progress` | Failures reset; streak + 1; no dispatch for 30, then 60 minutes after the stuck dispatch |
| 2xx with a valid body otherwise, including `claimed = 0` with nothing left (another trigger took the work) | `ok` | Failures and streak reset |
| 2xx whose body is not a JSON object, lacks `ok: true` or a `jobs` object, or lacks an integer counter | `bad_response` (†) | Failure |
| Non-2xx | `http_error` | Failure |
| pg_net timed out | `timed_out` (†) | Failure |
| pg_net error, or no status | `transport_error` (†) | Failure |
| No response; still queued for under 3 minutes, or sent under 150 s ago | none | `outstanding`; stop |
| No response; still queued after 3 minutes | `stalled` | One failure, counted once; `pg_net_stalled`; nothing more is queued while it waits |
| No response; sent 150 s ago or more | `lost` (†) | Failure |

(†) First the dispatcher looks up the run the route recorded under the same
dispatch id. If that run finished with `ok = true`, the outcome comes from the
run's counters with the same rule (`ok` or `no_progress`), so a timed-out,
lost or unreadable response for a run that did happen is not a failure.

The six counters are `jobs.claimed`, `jobs.recoveredLeases`,
`jobs.processableDueBefore`, `jobs.expiredLeasesBefore`,
`jobs.remainingProcessableDue` and `jobs.remainingExpiredLeases`.

How the backoffs end:

- The failure backoff, and `DISPATCH_FAILING`, end only with an `ok` outcome:
  a later dispatch that succeeds, or the owner probe. An idle queue does not
  end them, because the delivery path is still unproven.
- The no-progress backoff, and `DISPATCH_NO_PROGRESS`, end with an `ok`
  outcome, early when new work becomes ready, and at the first tick that finds
  nothing processable or expired: an admin resolved the stuck jobs, the
  database retired them, or another trigger drained them.

The route's `maxDuration` is 60 s, so a run that overruns comes back as
Vercel's HTTP 504 (`http_error`); pg_net's 120-second timeout only fires on
network hangs. Three real failures in a row lead to dispatches 15 minutes
apart, never to silence, and the watchdog and the daily Vercel Cron keep
draining regardless.

**Owner probe.** `select private.dispatch_job_worker(true);`, run by hand in
the SQL editor as `postgres`, dispatches once even when the queue is idle or a
backoff is active. It still scores the previous request and checks the
configuration first, so it never adds a second outstanding request and never
sends with a broken configuration. On an empty queue the worker answers 200
with every counter at 0, which scores `ok` and resets the failures. pg_cron
never passes the flag. Use the probe at setup, after a secret rotation, and to
clear `DISPATCH_FAILING` after an outage whose work another trigger already
drained. Its outcome shows in `private.job_dispatch_state` (`last_outcome`,
`last_http_status`) within one or two ticks.

**Queue snapshot.**
`public.job_queue_snapshot(p_campaign_id uuid default null)` is the only
definition of email hold, due, processable and expired lease. The dispatcher,
the health RPC and the worker (before and after each drain) all call it. An
email hold is any `send_email` job in `pending` or
`failed` whose `last_error_code` is one of `EMAIL_DEFERRAL_CODES` and whose
`available_at` is still ahead; it applies to every campaign. While a hold
exists, due `send_email` jobs are held back and are not processable. Due means
`pending` or `failed` with `available_at <= now()`; an expired lease is a
`running` job whose `lease_expires_at` has passed. A parity unit test keeps the
SQL code list equal to `EMAIL_DEFERRAL_CODES`.

## Worker response

The authenticated `POST /api/cron/jobs` answers with
`Cache-Control: no-store`:

- 200: `{ ok: true, requestId, trigger, jobs, health | healthError, runRecorded }`;
- 503: `{ ok: false, requestId, trigger, error, health | healthError, runRecorded }`;
- 401: `{ error: "unauthorized", requestId }`, before any processing.

`health` is `public.job_dispatch_health()` as it was **before** this run's
drain; `healthError: "JOB_HEALTH_FAILED"` replaces it when the read failed.
The route reads it for every trigger except `pg_cron` (the dispatcher's own
runs skip it to save a request), and for `github` it reads the watchdog
window (see Health and alerting). `runRecorded` says whether the run reached
`private.job_worker_runs`; the route records it last.

`jobs` keeps `processed`, `succeeded`, `failed`, `deferred`, `claimed`,
`skipped` (lost claims, stale completions, suppressed deliveries, deliberate
drops), `providerAccepted` (Resend accepted, distinct from delivery),
`documentsGenerated`, `recipientJobsCreated`, `recoveredLeases`,
`needsReconciliation`, `stateErrors`, `remainingDue` (everything due after the
run, held emails included), `oldestDueAgeSec` and `stopReason`
(`queue_empty` | `job_budget` | `time_budget` | `single_batch`), and adds:

- `unclaimable`: distinct jobs whose claim matched no row in this run;
- from the snapshot after lease recovery, before the drain: `dueBefore`,
  `processableDueBefore`, `oldestDueAgeSecBefore` (seconds since the oldest
  processable job became due) and `expiredLeasesBefore` (expired leases the
  recovery step could not recover);
- from the snapshot after the drain: `remainingProcessableDue`,
  `remainingExpiredLeases` and `emailHold` (`{ code, until }` or `null`).

`oldestDueAgeSec` changed meaning with the dispatcher: it is measured after
the drain, from `available_at` (when the oldest processable job became due),
and leaves held emails out. It used to count from `created_at` and include
held emails.

The dispatcher requires the six counters listed under Dispatcher in every
success body; a missing one is a `bad_response`. It ignores the request body
(`{"dispatchId": ...}`); the header carries the dispatch id.

`/api/cron/maintenance` answers
`{ ok, requestId, trigger, maintenance, jobs, health | healthError, runRecorded }`,
plus `error` on a 503. `maintenance` is `run_maintenance`'s own result,
`{"skipped": "concurrent"}` when another call held the lock, or `null` when it
failed (`maintenance_failed`). This route reads health after its drain, for
information only.

Audit records are preserved; recipient addresses and credentials never appear
in responses, the run log, or workflow logs.

## Health and alerting

`public.job_dispatch_health(p_since_last_watchdog boolean default false)`
returns one JSON object: `generatedAt`, `status` (`fail` with any problem,
else `warn` with any warning, else `ok`), `problems` and `warnings` (each
`{ code, detail }`), `thresholds`, and the sections `dispatcher`, `pgNet`,
`queue`, `jobs`, `workerRuns` and `maintenance`. Only `service_role` can call
it. The thresholds live only in this function and are echoed in `thresholds`;
all window arithmetic uses database time.

| Code | Level | Condition |
| --- | --- | --- |
| `DISPATCHER_NOT_CONFIGURED` | fail | A Vault secret name is missing |
| `DISPATCHER_NOT_SCHEDULED` | fail | No active cron job `ourmu-job-dispatch`, or no pg_cron |
| `DISPATCHER_TICK_STALE` | fail | No tick for over 600 s (five missed ticks), or never |
| `DISPATCHER_ERROR` | fail | The last tick ended `not_configured`, `invalid_url`, `invalid_secret`, `secret_unreadable` or `error`; reported while idle too |
| `DISPATCH_FAILING` | fail | 3 or more consecutive failures; stays until an `ok` outcome, also while idle |
| `DISPATCH_NO_PROGRESS` | fail | A no-progress backoff is active |
| `PG_NET_STALLED` | fail | The last tick found its request stalled, or the request has been queued for over 300 s |
| `PG_NET_WORKER_DOWN` | fail | pg_net is installed and its background worker is missing from `pg_stat_activity` |
| `QUEUE_STUCK` | fail | Processable work due for over 900 s; held emails are not processable |
| `LEASES_EXPIRED` | fail | A lease expired over 900 s ago |
| `JOBS_DEAD` | fail | Jobs died in the dead-job window, deliberate drops excluded |
| `RECONCILIATION_OPEN` | fail | Jobs in `failed` or `dead` with `NEEDS_RECONCILIATION`, any age |
| `WORKER_RUNS_FAILED` | fail | Worker runs with `ok = false` in the window |
| `JOB_FAILURES` | fail | Failed job attempts in the window |
| `STATE_ERRORS` | fail | State errors in the window |
| `RECONCILIATION_EVENTS` | fail | Reconciliation quarantines in the window |
| `MAINTENANCE_STALE` | fail | No `maintenance.completed` audit event, or none for over 115,200 s (32 hours) |
| `EMAIL_HOLD` | warn | An email hold from any `EMAIL_DEFERRAL_CODES` value is active |
| `UNCLAIMABLE_JOBS` | warn | Claims matched no row in the window |
| `PG_NET_QUEUE_BACKLOG` | warn | `net.http_request_queue` holds more than the dispatcher's one request |

`MAINTENANCE_STALE` waits 32 hours because the Vercel Cron and the
`maintenance.yml` fallback both run daily at 04:00 UTC: it fires only when
both missed a day, and a fallback that GitHub delivers late raises no false
alarm.

**Event windows.** Admin → Jobs and every trigger except `github` read the
last 24 hours. The watchdog (trigger `github`, which reads health with
`p_since_last_watchdog = true`) reads only what the previous watchdog run
could not have reported, so each event fails one watchdog run:

- the previous watchdog run is the latest one that answered 200 with health,
  because only then does `jobs.yml` evaluate it. A watchdog run that answered
  503 or could not read health moves neither window, so the next run reports
  what it missed, and may report a death in that run's own drain a second
  time;
- worker-run sums (`WORKER_RUNS_FAILED`, `JOB_FAILURES`, `STATE_ERRORS`,
  `RECONCILIATION_EVENTS`, `UNCLAIMABLE_JOBS`) count runs recorded after the
  previous watchdog read its health, and leave out the watchdog's own
  jobs-route runs, which already failed on their own processing;
- `JOBS_DEAD` counts jobs that died after the previous watchdog recorded its
  run, because deaths in its own drain already failed that run;
- maintenance-route runs never move either window, and both windows reach back
  at most 24 hours, which is what the first watchdog run after setup reads.

Narrow gaps remain: a run recorded at the very moment a watchdog reads health;
a job killed by the campaign worker, which records no run (only `JOBS_DEAD`
sees it); and a watchdog run whose 200 answer never reached GitHub, which
fails without reporting its health but still moves the windows.
`RECONCILIATION_OPEN` is a standing condition, not an event: it fails every
watchdog run until an admin resolves the rows in Admin → Jobs, because a
quarantined email needs a human decision.

**Deliberate drops.** `RESERVATION_NOT_FOUND`, `STALE_MATURITY_CONFIRMATION`,
`STALE_RESERVATION` and every code ending in `_CANCELLED` mean the email is no
longer relevant. The worker counts them as `skipped`, not `failed`. Health
counts them in `jobs.dropped24h`, shown in Admin → Jobs and never alerted, and
leaves them out of `dead24h`, `deadInWindow`, `JOBS_DEAD` and `JOB_FAILURES`.
`DELIBERATE_DROP_CODES` in `src/lib/jobs.ts` mirrors the SQL list (parity unit
test).

**Watchdog.** ourmu-ops `jobs.yml` sends `x-ourmu-trigger: github`, so the
route reads health before its own drain, then drains as a fallback. The run
fails when the call fails; when its own run had failed jobs, state errors or
reconciliation quarantines; when processable work had waited longer than
`thresholds.processableDueAgeSec` (900 s) before it started; or when health is
missing or lists any problem. Each problem becomes an error annotation.
Warnings, deliberate email holds included, become warning annotations and
never fail the run. When a hold ends, though, the emails it held back become
processable at once with their old due times, so a watchdog run in the next
few minutes can fail on `QUEUE_STUCK` or on the time work had waited (see
Troubleshooting). Use the existing GitHub workflow notifications for
failures. Do not add recurring Resend alert emails.

Admin → Jobs shows the same health in Africa/Kampala time: a banner for an
email hold, a banner for dead jobs in the last 24 hours and open
reconciliation, the **Worker trigger** panel (status, problems and warnings,
dispatcher, pg_net, deliberately dropped emails, last maintenance) and the
last 20 worker runs.

## Retry schedule and holds

- Failed attempts retry after 5, 15, 45, 135, 300, 300 and 300 minutes,
  18 hours 20 minutes over the default 8 attempts. With dispatch latency
  (about 2 minutes per retry, or 15 minutes under the failure backoff) the
  last attempt still falls inside Resend's 24-hour idempotency window, so a
  retry of an ambiguous send keeps its idempotency key instead of being
  quarantined. Quota, rate-limit and budget deferrals consume no attempts.
- A daily Resend quota refusal (`EMAIL_DAILY_QUOTA_EXCEEDED`) checks again at
  the earlier of the next 00:01 UTC (03:01 Kampala) and three hours later.
  Resend documents the daily quota both as a UTC calendar day and as a rolling
  24 hours, and this rule suits both: while the quota stays exhausted it costs
  at most 8 refused calls a day, none of them sent.
- A monthly quota refusal checks again every 24 hours. Rate limits honour
  `Retry-After` (5 seconds to 15 minutes).
- A daily local budget hold (`EMAIL_BUDGET_DEFERRED`) resumes exactly at the
  next 00:01 UTC, when the local daily count resets; a monthly budget hold
  checks again every 24 hours.
- During any hold, documents and other non-email work continue, and the
  dispatcher reports `held` only when nothing else is processable.
- **Retry** in Admin → Jobs works on failed and dead jobs and on pending jobs
  held by any deferral code. It makes the job due at once, so the dispatcher
  picks it up within about two minutes. An email hold pauses all email,
  though: a retried email waits while any other email is still deferred, so
  retry every deferred email to end a hold early. Retry does not reset
  `attempts`: a dead job gets one more attempt.

## Production setup

Production only. Migrations ship definitions and never schedule a cron job or
write Vault secrets, so local and CI databases stay inert. Run the SQL below
in the production project's SQL editor as `postgres`, the editor's default
role.

Deploy order: first merge #127 (stale maturity confirmation retirement) with a
merge commit, not a squash, because this change is stacked on it; its
migration and its app deploy in either order. Then edit this change's pull
request and set its base branch to `main`: GitHub retargets it on its own only
when #127's branch is deleted, and merged branches are kept here. Check that
the pull request then shows only this change's commits. Then apply this
change's migration before its app deploys (step 1), and only then merge it
(step 2).

1. **Apply the migration before the app.** The new worker calls
   `public.job_queue_snapshot` and answers 503 on every run until the
   migration exists. From a checkout of this change linked to the production
   project, run `supabase db push --dry-run`. It lists
   `20261103073957_job_dispatcher.sql`, and also
   `20261103030635_retire_stale_maturity_confirmation_jobs.sql` if #127's
   migration is not applied yet; the two may go together. Then run
   `supabase db push`. The migration creates pg_cron only if it is missing and
   changes no existing privilege; the deployed app keeps working and ignores
   the new objects. Then check:

   ```sql
   -- 0: the migration schedules nothing
   select count(*) from cron.job where jobname like 'ourmu-%';
   -- tested with pg_cron 1.6.4 and pg_net 0.20.4
   select extname, extversion from pg_catalog.pg_extension
   where extname in ('pg_cron', 'pg_net') order by extname;
   select public.job_dispatch_health() -> 'problems';
   ```

   - pg_cron 1.6.4 and later restart a stopped scheduler on their own; with an
     older pg_cron, `DISPATCHER_TICK_STALE` needs a fast database reboot. With
     a pg_net older than 0.20.4,
     `select to_regprocedure('net.worker_restart()');` must not be null,
     because Troubleshooting uses it; the probe in step 7 proves the rest.
   - The problems are `DISPATCHER_NOT_CONFIGURED`, `DISPATCHER_NOT_SCHEDULED`
     and `DISPATCHER_TICK_STALE` ("the dispatcher has never run").
     `QUEUE_STUCK` can also appear while the hourly worker is still the only
     trigger, and `MAINTENANCE_STALE` if maintenance has not completed in the
     last 32 hours. For a `PG_NET_*` code, see Troubleshooting before you go
     on. Any other code is existing backlog; look at it now:

   ```sql
   select status, last_error_code, count(*)
   from public.jobs
   where (status in ('failed', 'dead') and last_error_code = 'NEEDS_RECONCILIATION')
      or (status = 'dead' and updated_at > now() - interval '24 hours')
   group by 1, 2 order by 1, 2;
   ```

2. **Merge this change.** Vercel deploys production and registers the cron:
   Settings → Cron Jobs lists `/api/cron/maintenance` with `0 4 * * *`. The
   current ourmu-ops `jobs.yml` keeps working with `CRON_SECRET`.
3. **Generate `JOB_TRIGGER_SECRET`** on a trusted machine:
   `openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-48`. That gives 48
   characters with no whitespace. Never paste it into tickets or chat.
4. **Vercel.** In Settings → Environment Variables, add `JOB_TRIGGER_SECRET`
   for **Production** only (no trailing newline), then redeploy production.
   In Firewall, check that Attack Mode is off and the Bot Protection managed
   ruleset is Off or Log (see Firewall in `docs/production-runbook.md`).
5. **Supabase Vault.** In the production project's Vault (Integrations →
   Vault → Secrets; the path may move), add `ourmu_job_worker_url` =
   `https://partners.ourmu.org/api/cron/jobs` (no trailing slash) and
   `ourmu_job_trigger_secret` = the value from step 3. Use the UI, not the SQL
   editor, so the plaintext is never kept in saved snippets or SQL history.
6. **Schedule** the dispatcher once. The SQL holds no secrets and is
   idempotent: `cron.schedule` with an existing name updates that job. It
   does not resume a paused job, so the last query must show `active` true
   for both jobs (Rollback step 1 shows how to resume one).

   ```sql
   select cron.schedule(
     'ourmu-job-dispatch',
     '*/2 * * * *',
     'select private.dispatch_job_worker()'
   );
   select cron.schedule(
     'ourmu-cron-history-cleanup',
     '23 3 * * *',
     $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
   );
   select jobid, jobname, schedule, command, active
   from cron.job where jobname like 'ourmu-%' order by jobname;
   ```

7. **Prove the path once**, even with an empty queue:
   - `select private.dispatch_job_worker(true);` must return `dispatched`.
     `not_configured`, `invalid_url` or `invalid_secret` name the Vault value
     to fix (step 5); `outstanding` means a request is still in flight, so run
     it again 2-3 minutes later.
   - Within 4 minutes (two ticks score it; or run
     `select private.dispatch_job_worker();` about 20 seconds after the probe
     to score it at once),
     `select last_reason, last_outcome, last_http_status, consecutive_failures from private.job_dispatch_state;`
     must show `last_outcome = 'ok'` and `last_http_status = 200`. A 401 means
     the Vercel variable is missing, was not redeployed, or differs from the
     Vault value (step 4); fix it and probe again.
   - Then run Production verification below, and wait for the first Vercel
     Cron run (04:00-04:59 UTC the next day): Admin → Jobs shows a
     `maintenance` run with trigger `vercel_cron`. Hobby keeps runtime logs
     for only 1 hour; the run log keeps runs for 30 days.
8. **Resolve the backlog** from step 1 in Admin → Jobs before enabling the new
   watchdog:
   - every `NEEDS_RECONCILIATION` row: check Resend, then choose **Confirm
     delivered** or **Authorize resend**. Never bulk-reset dead email jobs;
   - dead jobs from the last 24 hours: **Retry** the ones that should get
     another attempt (Retry gives one more attempt);
   - `select public.job_dispatch_health(true) -> 'problems';` should then list
     nothing you do not expect.
9. **ourmu-ops** (owner):
   - in Settings → Secrets and variables → Actions, make sure
     `TEMP_DEPLOYMENT_URL` is exactly `https://partners.ourmu.org`, and update
     it if it holds anything else;
   - update `jobs.yml` to the reference workflow below and `maintenance.yml`
     as described there (the ourmu-ops change for this release does both);
   - run **Production job worker watchdog** once with `workflow_dispatch`.
   - The first watchdog run has no earlier watchdog run, so it looks back 24
     hours. A red run that lists only `RECONCILIATION_OPEN`, `JOBS_DEAD`,
     `JOB_FAILURES`, `STATE_ERRORS`, `RECONCILIATION_EVENTS` or
     `WORKER_RUNS_FAILED` is backlog, not a broken dispatcher.
     `DISPATCHER_*`, `DISPATCH_*`, `PG_NET_*`, `QUEUE_STUCK`, `LEASES_EXPIRED`
     and the "Processable work had waited" error are dispatcher problems: see
     Troubleshooting.
   - Keep `TEMP_DEPLOYMENT_URL`: the rollback uses it.
10. **After a week**, compare Supabase Usage (log ingest, database size,
    egress), Vercel Usage and GitHub billing with Free-tier usage below. The
    size of a log event is not verified yet; this reading settles the
    log-ingest estimate.
11. **Record** the setup, the limits (including the `cron.log_statement`
    lever and the Firewall guidance), the rollback and the pg_cron self-grant
    gotcha in the NFE Library (bookstack.nearlyfreeenergy.com) with the NFE
    Library skill, and keep that page current as the dispatcher changes.

### Free-tier usage

Typical traffic is about 1,000 dispatched runs a month, plus 31 Vercel Cron
runs, about 150 watchdog runs and 31 `maintenance.yml` runs:

- **Vercel Hobby**: about 2,400 function invocations a month (each call also
  invokes `proxy.ts`), 0.24% of 1M; about 4.4 GB-hours of provisioned memory
  (1.2%); 0.02-0.10 hours of Active CPU (0.4-2.5%); under 0.2% of CDN
  requests. At 3,000 dispatched runs: 0.64%, 3.3% and 1.1-6.7%. The cron is
  one Vercel Cron job, once a day, as Hobby allows.
- **Supabase Free**: 21,600-22,320 pg_cron ticks a month, each a short
  connection. `cron.job_run_details` grows about 721 rows a day, and the
  7-day cleanup keeps it near 5,000 rows (about 2 MB).
  `private.job_worker_runs` holds about 1,200 rows (30 days, about 0.5 MB).
  The database grows 2-3 MB; egress is about 24 MB (0.5%).
- **Supabase log ingest** is the meter to watch. pg_cron writes 2 log lines
  per run while `cron.log_statement` is on (its default), about 44,700 a
  month, and each worker run adds about 15 API log events. At an assumed
  0.5-2 KB per event that is 31-126 MB a month (3-13% of 1 GB), or 9-36 MB
  with `cron.log_statement` off.
- **GitHub Free**: about 150 watchdog runs and 31 maintenance runs at one
  `ubuntu-slim` minute each; with backups, about $0.68 a month of the $12
  included (5.7%), and at most about $3.42 if every hourly slot ran for two
  minutes. `timeout-minutes: 3` caps a hung run.
- **Resend Free**: volume is unchanged (local caps of 80 a day and 2,400 per
  31 days); at most 8 refused quota checks a day during a daily quota hold.

Failing dispatches are capped by the failure backoff at 3 plus 96 a day, and
stuck work by the no-progress backoff at about one dispatch an hour plus one
per newly ready job.

If log ingest is above 50% of the allowance, first turn off
`cron.log_statement`, the largest new log source; it costs no latency. An
organization Owner or Administrator runs
`supabase postgres-config update --config cron.log_statement=false --remote=<project-ref> --experimental`.
It restarts Postgres for a few seconds, so run it at a quiet hour, or add
`--no-restart` and let the next restart apply it. Keep `cron.log_run` on:
health and Production verification read `cron.job_run_details`. Only if
ingest stays above 50% after that, slow the dispatcher (ticks scale linearly):

```sql
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'ourmu-job-dispatch'),
  schedule := '*/3 * * * *' -- or '*/5 * * * *'
);
```

Do not move to every minute unless `cron.log_statement` is off and log ingest
is under about 25%.

## Production verification

```sql
-- ticks (expect 'succeeded' every 2 minutes)
select d.status, d.return_message, d.start_time
from cron.job_run_details d join cron.job j on j.jobid = d.jobid
where j.jobname = 'ourmu-job-dispatch' order by d.runid desc limit 10;
-- owner probe: proves Vault -> pg_net -> Vercel -> worker even with an empty queue
select private.dispatch_job_worker(true);            -- expect 'dispatched'
-- dispatcher decisions (within 4 minutes of the probe expect last_outcome 'ok',
-- last_http_status 200, consecutive_failures 0; afterwards last_reason idle/held/dispatched)
select last_tick_at, last_reason, last_dispatch_at, last_outcome, last_http_status,
       consecutive_failures, no_progress_streak, no_progress_until, last_error
from private.job_dispatch_state;
-- responses (expect 200 only for the probe and when work was due)
select id, status_code, timed_out, error_msg, created from net._http_response order by created desc limit 10;
select public.job_dispatch_health() -> 'problems';   -- expect [] once the backlog is resolved
select * from public.job_worker_recent_runs(20);
```

Never select `net.http_request_queue.headers` on a shared screen: it holds the
bearer until pg_net sends the request.

## Rollback

Pick the smallest step that solves the problem.

1. Stop the dispatcher only: `select cron.unschedule('ourmu-job-dispatch');`
   (history is kept), or pause it with
   `select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'ourmu-job-dispatch'), active := false);`
   and later resume it with
   `select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'ourmu-job-dispatch'), active := true);`
   (re-running the scheduling SQL does not resume it).
   The new watchdog then fails on `DISPATCHER_NOT_SCHEDULED` and
   `DISPATCHER_TICK_STALE`, so also revert `jobs.yml` in ourmu-ops to its
   previous commit. That old hourly worker works with both app versions,
   because `TEMP_DEPLOYMENT_URL` still exists and points at production.
2. Stop the Vercel Cron only: Vercel Settings → Cron Jobs → **Disable Cron
   Jobs**. The setting persists across deployments, promotions and Instant
   Rollbacks until you re-enable it. `maintenance.yml` keeps running
   maintenance daily.
3. Revert the app: do step 1 first, then revert this change on `main` and let
   Vercel deploy it: use **Revert** on the merged pull request, or
   `git revert -m 1 <merge sha>` for a merge commit (`git revert <sha>` for a
   squash merge). That also removes `vercel.json` and its cron. Do not use
   Instant Rollback for this. On Hobby it can only return to the immediately
   previous production deployment, which after setup step 4's redeploy is
   this change's own build. After any Instant Rollback Vercel also stops
   auto-assigning production domains, so the revert would not go live until
   you select **Undo Rollback** or promote the revert deployment. The new
   `maintenance.yml` works with the old app (`POST`, `CRON_SECRET`).
4. Keep the migration: it is additive and inert without a schedule, and the
   old worker ignores it.
5. Optionally delete both Vault secrets and the Vercel variable
   `JOB_TRIGGER_SECRET`.
6. Never `drop extension pg_cron`: it deletes all cron jobs.

Record every rollback on the dispatcher's NFE Library page (setup step 11).

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `PG_NET_STALLED` or `PG_NET_WORKER_DOWN` | `select count(*) from net.http_request_queue;`, then `select net.worker_restart();`. The dispatcher resumes on its own; run the owner probe to confirm |
| `DISPATCHER_TICK_STALE` without `DISPATCHER_NOT_SCHEDULED` | pg_cron is not running the job. If the ticks query in Production verification shows no recent runs, its scheduler has stopped: pg_cron 1.6.4 and later restart it on their own, older versions need a fast database reboot |
| `DISPATCH_FAILING` with `lastHttpStatus` 401 | The Vault and Vercel secrets differ. Update Vercel first and redeploy, then the Vault secret, then run `select private.dispatch_job_worker(true);` and expect `ok`/200 within 4 minutes |
| `DISPATCH_FAILING` after an outage, queue now idle | Another trigger drained the work, so no dispatch has proven the path since. Run the owner probe; an `ok` clears it |
| `DISPATCH_FAILING` with `bad_response`, or `http_error` 403/429, and HTML bodies | A Vercel Firewall challenge (Attack Mode, or the Bot Protection ruleset in Challenge mode). See Firewall in `docs/production-runbook.md` |
| `DISPATCHER_ERROR` `invalid_url` / `invalid_secret` / `not_configured` | Fix the Vault value (it is reported within 2 minutes, even when idle), then run the owner probe |
| `DISPATCHER_ERROR` `secret_unreadable` | Re-create both secrets in this project, then run the owner probe |
| `DISPATCH_NO_PROGRESS` | Inspect due jobs that cannot be claimed (`select id, kind, status, last_error_code, available_at from public.jobs where status in ('pending','failed') and available_at <= now() order by available_at limit 20;`). It clears itself at the first tick after the stuck jobs are resolved |
| `QUEUE_STUCK`, or the watchdog's "Processable work had waited" error, a few minutes after an email hold ends (00:01 UTC, a daily-quota re-check every 3 hours, a rate-limit expiry or the daily monthly-quota check) | The emails the hold kept back all became processable at once with their old due times; it clears as the dispatcher drains them, or as a new refusal starts a new hold. Investigate only if it persists past the next tick or two |
| `create extension ... pg_cron` fails with `dependent privileges exist` | Someone granted cron privileges to `postgres`. As `postgres` run `revoke all on all tables in schema cron from postgres; revoke usage on schema cron from postgres;`. This removes only postgres's grants to itself; Supabase's grants stay, and the re-create then succeeds. Retry it from a new database connection: in the session where it failed, a retry succeeds without proving the fix |
| Rotating `JOB_TRIGGER_SECRET` | Update the Vercel variable and redeploy, then update the Vault secret immediately, then run the owner probe and expect `ok`/200. In between, dispatches get 401 and the watchdog keeps working with `CRON_SECRET` |

## Reference watchdog workflow

Production workflows live in the private `OurMu-Ventures/ourmu-ops`
repository, not here. This is the reference copy of
`.github/workflows/jobs.yml`:

```yaml
name: Production job worker watchdog
on:
  # Watchdog and fallback. Supabase Cron dispatches the worker every 2 minutes.
  # This run reads dispatcher health before it drains, then drains as a
  # fallback, and fails on any health problem or on work left waiting.
  schedule: [{ cron: "17 * * * *" }]
  workflow_dispatch:
permissions: { contents: read }
concurrency:
  group: production-job-worker
  cancel-in-progress: false
jobs:
  process:
    runs-on: ubuntu-slim
    timeout-minutes: 3
    steps:
      - name: Validate worker secrets
        env:
          URL: ${{ secrets.TEMP_DEPLOYMENT_URL }}
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        shell: bash
        run: |
          if [[ -z "${URL}" ]]; then
            echo "::error::TEMP_DEPLOYMENT_URL secret is not set"
            exit 1
          fi
          if [[ "${URL}" != https://* ]]; then
            echo "::error::TEMP_DEPLOYMENT_URL must be the production URL https://partners.ourmu.org"
            exit 1
          fi
          if [[ -z "${CRON_SECRET}" ]]; then
            echo "::error::CRON_SECRET secret is not set"
            exit 1
          fi
      - name: Call protected job worker endpoint
        id: call
        env:
          URL: ${{ secrets.TEMP_DEPLOYMENT_URL }}
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        shell: bash
        run: |
          curl --fail-with-body --silent --show-error --max-time 75 -X POST \
            -H "Authorization: Bearer ${CRON_SECRET}" \
            -H "x-ourmu-trigger: github" \
            "${URL%/}/api/cron/jobs" > worker-response.json
          jq -e '.ok == true and (.jobs | type == "object")' worker-response.json > /dev/null
      - name: Queue response summary
        if: always()
        shell: bash
        run: |
          if [[ ! -s worker-response.json ]] || ! jq -e '.jobs | type == "object"' worker-response.json > /dev/null; then
            echo "Worker response unavailable; inspect the invocation step." >> "$GITHUB_STEP_SUMMARY"
            exit 0
          fi
          {
            echo "### Production queue worker (watchdog run)"
            jq -r '"Claimed: \(.jobs.claimed); succeeded: \(.jobs.succeeded); failed: \(.jobs.failed); deferred: \(.jobs.deferred); skipped: \(.jobs.skipped); unclaimable: \(.jobs.unclaimable // 0)"' worker-response.json
            jq -r '"Before this run: due \(.jobs.dueBefore // "n/a"), processable \(.jobs.processableDueBefore // "n/a"), oldest processable waited \(.jobs.oldestDueAgeSecBefore // "n/a")s; remaining due: \(.jobs.remainingDue); stop: \(.jobs.stopReason)"' worker-response.json
            jq -r '"Health before this run: \(.health.status // "unavailable"); dispatcher: \(.health.dispatcher.lastReason // "n/a") \(.health.dispatcher.lastTickAgeSec // "n/a")s ago; last dispatch outcome: \(.health.dispatcher.lastOutcome // "n/a") (HTTP \(.health.dispatcher.lastHttpStatus // "n/a")); consecutive failures: \(.health.dispatcher.consecutiveFailures // "n/a")"' worker-response.json
            jq -r '(.health.problems // [])[] | "- Problem \(.code): \(.detail)"' worker-response.json
            jq -r '(.health.warnings // [])[] | "- Warning \(.code): \(.detail)"' worker-response.json
          } >> "$GITHUB_STEP_SUMMARY"
      - name: Validate this run's processing
        if: ${{ !cancelled() && steps.call.outcome == 'success' }}
        shell: bash
        run: |
          if ! jq -e '.jobs.failed == 0 and .jobs.stateErrors == 0 and .jobs.needsReconciliation == 0' worker-response.json > /dev/null; then
            echo "::error::This run had failed jobs, state errors or reconciliation quarantines."
            exit 1
          fi
          if ! jq -e '(.jobs.oldestDueAgeSecBefore // 0) <= (.health.thresholds.processableDueAgeSec // 900)' worker-response.json > /dev/null; then
            echo "::error::Processable work had waited $(jq -r '.jobs.oldestDueAgeSecBefore' worker-response.json)s when this run started; the dispatcher did not deliver it."
            exit 1
          fi
      - name: Validate dispatcher health
        if: ${{ !cancelled() && steps.call.outcome == 'success' }}
        shell: bash
        run: |
          if ! jq -e '(.health | type == "object") and (.health.status | type == "string")' worker-response.json > /dev/null; then
            echo "::error::Dispatcher health is missing from the worker response ($(jq -r '.healthError // "no health field"' worker-response.json))."
            exit 1
          fi
          # Deliberate holds (email quota, rate limit, local budget) and other
          # warnings are reported but do not fail the run.
          jq -r '.health.warnings[] | "::warning::\(.code): \(.detail)"' worker-response.json
          if jq -e '(.health.problems | length) > 0' worker-response.json > /dev/null; then
            jq -r '.health.problems[] | "::error::\(.code): \(.detail)"' worker-response.json
            exit 1
          fi
```

`maintenance.yml` keeps its `0 4 * * *` schedule and its `POST` with
`CRON_SECRET` as the late fallback for the Vercel Cron, with the same runner
changes: `runs-on: ubuntu-slim`, `timeout-minutes: 3`, an `https://` check on
`TEMP_DEPLOYMENT_URL`, `-H "x-ourmu-trigger: github"` and `--max-time 75`
(the route's 60-second `maxDuration` plus network). Both workflows read
`TEMP_DEPLOYMENT_URL`, which must be exactly `https://partners.ourmu.org`, and
append the route path; secrets reach curl only through environment variables.

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
- A maturity choice confirmation is stale once its request is fulfilled or
  removed, or its investment is reported paid. The database retires unsent
  stale confirmations at that moment (`dead`,
  `STALE_MATURITY_CONFIRMATION_CANCELLED`); a running one retires on its
  worker's failure write or on lease recovery. While no live request exists,
  Retry and Authorize resend change nothing and report that the job is no
  longer eligible, so a delivery awaiting reconciliation can still be
  confirmed. Claims of stale confirmations still match no rows, and a run
  excludes any row whose claim matched nothing from its later batches, so a
  few unclaimable rows cannot crowd out newer work.
- Provider sends are paced to one request per second per run; provider error
  codes are preserved and `Retry-After` is honoured. Quota, rate-limit, and
  local-budget deferrals never consume the ordinary retry budget, and
  document/recipient preparation continues while sending is deferred.
- Local email budget is a conservative 80 recipient deliveries/day and
  2,400 per rolling 31 days (To + CC + BCC, ambiguous sends counted,
  deduplicated retries consume each budget window once). Daily budget holds
  resume at the next 00:01 UTC (03:01 Kampala), when the daily count resets;
  monthly budget holds probe once per 24 hours. A private reservation ledger and
  database advisory lock make tracking and reservations atomic across workers.
  Explicit provider rejections retain their reservations conservatively; worker
  retries on the same day do not reserve again. Retries crossing UTC midnight
  must reserve the new day's capacity while retaining one monthly charge.
  Historical sends seed the ledger at rollout. It is reconciled against provider quota responses:
  authentication SMTP and manual sends share the same Resend allowance, so
  local counters alone are not a complete account quota guarantee.
- The dispatcher's bearer exists only in Vault, in Vercel's Production
  environment and, until pg_net sends the request, in the unlogged
  `net.http_request_queue`. The cron command is
  `select private.dispatch_job_worker()`, so `cron.job` and database dumps
  carry no plaintext, and a dump restored into another project cannot decrypt
  the Vault secrets. A leaked `JOB_TRIGGER_SECRET` only allows early worker
  runs, never maintenance, but repeated calls could use up Hobby allowances:
  rotate it on suspicion.
- The dispatcher migration ships definitions only. Its two tables are private,
  with RLS and no grants; every new function is revoked from PUBLIC, `anon` and
  `authenticated`; `service_role` can execute only `job_queue_snapshot`,
  `job_dispatch_health`, `record_job_worker_run`, `job_worker_recent_runs` and
  `run_maintenance_exclusive`; and only `postgres` can run the dispatcher.

## Earlier rollouts

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

`20261103030635_retire_stale_maturity_confirmation_jobs.sql` and the
application can deploy in either order. On apply the migration retires
confirmations that are already stale: pending and failed
rows, and running rows without a live lease, become `dead` with
`STALE_MATURITY_CONFIRMATION_CANCELLED` and one
`email.stale_maturity_confirmation_cancelled` audit event each, so **Failed
jobs** on Admin → Overview may rise. List them with
`select entity_id, created_at from public.audit_events where action = 'email.stale_maturity_confirmation_cancelled';`.

## Verification commands

- `npm test`, `npx tsc --noEmit`, and ESLint on touched files.
- `node scripts/test-queue-worker-migration.mjs` checks legacy backfill and
  quarantine in a local transaction that rolls back.
- `node scripts/test-stale-confirmation-migration.mjs` replays the one-time
  stale confirmation cleanup against legacy rows in a local transaction that
  rolls back.
- `supabase test db` includes reservation counting, stale tracking, deduplication,
  monthly rollover, stale confirmation retirement, and privilege checks.
  `supabase/tests/job_dispatcher.test.sql` covers the inert install, the
  configuration checks, the owner probe, the request shape, stalls, both
  backoffs, response scoring, hold parity, the error path, the health windows
  and the run log.
- `node scripts/test-queue-budget-concurrency.mjs` uses two local Postgres
  sessions competing for the last daily slot. Run on an empty local test budget.
- `node scripts/test-maintenance-try-lock.mjs` runs maintenance in two local
  Postgres sessions at once: the second must print `{"skipped": "concurrent"}`
  while the first holds the try-lock. Both roll back.
- Unit tests cover cron authentication (`tests/unit/cron-auth.test.ts`), both
  cron routes (`tests/unit/cron-jobs-route.test.ts`,
  `tests/unit/cron-maintenance-route.test.ts`), the SQL and TypeScript code
  lists (`tests/unit/job-queue-snapshot-parity.test.ts`) and Admin → Jobs
  (`tests/unit/admin-jobs-page.test.tsx`).

Cancellation is cooperative: all job Supabase/Storage operations and provider
fetches receive the job signal. A delayed PDF can finish computing but cannot
start an upload, record write, fan-out or send after cancellation. Already
accepted external operations cannot be undone; ambiguous sends retain their
tracking/reservation and the original 24-hour reconciliation protection.

## pg_cron privileges

Never run `grant ... on schema cron to postgres` or
`grant ... on all tables in schema cron to postgres`, although Supabase's cron
guide suggests them. Supabase's own pg_cron setup already lets `postgres`
schedule, alter and unschedule jobs and clean `cron.job_run_details`, which is
all the dispatcher, the health RPC and the scheduling SQL need. Supabase
re-runs that setup on every `create extension ... pg_cron`, including
`if not exists` on an existing install, and once `postgres` has granted cron
privileges to itself the setup fails with `dependent privileges exist`, so
every later create fails. The dispatcher migration therefore creates pg_cron
only when it is absent and grants nothing on `cron`, and pgTAP re-creates
pg_cron to catch a reintroduced grant. The fix, if it ever happens, is in
Troubleshooting.
