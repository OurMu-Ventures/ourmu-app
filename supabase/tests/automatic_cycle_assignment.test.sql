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
    125000, gen_random_uuid(), 'test-agent', '\\x00', 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3')$$,
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
    125000, gen_random_uuid(), 'test-agent', '\\x00', 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3')$$,
  '23514', 'the displayed cycle changed; review the refreshed terms and accept again',
  'stale cycle evidence requires review');

-- Exercise the actual state-changing RPCs, not just resolver metadata.
create function pg_temp.auto_activate(source uuid, paid_at timestamptz, ref text default 'AUTO-PAID') returns void
language sql as $fn$
 select public.activate_investment('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', source, ref, 125000,
   (paid_at at time zone 'Africa/Kampala')::date, 'ACTIVATE', true, gen_random_uuid(), paid_at);
$fn$;
create function pg_temp.auto_fulfill(source uuid) returns jsonb language sql as $fn$
 select public.fulfill_maturity_instruction('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
 (select id from public.maturity_instructions where investment_id = source), 37500, '', 'FULFILL', true, gen_random_uuid(), false);
$fn$;

-- A real new-policy reservation with deadline capped at a near closing time.
update public.investment_cycles set closes_at = now() + interval '1 hour' where id='d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';
set local role service_role;
select lives_ok($$select public.request_investment('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4',125000,gen_random_uuid(),'test','\x00','c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3')$$,'new app can reserve as service_role');
select is((select min(reservation_expires_at) from public.investments where investor_id='b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2' and requested_at=now() and policy_version='auto_cycle_v1'), now()+interval '1 hour','new deadline is capped at close');
select throws_ok($$select public.request_investment('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2','d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4',125000,gen_random_uuid(),'test','\x00','11111111-1111-1111-1111-111111111111')$$,'23514',null,'stale cash agreement rejected');
select lives_ok($$select public.request_investment('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2','d4d4d4d4-d4d4-d4d4-d4d4d4d4d4d4d4d4',125000,gen_random_uuid(),'test','\x00')$$,'previous app reservation arguments remain valid');
select is((select count(*) from public.investments where investor_id='b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2' and policy_version is null),1::bigint,'old app reservations keep legacy activation policy');
reset role;

-- Synthetic timely payments from yesterday, verified after expiration today.
insert into public.investments(id,investor_id,cycle_id,principal_ugx,projected_return_bps,projected_return_ugx,projected_value_ugx,unit_price_ugx,maturity_date,reservation_expires_at,requested_at,status,policy_version)
select id,'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2','d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4',125000,3000,37500,162500,125000,
 (date_trunc('month',now()+interval '6 months')+interval '1 month - 1 day')::date,now()-interval '1 hour',now()-interval '20 hours',status::public.investment_status,'auto_cycle_v1'
from (values ('01010101-0101-0101-0101-010101010101'::uuid,'expired'),('02020202-0202-0202-0202-020202020202'::uuid,'expired'),('03030303-0303-0303-0303-030303030303'::uuid,'cancelled'),('04040404-0404-0404-0404-040404040404'::uuid,'expired'),('05050505-0505-0505-0505-050505050505'::uuid,'expired')) fixtures(id,status);
set local role service_role;
select lives_ok($$select pg_temp.auto_activate('01010101-0101-0101-0101-010101010101',now()-interval '2 hours')$$,'timely payment can activate after expiry');
select is((select received_at from public.bank_receipts where investment_id='01010101-0101-0101-0101-010101010101'),now()-interval '2 hours','verified timestamp is stored exactly');
select lives_ok($$select pg_temp.auto_activate('01010101-0101-0101-0101-010101010101',now()-interval '2 hours')$$,'activation retry is idempotent');
select is((select count(*) from public.investment_receipts where investment_id='01010101-0101-0101-0101-010101010101'),1::bigint,'retry does not duplicate receipt');
select is((select metadata->>'receipt_id' from public.audit_events where entity_id='01010101-0101-0101-0101-010101010101' and action='investment.activated'),(select id::text from public.investment_receipts where investment_id='01010101-0101-0101-0101-010101010101'),'audit refers to the issued investment receipt');
select throws_ok($$select pg_temp.auto_activate('02020202-0202-0202-0202-020202020202',now()-interval '30 minutes')$$,'23514',null,'late payment is not activated');
select throws_ok($$select pg_temp.auto_activate('03030303-0303-0303-0303-030303030303',now()-interval '2 hours')$$,'23514',null,'cancelled reservation is never revived');
select throws_ok($$select pg_temp.auto_activate('02020202-0202-0202-0202-020202020202',now()+interval '1 minute')$$,'22023',null,'future payment timestamp is rejected');
select throws_ok($$select pg_temp.auto_activate('02020202-0202-0202-0202-020202020202',now()-interval '2 days')$$,'23514',null,'payment preceding reservation is rejected');
reset role;
update public.investment_cycles set capacity_ugx=125000 where id='d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';
set local role service_role;
select throws_ok($$select pg_temp.auto_activate('04040404-0404-0404-0404-040404040404',now()-interval '2 hours','AUTO-CAP')$$,'23514',null,'late verification rechecks capacity');
reset role;
update public.investment_cycles set capacity_ugx=200000000 where id='d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';
insert into public.investments(id,investor_id,cycle_id,principal_ugx,projected_return_bps,projected_return_ugx,projected_value_ugx,unit_price_ugx,maturity_date,reservation_expires_at,status)
values('09090909-0909-0909-0909-090909090909','b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2','d4d4d4d4-d4d4-d4d4-d4d4d4d4d4d4d4d4',49500000,3000,14850000,64350000,125000,(date_trunc('month',now()+interval '6 months')+interval '1 month - 1 day')::date,now()+interval '1 day','active');
set local role service_role;
select throws_ok($$select pg_temp.auto_activate('04040404-0404-0404-0404-040404040404',now()-interval '2 hours','AUTO-LIMIT')$$,'23514',null,'late verification rechecks cumulative limit');
reset role;
delete from public.investments where id='09090909-0909-0909-0909-090909090909';

-- Interactive reinvestments are assigned at submission and can fulfill after
-- closing, but cannot enter already-matured or unapproved cycles.
insert into public.investments(id,investor_id,cycle_id,principal_ugx,projected_return_bps,projected_return_ugx,projected_value_ugx,unit_price_ugx,maturity_date,reservation_expires_at,status)
select id,'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2','e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5',125000,3000,37500,162500,125000,
 (date_trunc('month',now()-interval '3 months')+interval '1 month - 1 day')::date,now()-interval '2 months','matured'
from (values ('06060606-0606-0606-0606-060606060606'::uuid),('07070707-0707-0707-0707-070707070707'::uuid),('08080808-0808-0808-0808-080808080808'::uuid)) examples(id);
create function pg_temp.auto_submit(source uuid, expected uuid default 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3', accepted boolean default true) returns uuid language sql as $fn$
 select public.submit_maturity_instruction('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',source,'reinvest_all','d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4',null,accepted,false,gen_random_uuid(),'test','\x00',null,false,expected);
$fn$;
set local role service_role;
select throws_ok($$select pg_temp.auto_submit('06060606-0606-0606-0606-060606060606','11111111-1111-1111-1111-111111111111')$$,'23514',null,'stale reinvestment agreement is rejected');
select throws_ok($$select pg_temp.auto_submit('06060606-0606-0606-0606-060606060606','c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3',null)$$,'23514',null,'null acceptance cannot bypass required agreement');
select lives_ok($$select pg_temp.auto_submit('06060606-0606-0606-0606-060606060606')$$,'new instruction is assigned at submission');
select lives_ok($$select pg_temp.auto_submit('07070707-0707-0707-0707-070707070707')$$,'second instruction is assigned at submission');
select lives_ok($$select pg_temp.auto_submit('08080808-0808-0808-0808-080808080808')$$,'third instruction is assigned at submission');
select is((select policy_version from public.maturity_instructions where investment_id='06060606-0606-0606-0606-060606060606'),'auto_cycle_v1','instruction records automatic policy');
select lives_ok($$select public.begin_maturity_instruction_processing('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',(select id from public.maturity_instructions where investment_id='06060606-0606-0606-0606-060606060606'),true,gen_random_uuid())$$,'begin processing before fulfillment');
select lives_ok($$select public.begin_maturity_instruction_processing('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',(select id from public.maturity_instructions where investment_id='07070707-0707-0707-0707-070707070707'),true,gen_random_uuid())$$,'begin second instruction');
reset role;
-- Times are normally immutable to the partner; fixtures emulate passage of time.
update public.investment_cycles set status='closed', closes_at=now()-interval '1 second' where id='d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';
update public.maturity_instructions set acceptance_captured_at=now()-interval '1 hour' where investment_id in ('06060606-0606-0606-0606-060606060606','07070707-0707-0707-0707-070707070707');
set local role service_role;
select is((pg_temp.auto_fulfill('06060606-0606-0606-0606-060606060606')->>'fulfilled')::boolean,true,'timely reinvestment fulfills into original closed cycle');
select is((pg_temp.auto_fulfill('06060606-0606-0606-0606-060606060606')->>'already_fulfilled')::boolean,true,'reinvestment retry is idempotent');
reset role;
-- Emulate a month-end maturity boundary on any test execution date.
alter table public.investment_cycles disable trigger cycle_maturity_day_guard;
update public.investment_cycles set maturity_date=(now() at time zone 'Africa/Kampala')::date where id='d4d4d4d4-d4d4-d4d4-d4d4d4d4d4d4d4d4';
alter table public.investment_cycles enable trigger cycle_maturity_day_guard;
set local role service_role;
select is((pg_temp.auto_fulfill('07070707-0707-0707-0707-070707070707')->>'held')::boolean,true,'destination maturity day holds reinvestment in Kampala');
select throws_ok($$select pg_temp.auto_activate('05050505-0505-0505-0505-050505050505',now()-interval '2 hours','AUTO-MATURE')$$,'23514',null,'cash verification cannot activate an already-matured cycle');
reset role;

select * from finish();
rollback;
