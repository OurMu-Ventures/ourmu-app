begin;
select no_plan();
set local time zone 'America/New_York';

-- Synthetic fixtures only. C0 closed at the end of yesterday (Uganda), like a
-- cycle whose last day received the payment; C1 opened at midnight today.
create function pg_temp.k(days integer default 0) returns date language sql as
  $$ select (now() at time zone 'Africa/Kampala')::date + days $$;
create function pg_temp.kstart(d date) returns timestamptz language sql as
  $$ select d::timestamp at time zone 'Africa/Kampala' $$;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'deposit-admin@test.local'),
  ('b0000000-0000-4000-8000-000000000001', 'deposit-partner@test.local'),
  ('b0000000-0000-4000-8000-000000000002', 'deposit-other@test.local'),
  ('b0000000-0000-4000-8000-000000000003', 'deposit-test-partner@test.local');
insert into public.profiles (id, role, access_status, legal_name, email, phone, kyc_status, is_test) values
  ('a0000000-0000-4000-8000-000000000001', 'admin', 'active', 'Deposit Admin', 'deposit-admin@test.local', '+256700000201', 'verified', false),
  ('b0000000-0000-4000-8000-000000000001', 'investor', 'active', 'Deposit Partner', 'deposit-partner@test.local', '+256700000202', 'verified', false),
  ('b0000000-0000-4000-8000-000000000002', 'investor', 'active', 'Other Partner', 'deposit-other@test.local', '+256700000203', 'verified', false),
  ('b0000000-0000-4000-8000-000000000003', 'investor', 'active', 'Test Partner', 'deposit-test-partner@test.local', '+256700000204', 'verified', true);
insert into public.next_of_kin (user_id, legal_name, relationship, phone, address) values
  ('b0000000-0000-4000-8000-000000000001', 'Deposit Kin', 'sibling', '+256700000205', 'Kampala'),
  ('b0000000-0000-4000-8000-000000000003', 'Test Kin', 'sibling', '+256700000206', 'Kampala');
insert into public.investment_accounts (id, investor_id, name, archived_at) values
  ('ac000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'School Fees', null),
  ('ac000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Retirement', null),
  ('ac000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'Closed Pot', now());
create function pg_temp.main(p uuid default 'b0000000-0000-4000-8000-000000000001') returns uuid language sql as
  $$ select id from public.investment_accounts where investor_id = p and is_default $$;

insert into public.agreement_versions (id, version, title, template_markdown, content_hash, is_legally_approved, approved_by, approved_at, published_at)
values ('a9000000-0000-4000-8000-000000000001', 'v-deposit-test', 'Deposit Test Agreement', 'Deposit test terms.',
  repeat('ab', 32), true, 'a0000000-0000-4000-8000-000000000001', now(), now());
insert into public.investment_cycles (id, name, opens_at, closes_at, maturity_date, capacity_ugx, unit_price_ugx,
  projected_return_bps, status, agreement_version_id, created_by, record_origin)
values
  ('c0000000-0000-4000-8000-000000000000', 'Deposit C0', pg_temp.kstart(pg_temp.k(-30)), pg_temp.kstart(pg_temp.k()) - interval '1 millisecond',
    (date_trunc('month', now() + interval '6 months') + interval '1 month - 1 day')::date, 200000000, 125000, 3000,
    'closed', 'a9000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'portal'),
  ('c0000000-0000-4000-8000-000000000001', 'Deposit C1', pg_temp.kstart(pg_temp.k()), pg_temp.kstart(pg_temp.k(21)) - interval '1 millisecond',
    (date_trunc('month', now() + interval '7 months') + interval '1 month - 1 day')::date, 200000000, 125000, 3000,
    'open', 'a9000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'portal');

create function pg_temp.reserve(p_id uuid, p_cycle uuid, p_amount numeric, p_account uuid, p_requested timestamptz,
  p_investor uuid default 'b0000000-0000-4000-8000-000000000001', p_test boolean default false) returns void language sql as $$
  insert into public.investments (id, account_id, investor_id, cycle_id, principal_ugx, projected_return_bps,
    projected_return_ugx, projected_value_ugx, unit_price_ugx, maturity_date, requested_at, status, policy_version, is_test)
  select p_id, p_account, p_investor, p_cycle, p_amount, 3000, round(p_amount * 0.3, 8), p_amount + round(p_amount * 0.3, 8), 125000,
    c.maturity_date, p_requested, 'reserved', 'auto_cycle_v1', p_test from public.investment_cycles c where c.id = p_cycle;
  insert into public.investment_agreements (investment_id, investor_id, agreement_version_id, accepted_content_hash,
    accepted_at, acceptance_request_id, accepted_user_agent, accepted_ip_fingerprint)
  values (p_id, p_investor, 'a9000000-0000-4000-8000-000000000001', repeat('ab', 32), p_requested, gen_random_uuid(), 'test', '\x00');
$$;
-- C1 reservations (payment date today) and C0 reservations (paid yesterday).
select pg_temp.reserve('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 2000000, pg_temp.main(), pg_temp.kstart(pg_temp.k()) + interval '1 minute');
select pg_temp.reserve('e0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 500000, 'ac000000-0000-4000-8000-000000000001', pg_temp.kstart(pg_temp.k()) + interval '1 minute');
select pg_temp.reserve('e0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000000', 1000000, pg_temp.main(), pg_temp.kstart(pg_temp.k(-10)));
select pg_temp.reserve('e0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000000', 125000, pg_temp.main(), pg_temp.kstart(pg_temp.k(-10)));
select pg_temp.reserve('e0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000000', 500000, pg_temp.main('b0000000-0000-4000-8000-000000000002'), pg_temp.kstart(pg_temp.k(-10)), 'b0000000-0000-4000-8000-000000000002');
select pg_temp.reserve('e0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000000', 300000, pg_temp.main(), pg_temp.kstart(pg_temp.k(-10)));
update public.investments set status = 'cancelled', cancelled_at = now() where id = 'e0000000-0000-4000-8000-000000000006';
select pg_temp.reserve('e0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000000', 250000, pg_temp.main(), pg_temp.kstart(pg_temp.k(-10)));
select pg_temp.reserve('e0000000-0000-4000-8000-000000000008', 'c0000000-0000-4000-8000-000000000000', 125000, pg_temp.main(), pg_temp.kstart(pg_temp.k(-1)) + interval '1 hour');

create function pg_temp.res(id uuid, amount text, account uuid default null) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'reservation', 'investment_id', id, 'amount_ugx', amount,
    'account_id', coalesce(account, (select account_id from public.investments where investments.id = res.id)))
$$;
create function pg_temp.place(account uuid, amount text) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'offline_placement', 'account_id', account, 'amount_ugx', amount)
$$;
create function pg_temp.alloc(
  lines jsonb,
  amount numeric default 3000000,
  ref text default 'DEP-SPLIT-1',
  paid date default pg_temp.k(-1),
  cycle uuid default 'c0000000-0000-4000-8000-000000000000',
  request uuid default gen_random_uuid(),
  partner uuid default 'b0000000-0000-4000-8000-000000000001',
  admin uuid default 'a0000000-0000-4000-8000-000000000001',
  aal boolean default true,
  confirmation text default 'ALLOCATE',
  authorized date default pg_temp.k(-1),
  evidence text default 'EMAIL-SPLIT-0001',
  notes text default 'Statement line and partner split email verified.',
  identity boolean default true,
  verified boolean default true,
  agreement text default repeat('ab', 32),
  accepted boolean default true,
  method text default 'email',
  paid_at timestamptz default null
) returns jsonb language sql as $$
  select public.allocate_bank_deposit(admin, aal, request, partner, cycle, ref, amount, paid, authorized, method,
    evidence, notes, lines, identity, verified, agreement, accepted, confirmation, paid_at)
$$;
-- The synthetic UGX 3,000,000 deposit: offline placements of 2m, 500k and 500k in three accounts.
create function pg_temp.split_lines() returns jsonb language sql as $$
  select jsonb_build_array(
    pg_temp.place(pg_temp.main(), '2000000'),
    pg_temp.place('ac000000-0000-4000-8000-000000000001', '500000.00'),
    pg_temp.place('ac000000-0000-4000-8000-000000000002', '500000'))
$$;
create function pg_temp.snapshot() returns text language sql as $$
  select concat_ws('|', (select count(*) from public.bank_deposits), (select count(*) from public.bank_receipts),
    (select count(*) from public.investments), (select count(*) from public.investment_receipts),
    (select count(*) from public.jobs), (select count(*) from public.audit_events),
    (select string_agg(id::text || ':' || status::text, ',' order by id) from public.investments))
$$;

-- Access: backend-only function, administrator-only evidence.
select ok(not has_function_privilege('anon', 'public.allocate_bank_deposit(uuid,boolean,uuid,uuid,uuid,text,numeric,date,date,text,text,text,jsonb,boolean,boolean,text,boolean,text,timestamptz)', 'execute'), 'anon cannot allocate');
select ok(not has_function_privilege('authenticated', 'public.allocate_bank_deposit(uuid,boolean,uuid,uuid,uuid,text,numeric,date,date,text,text,text,jsonb,boolean,boolean,text,boolean,text,timestamptz)', 'execute'), 'authenticated cannot allocate');
select ok(has_function_privilege('service_role', 'public.allocate_bank_deposit(uuid,boolean,uuid,uuid,uuid,text,numeric,date,date,text,text,text,jsonb,boolean,boolean,text,boolean,text,timestamptz)', 'execute'), 'service role can allocate');
select ok(not has_table_privilege('authenticated', 'public.bank_payment_reconciliation', 'select'), 'reconciliation is backend-only');
select ok((select relrowsecurity from pg_class where oid = 'public.bank_deposits'::regclass), 'deposits have RLS');

-- Legacy single payments keep their rules.
set local role service_role;
select lives_ok($$select public.activate_investment('a0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000007','LEGACY-ONE',250000,pg_temp.k(-1),'ACTIVATE',true,gen_random_uuid())$$,
  'single-payment activation still works');
select is((select deposit_id from public.bank_receipts where investment_id = 'e0000000-0000-4000-8000-000000000007'), null::uuid, 'single payment has no deposit');
select is((select payment_reference from public.investment_receipts where investment_id = 'e0000000-0000-4000-8000-000000000007'), null::text, 'single-payment receipt is unchanged');
select throws_ok($$select public.activate_investment('a0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000004','LEGACY-ONE',125000,pg_temp.k(-1),'ACTIVATE',true,gen_random_uuid())$$,
  '23505', 'duplicate key value violates unique constraint "bank_receipts_bank_reference_key"', 'duplicate single reference keeps its constraint error');
select lives_ok($$select public.activate_investment('a0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000007','LEGACY-ONE',250000,pg_temp.k(-1),'ACTIVATE',true,gen_random_uuid())$$,
  'single-payment retry stays idempotent');
select is((select count(*) from public.bank_receipts where investment_id = 'e0000000-0000-4000-8000-000000000007'), 1::bigint, 'single payment recorded once');
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.res('e0000000-0000-4000-8000-000000000004','125000')), 125000, 'legacy-one')$$,
  '23505', 'bank reference is already recorded', 'deposit cannot reuse a single-payment reference, ignoring case');

-- Invalid requests leave no trace.
reset role;
create temp table before_invalid as select pg_temp.snapshot() as s;
set local role service_role;
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), aal => false)$$, '42501', 'active administrator AAL2 required', 'AAL2 required');
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), admin => 'b0000000-0000-4000-8000-000000000001')$$, '42501', 'active administrator AAL2 required', 'administrator required');
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), confirmation => 'allocate')$$, '22023', 'typed confirmation is invalid', 'typed confirmation required');
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), ref => '  ')$$, '22023', 'bank reference is required', 'reference required');
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), amount => 3000000.001)$$, '22023', 'received amount must be positive with at most two decimals', 'amount precision checked');
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), paid => null)$$, '22023', 'valid payment received date is required', 'payment date required');
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), paid => 'infinity'::date)$$, '22023', 'valid payment received date is required', 'infinite payment date rejected');
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), paid => pg_temp.k(1))$$, '22023', 'received date cannot be in the future', 'future payment date rejected');
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), paid_at => now() + interval '1 minute')$$, '22023', 'payment timestamp cannot be in the future', 'future statement time rejected');
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), paid_at => pg_temp.kstart(pg_temp.k(-2)) + interval '12 hours')$$, '22023', 'received date must match the Kampala date of the verified payment timestamp', 'statement time must match the payment date');
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), evidence => 'x')$$, '22023', 'dated partner split instructions and verification notes are required', 'split evidence required');
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), method => 'sms')$$, '22023', 'dated partner split instructions and verification notes are required', 'authorization method checked');
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), authorized => pg_temp.k(1))$$, '22023', 'split instruction date cannot be in the future', 'future authorization date rejected');
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), identity => false)$$, '22023', 'confirm the partner identity, bank statement and split instructions were verified', 'identity attestation required');
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), verified => false)$$, '22023', 'confirm the partner identity, bank statement and split instructions were verified', 'split attestation required');
select throws_ok($$select pg_temp.alloc('[]'::jsonb)$$, '22023', 'allocations must list between 1 and 20 investments', 'empty split rejected');
select throws_ok($$select pg_temp.alloc((select jsonb_agg(pg_temp.place('ac000000-0000-4000-8000-000000000002', '150000')) from generate_series(1, 21)), 3150000)$$, '22023', 'allocations must list between 1 and 20 investments', 'oversized split rejected');
select throws_ok($$select pg_temp.alloc(jsonb_build_array(jsonb_build_object('kind','reservation','account_id',pg_temp.main(),'amount_ugx','3000000')))$$, '22023', 'allocation line is invalid', 'reservation line needs an investment');
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.place('ac000000-0000-4000-8000-000000000002', '3000000.005')))$$, '22023', 'allocation line is invalid', 'line amount precision checked');
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.place('ac000000-0000-4000-8000-000000000002', '0')), 0.01)$$, '22023', 'allocation line is invalid', 'zero line rejected');
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.res('e0000000-0000-4000-8000-000000000004','125000'), pg_temp.res('e0000000-0000-4000-8000-000000000004','125000')), 250000)$$, '22023', 'an investment can appear only once in a deposit', 'duplicate investment rejected');
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), partner => 'b0000000-0000-4000-8000-000000000009')$$, 'P0002', 'partner not found', 'unknown partner rejected');
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), cycle => 'c0000000-0000-4000-8000-000000000001')$$, '23514', 'payment date resolves to a different cycle than reviewed; refresh and review again', 'stale reviewed cycle rejected');
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), amount => 2999999)$$, '23514', 'allocations must add up exactly to the received amount', 'short total rejected');
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), amount => 3000001)$$, '23514', 'allocations must add up exactly to the received amount', 'over total rejected');
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.res('e0000000-0000-4000-8000-000000000003','500000'), pg_temp.place('ac000000-0000-4000-8000-000000000002','500000')), 1000000)$$, '23514', 'reservation allocation must exactly match its reserved principal', 'partial reservation funding rejected');
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.res('e0000000-0000-4000-8000-000000000005','500000')), 500000)$$, 'P0002', 'reservation not found for this partner', 'another partner''s reservation rejected');
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.res('e0000000-0000-4000-8000-000000000006','300000')), 300000)$$, '23514', 'cancelled reservations cannot be revived; create a new reservation', 'cancelled reservation rejected');
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.res('e0000000-0000-4000-8000-000000000007','250000')), 250000)$$, '23514', 'only a pending reservation can be activated', 'already-paid investment rejected');
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.res('e0000000-0000-4000-8000-000000000004','125000', 'ac000000-0000-4000-8000-000000000001')), 125000)$$, '23514', 'reservation moved to another account; refresh and review again', 'stale account rejected');
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.res('e0000000-0000-4000-8000-000000000008','125000')), 125000, paid => pg_temp.k(-2), authorized => pg_temp.k(-2))$$, '23514', 'payment date predates the reservation date; held for staff resolution', 'payment before the reservation date rejected');
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.res('e0000000-0000-4000-8000-000000000001','2000000')), 2000000)$$, '23514', 'payment date resolves to a different cycle; held for staff resolution without moving funds', 'reservation never moves to the payment cycle');
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.place('ac000000-0000-4000-8000-000000000003','500000')), 500000)$$, '42501', 'investment account unavailable', 'archived account rejected');
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.place(pg_temp.main('b0000000-0000-4000-8000-000000000002'),'500000')), 500000)$$, '42501', 'investment account unavailable', 'another partner''s account rejected');
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.place('ac000000-0000-4000-8000-000000000002','124999.99'), pg_temp.res('e0000000-0000-4000-8000-000000000004','125000')), 249999.99)$$, '23514', 'placement amount must be at least UGX 125,000', 'placement minimum enforced');
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), accepted => false)$$, '22023', 'confirm the partner accepted the cycle agreement offline', 'offline agreement acceptance required for placements');
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), agreement => repeat('cd', 32))$$, '23514', 'the agreement changed; review the refreshed terms', 'changed agreement rejected');
reset role;
select is((select s from before_invalid), pg_temp.snapshot(), 'no rejected request wrote anything');

-- Main case: UGX 3,000,000 paid on C0's last day, posted today after C0 closed.
set local role service_role;
select lives_ok($$select pg_temp.alloc(pg_temp.split_lines(), request => 'f0000000-0000-4000-8000-000000000001', ref => ' DEP-SPLIT-1 ')$$,
  'payment on the last cycle day posts the next day, after close');
reset role;
select lives_ok($$set constraints all immediate$$, 'posted split balances at commit');
set constraints all deferred;
create temp table dep as select * from public.bank_deposits where request_id = 'f0000000-0000-4000-8000-000000000001';
select is((select count(*) from dep), 1::bigint, 'one deposit recorded');
select is((select bank_reference from dep), 'DEP-SPLIT-1', 'trimmed unique reference stored once');
select is((select received_amount_ugx from dep), 3000000::numeric, 'deposit amount stored');
select is((select received_date from dep), pg_temp.k(-1), 'real payment date stored');
select is((select received_at from dep), null::timestamptz, 'no payment time invented');
select is((select cycle_id from dep), 'c0000000-0000-4000-8000-000000000000'::uuid, 'cycle comes from the payment date');
select is((select posted_by from dep), 'a0000000-0000-4000-8000-000000000001'::uuid, 'acting admin stored');
select is((select posted_at from dep), now(), 'real posting time stored');
select ok((select (select posted_at from dep) > closes_at from public.investment_cycles where id = 'c0000000-0000-4000-8000-000000000000'), 'posted after the cycle closed');
select is((select authorization_method || ' ' || authorized_on || ' ' || evidence_reference from dep), 'email ' || pg_temp.k(-1) || ' EMAIL-SPLIT-0001', 'offline authority evidence stored');
select is((select identity_verified and split_verified and agreement_accepted_offline from dep), true, 'offline attestations stored');
select is((select placement_agreement_version_id::text || ' ' || placement_agreement_hash from dep), 'a9000000-0000-4000-8000-000000000001 ' || repeat('ab', 32), 'agreement version and hash accepted offline stored');
select is((select string_agg(r.received_amount_ugx::numeric(28,2)::text || ':' || r.allocation_kind || ':' || a.name, ',' order by r.deposit_line)
  from public.bank_receipts r join public.investments i on i.id = r.investment_id join public.investment_accounts a on a.id = i.account_id
  where r.deposit_id = (select id from dep)),
  '2000000.00:offline_placement:Main Account,500000.00:offline_placement:School Fees,500000.00:offline_placement:Retirement', 'allocation amounts stored per investment and account');
select is((select count(distinct bank_reference) from public.bank_receipts where deposit_id = (select id from dep)), 1::bigint, 'allocations share the reference');
create temp table placed as select i.* from public.investments i join public.bank_receipts r on r.investment_id = i.id
  where r.deposit_id = (select id from dep);
select is((select count(*) from placed where status = 'active' and cycle_id = 'c0000000-0000-4000-8000-000000000000' and record_origin = 'portal'
  and policy_version = 'auto_cycle_v1' and requested_at = now() and activated_at = now()), 3::bigint, 'placements active in the payment cycle, never backdated');
select is((select string_agg(principal_ugx::numeric(28,2) || '/' || projected_return_ugx::numeric(28,2) || '/' || projected_value_ugx::numeric(28,2), ',' order by principal_ugx desc) from placed),
  '2000000.00/600000.00/2600000.00,500000.00/150000.00/650000.00,500000.00/150000.00/650000.00', 'placement returns calculated');
select is((select count(*) from public.investment_agreements where investment_id in (select id from placed)), 0::bigint, 'no electronic acceptance is invented');
select throws_ok($$insert into public.investment_agreements (investment_id, investor_id, agreement_version_id, accepted_content_hash, accepted_at, acceptance_request_id, accepted_user_agent, accepted_ip_fingerprint)
  select id, investor_id, 'a9000000-0000-4000-8000-000000000001', repeat('ab', 32), now(), gen_random_uuid(), 'invented', '\x00' from placed limit 1$$,
  '23514', 'offline placements have no electronic agreement acceptance', 'electronic acceptance cannot be attached later');
select is((select count(*) from public.jobs where kind = 'generate_agreement_pdf' and entity_id in (select id from placed)), 0::bigint, 'no electronic agreement PDF is queued');
select is((select string_agg(amount_ugx::numeric(28,2)::text || ' ' || payment_reference || ' ' || deposit_amount_ugx::numeric(28,2) || ' ' || deposit_allocation_count || ' ' || transaction_date, ',' order by amount_ugx desc, investment_id)
  from public.investment_receipts where bank_deposit_id = (select id from dep)),
  concat_ws(',', '2000000.00 DEP-SPLIT-1 3000000.00 3 ' || pg_temp.k(-1), '500000.00 DEP-SPLIT-1 3000000.00 3 ' || pg_temp.k(-1), '500000.00 DEP-SPLIT-1 3000000.00 3 ' || pg_temp.k(-1)),
  'receipts show individual amounts, the shared reference and the payment date');
select is((select count(*) from public.jobs where kind = 'generate_receipt_pdf' and entity_id in (select id from public.investment_receipts where bank_deposit_id = (select id from dep))), 3::bigint, 'one receipt job per investment');
select is((select count(*) from public.audit_events where action = 'investment.activated' and metadata->>'bank_deposit_id' = (select id::text from dep)), 3::bigint, 'each investment activation is audited');
select is((select metadata->>'assignment_basis' from public.audit_events where action = 'investment.activated' and metadata->>'bank_deposit_id' = (select id::text from dep) limit 1), 'payment_date', 'audit records the date basis');
select is((select count(*) from public.audit_events where action = 'bank_deposit.allocated' and entity_id = (select id from dep)), 1::bigint, 'deposit allocation is audited once');
-- Reconciliation counts the deposit once.
select is((select count(*) from public.bank_payment_reconciliation where bank_reference = 'DEP-SPLIT-1'), 1::bigint, 'deposit appears once in reconciliation');
select is((select received_amount_ugx || ' ' || investment_count from public.bank_payment_reconciliation where bank_reference = 'DEP-SPLIT-1'), '3000000.00000000 3', 'reconciliation shows the full deposit');
select is((select sum(received_amount_ugx) from public.bank_payment_reconciliation), (select sum(received_amount_ugx) from public.bank_receipts), 'reconciliation total matches recorded payments');
select is((select count(*) from public.bank_payment_reconciliation), (select count(*) from public.bank_receipts where deposit_id is null) + (select count(*) from public.bank_deposits), 'one reconciliation row per transfer');

-- Retries and duplicate submissions.
set local role service_role;
select is((select pg_temp.alloc(pg_temp.split_lines(), request => 'f0000000-0000-4000-8000-000000000001', ref => 'DEP-SPLIT-1')->>'replayed'), 'true', 'same request replays');
select is((select count(*) from public.bank_deposits), 1::bigint, 'replay writes no deposit');
select is((select count(*) from public.investments where id in (select investment_id from public.bank_receipts where deposit_id is not null)), 3::bigint, 'replay creates no placement');
select throws_ok($$select pg_temp.alloc(pg_temp.split_lines(), request => 'f0000000-0000-4000-8000-000000000001', notes => 'A different set of verification notes.')$$,
  '23505', 'request already used for a different deposit', 'reused request with different data rejected');
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.res('e0000000-0000-4000-8000-000000000004','125000')), 125000, 'dep-split-1')$$,
  '23505', 'bank reference is already recorded', 'new deposit cannot reuse the reference');
select throws_ok($$select public.activate_investment('a0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000004','DEP-SPLIT-1',125000,pg_temp.k(-1),'ACTIVATE',true,gen_random_uuid())$$,
  '23505', 'bank reference is already recorded', 'single payment cannot reuse a deposit reference');
reset role;

-- Secondary: fund existing reservations, alone or with a placement.
set local role service_role;
select lives_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.res('e0000000-0000-4000-8000-000000000001','2000000'), pg_temp.res('e0000000-0000-4000-8000-000000000002','500000'),
  pg_temp.place('ac000000-0000-4000-8000-000000000002','500000')), 3000000, 'DEP-MIXED', pg_temp.k(), 'c0000000-0000-4000-8000-000000000001', authorized => pg_temp.k(),
  paid_at => pg_temp.kstart(pg_temp.k()))$$, 'reservations and a placement share one deposit');
select is((select string_agg(status::text, ',' order by id) from public.investments where id in ('e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002')), 'active,active', 'reservations activated');
select is((select count(*) from public.jobs where kind = 'generate_agreement_pdf' and entity_id in ('e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002')), 2::bigint, 'online agreements still generate for reservations');
select is((select received_at from public.bank_deposits where bank_reference = 'DEP-MIXED'), pg_temp.kstart(pg_temp.k()), 'verified statement time kept when supplied');
select lives_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.res('e0000000-0000-4000-8000-000000000003','1000000')), 1000000, 'DEP-AFTER-CLOSE')$$,
  'closed-cycle reservation paid on its last day posts after close');
select throws_ok($$select public.activate_investment('a0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002','OTHER-REF',500000,pg_temp.k(),'ACTIVATE',true,gen_random_uuid())$$,
  '23514', 'only a pending reservation can be activated', 'allocated reservation cannot be paid twice');
select is((select count(*) from public.bank_receipts where investment_id = 'e0000000-0000-4000-8000-000000000002'), 1::bigint, 'single-payment activation preserved');
select lives_ok($$select public.ensure_investment_receipt('b0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002')$$, 'on-demand receipt returns the existing receipt');
select is((select count(*) from public.investment_receipts where investment_id = 'e0000000-0000-4000-8000-000000000002'), 1::bigint, 'receipt not duplicated');
reset role;

-- Evidence is immutable and splits must balance at commit.
select throws_ok($$update public.bank_deposits set verification_notes = 'Changed after posting.'$$, '55000', null, 'deposit evidence is immutable');
select throws_ok($$update public.investment_receipts set payment_reference = 'CHANGED' where bank_deposit_id is not null$$, '55000', 'issued receipt details are immutable', 'receipt reference is immutable');
select throws_ok($$
  set constraints all immediate;
  insert into public.bank_deposits (investor_id, cycle_id, bank_reference, received_amount_ugx, received_date,
    authorized_on, authorization_method, evidence_reference, verification_notes, identity_verified, split_verified,
    agreement_accepted_offline, allocation_count, is_test, posted_by, request_id, request_fingerprint)
  values ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'UNBALANCED-1', 125000,
    pg_temp.k(), pg_temp.k(), 'email', 'EMAIL-SPLIT-0002', 'Direct write without allocations.', true, true, false, 1, false,
    'a0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'x')
$$, '23514', 'bank deposit allocations must add up to the deposit', 'unbalanced deposit cannot commit');
set constraints all deferred;
select throws_ok($$insert into public.bank_receipts (investment_id, bank_reference, received_amount_ugx, received_date, received_at, recorded_by, activated_at, deposit_id, deposit_line, allocation_kind)
  values ('e0000000-0000-4000-8000-000000000004', 'WRONG-REF', 125000, pg_temp.k(-1), null, 'a0000000-0000-4000-8000-000000000001', now(), (select id from dep), 4, 'reservation')$$,
  '23514', 'deposit allocation does not match its deposit', 'allocation must match its deposit');

-- Cycle boundaries follow the Uganda payment date.
set local role service_role;
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.place(pg_temp.main(),'125000')), 125000, 'DEP-LATE', pg_temp.k())$$,
  '23514', 'payment date resolves to a different cycle than reviewed; refresh and review again', 'payment after the last day cannot use the closed cycle');
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.res('e0000000-0000-4000-8000-000000000004','125000')), 125000, 'DEP-LATE', pg_temp.k(), 'c0000000-0000-4000-8000-000000000001', authorized => pg_temp.k())$$,
  '23514', 'payment date resolves to a different cycle; held for staff resolution without moving funds', 'late payment never moves a reservation');
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.place(pg_temp.main(),'125000')), 125000, 'DEP-EARLY', pg_temp.k(-31), authorized => pg_temp.k(-31))$$,
  '23514', 'no eligible cycle is available for this payment date', 'payment before any cycle rejected');
select lives_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.place(pg_temp.main(),'125000')), 125000, 'DEP-FIRST-DAY', pg_temp.k(-30), authorized => pg_temp.k(-30))$$,
  'payment on the opening day belongs to the cycle');
select is((select status::text from public.investments where id = 'e0000000-0000-4000-8000-000000000004'), 'reserved', 'rejected payments left the reservation pending');
reset role;
-- A cycle boundary inside the payment day is ambiguous and never guessed.
update public.investment_cycles set closes_at = pg_temp.kstart(pg_temp.k(-1)) + interval '12 hours' where id = 'c0000000-0000-4000-8000-000000000000';
insert into public.investment_cycles (id, name, opens_at, closes_at, maturity_date, capacity_ugx, unit_price_ugx,
  projected_return_bps, status, agreement_version_id, created_by, record_origin)
select 'c0000000-0000-4000-8000-000000000002', 'Deposit split day', pg_temp.kstart(pg_temp.k(-1)) + interval '12 hours', pg_temp.kstart(pg_temp.k()) - interval '1 millisecond', maturity_date,
  200000000, 125000, 3000, 'closed', agreement_version_id, created_by, 'portal' from public.investment_cycles where id = 'c0000000-0000-4000-8000-000000000000';
set local role service_role;
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.place(pg_temp.main(),'125000')), 125000, 'DEP-SPLIT-DAY')$$,
  '23514', 'multiple eligible cycles match this payment date; held for staff resolution', 'split-day payment rejected');
reset role;
delete from public.investment_cycles where id = 'c0000000-0000-4000-8000-000000000002';
update public.investment_cycles set closes_at = pg_temp.kstart(pg_temp.k()) - interval '1 millisecond' where id = 'c0000000-0000-4000-8000-000000000000';

-- Partner-wide cap and shared cycle capacity. In C0 the partner holds 3m of
-- placements, 1m + 250k paid reservations, 125k + 125k pending ones and a 125k placement.
select is((select sum(principal_ugx) from public.investments where cycle_id = 'c0000000-0000-4000-8000-000000000000'
  and investor_id = 'b0000000-0000-4000-8000-000000000001' and status in ('reserved','active')), 4625000::numeric, 'cap fixture total');
set local role service_role;
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.place('ac000000-0000-4000-8000-000000000002', '45375001')), 45375001, 'DEP-CAP')$$,
  '23514', 'investor cycle limit exceeded; held for staff resolution', 'partner-wide cap includes every account');
select lives_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.place('ac000000-0000-4000-8000-000000000001', '45375000')), 45375000, 'DEP-CAP')$$,
  'placement up to the partner cap allowed');
reset role;
update public.investment_cycles set capacity_ugx = (select sum(principal_ugx) from public.investments where cycle_id = 'c0000000-0000-4000-8000-000000000000' and status in ('reserved','active') and not is_test) + 200000
  where id = 'c0000000-0000-4000-8000-000000000000';
update public.profiles set investment_limit_ugx = 100000000 where id = 'b0000000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.place('ac000000-0000-4000-8000-000000000001', '250000')), 250000, 'DEP-CAPACITY')$$,
  '23514', 'cycle capacity exceeded; held for staff resolution', 'shared cycle capacity enforced');
select lives_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.res('e0000000-0000-4000-8000-000000000004','125000'), pg_temp.place('ac000000-0000-4000-8000-000000000001', '200000')), 325000, 'DEP-CAPACITY')$$,
  'funding a counted reservation plus a placement within capacity allowed');
reset role;
-- Test partners are exempt from shared capacity but not their own cap.
set local role service_role;
select lives_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.place(pg_temp.main('b0000000-0000-4000-8000-000000000003'), '1000000')), 1000000, 'DEP-TEST', partner => 'b0000000-0000-4000-8000-000000000003')$$,
  'test partner bypasses shared capacity');
select is((select is_test from public.bank_deposits where bank_reference = 'DEP-TEST'), true, 'test deposit flagged');
select ok((select bool_and(receipt_number like 'TEST-%') from public.investment_receipts where payment_reference = 'DEP-TEST'), 'test receipts use the test series');
select throws_ok($$select pg_temp.alloc(jsonb_build_array(pg_temp.place(pg_temp.main('b0000000-0000-4000-8000-000000000003'), '49000001')), 49000001, 'DEP-TEST-CAP', partner => 'b0000000-0000-4000-8000-000000000003')$$,
  '23514', 'investor cycle limit exceeded; held for staff resolution', 'test partner still obeys the partner cap');
select is((select count(*) from public.bank_payment_reconciliation where not is_test), (select count(*) from public.bank_receipts r join public.investments i on i.id = r.investment_id where r.deposit_id is null and not i.is_test) + (select count(*) from public.bank_deposits where not is_test), 'live reconciliation excludes test deposits');
reset role;

-- Partners read only their own payment rows; deposit evidence stays with administrators.
set local role authenticated;
set local request.jwt.claim.sub = 'b0000000-0000-4000-8000-000000000001';
select is((select count(*) from public.bank_deposits), 0::bigint, 'partner cannot read deposit evidence');
select is((select count(*) from public.bank_receipts where bank_reference = 'DEP-SPLIT-1'), 3::bigint, 'partner reads own allocations');
select is((select count(*) from public.bank_receipts where allocation_kind = 'offline_placement' and bank_reference = 'DEP-SPLIT-1'), 3::bigint, 'partner can see the placements were authorized offline');
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';
select ok((select count(*) from public.bank_deposits) >= 3, 'administrator reads deposit evidence');
reset role;

select * from finish();
rollback;
