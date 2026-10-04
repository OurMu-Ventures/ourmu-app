begin;
set local search_path = public, extensions;
select plan(3);
insert into public.jobs(kind,entity_type,entity_id,payload,email_dedupe_key)
values ('send_email','queue_recovery_test','00000000-0000-4000-8000-000000000001',
'{"template":"magic_link","to":"test@example.test","idempotencyKey":"first"}', 'queue-recovery-first')
on conflict(email_dedupe_key) do nothing;
select is((select count(*)::integer from public.jobs where email_dedupe_key='queue-recovery-first'),1,'PostgREST-style conflict target works');
insert into public.jobs(kind,entity_type,entity_id,payload,email_dedupe_key)
values ('send_email','queue_recovery_test','00000000-0000-4000-8000-000000000001',
'{"template":"magic_link","to":"test@example.test","idempotencyKey":"second"}', 'queue-recovery-second');
select is((select count(*)::integer from public.jobs where entity_type='queue_recovery_test'),1,'Different parent keys cannot duplicate identical queued email');
update public.jobs set status='succeeded' where email_dedupe_key='queue-recovery-first';
insert into public.jobs(kind,entity_type,entity_id,payload,email_dedupe_key)
values ('send_email','queue_recovery_test','00000000-0000-4000-8000-000000000001',
'{"template":"magic_link","to":"test@example.test","idempotencyKey":"third"}', 'queue-recovery-third');
select is((select count(*)::integer from public.jobs where entity_type='queue_recovery_test'),2,'Later notification is allowed after prior delivery completes');
select * from finish();
rollback;
