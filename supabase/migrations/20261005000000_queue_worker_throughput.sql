begin;

-- Queue throughput within the existing free-tier setup: atomic claims with a
-- unique claim token and a five-minute lease. Completion and failure updates
-- must match the token so an expired worker cannot overwrite a newer attempt.
-- Expired leases are recovered to pending before processing.
alter table public.jobs
  add column if not exists claim_token text;
alter table public.jobs
  add column if not exists lease_expires_at timestamptz;

-- Lease recovery lookup: running jobs whose lease has expired.
create index if not exists jobs_lease_recovery_idx
  on public.jobs (lease_expires_at)
  where status = 'running';

commit;
