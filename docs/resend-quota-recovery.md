# Resend quota holds

The worker recognizes Resend's explicit `daily_quota_exceeded` and `monthly_quota_exceeded` refusals. It returns the email job to pending, records a specific quota code, and restores its previous retry count and send tracking. A known refusal is not a delivery failure and does not exhaust the retry budget.

Daily holds resume at the next midnight UTC plus one minute (03:01 Africa/Kampala). Monthly holds probe once per 24 hours because the worker does not know the account's actual reset date. A future quota hold on any pending/failed email job pauses other email jobs across worker invocations and campaigns. Workers fetch non-email work during the hold so a backlog of email jobs cannot crowd PDF generation out of the batch. On the first refusal within a batch, subsequent email jobs remain untouched; other already-fetched work continues.

The admin Jobs page shows quota-held jobs and their next check time. After upgrading the plan, use Retry on quota-held jobs to clear their hold and make them available to the next worker run. If concurrent workers created several holds, clear each one before expecting sends to resume. Concurrent workers already in flight can still receive additional quota refusals; those jobs are deferred the same way.

Only explicit quota refusals restore send tracking. An earlier timeout or unknown provider outcome retains its original first-send timestamp. If that ambiguous attempt ages beyond Resend's 24-hour idempotency window, normal manual delivery reconciliation is still required. Other provider errors keep the existing failure/backoff policy.

Rate-limit (`429` / `rate_limit_exceeded`) refusals defer the same way, honouring `Retry-After` (bounded between 5 seconds and 15 minutes) instead of the quota reset schedule. A conservative local budget (80 recipient deliveries/day, 2,400 per rolling 31 days) additionally defers sends when the shared free-tier allowance is nearly reserved. Pre-send tracking and reservations are atomic in Postgres across cron and campaign workers. The private ledger counts a delivery once per budget window; retries crossing UTC midnight must reserve the new day's capacity while preserving one monthly charge. Explicit provider refusals retain their reservations conservatively. See `docs/queue-worker.md` for scheduling, monitoring thresholds, and rollout.

This change does not revive existing dead jobs with generic `EMAIL_DELIVERY_FAILED` codes: their historical provider outcome must be reviewed before retrying. It also does not manage Supabase Auth's SMTP sending, which uses Resend outside the application job runner. The queue migrations add lease columns and a private reservation ledger; they do not upgrade the Resend plan. Verification uses local fixtures and a mocked provider transport.

Provider references: https://resend.com/docs/api-reference/errors and https://resend.com/docs/knowledge-base/account-quotas-and-limits.
