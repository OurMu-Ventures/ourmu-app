# Encrypted backup and restore

Daily CI creates a custom-format `pg_dump`, encrypts it to the public age recipient, and retains it for 30 days. The private identity remains a GitHub secret and in the organization's offline recovery process.

Monthly CI makes a fresh encrypted dump, decrypts only inside the runner, restores to ephemeral PostgreSQL 17, and verifies expected tables, migration history, and aggregate counts without printing rows. Quarterly, an authorized operator should independently restore one artifact, document safe counts, then dispose of plaintext.

The backup, monthly restore test, maintenance fallback, and job worker watchdog workflows live in the private `OurMu-Ventures/ourmu-ops` repository.

## Job dispatcher in restored databases

The monthly CI restore copies only the `public` and `supabase_migrations` schemas into plain PostgreSQL 17, so it contains no dispatcher, cron job, or Vault at all. A full restore into another Supabase project (a disaster-recovery rehearsal, or an operator restore done that way) brings back the `cron.job` rows but not a usable Vault, because the new project has its own root key. The dispatcher there stays inert: `secret_unreadable`, or `not_configured`.

pgTAP cannot fabricate an undecryptable secret, so check this by hand after every full restore into another Supabase project. In that project's SQL editor run:

```sql
select jobname, active from cron.job where jobname like 'ourmu-%';
select private.dispatch_job_worker();
select last_reason, last_error from private.job_dispatch_state;
select count(*) from net.http_request_queue;
```

Expect `secret_unreadable` (or `not_configured`) and a request queue count of 0. Any other result means the restored project may call the production worker. The dispatcher checks both secrets before it looks at the queue, so `idle`, `held`, `failure_backoff`, `no_progress` and `dispatched` all mean it read working production secrets and dispatches as soon as work is due. Run `select cron.unschedule('ourmu-job-dispatch');` there at once and delete its Vault secrets.

After a real recovery, re-create both Vault secrets in the new production project, then re-run the scheduling SQL and the owner probe (`docs/queue-worker.md`, Production setup steps 5-7). Never do this in a test restore.
