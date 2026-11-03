begin;
select plan(95);

-- Isolate from anything else in the local database.
delete from public.jobs;
delete from private.job_worker_runs;
update private.job_dispatch_state set last_tick_at = null, last_reason = 'never_ran',
  last_dispatch_at = null, last_request_id = null, last_dispatch_id = null,
  last_dispatch_newest_ready_at = null, last_request_scored = true, stall_counted = false,
  last_outcome = null, last_outcome_at = null, last_http_status = null, last_success_at = null,
  consecutive_failures = 0, no_progress_streak = 0, no_progress_until = null,
  no_progress_newest_ready_at = null, last_error = null;
create temporary table queue_baseline on commit drop as
  select coalesce(max(id), 0) as max_id from net.http_request_queue;
-- A complete /api/cron/jobs success body (every counter the dispatcher requires).
create function pg_temp.worker_body(p_claimed integer, p_due_before integer,
  p_remaining_due integer, p_recovered integer default 0, p_leases_before integer default 0,
  p_remaining_leases integer default 0)
returns text language sql as $$
  select jsonb_build_object('ok', true, 'jobs', jsonb_build_object(
    'claimed', p_claimed, 'recoveredLeases', p_recovered,
    'processableDueBefore', p_due_before, 'expiredLeasesBefore', p_leases_before,
    'remainingProcessableDue', p_remaining_due, 'remainingExpiredLeases', p_remaining_leases))::text
$$;

-- 1-16: installation is inert and privileges are explicit
select has_extension('pg_cron', 'pg_cron is installed for production scheduling');
select has_extension('pg_net', 'pg_net is installed');
select lives_ok($$create extension if not exists pg_cron with schema pg_catalog$$,
  'pg_cron can be re-created: no postgres self-grants on cron');
select is_empty($$select 1 from cron.job where jobname like 'ourmu-%'$$,
  'migrations schedule no ourmu cron jobs');
select is_empty($$select 1 from vault.secrets where name in ('ourmu_job_worker_url','ourmu_job_trigger_secret')$$,
  'migrations ship no Vault secrets');
select has_function('private', 'dispatch_job_worker', array['boolean'],
  'the dispatcher takes the owner probe flag');
select is_empty($$select 1 from information_schema.role_routine_grants
  where routine_schema = 'private' and routine_name = 'dispatch_job_worker'
    and grantee in ('PUBLIC','anon','authenticated','service_role')$$,
  'only the owner can execute the dispatcher');
select is_empty($$select 1 from information_schema.role_routine_grants
  where routine_schema = 'public'
    and routine_name in ('job_queue_snapshot','job_dispatch_health','record_job_worker_run',
                         'job_worker_recent_runs','run_maintenance_exclusive')
    and grantee in ('PUBLIC','anon','authenticated')$$,
  'browser roles cannot execute the worker RPCs');
select function_privs_are('public','job_queue_snapshot',array['uuid'],'service_role',array['EXECUTE'],
  'service role executes job_queue_snapshot');
select function_privs_are('public','job_dispatch_health',array['boolean'],'service_role',array['EXECUTE'],
  'service role executes job_dispatch_health');
select function_privs_are('public','record_job_worker_run',array['jsonb'],'service_role',array['EXECUTE'],
  'service role executes record_job_worker_run');
select function_privs_are('public','job_worker_recent_runs',array['integer'],'service_role',array['EXECUTE'],
  'service role executes job_worker_recent_runs');
select function_privs_are('public','run_maintenance_exclusive',array['uuid'],'service_role',array['EXECUTE'],
  'service role executes run_maintenance_exclusive');
select is_empty($$select 1 from information_schema.role_table_grants
  where table_schema = 'private' and table_name in ('job_dispatch_state','job_worker_runs')
    and grantee in ('PUBLIC','anon','authenticated','service_role')$$,
  'dispatcher tables are reachable only through functions');
select ok((select relrowsecurity from pg_class where oid = 'private.job_dispatch_state'::regclass),
  'dispatch state has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'private.job_worker_runs'::regclass),
  'worker runs have RLS enabled');

-- 17-25: the configuration is checked on every tick, even with an empty queue
select is(private.dispatch_job_worker(), 'not_configured',
  'a missing configuration is reported even when the queue is empty');
select ok((public.job_dispatch_health(true) -> 'problems') @> '[{"code":"DISPATCHER_ERROR"}]',
  'a missing configuration fails health while idle');
do $$ begin
  perform vault.create_secret('http://partners.example.test/api/cron/jobs', 'ourmu_job_worker_url');
  perform vault.create_secret(repeat('t', 40), 'ourmu_job_trigger_secret');
end $$;
select is(private.dispatch_job_worker(), 'invalid_url', 'plain http is rejected with an empty queue');
select ok((public.job_dispatch_health(true) -> 'problems')
    @> '[{"code":"DISPATCHER_ERROR","detail":"invalid_url"}]',
  'a bad URL fails health while idle');
do $$ begin perform vault.update_secret((select id from vault.secrets where name = 'ourmu_job_worker_url'),
  'https://partners.example.test/api/cron/jobs/extra'); end $$;
select is(private.dispatch_job_worker(), 'invalid_url', 'other paths are rejected');
do $$ begin perform vault.update_secret((select id from vault.secrets where name = 'ourmu_job_worker_url'),
  'https://user@partners.example.test/api/cron/jobs'); end $$;
select is(private.dispatch_job_worker(), 'invalid_url', 'userinfo is rejected');
do $$ begin perform vault.update_secret((select id from vault.secrets where name = 'ourmu_job_worker_url'),
  'https://partners.example.test/api/cron/jobs'); end $$;
do $$ begin perform vault.update_secret((select id from vault.secrets where name = 'ourmu_job_trigger_secret'), 'short'); end $$;
select is(private.dispatch_job_worker(), 'invalid_secret', 'short secrets are rejected');
do $$ begin perform vault.update_secret((select id from vault.secrets where name = 'ourmu_job_trigger_secret'), repeat('t', 40)); end $$;
select is(private.dispatch_job_worker(), 'idle', 'a valid configuration with an empty queue is idle');
select is((select count(*)::integer from net.http_request_queue
  where id > (select max_id from queue_baseline)), 0,
  'idle ticks and rejected configurations queue nothing');

-- 26-30: the owner probe proves the delivery path without due work
select is(private.dispatch_job_worker(true), 'dispatched', 'the owner probe dispatches with an empty queue');
select is(private.dispatch_job_worker(true), 'outstanding', 'the probe never adds a second outstanding request');
insert into net._http_response (id, status_code, content, timed_out, error_msg)
  select last_request_id, 200, pg_temp.worker_body(0, 0, 0), false, null from private.job_dispatch_state;
select is(private.dispatch_job_worker(), 'idle', 'after the probe an idle tick does not dispatch');
select is((select format('%s/%s', last_outcome, last_http_status) from private.job_dispatch_state),
  'ok/200', 'the probe response is scored ok with HTTP 200');
select is((select count(*)::integer from net.http_request_queue
  where id > (select max_id from queue_baseline)), 1, 'only the probe request was queued');
delete from net.http_request_queue where id > (select max_id from queue_baseline);

-- 31-36: dispatch with exact request shape
insert into public.jobs (id, kind, entity_type, entity_id, payload, available_at)
values ('88000000-0000-4000-8000-000000000001', 'generate_receipt_pdf', 'test',
        '88000000-0000-4000-8000-000000000000', '{}', now() - interval '1 minute');
select is(private.dispatch_job_worker(), 'dispatched', 'due PDF work dispatches');
select is((select count(*)::integer from net.http_request_queue
  where id > (select max_id from queue_baseline)), 1, 'exactly one request is queued');
select is((select url from net.http_request_queue where id = (select last_request_id from private.job_dispatch_state)),
  'https://partners.example.test/api/cron/jobs', 'request targets the Vault URL');
select ok((select headers ->> 'Authorization' = 'Bearer ' || repeat('t', 40)
    and headers ->> 'x-ourmu-trigger' = 'pg_cron'
    and (headers ->> 'x-ourmu-dispatch-id')::uuid = (select last_dispatch_id from private.job_dispatch_state)
    and method = 'POST' and timeout_milliseconds = 120000
  from net.http_request_queue where id = (select last_request_id from private.job_dispatch_state)),
  'request carries the bearer, trigger, dispatch id, POST and a 120 s timeout');
select is(private.dispatch_job_worker(), 'outstanding', 'a queued request blocks another dispatch');
select is((select count(*)::integer from net.http_request_queue
  where id > (select max_id from queue_baseline)), 1, 'still exactly one request');

-- 37-41: pg_net stall and lost requests
update private.job_dispatch_state set last_dispatch_at = now() - interval '4 minutes';
select is(private.dispatch_job_worker(), 'pg_net_stalled', 'a request queued for over 3 minutes is a stall');
select is(private.dispatch_job_worker(), 'pg_net_stalled', 'the stall persists without enqueuing more');
select is((select consecutive_failures from private.job_dispatch_state), 1, 'a stall counts as one failure, once');
select is((select format('%s/%s', last_outcome, coalesce(last_http_status::text, 'none'))
  from private.job_dispatch_state), 'stalled/none',
  'a stall shows no HTTP status, not the previous request''s');
delete from net.http_request_queue where id = (select last_request_id from private.job_dispatch_state);
update private.job_dispatch_state set last_dispatch_at = now() - interval '3 minutes';
select is(private.dispatch_job_worker(), 'dispatched', 'a lost request is scored and work is re-dispatched');

-- 42-45: failure backoff
insert into net._http_response (id, status_code, content, timed_out, error_msg)
  select last_request_id, 500, '{"ok":false}', false, null from private.job_dispatch_state;
select is(private.dispatch_job_worker(), 'dispatched', 'second failure still dispatches');
insert into net._http_response (id, status_code, content, timed_out, error_msg)
  select last_request_id, 503, '{"ok":false}', false, null from private.job_dispatch_state;
select is(private.dispatch_job_worker(), 'failure_backoff', 'third consecutive failure backs off');
select is((select consecutive_failures from private.job_dispatch_state), 3, 'three failures recorded');
update private.job_dispatch_state set last_dispatch_at = now() - interval '16 minutes';
select is(private.dispatch_job_worker(), 'dispatched', 'after 15 minutes one dispatch is allowed');

-- 46-49: failures stay reported while idle; a successful probe clears them
delete from public.jobs;
insert into net._http_response (id, status_code, content, timed_out, error_msg)
  select last_request_id, 502, 'Bad Gateway', false, null from private.job_dispatch_state;
select is(private.dispatch_job_worker(), 'idle', 'with the work drained elsewhere the dispatcher is idle');
select ok((public.job_dispatch_health(true) -> 'problems') @> '[{"code":"DISPATCH_FAILING"}]',
  'failures stay reported while idle until a dispatch succeeds');
select is(private.dispatch_job_worker(true), 'dispatched', 'the owner probe ignores the failure backoff');
insert into net._http_response (id, status_code, content, timed_out, error_msg)
  select last_request_id, 200, pg_temp.worker_body(0, 0, 0), false, null from private.job_dispatch_state;
do $$ begin perform private.dispatch_job_worker(); end $$;
select is((select format('%s/%s/%s', last_reason, last_outcome, consecutive_failures)
  from private.job_dispatch_state), 'idle/ok/0', 'a successful probe clears the failure count');

-- 50-59: no-progress backoff, and its end once nothing is stuck
insert into public.jobs (id, kind, entity_type, entity_id, payload, available_at)
values ('88000000-0000-4000-8000-000000000001', 'generate_receipt_pdf', 'test',
        '88000000-0000-4000-8000-000000000000', '{}', now() - interval '1 minute');
select is(private.dispatch_job_worker(), 'dispatched', 'due work dispatches');
insert into net._http_response (id, status_code, content, timed_out, error_msg)
  select last_request_id, 200, pg_temp.worker_body(0, 1, 1), false, null from private.job_dispatch_state;
select is(private.dispatch_job_worker(), 'no_progress', 'claimed 0 while work was due and is still left backs off');
select is((select no_progress_until - last_dispatch_at from private.job_dispatch_state),
  interval '30 minutes', 'first no-progress wait is 30 minutes');
select is(private.dispatch_job_worker(), 'no_progress', 'the same stuck work does not dispatch again');
select is((select no_progress_streak from private.job_dispatch_state), 1,
  'waiting on the same stuck work keeps the streak');
insert into public.jobs (id, kind, entity_type, entity_id, payload, available_at)
values ('88000000-0000-4000-8000-000000000002', 'generate_agreement_pdf', 'test',
        '88000000-0000-4000-8000-000000000000', '{}', now());
select is(private.dispatch_job_worker(), 'dispatched', 'newly ready work bypasses the no-progress wait');
insert into net._http_response (id, status_code, content, timed_out, error_msg)
  select last_request_id, 200, pg_temp.worker_body(0, 2, 2), false, null from private.job_dispatch_state;
select is(private.dispatch_job_worker(), 'no_progress', 'second no-progress run backs off again');
select is((select no_progress_until - last_dispatch_at from private.job_dispatch_state),
  interval '60 minutes', 'second no-progress wait is capped at 60 minutes');
delete from public.jobs;
select is(private.dispatch_job_worker(), 'idle', 'once the stuck work is gone the dispatcher is idle');
select ok((select no_progress_streak = 0 and no_progress_until is null from private.job_dispatch_state)
    and not (public.job_dispatch_health(true) -> 'problems') @> '[{"code":"DISPATCH_NO_PROGRESS"}]',
  'an idle tick ends the no-progress backoff and its alert');

-- 60-61: claimed nothing because nothing was left (a concurrent worker took it)
insert into public.jobs (id, kind, entity_type, entity_id, payload, available_at)
values ('88000000-0000-4000-8000-000000000001', 'generate_receipt_pdf', 'test',
        '88000000-0000-4000-8000-000000000000', '{}', now() - interval '1 minute');
do $$ begin perform private.dispatch_job_worker(); end $$;
insert into net._http_response (id, status_code, content, timed_out, error_msg)
  select last_request_id, 200, pg_temp.worker_body(0, 1, 0), false, null from private.job_dispatch_state;
select is(private.dispatch_job_worker(), 'dispatched', 'a run that found nothing left is not stuck');
select is((select format('%s/%s', last_outcome, no_progress_streak) from private.job_dispatch_state),
  'ok/0', 'claimed 0 with no work left scores ok');

-- 62-67: timeouts are scored from the run log; bodies are validated
insert into net._http_response (id, status_code, content, timed_out, error_msg)
  select last_request_id, null, null, true, 'Timeout was reached' from private.job_dispatch_state;
select lives_ok($$select public.record_job_worker_run(jsonb_build_object(
  'route','jobs','trigger','pg_cron','request_id',gen_random_uuid(),
  'dispatch_id',(select last_dispatch_id from private.job_dispatch_state),
  'started_at',now(),'finished_at',now(),'ok',true,'claimed',2,'processable_due_before',2,
  'remaining_processable_due',0,'remaining_expired_leases',0))$$,
  'the route records its run');
select is(private.dispatch_job_worker(), 'dispatched', 'timed out but recorded progress is not a failure');
select is((select format('%s/%s', no_progress_streak, consecutive_failures) from private.job_dispatch_state),
  '0/0', 'progress resets both backoffs');
insert into net._http_response (id, status_code, content, timed_out, error_msg)
  select last_request_id, 200, '<html>challenge</html>', false, null from private.job_dispatch_state;
do $$ begin perform private.dispatch_job_worker(); end $$;
select is((select format('%s/%s', last_outcome, consecutive_failures) from private.job_dispatch_state),
  'bad_response/1', 'a 2xx without the worker JSON counts as a failure');
insert into net._http_response (id, status_code, content, timed_out, error_msg)
  select last_request_id, 200, '{"ok":true}', false, null from private.job_dispatch_state;
do $$ begin perform private.dispatch_job_worker(); end $$;
select is((select format('%s/%s', last_outcome, consecutive_failures) from private.job_dispatch_state),
  'bad_response/2', 'a 2xx without the jobs object counts as a failure');
insert into net._http_response (id, status_code, content, timed_out, error_msg)
  select last_request_id, 200,
    '{"ok":true,"jobs":{"claimed":1,"recoveredLeases":0,"processableDueBefore":1,"expiredLeasesBefore":0}}',
    false, null from private.job_dispatch_state;
do $$ begin perform private.dispatch_job_worker(); end $$;
select is((select format('%s/%s', last_outcome, consecutive_failures) from private.job_dispatch_state),
  'bad_response/3', 'a body missing a required counter counts as a failure');

-- 68-72: email hold parity with src/lib/jobs.ts
delete from public.jobs;
delete from net.http_request_queue where id > (select max_id from queue_baseline);
update private.job_dispatch_state set last_request_scored = true, consecutive_failures = 0;
insert into public.jobs (id, kind, entity_type, entity_id, payload, status, last_error_code, available_at)
values
 ('88000000-0000-4000-8000-000000000010', 'send_email', 'test', '88000000-0000-4000-8000-000000000000',
  '{"template":"agreement_ready","to":"held@example.test"}', 'pending', 'EMAIL_DAILY_QUOTA_EXCEEDED', now() + interval '1 hour'),
 ('88000000-0000-4000-8000-000000000011', 'send_email', 'test', '88000000-0000-4000-8000-000000000000',
  '{"template":"agreement_ready","to":"waiting@example.test"}', 'pending', null, now() - interval '20 minutes');
select is(private.dispatch_job_worker(), 'held', 'held emails alone do not dispatch');
select is((select format('%s/%s/%s/%s', due_count, processable_due_count, held_email_count, email_hold_code)
  from public.job_queue_snapshot()), '1/0/2/EMAIL_DAILY_QUOTA_EXCEEDED',
  'snapshot reports the hold and excludes held emails');
select ok(not (public.job_dispatch_health() -> 'problems') @> '[{"code":"QUEUE_STUCK"}]',
  'held emails are not reported as a stuck queue');
insert into public.jobs (id, kind, entity_type, entity_id, payload, available_at)
values ('88000000-0000-4000-8000-000000000012', 'generate_receipt_pdf', 'test',
        '88000000-0000-4000-8000-000000000000', '{}', now() - interval '20 minutes');
select is(private.dispatch_job_worker(), 'dispatched', 'PDF work dispatches during an email hold');
select ok((public.job_dispatch_health() -> 'problems') @> '[{"code":"QUEUE_STUCK"}]'
  and (public.job_dispatch_health() -> 'warnings') @> '[{"code":"EMAIL_HOLD"}]',
  'old processable work fails health while the hold only warns');

-- 73-75: expired leases
delete from public.jobs;
delete from net.http_request_queue where id > (select max_id from queue_baseline);
update private.job_dispatch_state set last_request_scored = true;
insert into public.jobs (id, kind, entity_type, entity_id, payload, status, claim_token, lease_expires_at, available_at)
values ('88000000-0000-4000-8000-000000000020', 'generate_agreement_pdf', 'test',
        '88000000-0000-4000-8000-000000000000', '{}', 'running', 'dead-worker',
        now() - interval '1 minute', now() - interval '10 minutes');
select is((select expired_lease_count from public.job_queue_snapshot()), 1, 'snapshot counts the expired lease');
select is(private.dispatch_job_worker(), 'dispatched', 'an expired lease dispatches');
insert into net._http_response (id, status_code, content, timed_out, error_msg)
  select last_request_id, 200, pg_temp.worker_body(0, 0, 0, 0, 1, 1), false, null
  from private.job_dispatch_state;
select is(private.dispatch_job_worker(), 'no_progress', 'a lease the worker cannot recover backs off as no progress');

-- 76-78: an error inside a tick is recorded, never raised, and queues nothing
delete from public.jobs;
delete from net.http_request_queue where id > (select max_id from queue_baseline);
update private.job_dispatch_state set last_request_scored = true, no_progress_streak = 0,
  no_progress_until = null, no_progress_newest_ready_at = null, consecutive_failures = 0;
insert into public.jobs (id, kind, entity_type, entity_id, payload, available_at)
values ('88000000-0000-4000-8000-000000000001', 'generate_receipt_pdf', 'test',
        '88000000-0000-4000-8000-000000000000', '{}', now() - interval '1 minute');
create function private.test_fail_dispatch_state() returns trigger language plpgsql
set search_path = '' as $$
begin
  if new.last_reason = 'dispatched' then
    raise exception 'simulated state write failure';
  end if;
  return new;
end;
$$;
create trigger test_fail_dispatch_state before update on private.job_dispatch_state
  for each row execute function private.test_fail_dispatch_state();
select is(private.dispatch_job_worker(), 'error', 'an error inside a tick is returned, never raised');
select ok((select last_reason = 'error' and last_error like 'P0001: simulated state write failure%'
  from private.job_dispatch_state), 'the error is recorded with its SQLSTATE');
select is((select count(*)::integer from net.http_request_queue
  where id > (select max_id from queue_baseline)), 0,
  'an error rolls back the request queued in the same tick');
drop trigger test_fail_dispatch_state on private.job_dispatch_state;
drop function private.test_fail_dispatch_state();

-- 79-82: dead jobs, deliberate drops and reconciliation
delete from public.jobs;
insert into public.jobs (id, kind, entity_type, entity_id, payload, status, last_error_code)
values
 ('88000000-0000-4000-8000-000000000030', 'send_email', 'test', '88000000-0000-4000-8000-000000000000',
  '{"template":"agreement_ready","to":"a@example.test"}', 'dead', 'EMAIL_DELIVERY_FAILED:validation_error'),
 ('88000000-0000-4000-8000-000000000031', 'send_email', 'test', '88000000-0000-4000-8000-000000000000',
  '{"template":"agreement_ready","to":"b@example.test"}', 'dead', 'STALE_MATURITY_CONFIRMATION_CANCELLED'),
 ('88000000-0000-4000-8000-000000000032', 'send_email', 'test', '88000000-0000-4000-8000-000000000000',
  '{"template":"agreement_ready","to":"c@example.test"}', 'dead', 'NEEDS_RECONCILIATION'),
 ('88000000-0000-4000-8000-000000000033', 'send_email', 'test', '88000000-0000-4000-8000-000000000000',
  '{"template":"reservation_created","to":"d@example.test"}', 'dead', 'STALE_RESERVATION'),
 ('88000000-0000-4000-8000-000000000034', 'send_email', 'test', '88000000-0000-4000-8000-000000000000',
  '{"template":"reservation_created","to":"e@example.test"}', 'dead', 'RESERVATION_NOT_FOUND');
select is((public.job_dispatch_health() #>> '{jobs,dead24h}')::integer, 2,
  'dead jobs in 24 h exclude cancellations and deliberate drops');
select is((public.job_dispatch_health() #>> '{jobs,dropped24h}')::integer, 3,
  'cancellations and deliberate drops are counted separately');
select is((public.job_dispatch_health() #>> '{jobs,openReconciliation}')::integer, 1,
  'open reconciliation is counted');
select ok(public.job_dispatch_health() ?& array['generatedAt','status','problems','warnings','thresholds',
  'dispatcher','pgNet','queue','jobs','workerRuns','maintenance'], 'health has every section');

-- 83-88: the watchdog window reports every event once
delete from private.job_worker_runs;
delete from public.jobs;
insert into private.job_worker_runs (route, trigger, request_id, started_at, finished_at, ok,
  failed, state_errors, maintenance_status, health_checked_at, recorded_at)
values
 -- previous watchdog run: read health 1 h ago, drained, recorded 40 s later
 ('jobs', 'github', gen_random_uuid(), now() - interval '1 hour', now() - interval '1 hour' + interval '40 seconds',
  true, 1, 0, null, now() - interval '1 hour', now() - interval '1 hour' + interval '40 seconds'),
 -- dispatcher run recorded before that health read: already reported by it
 ('jobs', 'pg_cron', gen_random_uuid(), now() - interval '1 hour' - interval '60 seconds',
  now() - interval '1 hour' - interval '5 seconds', true, 4, 0, null, null, now() - interval '1 hour' - interval '5 seconds'),
 -- dispatcher run that started before the health read and was recorded after it
 ('jobs', 'pg_cron', gen_random_uuid(), now() - interval '1 hour' - interval '5 seconds',
  now() - interval '1 hour' + interval '30 seconds', true, 2, 1, null, null, now() - interval '1 hour' + interval '30 seconds'),
 -- maintenance fallback run: never moves the window
 ('maintenance', 'github', gen_random_uuid(), now() - interval '30 minutes', now() - interval '30 minutes',
  true, 0, 0, 'completed', now() - interval '30 minutes', now() - interval '30 minutes');
select is((public.job_dispatch_health(true) #>> '{workerRuns,since}')::timestamptz, now() - interval '1 hour',
  'the watchdog window starts when the previous watchdog read health, not at maintenance runs');
select is((public.job_dispatch_health(true) #>> '{workerRuns,failed}')::integer, 2,
  'the watchdog counts runs recorded after the previous health read, never that run''s own row');
select ok((public.job_dispatch_health(true) -> 'problems') @> '[{"code":"JOB_FAILURES"},{"code":"STATE_ERRORS"}]',
  'a dispatcher run that overlapped the previous watchdog run is still reported');
select is((public.job_dispatch_health(false) #>> '{workerRuns,failed}')::integer, 7,
  'the admin view sums every run of the last 24 h');
insert into public.jobs (id, kind, entity_type, entity_id, payload, status, last_error_code, updated_at)
values
 ('88000000-0000-4000-8000-000000000040', 'generate_receipt_pdf', 'test', '88000000-0000-4000-8000-000000000000',
  '{}', 'dead', 'RECEIPT_FAILED', now() - interval '1 hour' + interval '20 seconds'),
 ('88000000-0000-4000-8000-000000000041', 'generate_receipt_pdf', 'test', '88000000-0000-4000-8000-000000000000',
  '{}', 'dead', 'RECEIPT_FAILED', now() - interval '10 minutes');
select is((public.job_dispatch_health(true) #>> '{jobs,deadInWindow}')::integer, 1,
  'a job that died in the previous watchdog run''s own drain is not reported again');
select is((public.job_dispatch_health(false) #>> '{jobs,deadInWindow}')::integer, 2,
  'the admin view counts every death of the last 24 h');

-- 89-90: a watchdog run whose health jobs.yml did not evaluate moves neither window
insert into private.job_worker_runs (route, trigger, request_id, started_at, finished_at, ok,
  error_code, health_checked_at, recorded_at)
values ('jobs', 'github', '88000000-0000-4000-8000-0000000000fe', now() - interval '5 minutes',
  now() - interval '4 minutes', false, 'JOB_FETCH_FAILED', now() - interval '5 minutes',
  now() - interval '4 minutes');
select is((select format('%s/%s/%s', (h #>> '{workerRuns,since}')::timestamptz = now() - interval '1 hour',
    h #>> '{workerRuns,failed}', h #>> '{jobs,deadInWindow}')
  from public.job_dispatch_health(true) as h), 't/2/1',
  'a watchdog run that answered 503 moves neither window');
update private.job_worker_runs set ok = true, error_code = null, health_checked_at = null
  where request_id = '88000000-0000-4000-8000-0000000000fe';
select is((select format('%s/%s/%s', (h #>> '{workerRuns,since}')::timestamptz = now() - interval '1 hour',
    h #>> '{workerRuns,failed}', h #>> '{jobs,deadInWindow}')
  from public.job_dispatch_health(true) as h), 't/2/1',
  'a watchdog run whose health read failed moves neither window');

-- 91-95: run log validation and retention, maintenance lock
select throws_ok($$select public.record_job_worker_run(jsonb_build_object('route','jobs','trigger','github',
  'request_id',gen_random_uuid(),'started_at',now(),'finished_at',now(),'ok',true,'failed',-1))$$,
  '23514', null, 'negative counters are rejected');
insert into private.job_worker_runs (route, trigger, request_id, started_at, finished_at, ok)
values ('jobs', 'pg_cron', gen_random_uuid(), now() - interval '31 days', now() - interval '31 days', true);
do $$ begin perform public.record_job_worker_run(jsonb_build_object('route','jobs','trigger','bogus',
  'request_id','88000000-0000-4000-8000-0000000000ff','started_at',now(),'finished_at',now(),'ok',true,
  'remaining_expired_leases',3,'health_checked_at','2026-11-03T04:00:00Z')); end $$;
select is((select trigger from private.job_worker_runs where request_id = '88000000-0000-4000-8000-0000000000ff'),
  'unknown', 'unrecognised triggers are stored as unknown');
select is((select format('%s/%s', remaining_expired_leases, health_checked_at = '2026-11-03T04:00:00Z'::timestamptz)
  from private.job_worker_runs where request_id = '88000000-0000-4000-8000-0000000000ff'),
  '3/t', 'remaining expired leases and the health read time are stored');
select is((select count(*)::integer from private.job_worker_runs where started_at < now() - interval '30 days'), 0,
  'runs older than 30 days are pruned on write');
select ok((public.run_maintenance_exclusive(gen_random_uuid()) ? 'matured')
  and exists (select 1 from pg_locks where locktype = 'advisory' and classid = 87005 and objid = 2
    and objsubid = 2 and pid = pg_backend_pid()),
  'maintenance runs under the 87005/2 advisory lock and returns run_maintenance''s result');

select * from finish();
rollback;
