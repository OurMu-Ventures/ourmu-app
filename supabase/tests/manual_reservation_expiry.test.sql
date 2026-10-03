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

select is(
  private.resolve_portal_cycle(now()),
  'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4'::uuid,
  'resolver returns the cycle containing now()');

select throws_ok(
  $$select private.resolve_portal_cycle(now() - interval '90 days')$$,
  '23514', 'no eligible cycle is available for this timestamp',
  'resolver rejects timestamps with no eligible cycle');

-- Overlapping portal cycles are ambiguous.
insert into public.investment_cycles (id, name, opens_at, closes_at, maturity_date, capacity_ugx, unit_price_ugx, projected_return_bps, status, agreement_version_id, created_by, record_origin)
values
  ('f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6', 'Auto Overlap Cycle', now() - interval '1 day', now() + interval '30 days',
    (date_trunc('month', now() + interval '6 months') + interval '1 month - 1 day')::date, 200000000, 125000, 3000, 'draft',
    'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'portal');

select throws_ok(
  $$select private.resolve_portal_cycle(now())$$,
  '23514', 'multiple eligible cycles match this timestamp',
  'resolver rejects ambiguous matches');
delete from public.investment_cycles where id = 'f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6';

-- Reservation uses the resolver, records auto policy, and has no automatic expiry.
select lives_ok(
  $$select public.request_investment(
    'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',
    'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4',
    125000, gen_random_uuid(), 'test-agent', '\\x00', 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3')$$,
  'request resolves the current cycle');

select ok(
  (select policy_version = 'auto_cycle_v1' from public.investments
    where investor_id = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'
    order by requested_at desc limit 1),
  'new reservations carry the auto policy version');

select ok(
  (select reservation_expires_at is null
   from public.investments
   where investor_id = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2' order by requested_at desc limit 1),
  'reservation has no automatic expiry');


-- Old deadlines never cause automatic expiry, even if an old client supplied one.
update public.investments set requested_at = now() - interval '4 days',
  reservation_expires_at = now() - interval '2 days'
where investor_id = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
select lives_ok($$select public.run_maintenance(gen_random_uuid())$$, 'maintenance still runs');
select is((select status::text from public.investments where investor_id = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'), 'reserved', 'maintenance leaves overdue reservations pending');
set local role service_role;
select lives_ok($$select public.activate_investment(
 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
 (select id from public.investments where investor_id='b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'),
 'MANUAL-EXPIRY-ACTIVATION',125000,(now() at time zone 'Africa/Kampala')::date,
 'ACTIVATE',true,gen_random_uuid(),now())$$, 'admin activates after former 48 hour deadline');
select lives_ok($$select public.request_investment(
 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2','d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4',
 125000,gen_random_uuid(),'manual-test','\x00','c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3')$$, 'create another pending reservation');
select throws_ok($$select public.expire_investment(
 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
 (select id from public.investments where status='reserved'), 'EXPIRE',false,gen_random_uuid())$$,
 '42501','active administrator AAL2 required','expiry requires MFA');
select throws_ok($$select public.expire_investment(
 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',
 (select id from public.investments where status='reserved'), 'EXPIRE',true,gen_random_uuid())$$,
 '42501','active administrator AAL2 required','investors cannot expire reservations');
select throws_ok($$select public.expire_investment(
 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
 (select id from public.investments where status='reserved'), 'WRONG',true,gen_random_uuid())$$,
 '22023','typed confirmation is invalid','expiry requires explicit confirmation');
select lives_ok($$select public.expire_investment(
 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
 (select id from public.investments where status='reserved'), 'EXPIRE',true,gen_random_uuid())$$,
 'administrator manually expires reservation');
select is((select count(*) from public.audit_events where action='investment.expired'),1::bigint,'manual expiry is audited');
select throws_ok($$select public.activate_investment(
 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
 (select id from public.investments where status='expired'),
 'EXPIRED-REFERENCE',125000,(now() at time zone 'Africa/Kampala')::date,
 'ACTIVATE',true,gen_random_uuid(),now())$$,
 '23514','only a pending reservation can be activated','manual expiry cannot be revived');
select lives_ok($$select public.request_investment(
 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2','d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4',
 125000,gen_random_uuid(),'manual-test','\x00','c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3')$$, 'create reservation for cancellation');
select lives_ok($$select public.cancel_investment(
 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',
 (select id from public.investments where status='reserved'),gen_random_uuid())$$,
 'investor cancels reservation with no expiry');
reset role;
select function_privs_are('public','expire_investment',array['uuid','uuid','text','boolean','uuid'],'authenticated',array[]::text[],'authenticated cannot directly expire');
select function_privs_are('public','expire_investment',array['uuid','uuid','text','boolean','uuid'],'service_role',array['EXECUTE'],'service role executes expiry');
select * from finish();
rollback;
