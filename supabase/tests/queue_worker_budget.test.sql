begin;
select plan(11);
truncate private.queued_email_reservations;
insert into public.jobs(id,kind,entity_type,entity_id,payload,status,claim_token,lease_expires_at)
values
 ('87000000-0000-4000-8000-000000000001','send_email','test','87000000-0000-4000-8000-000000000000','{"to":"test@example.test","providerIdempotencyKey":"test-budget-key","cc":["cc@example.test"],"bcc":["bcc@example.test"]}','running','owner',now()+interval '5 minutes'),
 ('87000000-0000-4000-8000-000000000002','send_email','test','87000000-0000-4000-8000-000000000000','{"to":"test@example.test","providerIdempotencyKey":"test-budget-key"}','running','owner',now()+interval '5 minutes'),
 ('87000000-0000-4000-8000-000000000003','send_email','test','87000000-0000-4000-8000-000000000000','{"to":"test@example.test","providerIdempotencyKey":"fresh-key"}','running','owner',now()+interval '5 minutes');
update public.jobs set send_attempts=1,first_send_attempt_at=now()
 where id='87000000-0000-4000-8000-000000000001' and claim_token='stale';
select is((select count(*)::integer from private.queued_email_reservations),0,'stale claim cannot reserve');
update public.jobs set send_attempts=1,first_send_attempt_at=now()
 where id='87000000-0000-4000-8000-000000000001' and claim_token='owner';
select is((select sum(recipients)::integer from private.queued_email_reservations),3,'To + CC + BCC counted atomically');
update public.jobs set send_attempts=2 where id='87000000-0000-4000-8000-000000000001';
update public.jobs set send_attempts=1,first_send_attempt_at=now() where id='87000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from private.queued_email_reservations),1,'same delivery key and retries reserve once');
insert into private.queued_email_reservations(delivery_key,job_id,recipients)
 values ('fill-daily','87000000-0000-4000-8000-000000000000',77);
select throws_ok($$update public.jobs set send_attempts=1,first_send_attempt_at=now() where id='87000000-0000-4000-8000-000000000003'$$,'P0001','EMAIL_DAILY_BUDGET_DEFERRED','daily overflow is refused');
select is((select send_attempts from public.jobs where id='87000000-0000-4000-8000-000000000003'),0,'refused tracking rolls back');
select is((select count(*)::integer from private.queued_email_reservations where delivery_key='fresh-key'),0,'refused reservation rolls back');
truncate private.queued_email_reservations;
insert into private.queued_email_reservations(delivery_key,job_id,recipients,reserved_at,daily_reserved_at)
 values ('prior-cycle','87000000-0000-4000-8000-000000000000',2400,now()-interval '15 days',now()-interval '15 days');
select throws_ok($$update public.jobs set send_attempts=1,first_send_attempt_at=now() where id='87000000-0000-4000-8000-000000000003'$$,'P0001','EMAIL_MONTHLY_BUDGET_DEFERRED','rolling monthly budget includes prior calendar month');
truncate private.queued_email_reservations;
insert into private.queued_email_reservations(delivery_key,job_id,recipients,reserved_at,daily_reserved_at)
 values ('fresh-key','87000000-0000-4000-8000-000000000003',1,now()-interval '2 days',now()-interval '2 days'),
        ('fill-today','87000000-0000-4000-8000-000000000000',80,now(),now());
select throws_ok($$update public.jobs set send_attempts=1,first_send_attempt_at=now() where id='87000000-0000-4000-8000-000000000003'$$,'P0001','EMAIL_DAILY_BUDGET_DEFERRED','retry on a later day needs new daily capacity');
delete from private.queued_email_reservations where delivery_key='fill-today';
update public.jobs set send_attempts=1,first_send_attempt_at=now() where id='87000000-0000-4000-8000-000000000003';
select is((select count(*)::integer from private.queued_email_reservations),1,'new day reservation preserves one monthly charge');
select ok(not has_table_privilege('authenticated','private.queued_email_reservations','SELECT'),'partner cannot read budget ledger');
select ok(not has_function_privilege('authenticated','private.reserve_queued_email_budget()','EXECUTE'),'partner cannot call budget trigger');
select * from finish();
rollback;
