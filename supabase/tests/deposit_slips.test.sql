begin;
select no_plan();

-- Automatic cycle assignment: resolver, policy columns, deadline rule.

-- Policy + receipt columns exist and are nullable (legacy rows keep NULL).
select ok(
  (select is_nullable = 'YES' from information_schema.columns
    where table_schema = 'public' and table_name = 'investments' and column_name = 'policy_version'),
  'investments.policy_version is nullable');
select ok(
  (select is_nullable = 'YES' from information_schema.columns
    where table_schema = 'public' and table_name = 'maturity_instructions' and column_name = 'policy_version'),
  'maturity_instructions.policy_version is nullable');
select ok(
  (select is_nullable = 'YES' from information_schema.columns
    where table_schema = 'public' and table_name = 'bank_receipts' and column_name = 'received_at'),
  'bank_receipts.received_at is nullable');

-- Resolver fixtures.
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
update public.deposit_slips set expires_at=now()-interval '1 day';
select is((select count(*) from public.deposit_slip_cleanup_candidates()),3::bigint,'expired files selected');
select is((select status::text from public.investments where id=(select id from slip_test_ids)),'reserved','file expiry preserves reservation');
select * from finish();
rollback;
