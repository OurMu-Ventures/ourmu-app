begin;
select no_plan();

insert into auth.users (id, email) values
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'auto-admin@test.local'),
  ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', 'auto-partner@test.local');

insert into public.profiles (id, role, access_status, legal_name, email, phone, kyc_status)
values
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'admin', 'active', 'Auto Admin', 'auto-admin@test.local', '+256700000011', 'verified'),
  ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', 'investor', 'active', 'Auto Partner', 'auto-partner@test.local', '+256700000012', 'verified');

insert into public.next_of_kin (user_id, legal_name, relationship, phone, address)
values ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', 'Auto Kin', 'sibling', '+256700000013', 'Kampala');

insert into public.agreement_versions (id, version, title, template_markdown, content_hash, is_legally_approved, approved_by, approved_at, published_at)
values
  ('c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3', 'v-auto-test', 'Auto Test Agreement',
    'Auto test terms for the member.',
    'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    true, 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', now(), now());

-- Exactly one portal cycle contains now(); closed + draft cycles must not match.
insert into public.investment_cycles (id, name, opens_at, closes_at, maturity_date, capacity_ugx, unit_price_ugx, projected_return_bps, status, agreement_version_id, created_by, record_origin)
values
  ('d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4', 'Auto Open Cycle', now() - interval '1 day', now() + interval '30 days',
    (date_trunc('month', now() + interval '6 months') + interval '1 month - 1 day')::date, 200000000, 125000, 3000, 'open',
    'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'portal'),
  ('e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5', 'Auto Closed Cycle', now() - interval '60 days', now() - interval '30 days',
    (date_trunc('month', now() - interval '1 month') + interval '1 month - 1 day')::date, 200000000, 125000, 3000, 'closed',
    'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'portal');


select public.request_investment('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2','d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4',125000,gen_random_uuid(),'slip-test','\\x00','c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3');
create temporary table slip_test_ids as select id from public.investments where investor_id='b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
select lives_ok($$select public.reserve_deposit_slip('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',(select id from slip_test_ids),'image/jpeg',100,209715200)$$,'reserve first slot');
select lives_ok($$select public.reserve_deposit_slip('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',(select id from slip_test_ids),'application/pdf',100,209715200)$$,'reserve second slot');
select throws_ok($$select public.reserve_deposit_slip('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',(select id from slip_test_ids),'image/png',100,4194304)$$,'P0001','Uploads temporarily full. Investment processing continues','capacity includes full reserved slots');
select lives_ok($$select public.reserve_deposit_slip('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',(select id from slip_test_ids),'image/png',100,209715200)$$,'reserve third slot');
select throws_ok($$select public.reserve_deposit_slip('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',(select id from slip_test_ids),'image/png',100,209715200)$$,'P0001','Three attachments maximum','fourth slot rejected');
select ok(not has_function_privilege('authenticated','public.reserve_deposit_slip(uuid,uuid,text,integer,bigint)','execute'),'browser cannot reserve directly');
select ok(not has_table_privilege('authenticated','public.deposit_slips','update'),'browser cannot finalize directly');
select ok(not (select public from storage.buckets where id='deposit-slips'),'bucket private');
select throws_ok($$select public.reserve_deposit_slip('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',(select id from slip_test_ids),'image/png',100,209715200)$$,'P0001','Reservation unavailable','wrong owner rejected');
update public.deposit_slips set expires_at=now()-interval '1 day', created_at=now()-interval '1 hour';
select is((select count(*) from public.deposit_slip_cleanup_candidates()),3::bigint,'expired files selected');
select is((select status::text from public.investments where id=(select id from slip_test_ids)),'reserved','file expiry preserves reservation');

-- Retry claims rotate failed rows and exclude young slots.
select is((select count(*) from public.deposit_slip_cleanup_candidates()),0::bigint,'claimed files have a retry lease');
select ok((select bool_and(cleanup_attempts=1) from public.deposit_slips),'claims record attempts');
update public.deposit_slips set last_cleanup_at=now()-interval '3 minutes';
select is((select count(*) from public.deposit_slip_cleanup_candidates()),3::bigint,'failed batch becomes retryable');
update public.deposit_slips set state='deleted';
-- Upload policy: fresh owned slot only, active account and pending reservation.
select public.reserve_deposit_slip('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',(select id from slip_test_ids),'image/png',100,209715200);
select set_config('request.jwt.claim.sub','b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',true);
select ok(public.can_upload_deposit_slip((select path from public.deposit_slips where state='uploading')),'owner may upload into fresh slot');
select set_config('request.jwt.claim.sub','a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',true);
select ok(not public.can_upload_deposit_slip((select path from public.deposit_slips where state='uploading')),'another partner cannot upload');
select set_config('request.jwt.claim.sub','b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',true);
update public.profiles set access_status='disabled' where id='b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
select ok(not public.can_upload_deposit_slip((select path from public.deposit_slips where state='uploading')),'disabled partner cannot upload');
update public.profiles set access_status='active' where id='b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
update public.deposit_slips set created_at=now()-interval '16 minutes' where state='uploading';
select ok(not public.can_upload_deposit_slip((select path from public.deposit_slips where state='uploading')),'stale slot cannot upload');
select ok(not public.finalize_deposit_slip((select id from public.deposit_slips where state='uploading'),'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'),'stale finalization rejected');
select lives_ok($$select public.reserve_deposit_slip('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',(select id from slip_test_ids),'image/png',100,209715200)$$,'stale slot does not consume live attachment limit');
select ok(public.finalize_deposit_slip((select id from public.deposit_slips where state='uploading' order by created_at desc limit 1),'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'),'fresh finalization succeeds');
set local role authenticated;
select is((select count(*) from public.deposit_slips),1::bigint,'owner SELECT shows only ready unexpired slips');
reset role;
select set_config('request.jwt.claim.sub','a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',true);
set local role authenticated;
select is((select count(*) from public.deposit_slips),0::bigint,'other partner SELECT hides slips');
reset role;
-- Repeated remove/reserve cannot fill global budget: maximum six outstanding per investor.
update public.deposit_slips set state='deleting' where state<>'deleted';
do $$ begin for n in 1..4 loop perform public.reserve_deposit_slip('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',(select id from slip_test_ids),'image/png',100,209715200); update public.deposit_slips set state='deleting' where state='uploading'; end loop; end $$;
update public.deposit_slips set state='deleting' where state<>'deleted';
select throws_ok($$select public.reserve_deposit_slip('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',(select id from slip_test_ids),'image/png',100,209715200)$$,'P0001','Previous uploads awaiting cleanup. Please try again later','outstanding partner cap prevents shared budget exhaustion');
select is((select count(*) from public.deposit_slip_cleanup_candidates()),0::bigint,'young deleting rows do not occupy cleanup batch');
-- Orphans include absent metadata and deleted slots, but not live files.
insert into storage.objects(bucket_id,name,created_at) values ('deposit-slips','orphan-test',now()-interval '1 hour');
select ok(exists(select 1 from public.deposit_slip_orphan_paths() where path='orphan-test'),'orphan lookup finds untracked object');


delete from public.deposit_slips;
insert into public.deposit_slips(investment_id,investor_id,path,mime,bytes,state,created_at)
select (select id from slip_test_ids),'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', 'fair-'||n,'image/png',100,'deleting',now()-interval '1 hour' from generate_series(1,25) n;
select is((select count(*) from public.deposit_slip_cleanup_candidates()),20::bigint,'bounded first cleanup claim');
select is((select count(*) from public.deposit_slip_cleanup_candidates()),5::bigint,'failed first batch cannot starve untouched files');
select is((select count(*) from public.deposit_slip_cleanup_candidates()),0::bigint,'overlapping worker cannot reclaim leased files');

select * from finish();
rollback;
