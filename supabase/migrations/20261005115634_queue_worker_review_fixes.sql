begin;

-- Give pre-upgrade workers a full lease from rollout before recovery. Legacy
-- email jobs may have sent without tracking: quarantine those instead of resend.
update public.jobs
set claim_token = 'legacy-' || gen_random_uuid()::text,
    lease_expires_at = clock_timestamp() + interval '5 minutes'
where status = 'running' and lease_expires_at is null;
update public.jobs
set status = 'dead', locked_at = null, claim_token = null,
    lease_expires_at = null, last_error_code = 'NEEDS_RECONCILIATION'
where status = 'running' and kind = 'send_email' and claim_token like 'legacy-%'
  and payload->>'to' is not null
  and first_send_attempt_at is null and provider_message_id is null;

-- A small private ledger serializes local reservations across cron/campaign
-- workers. Retain ambiguous and explicitly rejected reservations conservatively.
create table private.queued_email_reservations (
  delivery_key text primary key,
  job_id uuid not null,
  recipients integer not null check (recipients > 0),
  reserved_at timestamptz not null default clock_timestamp(),
  daily_reserved_at timestamptz not null default clock_timestamp()
);
alter table private.queued_email_reservations enable row level security;
revoke all on private.queued_email_reservations from public, anon, authenticated;
grant select, insert on private.queued_email_reservations to service_role;
create index queued_email_reservations_time_idx
  on private.queued_email_reservations (reserved_at);

-- Seed known sends. A fallback key can conservatively overcount legacy receipts
-- with derived keys, but will never undercount them. Rolling 31 days is safer
-- than calendar months when the provider billing cycle resets mid-month.
insert into private.queued_email_reservations (delivery_key, job_id, recipients, reserved_at, daily_reserved_at)
select coalesce(nullif(payload->>'idempotencyKey', ''), 'job-' || id::text || '-' ||
                coalesce(payload->>'accountEmailId', payload->>'to', 'legacy')),
       id,
       1 + jsonb_array_length(coalesce(nullif(payload->'routing'->'cc', 'null'::jsonb), nullif(payload->'cc', 'null'::jsonb), '[]'::jsonb))
         + jsonb_array_length(coalesce(nullif(payload->'bcc', 'null'::jsonb), '[]'::jsonb)),
       first_send_attempt_at, first_send_attempt_at
from public.jobs where kind = 'send_email' and first_send_attempt_at is not null
on conflict (delivery_key) do nothing;

-- Trigger runs in the same transaction as fenced pre-send tracking. The lock
-- is global to this budget; volatile SPI queries see prior lock holders' commits.
create function private.reserve_queued_email_budget()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  delivery text;
  recipient_count integer;
  daily_used bigint;
  monthly_used bigint;
  current_time_utc timestamptz := clock_timestamp();
  utc_day_start timestamptz := date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  previous private.queued_email_reservations%rowtype;
  monthly_increment integer;
begin
  if new.kind <> 'send_email' or new.first_send_attempt_at is null
     or new.send_attempts <= coalesce(old.send_attempts, 0) then
    return new;
  end if;
  delivery := coalesce(nullif(new.payload->>'providerIdempotencyKey', ''),
                       nullif(new.payload->>'idempotencyKey', ''),
                       'job-' || new.id::text || '-' || coalesce(new.payload->>'accountEmailId', new.payload->>'to', 'legacy'));
  recipient_count := 1 + jsonb_array_length(coalesce(nullif(new.payload->'routing'->'cc', 'null'::jsonb), nullif(new.payload->'cc', 'null'::jsonb), '[]'::jsonb))
                       + jsonb_array_length(coalesce(nullif(new.payload->'bcc', 'null'::jsonb), '[]'::jsonb));
  perform pg_advisory_xact_lock(87005, 1);
  -- Same delivery consumes each budget window once. A retry crossing UTC
  -- midnight must reserve the new day's capacity, even if its earlier send
  -- was explicitly refused. Keep its original monthly charge within 31 days.
  select * into previous from private.queued_email_reservations
    where delivery_key = delivery or job_id = new.id
    order by reserved_at desc limit 1;
  if previous.daily_reserved_at >= utc_day_start then return new; end if;
  monthly_increment := case when previous.reserved_at >= current_time_utc - interval '31 days'
    then 0 else recipient_count end;
  select coalesce(sum(recipients) filter (where daily_reserved_at >= utc_day_start), 0),
         coalesce(sum(recipients) filter (where reserved_at >= current_time_utc - interval '31 days'), 0)
  into daily_used, monthly_used
  from private.queued_email_reservations
  where reserved_at >= current_time_utc - interval '31 days'
     or daily_reserved_at >= utc_day_start;
  if daily_used + recipient_count > 80 then
    raise exception 'EMAIL_DAILY_BUDGET_DEFERRED';
  end if;
  if monthly_used + monthly_increment > 2400 then
    raise exception 'EMAIL_MONTHLY_BUDGET_DEFERRED';
  end if;
  if previous.delivery_key is not null then
    update private.queued_email_reservations
    set daily_reserved_at = current_time_utc,
        reserved_at = case when monthly_increment > 0 then current_time_utc else reserved_at end
    where delivery_key = previous.delivery_key;
  else
    insert into private.queued_email_reservations (delivery_key, job_id, recipients)
      values (delivery, new.id, recipient_count);
  end if;
  return new;
end;
$$;
revoke all on function private.reserve_queued_email_budget() from public, anon, authenticated;
create trigger reserve_queued_email_budget
before update of send_attempts, first_send_attempt_at on public.jobs
for each row execute function private.reserve_queued_email_budget();
commit;
