begin;

-- Supabase Cron dispatcher for the job worker. Definitions only: this
-- migration never calls cron.schedule and never writes Vault secrets, so
-- local and CI databases stay inert. Production scheduling is a one-time
-- owner step documented in docs/queue-worker.md.
--
-- pg_cron is created only when absent. Supabase re-runs its pg_cron
-- after-create script on every CREATE EXTENSION, including IF NOT EXISTS on
-- an existing install, and that script fails with "dependent privileges
-- exist" once postgres has re-granted cron privileges to itself (as the
-- documented setup grants do). Never add such grants: the after-create script
-- already gives postgres everything the dispatcher, the health RPC and the
-- owner's scheduling SQL need.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    create extension pg_cron with schema pg_catalog;
  end if;
end
$$;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- Dispatcher state: one row, written only by private.dispatch_job_worker().
-- ---------------------------------------------------------------------------
create table private.job_dispatch_state (
  id boolean primary key default true,
  last_tick_at timestamptz,
  last_reason text not null default 'never_ran',
  last_dispatch_at timestamptz,
  last_request_id bigint,
  last_dispatch_id uuid,
  last_dispatch_newest_ready_at timestamptz,
  last_request_scored boolean not null default true,
  stall_counted boolean not null default false,
  last_outcome text,
  last_outcome_at timestamptz,
  last_http_status integer,
  last_success_at timestamptz,
  consecutive_failures integer not null default 0,
  no_progress_streak integer not null default 0,
  no_progress_until timestamptz,
  no_progress_newest_ready_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  constraint job_dispatch_state_singleton check (id),
  constraint job_dispatch_state_reason check (last_reason in (
    'never_ran', 'idle', 'held', 'dispatched', 'outstanding', 'pg_net_stalled',
    'failure_backoff', 'no_progress', 'not_configured', 'invalid_url',
    'invalid_secret', 'secret_unreadable', 'error')),
  constraint job_dispatch_state_outcome check (last_outcome is null or last_outcome in (
    'ok', 'no_progress', 'http_error', 'timed_out', 'transport_error',
    'bad_response', 'lost', 'stalled')),
  constraint job_dispatch_state_counters check (
    consecutive_failures >= 0 and no_progress_streak >= 0),
  constraint job_dispatch_state_error_length check (
    last_error is null or length(last_error) <= 200)
);
insert into private.job_dispatch_state (id) values (true);
alter table private.job_dispatch_state enable row level security;
revoke all on table private.job_dispatch_state from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Worker run log: counts and codes only (no recipients, no payloads).
-- Written through public.record_job_worker_run, pruned after 30 days.
-- ---------------------------------------------------------------------------
create table private.job_worker_runs (
  id bigint generated always as identity primary key,
  route text not null,
  trigger text not null,
  request_id uuid not null,
  dispatch_id uuid,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  ok boolean not null,
  error_code text,
  stop_reason text,
  maintenance_status text,
  claimed integer not null default 0,
  succeeded integer not null default 0,
  failed integer not null default 0,
  deferred integer not null default 0,
  skipped integer not null default 0,
  unclaimable integer not null default 0,
  provider_accepted integer not null default 0,
  documents_generated integer not null default 0,
  recipient_jobs_created integer not null default 0,
  recovered_leases integer not null default 0,
  needs_reconciliation integer not null default 0,
  state_errors integer not null default 0,
  due_before integer,
  processable_due_before integer,
  oldest_due_age_sec_before integer,
  expired_leases_before integer,
  remaining_due integer,
  remaining_processable_due integer,
  remaining_expired_leases integer,
  oldest_due_age_sec integer,
  email_hold_code text,
  email_hold_until timestamptz,
  -- job_dispatch_health's generatedAt when the route read health for this
  -- run (before its drain); after an ok watchdog run the next watchdog
  -- window starts here.
  health_checked_at timestamptz,
  recorded_at timestamptz not null default now(),
  constraint job_worker_runs_route check (route in ('jobs', 'maintenance')),
  constraint job_worker_runs_trigger check (
    trigger in ('pg_cron', 'github', 'vercel_cron', 'manual', 'unknown')),
  constraint job_worker_runs_times check (finished_at >= started_at),
  constraint job_worker_runs_error_code check (error_code is null or length(error_code) <= 80),
  constraint job_worker_runs_stop_reason check (stop_reason is null or stop_reason in (
    'queue_empty', 'job_budget', 'time_budget', 'single_batch')),
  constraint job_worker_runs_maintenance_status check (maintenance_status is null or
    maintenance_status in ('completed', 'skipped_concurrent', 'failed')),
  constraint job_worker_runs_hold_code check (email_hold_code is null or length(email_hold_code) <= 80),
  constraint job_worker_runs_counts check (least(claimed, succeeded, failed, deferred,
    skipped, unclaimable, provider_accepted, documents_generated, recipient_jobs_created,
    recovered_leases, needs_reconciliation, state_errors) >= 0)
);
create index job_worker_runs_started_at_idx on private.job_worker_runs (started_at desc);
create index job_worker_runs_recorded_at_idx on private.job_worker_runs (recorded_at desc);
create index job_worker_runs_dispatch_id_idx on private.job_worker_runs (dispatch_id)
  where dispatch_id is not null;
alter table private.job_worker_runs enable row level security;
revoke all on table private.job_worker_runs from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared queue snapshot. The single definition of "email hold", "due",
-- "processable" and "expired lease" used by the dispatcher, the health RPC
-- and src/lib/jobs.ts. Keep the code list identical to EMAIL_DEFERRAL_CODES
-- in src/lib/email/quota.ts (tests/unit/job-queue-snapshot-parity.test.ts).
-- ---------------------------------------------------------------------------
create function public.job_queue_snapshot(p_campaign_id uuid default null)
returns table (
  snapshot_at timestamptz,
  email_hold_code text,
  email_hold_until timestamptz,
  held_email_count integer,
  due_count integer,
  processable_due_count integer,
  oldest_due_at timestamptz,
  oldest_processable_due_at timestamptz,
  newest_ready_at timestamptz,
  expired_lease_count integer,
  oldest_expired_lease_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with hold_rows as (
    select j.last_error_code, j.available_at
    from public.jobs j
    where j.kind = 'send_email'
      and j.status in ('pending', 'failed')
      and j.last_error_code = any (/* EMAIL_DEFERRAL_CODES */ array[
        'EMAIL_DAILY_QUOTA_EXCEEDED',
        'EMAIL_MONTHLY_QUOTA_EXCEEDED',
        'EMAIL_RATE_LIMITED',
        'EMAIL_BUDGET_DEFERRED'
      ]::text[])
      and j.available_at > now()
  ),
  hold as (
    select h.last_error_code as code, h.available_at as until
    from hold_rows h
    order by h.available_at desc, h.last_error_code
    limit 1
  ),
  due as (
    select j.kind, j.available_at,
      (j.kind = 'send_email' and exists (select 1 from hold_rows)) as held_back
    from public.jobs j
    where j.status in ('pending', 'failed')
      and j.available_at <= now()
      and (p_campaign_id is null
        or (j.entity_type = 'email_campaign' and j.entity_id = p_campaign_id))
  ),
  leases as (
    select count(*)::integer as n,
      min(j.lease_expires_at) as oldest,
      max(j.lease_expires_at) as newest
    from public.jobs j
    where j.status = 'running'
      and j.lease_expires_at < now()
      and (p_campaign_id is null
        or (j.entity_type = 'email_campaign' and j.entity_id = p_campaign_id))
  )
  select
    now(),
    (select code from hold),
    (select until from hold),
    ((select count(*) from hold_rows) + (select count(*) from due where held_back))::integer,
    (select count(*) from due)::integer,
    (select count(*) from due where not held_back)::integer,
    (select min(available_at) from due),
    (select min(available_at) from due where not held_back),
    greatest((select max(available_at) from due where not held_back), (select newest from leases)),
    (select n from leases),
    (select oldest from leases);
$$;
revoke all on function public.job_queue_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.job_queue_snapshot(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Dispatcher. Runs every 2 minutes from pg_cron (scheduled by the owner in
-- production only) as select private.dispatch_job_worker(). Calls
-- POST /api/cron/jobs through pg_net only when processable work is due or a
-- lease has expired. The Vault configuration is validated on every tick
-- (no network call), so a broken setup stays visible while the queue is idle.
-- p_probe (owner only, by hand): dispatch once even when idle or backing off,
-- still never with a request outstanding. Never raises.
-- ---------------------------------------------------------------------------
create function private.dispatch_job_worker(p_probe boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_url_secret constant text := 'ourmu_job_worker_url';
  c_token_secret constant text := 'ourmu_job_trigger_secret';
  c_timeout_ms constant integer := 120000;
  c_in_flight_grace constant interval := interval '150 seconds';
  c_stall_after constant interval := interval '3 minutes';
  c_failure_threshold constant integer := 3;
  c_failure_spacing constant interval := interval '15 minutes';
  c_no_progress_base constant interval := interval '30 minutes';
  c_no_progress_cap constant interval := interval '60 minutes';
  -- Counters every /api/cron/jobs success body must carry as JSON numbers.
  c_counters constant text[] := array['claimed', 'recoveredLeases',
    'processableDueBefore', 'expiredLeasesBefore', 'remainingProcessableDue',
    'remainingExpiredLeases'];
  v_now timestamptz := now();
  v_probe boolean := coalesce(p_probe, false);
  s private.job_dispatch_state%rowtype;
  snap record;
  resp record;
  run record;
  v_reason text;
  v_outcome text;
  v_status integer;
  v_body jsonb;
  v_url text;
  v_token text;
  v_dispatch_id uuid;
  v_request_id bigint;
begin
  if not pg_try_advisory_xact_lock(87005, 3) then
    return 'busy';
  end if;

  begin
    select * into s from private.job_dispatch_state where id for update;
    if not found then
      insert into private.job_dispatch_state (id) values (true) returning * into s;
    end if;

    <<decide>>
    begin
      -- 1. Score the previous request (one outstanding request at a time).
      if s.last_request_id is not null and not s.last_request_scored then
        v_outcome := null;
        v_status := null;
        select r.status_code, r.timed_out, r.error_msg, r.content
          into resp
          from net._http_response r
         where r.id = s.last_request_id
         order by r.created desc
         limit 1;
        if found then
          v_status := resp.status_code;
          if coalesce(resp.timed_out, false) then
            v_outcome := 'timed_out';
          elsif resp.error_msg is not null or resp.status_code is null then
            v_outcome := 'transport_error';
          elsif resp.status_code between 200 and 299 then
            begin
              v_body := resp.content::jsonb;
              if jsonb_typeof(v_body) is distinct from 'object'
                 or jsonb_typeof(v_body -> 'jobs') is distinct from 'object'
                 or (v_body ->> 'ok') is distinct from 'true'
                 or exists (select 1 from unnest(c_counters) as k(name)
                   where jsonb_typeof(v_body -> 'jobs' -> k.name) is distinct from 'number') then
                v_outcome := 'bad_response';
              -- No progress: nothing claimed or recovered although work was
              -- due, and work is still left (a concurrent worker that took it
              -- all is not a stuck queue). Same rule as the run-row fallback.
              elsif (v_body #>> '{jobs,claimed}')::integer = 0
                and (v_body #>> '{jobs,recoveredLeases}')::integer = 0
                and ((v_body #>> '{jobs,processableDueBefore}')::integer > 0
                  or (v_body #>> '{jobs,expiredLeasesBefore}')::integer > 0)
                and ((v_body #>> '{jobs,remainingProcessableDue}')::integer > 0
                  or (v_body #>> '{jobs,remainingExpiredLeases}')::integer > 0) then
                v_outcome := 'no_progress';
              else
                v_outcome := 'ok';
              end if;
            exception when others then
              v_outcome := 'bad_response';
            end;
          else
            v_outcome := 'http_error';
          end if;
        elsif exists (select 1 from net.http_request_queue q where q.id = s.last_request_id) then
          -- Still waiting for the pg_net worker to send it.
          if v_now - s.last_dispatch_at >= c_stall_after then
            if not s.stall_counted then
              s.consecutive_failures := s.consecutive_failures + 1;
              s.stall_counted := true;
              s.last_outcome := 'stalled';
              s.last_outcome_at := v_now;
              s.last_http_status := null;
            end if;
            v_reason := 'pg_net_stalled';
          else
            v_reason := 'outstanding';
          end if;
          exit decide;
        elsif v_now - s.last_dispatch_at < c_in_flight_grace then
          -- Sent and awaiting a response (timeout 120 s plus slack).
          v_reason := 'outstanding';
          exit decide;
        else
          v_outcome := 'lost';
        end if;

        -- A missing or unreadable response may still have reached the
        -- worker: score it from the run the route recorded for this dispatch.
        if v_outcome in ('timed_out', 'transport_error', 'bad_response', 'lost')
           and s.last_dispatch_id is not null then
          select w.ok, w.claimed, w.recovered_leases, w.processable_due_before,
              w.expired_leases_before, w.remaining_processable_due,
              w.remaining_expired_leases
            into run
            from private.job_worker_runs w
           where w.dispatch_id = s.last_dispatch_id
           order by w.id desc
           limit 1;
          if found and run.ok then
            v_outcome := case
              when run.claimed = 0 and run.recovered_leases = 0
                and (coalesce(run.processable_due_before, 0) > 0
                  or coalesce(run.expired_leases_before, 0) > 0)
                and (coalesce(run.remaining_processable_due, 0) > 0
                  or coalesce(run.remaining_expired_leases, 0) > 0)
                then 'no_progress' else 'ok' end;
          end if;
        end if;

        if v_outcome = 'ok' then
          s.consecutive_failures := 0;
          s.no_progress_streak := 0;
          s.no_progress_until := null;
          s.no_progress_newest_ready_at := null;
          s.last_success_at := v_now;
        elsif v_outcome = 'no_progress' then
          s.consecutive_failures := 0;
          s.no_progress_streak := s.no_progress_streak + 1;
          s.no_progress_until := s.last_dispatch_at + least(c_no_progress_cap,
            c_no_progress_base * power(2, least(s.no_progress_streak - 1, 4)));
          s.no_progress_newest_ready_at := s.last_dispatch_newest_ready_at;
        elsif not s.stall_counted then
          s.consecutive_failures := s.consecutive_failures + 1;
        end if;
        s.last_outcome := v_outcome;
        s.last_outcome_at := v_now;
        s.last_http_status := v_status;
        s.last_request_scored := true;
        s.stall_counted := false;
      end if;

      -- 2. Read and validate the Vault secrets on every tick (missing = NULL,
      --    undecryptable = error). No network call; idle ticks stay local.
      begin
        select ds.decrypted_secret into v_url
          from vault.decrypted_secrets ds where ds.name = c_url_secret;
        select ds.decrypted_secret into v_token
          from vault.decrypted_secrets ds where ds.name = c_token_secret;
      exception when others then
        s.last_error := left('VAULT ' || sqlstate || ': ' || sqlerrm, 200);
        v_reason := 'secret_unreadable';
        exit decide;
      end;
      if v_url is null or v_token is null then
        v_reason := 'not_configured';
        exit decide;
      end if;
      if v_url !~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?/api/cron/jobs$' then
        v_reason := 'invalid_url';
        exit decide;
      end if;
      if length(v_token) < 32 or length(v_token) > 512 or v_token ~ '[[:space:][:cntrl:]]' then
        v_reason := 'invalid_secret';
        exit decide;
      end if;

      -- 3. Is there processable work or an expired lease?
      select * into snap from public.job_queue_snapshot(null);
      if coalesce(snap.processable_due_count, 0) = 0
         and coalesce(snap.expired_lease_count, 0) = 0 then
        -- Nothing is stuck any more: end the no-progress backoff. Failures
        -- stay counted until a dispatch succeeds or the owner probes.
        s.no_progress_streak := 0;
        s.no_progress_until := null;
        s.no_progress_newest_ready_at := null;
        if not v_probe then
          v_reason := case when snap.email_hold_code is not null then 'held' else 'idle' end;
          exit decide;
        end if;
      end if;

      if not v_probe then
        -- 4. Failure backoff: after 3 consecutive failures, at most every 15 min.
        if s.consecutive_failures >= c_failure_threshold
           and s.last_dispatch_at is not null
           and v_now < s.last_dispatch_at + c_failure_spacing then
          v_reason := 'failure_backoff';
          exit decide;
        end if;

        -- 5. No-progress backoff: wait unless new work became ready since.
        if s.no_progress_until is not null and v_now < s.no_progress_until
           and not coalesce(snap.newest_ready_at > s.no_progress_newest_ready_at, false) then
          v_reason := 'no_progress';
          exit decide;
        end if;
      end if;

      -- 6. Dispatch.
      v_dispatch_id := gen_random_uuid();
      v_request_id := net.http_post(
        url := v_url,
        body := jsonb_build_object('dispatchId', v_dispatch_id),
        params := '{}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_token,
          'x-ourmu-trigger', 'pg_cron',
          'x-ourmu-dispatch-id', v_dispatch_id::text),
        timeout_milliseconds := c_timeout_ms);
      s.last_request_id := v_request_id;
      s.last_dispatch_id := v_dispatch_id;
      s.last_dispatch_at := v_now;
      s.last_dispatch_newest_ready_at := snap.newest_ready_at;
      s.last_request_scored := false;
      s.stall_counted := false;
      v_reason := 'dispatched';
    end decide;

    if v_reason <> 'secret_unreadable' then
      s.last_error := null;
    end if;
    update private.job_dispatch_state set
      last_tick_at = v_now,
      last_reason = v_reason,
      last_dispatch_at = s.last_dispatch_at,
      last_request_id = s.last_request_id,
      last_dispatch_id = s.last_dispatch_id,
      last_dispatch_newest_ready_at = s.last_dispatch_newest_ready_at,
      last_request_scored = s.last_request_scored,
      stall_counted = s.stall_counted,
      last_outcome = s.last_outcome,
      last_outcome_at = s.last_outcome_at,
      last_http_status = s.last_http_status,
      last_success_at = s.last_success_at,
      consecutive_failures = s.consecutive_failures,
      no_progress_streak = s.no_progress_streak,
      no_progress_until = s.no_progress_until,
      no_progress_newest_ready_at = s.no_progress_newest_ready_at,
      last_error = s.last_error,
      updated_at = v_now
    where id;
    return v_reason;
  exception when others then
    -- The block above rolls back, including any request queued this tick
    -- (and with it the plaintext bearer).
    begin
      update private.job_dispatch_state set
        last_tick_at = v_now,
        last_reason = 'error',
        last_error = left(sqlstate || ': ' || sqlerrm, 200),
        updated_at = v_now
      where id;
    exception when others then
      null;
    end;
    return 'error';
  end;
end;
$$;
revoke all on function private.dispatch_job_worker(boolean) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Worker run recording (service_role only).
-- ---------------------------------------------------------------------------
create function public.record_job_worker_run(p_run jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if p_run is null or jsonb_typeof(p_run) <> 'object' then
    raise exception 'JOB_WORKER_RUN_INVALID' using errcode = '22023';
  end if;
  insert into private.job_worker_runs (
    route, trigger, request_id, dispatch_id, started_at, finished_at, ok,
    error_code, stop_reason, maintenance_status,
    claimed, succeeded, failed, deferred, skipped, unclaimable,
    provider_accepted, documents_generated, recipient_jobs_created,
    recovered_leases, needs_reconciliation, state_errors,
    due_before, processable_due_before, oldest_due_age_sec_before, expired_leases_before,
    remaining_due, remaining_processable_due, remaining_expired_leases, oldest_due_age_sec,
    email_hold_code, email_hold_until, health_checked_at
  ) values (
    p_run ->> 'route',
    case when p_run ->> 'trigger' in ('pg_cron', 'github', 'vercel_cron', 'manual')
      then p_run ->> 'trigger' else 'unknown' end,
    (p_run ->> 'request_id')::uuid,
    (p_run ->> 'dispatch_id')::uuid,
    (p_run ->> 'started_at')::timestamptz,
    (p_run ->> 'finished_at')::timestamptz,
    (p_run ->> 'ok')::boolean,
    left(p_run ->> 'error_code', 80),
    p_run ->> 'stop_reason',
    p_run ->> 'maintenance_status',
    coalesce((p_run ->> 'claimed')::integer, 0),
    coalesce((p_run ->> 'succeeded')::integer, 0),
    coalesce((p_run ->> 'failed')::integer, 0),
    coalesce((p_run ->> 'deferred')::integer, 0),
    coalesce((p_run ->> 'skipped')::integer, 0),
    coalesce((p_run ->> 'unclaimable')::integer, 0),
    coalesce((p_run ->> 'provider_accepted')::integer, 0),
    coalesce((p_run ->> 'documents_generated')::integer, 0),
    coalesce((p_run ->> 'recipient_jobs_created')::integer, 0),
    coalesce((p_run ->> 'recovered_leases')::integer, 0),
    coalesce((p_run ->> 'needs_reconciliation')::integer, 0),
    coalesce((p_run ->> 'state_errors')::integer, 0),
    (p_run ->> 'due_before')::integer,
    (p_run ->> 'processable_due_before')::integer,
    (p_run ->> 'oldest_due_age_sec_before')::integer,
    (p_run ->> 'expired_leases_before')::integer,
    (p_run ->> 'remaining_due')::integer,
    (p_run ->> 'remaining_processable_due')::integer,
    (p_run ->> 'remaining_expired_leases')::integer,
    (p_run ->> 'oldest_due_age_sec')::integer,
    left(p_run ->> 'email_hold_code', 80),
    (p_run ->> 'email_hold_until')::timestamptz,
    (p_run ->> 'health_checked_at')::timestamptz
  ) returning id into v_id;
  delete from private.job_worker_runs where started_at < now() - interval '30 days';
  return v_id;
end;
$$;
revoke all on function public.record_job_worker_run(jsonb) from public, anon, authenticated;
grant execute on function public.record_job_worker_run(jsonb) to service_role;

create function public.job_worker_recent_runs(p_limit integer default 20)
returns table (
  id bigint,
  route text,
  trigger text,
  started_at timestamptz,
  finished_at timestamptz,
  ok boolean,
  error_code text,
  stop_reason text,
  maintenance_status text,
  claimed integer,
  succeeded integer,
  failed integer,
  deferred integer,
  skipped integer,
  unclaimable integer,
  provider_accepted integer,
  documents_generated integer,
  recovered_leases integer,
  needs_reconciliation integer,
  state_errors integer,
  processable_due_before integer,
  oldest_due_age_sec_before integer,
  remaining_due integer,
  email_hold_code text,
  email_hold_until timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.route, r.trigger, r.started_at, r.finished_at, r.ok, r.error_code,
    r.stop_reason, r.maintenance_status, r.claimed, r.succeeded, r.failed, r.deferred,
    r.skipped, r.unclaimable, r.provider_accepted, r.documents_generated,
    r.recovered_leases, r.needs_reconciliation, r.state_errors,
    r.processable_due_before, r.oldest_due_age_sec_before, r.remaining_due,
    r.email_hold_code, r.email_hold_until
  from private.job_worker_runs r
  order by r.started_at desc, r.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;
revoke all on function public.job_worker_recent_runs(integer) from public, anon, authenticated;
grant execute on function public.job_worker_recent_runs(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Maintenance try-lock wrapper. run_maintenance itself is unchanged; the
-- 'maintenance.completed' audit row it writes stays the completion record.
-- ---------------------------------------------------------------------------
create function public.run_maintenance_exclusive(p_request_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not pg_try_advisory_xact_lock(87005, 2) then
    return jsonb_build_object('skipped', 'concurrent');
  end if;
  return public.run_maintenance(p_request_id);
end;
$$;
revoke all on function public.run_maintenance_exclusive(uuid) from public, anon, authenticated;
grant execute on function public.run_maintenance_exclusive(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Health for the watchdog, the jobs route and Admin > Jobs.
-- ---------------------------------------------------------------------------
create function public.job_dispatch_health(p_since_last_watchdog boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_tick_stale_sec constant integer := 600;
  c_processable_due_age_sec constant integer := 900;
  c_expired_lease_age_sec constant integer := 900;
  c_failure_threshold constant integer := 3;
  c_outstanding_sec constant integer := 300;
  -- 32 h: the daily Vercel Cron and the maintenance.yml fallback both run at
  -- 04:00 UTC, so this fires only when both missed a day, and a fallback that
  -- GitHub delivers late raises no false alarm.
  c_maintenance_age_sec constant integer := 115200;
  -- Deliberate do-not-send outcomes: the email is no longer relevant. Keep
  -- identical to DELIBERATE_DROP_CODES in src/lib/jobs.ts (parity unit test).
  -- Codes ending in _CANCELLED are deliberate as well.
  c_drop_codes constant text[] := /* DELIBERATE_DROP_CODES */ array[
    'RESERVATION_NOT_FOUND',
    'STALE_MATURITY_CONFIRMATION',
    'STALE_RESERVATION'
  ]::text[];
  v_now timestamptz := now();
  v_watchdog boolean := coalesce(p_since_last_watchdog, false);
  s private.job_dispatch_state%rowtype;
  snap record;
  v_since timestamptz;
  v_dead_since timestamptz;
  v_prev_checked timestamptz;
  v_prev_recorded timestamptz;
  v_configured boolean;
  v_cron_installed boolean := to_regclass('cron.job') is not null;
  v_scheduled boolean := false;
  v_cron_status text;
  v_cron_start timestamptz;
  v_net_installed boolean := to_regclass('net.http_request_queue') is not null;
  v_worker_running boolean;
  v_queue_depth integer;
  v_outstanding_queued boolean := false;
  v_outstanding_age integer;
  v_dead integer;
  v_dead_codes jsonb;
  v_dropped integer;
  v_dead_window integer;
  v_open_recon integer;
  v_runs integer;
  v_runs_not_ok integer;
  v_failed integer;
  v_state_errors integer;
  v_needs_recon integer;
  v_unclaimable integer;
  v_last_run_at timestamptz;
  v_last_run_trigger text;
  v_maintenance_at timestamptz;
  v_tick_age integer;
  v_due_age integer;
  v_lease_age integer;
  v_maint_age integer;
  v_problems jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
begin
  select * into s from private.job_dispatch_state where id;
  select * into snap from public.job_queue_snapshot(null);

  v_configured := (select count(*) = 2 from vault.secrets
    where name in ('ourmu_job_worker_url', 'ourmu_job_trigger_secret'));

  if v_cron_installed then
    execute $q$select exists (select 1 from cron.job
      where jobname = 'ourmu-job-dispatch' and active)$q$ into v_scheduled;
    execute $q$select d.status, d.start_time
      from cron.job_run_details d
      where d.jobid = (select j.jobid from cron.job j where j.jobname = 'ourmu-job-dispatch')
      order by d.runid desc limit 1$q$ into v_cron_status, v_cron_start;
  end if;

  if v_net_installed then
    v_worker_running := exists (select 1 from pg_catalog.pg_stat_activity a
      where a.backend_type ilike '%pg_net%');
    execute 'select count(*)::integer from net.http_request_queue' into v_queue_depth;
    if s.last_request_id is not null and not s.last_request_scored then
      execute 'select exists (select 1 from net.http_request_queue where id = $1)'
        into v_outstanding_queued using s.last_request_id;
      v_outstanding_age := extract(epoch from v_now - s.last_dispatch_at)::integer;
    end if;
  end if;

  -- Event windows. Admin view: the last 24 h. Watchdog (jobs route, trigger
  -- github): only what the previous watchdog run could not have reported, so
  -- each event fails one run. The previous watchdog run is the latest one
  -- that answered 200 with health (ok, health_checked_at set): jobs.yml
  -- evaluates health only then, so a run that failed or could not read
  -- health moves neither window. Worker runs count when recorded after the
  -- previous watchdog read health; watchdog jobs-route rows are left out
  -- because each of those runs already checked its own processing. Dead jobs
  -- count when they died after the previous watchdog recorded its run, since
  -- deaths in its own drain failed that run. Maintenance-route runs never
  -- move either window.
  select w.health_checked_at, w.recorded_at into v_prev_checked, v_prev_recorded
    from private.job_worker_runs w
    where w.route = 'jobs' and w.trigger = 'github'
      and w.ok and w.health_checked_at is not null
    order by w.recorded_at desc, w.id desc
    limit 1;
  v_since := v_now - interval '24 hours';
  v_dead_since := v_since;
  if v_watchdog then
    v_since := greatest(v_since, v_prev_checked);
    v_dead_since := greatest(v_dead_since, v_prev_recorded);
  end if;

  select coalesce(sum(d.n), 0)::integer,
    coalesce(jsonb_object_agg(d.code, d.n), '{}'::jsonb)
    into v_dead, v_dead_codes
    from (
      select coalesce(j.last_error_code, 'UNKNOWN') as code, count(*)::integer as n
      from public.jobs j
      where j.status = 'dead'
        and j.updated_at >= v_now - interval '24 hours'
        and coalesce(j.last_error_code, '') !~ '_CANCELLED$'
        and not coalesce(j.last_error_code = any (c_drop_codes), false)
      group by 1
    ) d;

  select count(*)::integer into v_dropped
    from public.jobs j
    where j.status = 'dead'
      and j.updated_at >= v_now - interval '24 hours'
      and (coalesce(j.last_error_code, '') ~ '_CANCELLED$'
        or coalesce(j.last_error_code = any (c_drop_codes), false));

  select count(*)::integer into v_dead_window
    from public.jobs j
    where j.status = 'dead'
      and j.updated_at > v_dead_since
      and coalesce(j.last_error_code, '') !~ '_CANCELLED$'
      and not coalesce(j.last_error_code = any (c_drop_codes), false);

  select count(*)::integer into v_open_recon
    from public.jobs j
    where j.status in ('failed', 'dead') and j.last_error_code = 'NEEDS_RECONCILIATION';

  select count(*)::integer,
    count(*) filter (where not w.ok)::integer,
    coalesce(sum(w.failed), 0)::integer,
    coalesce(sum(w.state_errors), 0)::integer,
    coalesce(sum(w.needs_reconciliation), 0)::integer,
    coalesce(sum(w.unclaimable), 0)::integer
    into v_runs, v_runs_not_ok, v_failed, v_state_errors, v_needs_recon, v_unclaimable
    from private.job_worker_runs w
    where w.recorded_at > v_since
      and not (v_watchdog and w.route = 'jobs' and w.trigger = 'github');
  select w.started_at, w.trigger into v_last_run_at, v_last_run_trigger
    from private.job_worker_runs w order by w.started_at desc, w.id desc limit 1;

  select a.created_at into v_maintenance_at
    from public.audit_events a
    where a.entity_type = 'system' and a.entity_id is null
      and a.action = 'maintenance.completed'
    order by a.created_at desc limit 1;

  v_tick_age := extract(epoch from v_now - s.last_tick_at)::integer;
  v_due_age := extract(epoch from v_now - snap.oldest_processable_due_at)::integer;
  v_lease_age := extract(epoch from v_now - snap.oldest_expired_lease_at)::integer;
  v_maint_age := extract(epoch from v_now - v_maintenance_at)::integer;

  if not v_configured then
    v_problems := v_problems || jsonb_build_object('code', 'DISPATCHER_NOT_CONFIGURED',
      'detail', 'Vault secrets ourmu_job_worker_url and ourmu_job_trigger_secret are required');
  end if;
  if not coalesce(v_scheduled, false) then
    v_problems := v_problems || jsonb_build_object('code', 'DISPATCHER_NOT_SCHEDULED',
      'detail', 'cron job ourmu-job-dispatch is missing or inactive');
  end if;
  if v_tick_age is null or v_tick_age > c_tick_stale_sec then
    v_problems := v_problems || jsonb_build_object('code', 'DISPATCHER_TICK_STALE',
      'detail', case when v_tick_age is null then 'the dispatcher has never run'
        else format('last tick %s s ago', v_tick_age) end);
  end if;
  if s.last_reason in ('not_configured', 'invalid_url', 'invalid_secret',
                       'secret_unreadable', 'error') then
    v_problems := v_problems || jsonb_build_object('code', 'DISPATCHER_ERROR',
      'detail', s.last_reason || coalesce(' ' || s.last_error, ''));
  end if;
  if s.consecutive_failures >= c_failure_threshold then
    v_problems := v_problems || jsonb_build_object('code', 'DISPATCH_FAILING',
      'detail', format('%s consecutive failed dispatches, last outcome %s, HTTP %s',
        s.consecutive_failures, s.last_outcome, coalesce(s.last_http_status::text, 'none')));
  end if;
  if s.no_progress_streak > 0 then
    v_problems := v_problems || jsonb_build_object('code', 'DISPATCH_NO_PROGRESS',
      'detail', format('worker claimed nothing while work was due (%s in a row)', s.no_progress_streak));
  end if;
  if s.last_reason = 'pg_net_stalled'
     or (v_outstanding_queued and v_outstanding_age > c_outstanding_sec) then
    v_problems := v_problems || jsonb_build_object('code', 'PG_NET_STALLED',
      'detail', format('request %s queued for %s s; run select net.worker_restart()',
        s.last_request_id, coalesce(v_outstanding_age::text, '?')));
  end if;
  if v_net_installed and not v_worker_running then
    v_problems := v_problems || jsonb_build_object('code', 'PG_NET_WORKER_DOWN',
      'detail', 'no pg_net background worker in pg_stat_activity');
  end if;
  if v_due_age > c_processable_due_age_sec then
    v_problems := v_problems || jsonb_build_object('code', 'QUEUE_STUCK',
      'detail', format('processable work due for %s s', v_due_age));
  end if;
  if v_lease_age > c_expired_lease_age_sec then
    v_problems := v_problems || jsonb_build_object('code', 'LEASES_EXPIRED',
      'detail', format('%s expired leases, oldest %s s', snap.expired_lease_count, v_lease_age));
  end if;
  if v_dead_window > 0 then
    v_problems := v_problems || jsonb_build_object('code', 'JOBS_DEAD',
      'detail', format('%s jobs became dead since %s', v_dead_window,
        to_char(v_dead_since at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  end if;
  if v_open_recon > 0 then
    v_problems := v_problems || jsonb_build_object('code', 'RECONCILIATION_OPEN',
      'detail', format('%s deliveries need reconciliation', v_open_recon));
  end if;
  if v_runs_not_ok > 0 then
    v_problems := v_problems || jsonb_build_object('code', 'WORKER_RUNS_FAILED',
      'detail', format('%s worker runs failed', v_runs_not_ok));
  end if;
  if v_failed > 0 then
    v_problems := v_problems || jsonb_build_object('code', 'JOB_FAILURES',
      'detail', format('%s job attempts failed', v_failed));
  end if;
  if v_state_errors > 0 then
    v_problems := v_problems || jsonb_build_object('code', 'STATE_ERRORS',
      'detail', format('%s state errors', v_state_errors));
  end if;
  if v_needs_recon > 0 then
    v_problems := v_problems || jsonb_build_object('code', 'RECONCILIATION_EVENTS',
      'detail', format('%s jobs quarantined for reconciliation', v_needs_recon));
  end if;
  if v_maint_age is null or v_maint_age > c_maintenance_age_sec then
    v_problems := v_problems || jsonb_build_object('code', 'MAINTENANCE_STALE',
      'detail', case when v_maint_age is null then 'no maintenance.completed audit row'
        else format('last maintenance %s s ago', v_maint_age) end);
  end if;

  if snap.email_hold_code is not null then
    v_warnings := v_warnings || jsonb_build_object('code', 'EMAIL_HOLD',
      'detail', format('%s until %s (%s emails waiting)', snap.email_hold_code,
        to_char(snap.email_hold_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        snap.held_email_count));
  end if;
  if v_unclaimable > 0 then
    v_warnings := v_warnings || jsonb_build_object('code', 'UNCLAIMABLE_JOBS',
      'detail', format('%s claims matched no row', v_unclaimable));
  end if;
  if coalesce(v_queue_depth, 0) > (case when v_outstanding_queued then 1 else 0 end) then
    v_warnings := v_warnings || jsonb_build_object('code', 'PG_NET_QUEUE_BACKLOG',
      'detail', format('%s rows in net.http_request_queue', v_queue_depth));
  end if;

  return jsonb_build_object(
    'generatedAt', v_now,
    'status', case when jsonb_array_length(v_problems) > 0 then 'fail'
      when jsonb_array_length(v_warnings) > 0 then 'warn' else 'ok' end,
    'problems', v_problems,
    'warnings', v_warnings,
    'thresholds', jsonb_build_object(
      'tickStaleSec', c_tick_stale_sec,
      'processableDueAgeSec', c_processable_due_age_sec,
      'expiredLeaseAgeSec', c_expired_lease_age_sec,
      'consecutiveFailures', c_failure_threshold,
      'pgNetOutstandingSec', c_outstanding_sec,
      'maintenanceAgeSec', c_maintenance_age_sec,
      'deadWindowHours', 24),
    'dispatcher', jsonb_build_object(
      'configured', v_configured,
      'cronInstalled', v_cron_installed,
      'scheduled', v_scheduled,
      'cronLastRunStatus', v_cron_status,
      'cronLastRunAgeSec', extract(epoch from v_now - v_cron_start)::integer,
      'lastTickAt', s.last_tick_at,
      'lastTickAgeSec', v_tick_age,
      'lastReason', s.last_reason,
      'lastDispatchAt', s.last_dispatch_at,
      'lastDispatchAgeSec', extract(epoch from v_now - s.last_dispatch_at)::integer,
      'lastOutcome', s.last_outcome,
      'lastHttpStatus', s.last_http_status,
      'lastSuccessAt', s.last_success_at,
      'consecutiveFailures', s.consecutive_failures,
      'noProgressStreak', s.no_progress_streak,
      'noProgressUntil', s.no_progress_until,
      'lastError', s.last_error),
    'pgNet', jsonb_build_object(
      'installed', v_net_installed,
      'workerRunning', v_worker_running,
      'queueDepth', v_queue_depth,
      'outstandingRequestId', case when s.last_request_scored then null else s.last_request_id end,
      'outstandingQueued', v_outstanding_queued,
      'outstandingAgeSec', v_outstanding_age),
    'queue', jsonb_build_object(
      'dueCount', snap.due_count,
      'processableDueCount', snap.processable_due_count,
      'oldestDueAgeSec', extract(epoch from v_now - snap.oldest_due_at)::integer,
      'oldestProcessableDueAgeSec', v_due_age,
      'expiredLeaseCount', snap.expired_lease_count,
      'oldestExpiredLeaseAgeSec', v_lease_age,
      'emailHold', case when snap.email_hold_code is null then null else jsonb_build_object(
        'code', snap.email_hold_code,
        'until', snap.email_hold_until,
        'heldCount', snap.held_email_count) end),
    'jobs', jsonb_build_object(
      'dead24h', v_dead,
      'dead24hByCode', v_dead_codes,
      'dropped24h', v_dropped,
      'deadWindowSince', v_dead_since,
      'deadInWindow', v_dead_window,
      'openReconciliation', v_open_recon),
    'workerRuns', jsonb_build_object(
      'since', v_since,
      'runs', v_runs,
      'notOk', v_runs_not_ok,
      'failed', v_failed,
      'stateErrors', v_state_errors,
      'needsReconciliation', v_needs_recon,
      'unclaimable', v_unclaimable,
      'lastRunAt', v_last_run_at,
      'lastRunTrigger', v_last_run_trigger),
    'maintenance', jsonb_build_object(
      'lastCompletedAt', v_maintenance_at,
      'ageSec', v_maint_age)
  );
end;
$$;
revoke all on function public.job_dispatch_health(boolean) from public, anon, authenticated;
grant execute on function public.job_dispatch_health(boolean) to service_role;

commit;
