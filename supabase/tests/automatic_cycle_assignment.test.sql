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

-- Reservation uses the resolver, records auto policy, and caps expiry at close.
select lives_ok(
  $$select public.request_investment(
    'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',
    'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4',
    125000, gen_random_uuid(), 'test-agent', '\\x00')$$,
  'request resolves the current cycle');

select ok(
  (select policy_version = 'auto_cycle_v1' from public.investments
    where investor_id = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'
    order by requested_at desc limit 1),
  'new reservations carry the auto policy version');

select ok(
  (select reservation_expires_at <= (select closes_at from public.investment_cycles where id = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4')
   from public.investments
   where investor_id = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2' order by requested_at desc limit 1),
  'reservation expiry never passes the cycle close');

-- Stale evidence is rejected for review, never silently reassigned.
select throws_ok(
  $$select public.request_investment(
    'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',
    'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5',
    125000, gen_random_uuid(), 'test-agent', '\\x00')$$,
  '23514', 'the displayed cycle changed; review the refreshed terms and accept again',
  'stale cycle evidence requires review');

select * from finish();
rollback;
