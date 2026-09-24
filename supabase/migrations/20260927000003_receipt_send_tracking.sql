begin;

-- Track actual provider send attempts separately from worker claim attempts
-- so the Resend 24h idempotency guard keys off the first real send, not job
-- creation. Reconciliation (audited admin action) either confirms delivery
-- or authorizes a fresh send.
alter table public.jobs
  add column if not exists first_send_attempt_at timestamptz;
alter table public.jobs
  add column if not exists send_attempts integer not null default 0
  constraint jobs_send_attempts_nonnegative check (send_attempts >= 0);

commit;
