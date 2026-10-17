begin;
select no_plan();
set local time zone 'America/New_York';

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


-- Date-only fixtures deliberately use a reservation later in the same day.
insert into public.investment_cycles(id,name,opens_at,closes_at,maturity_date,capacity_ugx,unit_price_ugx,projected_return_bps,status,agreement_version_id,created_by,record_origin)
values('d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4','Date Only Cycle',
 ((now() at time zone 'Africa/Kampala')::date-10)::timestamp at time zone 'Africa/Kampala',
 ((now() at time zone 'Africa/Kampala')::date+10)::timestamp at time zone 'Africa/Kampala',
 (date_trunc('month',now()+interval '6 months')+interval '1 month - 1 day')::date,
 200000000,125000,3000,'open','c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3','a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1','portal');
insert into public.investments(id,investor_id,cycle_id,principal_ugx,projected_return_bps,projected_return_ugx,projected_value_ugx,unit_price_ugx,maturity_date,requested_at,status,policy_version)
select ('01010101-0101-4101-8101-'||lpad(n::text,12,'0'))::uuid,'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2','d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4',125000,3000,37500,162500,125000,
 (date_trunc('month',now()+interval '6 months')+interval '1 month - 1 day')::date,
 ((now() at time zone 'Africa/Kampala')::date::timestamp at time zone 'Africa/Kampala') + interval '20 hours',
 'reserved','auto_cycle_v1' from generate_series(1,8) n;
create function pg_temp.activate_date(n integer,paid date default (now() at time zone 'Africa/Kampala')::date,ref text default null,amount numeric default 125000,aal boolean default true) returns void language sql as $fn$
 select public.activate_investment('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',('01010101-0101-4101-8101-'||lpad(n::text,12,'0'))::uuid,coalesce(ref,'DATE-PAID-'||n),amount,paid,'ACTIVATE',aal,gen_random_uuid());
$fn$;
set local role service_role;
select lives_ok($$select pg_temp.activate_date(1)$$,'date-only activation allows same-day payment regardless of reservation time');
select is((select received_at from public.bank_receipts where investment_id='01010101-0101-4101-8101-000000000001'),null::timestamptz,'no artificial payment timestamp stored');
select is((select received_date from public.bank_receipts where investment_id='01010101-0101-4101-8101-000000000001'),(now() at time zone 'Africa/Kampala')::date,'exact verified payment date stored');
select ok((select activated_at is not null from public.investments where id='01010101-0101-4101-8101-000000000001'),'actual activation timestamp retained');
select is((select metadata->>'assignment_basis' from public.audit_events where entity_id='01010101-0101-4101-8101-000000000001' and action='investment.activated'),'payment_date','audit identifies date precision');
set local time zone 'Pacific/Honolulu';
select lives_ok($$select pg_temp.activate_date(1)$$,'date-only retry remains idempotent across session time zones');
select is((select count(*) from public.investment_receipts where investment_id='01010101-0101-4101-8101-000000000001'),1::bigint,'retry does not duplicate receipt');
select throws_ok($$select pg_temp.activate_date(2,(now() at time zone 'Africa/Kampala')::date+1)$$,'22023','received date cannot be in the future','future day rejected');
select throws_ok($$select pg_temp.activate_date(2,(now() at time zone 'Africa/Kampala')::date-1)$$,'23514','payment date predates the reservation date; held for staff resolution','previous-day payment rejected');
select throws_ok($$select pg_temp.activate_date(2,null)$$,'22023','valid payment received date is required','null date rejected');
select throws_ok($$select pg_temp.activate_date(2,'infinity'::date)$$,'22023','valid payment received date is required','infinite date rejected');
select throws_ok($$select pg_temp.activate_date(2,amount=>1)$$,'23514','received amount must exactly match expected principal','amount must match');
select throws_ok($$select pg_temp.activate_date(2,aal=>false)$$,'42501','active administrator AAL2 required','AAL2 still required');
select throws_ok($$select pg_temp.activate_date(2,ref=>'DATE-PAID-1')$$,'23505',null,'duplicate payment reference rejected');
reset role;
-- Closing at Uganda midnight excludes that entire calendar date.
update public.investment_cycles set closes_at=(now() at time zone 'Africa/Kampala')::date::timestamp at time zone 'Africa/Kampala' where id='d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';
set local role service_role;
select throws_ok($$select pg_temp.activate_date(2)$$,'23514','no eligible cycle is available for this payment date','midnight-exclusive close does not include closing date');
reset role;
update public.investment_cycles set closes_at=(((now() at time zone 'Africa/Kampala')::date+1)::timestamp at time zone 'Africa/Kampala')-interval '1 millisecond' where id='d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';
set local role service_role;
select lives_ok($$select pg_temp.activate_date(2)$$,'end-of-day close includes payment date');
reset role;
-- A second cycle intersecting any part of the same day must not be guessed.
insert into public.investment_cycles(id,name,opens_at,closes_at,maturity_date,capacity_ugx,unit_price_ugx,projected_return_bps,status,agreement_version_id,created_by,record_origin)
select 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5','Date Ambiguous Cycle',
 ((now() at time zone 'Africa/Kampala')::date)::timestamp at time zone 'Africa/Kampala',
 ((now() at time zone 'Africa/Kampala')::date+1)::timestamp at time zone 'Africa/Kampala',
 maturity_date,200000000,125000,3000,'closed',agreement_version_id,created_by,'portal' from public.investment_cycles where id='d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';
set local role service_role;
select throws_ok($$select pg_temp.activate_date(3)$$,'23514','multiple eligible cycles match this payment date; held for staff resolution','ambiguous calendar-day assignment rejected');
reset role;
update public.investment_cycles set opens_at=((now() at time zone 'Africa/Kampala')::date+1)::timestamp at time zone 'Africa/Kampala',closes_at=((now() at time zone 'Africa/Kampala')::date+2)::timestamp at time zone 'Africa/Kampala' where id='d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';
set local role service_role;
select throws_ok($$select pg_temp.activate_date(3)$$,'23514','payment date resolves to a different cycle; held for staff resolution without moving funds','payment date never silently reassigns a reservation');
select is((select status::text from public.investments where id='01010101-0101-4101-8101-000000000003'),'reserved','failed attempt leaves pending record unchanged');
select is((select count(*) from public.bank_receipts where investment_id='01010101-0101-4101-8101-000000000003'),0::bigint,'failed attempt creates no payment record');
reset role;
select * from finish();
rollback;
