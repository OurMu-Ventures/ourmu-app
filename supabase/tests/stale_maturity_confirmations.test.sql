begin;
select plan(27);

-- Stale maturity confirmations: one staleness rule for the job guard and the
-- retirement triggers. Synthetic fixtures with fixed dates; rolled back.
-- Worker and RPC writes run as service_role, as in production.

-- Privileges -------------------------------------------------------------------
select ok(has_function_privilege('service_role','private.is_stale_maturity_confirmation(public.jobs)','execute'),'worker writes can evaluate the staleness rule');
select ok(not has_function_privilege('authenticated','private.is_stale_maturity_confirmation(public.jobs)','execute'),'browser roles cannot call the staleness rule');
select ok((select prosecdef from pg_proc where oid='private.retire_stale_maturity_confirmation_jobs()'::regprocedure),'retirement does not depend on the caller''s job privileges');
select ok(not has_function_privilege('authenticated','private.retire_stale_maturity_confirmation_jobs()','execute'),'browser roles cannot run the retirement trigger');

-- Fixtures ---------------------------------------------------------------------
insert into auth.users(id,email) values
 ('5c000000-0000-4000-8000-000000000001','stale-admin@test.local'),
 ('5c000000-0000-4000-8000-000000000002','stale-partner@test.local');
insert into public.profiles(id,role,access_status,legal_name,email,phone,kyc_status) values
 ('5c000000-0000-4000-8000-000000000001','admin','active','Stale Admin','stale-admin@test.local','+256700000501','verified'),
 ('5c000000-0000-4000-8000-000000000002','investor','active','Stale Partner','stale-partner@test.local','+256700000502','verified');
insert into public.agreement_versions(id,version,title,template_markdown,content_hash,is_legally_approved,approved_by,approved_at,published_at)
values('5c000000-0000-4000-8000-000000000003','stale-confirmation-test','Test Agreement','Test terms',repeat('e',64),true,'5c000000-0000-4000-8000-000000000001',now(),now());
-- Fixed past dates: the payout day has passed whatever day the suite runs.
insert into public.investment_cycles(id,name,opens_at,closes_at,maturity_date,capacity_ugx,unit_price_ugx,projected_return_bps,status,agreement_version_id,created_by,record_origin)
values('5c000000-0000-4000-8000-000000000004','Stale Confirmation Cycle','2026-01-05 00:00+03','2026-01-20 00:00+03','2026-07-31',200000000,125000,3000,'closed','5c000000-0000-4000-8000-000000000003','5c000000-0000-4000-8000-000000000001','portal');
select set_config('ourmu.recording_cycle_actual_return','on',true);
update public.investment_cycles set legacy_settlement=true where id='5c000000-0000-4000-8000-000000000004';
select set_config('ourmu.recording_cycle_actual_return','off',true);
insert into public.payout_destinations(id,investor_id,channel,provider_label,account_name,account_ref_ciphertext,account_ref_iv,account_ref_auth_tag,account_ref_fingerprint,account_last_four,key_version)
values('5c000000-0000-4000-8000-000000000005','5c000000-0000-4000-8000-000000000002','bank','Test Bank','Stale Partner','\x01','\x02','\x03','\x04','0502',1);
-- Six matured investments (…11 to …16); the sixth has no request yet.
insert into public.investments(id,investor_id,cycle_id,principal_ugx,unit_price_ugx,projected_return_bps,projected_return_ugx,projected_value_ugx,maturity_date,status,record_origin)
select ('5c000000-0000-4000-8000-00000000001'||n)::uuid,'5c000000-0000-4000-8000-000000000002','5c000000-0000-4000-8000-000000000004',1000000,125000,3000,300000,1300000,'2026-07-31','matured','portal'
from generate_series(1,6) n;
insert into public.maturity_instructions(id,investment_id,investor_id,choice,status,projected_payout_ugx,projected_reinvest_ugx,payout_destination_id,request_id)
select ('5c000000-0000-4000-8000-00000000002'||n)::uuid,('5c000000-0000-4000-8000-00000000001'||n)::uuid,'5c000000-0000-4000-8000-000000000002','withdraw_all','requested',1300000,0,'5c000000-0000-4000-8000-000000000005',gen_random_uuid()
from generate_series(1,5) n;
-- Queued while every request is live, so the guard accepts each row.
insert into public.jobs(id,kind,entity_type,entity_id,payload,status,claim_token,lease_expires_at,locked_at) values
 -- Investment 1 is fulfilled through the RPCs.
 ('5c000000-0000-4000-8000-000000000031','send_email','investment','5c000000-0000-4000-8000-000000000011','{"template":"maturity_choice_confirmed"}','pending',null,null,null),
 ('5c000000-0000-4000-8000-000000000032','send_email','investment','5c000000-0000-4000-8000-000000000011','{"template":"maturity_choice_confirmed"}','failed','failed-owner',now()+interval '5 minutes',now()),
 ('5c000000-0000-4000-8000-000000000033','send_email','investment','5c000000-0000-4000-8000-000000000011','{"template":"maturity_notice"}','pending',null,null,null),
 ('5c000000-0000-4000-8000-000000000034','generate_agreement_pdf','investment','5c000000-0000-4000-8000-000000000011','{}','pending',null,null,null),
 ('5c000000-0000-4000-8000-000000000035','send_email','investment','5c000000-0000-4000-8000-000000000011','{"template":"maturity_choice_confirmed","to":"first@example.test"}','running','live-owner',now()+interval '5 minutes',now()),
 ('5c000000-0000-4000-8000-000000000036','send_email','investment','5c000000-0000-4000-8000-000000000011','{"template":"maturity_choice_confirmed","to":"second@example.test"}','running','lost-owner',now()-interval '1 minute',now()-interval '6 minutes'),
 -- Investment 2 keeps its live request.
 ('5c000000-0000-4000-8000-000000000037','send_email','investment','5c000000-0000-4000-8000-000000000012','{"template":"maturity_choice_confirmed"}','pending',null,null,null),
 -- Investment 3 is reported paid; investment 4 loses its request.
 ('5c000000-0000-4000-8000-000000000038','send_email','investment','5c000000-0000-4000-8000-000000000013','{"template":"maturity_choice_confirmed"}','pending',null,null,null),
 ('5c000000-0000-4000-8000-000000000039','send_email','investment','5c000000-0000-4000-8000-000000000013','{"template":"maturity_choice_confirmed"}','failed',null,null,null),
 ('5c000000-0000-4000-8000-000000000040','send_email','investment','5c000000-0000-4000-8000-000000000014','{"template":"maturity_choice_confirmed"}','pending',null,null,null),
 -- Investment 5 goes stale without the triggers, like rows from before them.
 ('5c000000-0000-4000-8000-000000000041','send_email','investment','5c000000-0000-4000-8000-000000000015','{"template":"maturity_choice_confirmed"}','pending',null,null,null);

-- Fulfilment ---------------------------------------------------------------------
set local role service_role;
select lives_ok($$select public.begin_maturity_instruction_processing('5c000000-0000-4000-8000-000000000001','5c000000-0000-4000-8000-000000000021',true,gen_random_uuid())$$,'processing begins');
reset role;
select is((select array_agg(status::text order by id) from public.jobs where id in ('5c000000-0000-4000-8000-000000000031','5c000000-0000-4000-8000-000000000032')),array['pending','failed'],'a processing request keeps its confirmations queued');
set local role service_role;
select lives_ok($$select public.fulfill_maturity_instruction('5c000000-0000-4000-8000-000000000001','5c000000-0000-4000-8000-000000000021',300000,'TEST-TRANSFER','FULFILL',true,gen_random_uuid(),true)$$,'fulfilment completes despite the retirement it triggers');
reset role;
select is((select status::text from public.maturity_instructions where id='5c000000-0000-4000-8000-000000000021'),'fulfilled','the request is fulfilled');
select is((select count(*)::integer from public.jobs where id in ('5c000000-0000-4000-8000-000000000031','5c000000-0000-4000-8000-000000000032')
  and status='dead' and last_error_code='STALE_MATURITY_CONFIRMATION_CANCELLED'
  and claim_token is null and lease_expires_at is null and locked_at is null),2,'fulfilment retires pending and failed confirmations and clears their claims');
select is((select status::text from public.jobs where id='5c000000-0000-4000-8000-000000000033'),'pending','other templates are untouched');
select is((select status::text from public.jobs where id='5c000000-0000-4000-8000-000000000034'),'pending','other job kinds are untouched');
select is((select status::text from public.jobs where id='5c000000-0000-4000-8000-000000000037'),'pending','confirmations for other investments are untouched');
select is((select count(*)::integer from public.jobs where entity_id='5c000000-0000-4000-8000-000000000011' and payload->>'template'='maturity_fulfilled' and status='pending'),1,'the fulfilment notice is still queued');
select is((select array_agg(status::text order by id) from public.jobs where id in ('5c000000-0000-4000-8000-000000000035','5c000000-0000-4000-8000-000000000036')),array['running','running'],'running confirmations are left to their next write');

-- Stale running rows ---------------------------------------------------------------
set local role service_role;
with tracked as (
  update public.jobs set send_attempts=send_attempts+1, first_send_attempt_at=now(),
    payload=payload||'{"providerIdempotencyKey":"stale-key"}'
  where id='5c000000-0000-4000-8000-000000000035' and claim_token='live-owner' and status='running'
  returning id)
select is((select count(*)::integer from tracked),0,'pre-send tracking on a stale confirmation still matches zero rows');
with recorded as (
  update public.jobs set status='failed', locked_at=now(), claim_token='live-owner',
    lease_expires_at=now()+interval '5 minutes', last_error_code='JOB_CLAIM_LOST',
    available_at=now()+interval '2 minutes'
  where id='5c000000-0000-4000-8000-000000000035' and claim_token='live-owner'
  returning status::text||':'||last_error_code as outcome, claim_token, lease_expires_at, locked_at)
select is((select outcome from recorded where claim_token is null and lease_expires_at is null and locked_at is null),
  'dead:STALE_MATURITY_CONFIRMATION_CANCELLED','a stale running job''s failure write retires it');
with recovered as (
  update public.jobs set status='pending', locked_at=null, claim_token=null,
    lease_expires_at=null, available_at=now()
  where status='running' and lease_expires_at < now()
  returning id, status::text||':'||last_error_code as outcome)
select is((select outcome from recovered where id='5c000000-0000-4000-8000-000000000036'),
  'dead:STALE_MATURITY_CONFIRMATION_CANCELLED','lease recovery retires a stale running job');
reset role;
select is((select count(*)::integer from private.queued_email_reservations where job_id='5c000000-0000-4000-8000-000000000035'),0,'skipped tracking reserves no email budget');

-- Paid-out investments and moved requests --------------------------------------------
-- A data correction can report an activated investment paid.
alter table public.investments disable trigger investment_immutable_guard;
update public.investments set payout_basis='reported_paid', reported_return_ugx=projected_return_ugx,
  reported_payout_ugx=projected_value_ugx
where id='5c000000-0000-4000-8000-000000000013';
alter table public.investments enable trigger investment_immutable_guard;
select is((select count(*)::integer from public.jobs where id in ('5c000000-0000-4000-8000-000000000038','5c000000-0000-4000-8000-000000000039')
  and status='dead' and last_error_code='STALE_MATURITY_CONFIRMATION_CANCELLED'),2,'reporting the investment paid retires pending and failed confirmations');
set local role service_role;
update public.maturity_instructions set investment_id='5c000000-0000-4000-8000-000000000016'
where id='5c000000-0000-4000-8000-000000000024';
reset role;
select is((select status::text||':'||last_error_code from public.jobs where id='5c000000-0000-4000-8000-000000000040'),
  'dead:STALE_MATURITY_CONFIRMATION_CANCELLED','moving a request away retires the original investment''s confirmations');

-- Rows that went stale before the triggers ---------------------------------------------
alter table public.maturity_instructions disable trigger retire_stale_maturity_confirmation_jobs;
update public.maturity_instructions set status='fulfilled', actual_roi_ugx=300000,
  actual_payout_ugx=1300000, actual_reinvest_ugx=0, fulfilled_at=now()
where id='5c000000-0000-4000-8000-000000000025';
alter table public.maturity_instructions enable trigger retire_stale_maturity_confirmation_jobs;
set local role service_role;
with claimed as (
  update public.jobs set status='running', locked_at=now(), claim_token='stale-claim',
    lease_expires_at=now()+interval '5 minutes', attempts=attempts+1
  where id='5c000000-0000-4000-8000-000000000041' and attempts=0 and available_at <= now()
    and status in ('pending','failed')
  returning id)
select is((select count(*)::integer from claimed),0,'a stale claim still matches zero rows');
select is((select status::text from public.jobs where id='5c000000-0000-4000-8000-000000000041'),'pending','the skipped claim leaves the row unchanged');
with retried as (
  update public.jobs set status='pending', available_at=now(), locked_at=null, last_error_code=null
  where id='5c000000-0000-4000-8000-000000000041'
  returning status::text||':'||last_error_code as outcome)
select is((select outcome from retried),'dead:STALE_MATURITY_CONFIRMATION_CANCELLED','a retry retires a stale confirmation instead of re-queuing it');
with retried as (
  update public.jobs set status='pending', available_at=now(), locked_at=null, last_error_code=null
  where id='5c000000-0000-4000-8000-000000000041'
  returning id)
select is((select count(*)::integer from retried),0,'a retry of a retired confirmation matches zero rows');
reset role;
-- A finished send awaiting delivery reconciliation keeps its outcome.
alter table public.jobs disable trigger guard_stale_maturity_confirmation_job;
update public.jobs set status='dead', last_error_code='NEEDS_RECONCILIATION',
  first_send_attempt_at='2026-08-01 09:00+00'
where id='5c000000-0000-4000-8000-000000000041';
alter table public.jobs enable trigger guard_stale_maturity_confirmation_job;
set local role service_role;
with resent as (
  update public.jobs set status='pending', available_at=now(), locked_at=null,
    last_error_code=null, first_send_attempt_at=null
  where id='5c000000-0000-4000-8000-000000000041'
  returning id)
select is((select count(*)::integer from resent),0,'an authorized resend of a stale confirmation matches zero rows');
reset role;
select is((select status::text||':'||last_error_code||':'||(first_send_attempt_at is not null)::text from public.jobs where id='5c000000-0000-4000-8000-000000000041'),
  'dead:NEEDS_RECONCILIATION:true','the skipped resend keeps the delivery awaiting reconciliation');
set local role service_role;
insert into public.jobs(kind,entity_type,entity_id,payload)
values ('send_email','investment','5c000000-0000-4000-8000-000000000015','{"template":"maturity_choice_confirmed"}');
reset role;
select is((select count(*)::integer from public.jobs where entity_id='5c000000-0000-4000-8000-000000000015'
  and payload->>'template'='maturity_choice_confirmed'),1,'inserting a stale confirmation is still skipped');

select * from finish();
rollback;
