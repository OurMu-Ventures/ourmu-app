begin;
select no_plan();

-- Account isolation, ownership, aggregate limits, lifecycle and reinvestment.

-- Fixtures (as the test superuser; RLS is bypassed, FKs still apply).
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'receipt-admin@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'receipt-partner@test.local');

insert into public.profiles (id, role, access_status, legal_name, email, phone, kyc_status)
values
  ('11111111-1111-1111-1111-111111111111', 'admin', 'active', 'Receipt Admin', 'receipt-admin@test.local', '+256700000001', 'verified'),
  ('22222222-2222-2222-2222-222222222222', 'investor', 'active', 'Receipt Partner', 'receipt-partner@test.local', '+256700000002', 'verified');

insert into public.agreement_versions (id, version, title, template_markdown, content_hash, is_legally_approved, approved_by, approved_at, published_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'v-receipt-test', 'Receipt Test Agreement',
    'Receipt test terms for the member.',
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    true, '11111111-1111-1111-1111-111111111111', now(), now());

insert into public.investment_cycles (id, name, opens_at, closes_at, maturity_date, capacity_ugx, unit_price_ugx, projected_return_bps, status, agreement_version_id, created_by)
values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Receipt Old Cycle', now() - interval '400 days', now() - interval '300 days',
    (date_trunc('month', now() - interval '7 months') + interval '1 month - 1 day')::date, 200000000, 125000, 3000, 'closed',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Receipt Open Cycle', now() - interval '1 day', now() + interval '30 days',
    (date_trunc('month', now() + interval '6 months') + interval '1 month - 1 day')::date, 200000000, 125000, 3000, 'open',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111');

insert into public.investment_accounts(id,investor_id,name) values
('12345678-1234-4234-8234-123456789012','22222222-2222-2222-2222-222222222222','School Fees');
insert into public.investments (account_id, id, investor_id, cycle_id, unit_price_ugx, principal_ugx, projected_return_bps, projected_return_ugx, projected_value_ugx, maturity_date, reservation_expires_at, status, record_origin)
values
  ('12345678-1234-4234-8234-123456789012', 'dddddddd-dddd-dddd-dddd-dddddddddddd', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    125000, 500000, 3000, 150000, 650000, (now() + interval '300 days')::date, now() + interval '1 day', 'reserved', 'portal'),
  ('12345678-1234-4234-8234-123456789012', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    125000, 50000000, 3000, 15000000, 65000000, (now() - interval '200 days')::date, now() - interval '190 days', 'matured', 'portal'),
  ('12345678-1234-4234-8234-123456789012', 'ffffffff-ffff-ffff-ffff-ffffffffffff', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    125000, 125000, 3000, 37500, 162500, (now() - interval '200 days')::date, now() - interval '190 days', 'matured', 'portal');

insert into public.payout_destinations (id, investor_id, channel, provider_label, account_name, account_ref_ciphertext, account_ref_iv, account_ref_auth_tag, account_ref_fingerprint, account_last_four, key_version)
values
  ('99999999-9999-9999-9999-999999999999', '22222222-2222-2222-2222-222222222222', 'bank', 'Test Bank',
    'Receipt Partner', '\x01', '\x02', '\x03', '\x04', '0002', 1);

insert into public.maturity_instructions (id, investment_id, investor_id, choice, status, projected_payout_ugx, projected_reinvest_ugx,
  target_cycle_id, target_agreement_version_id, agreement_accepted, payout_destination_id,
  acceptance_captured_at, acceptance_request_id, acceptance_user_agent, acceptance_ip_fingerprint, request_id)
values
  ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '22222222-2222-2222-2222-222222222222',
    'reinvest_all', 'processing', 0, 65000000,
    'cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, null,
    now(), gen_random_uuid(), 'test-agent', '\x05', gen_random_uuid()),
  ('bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', 'ffffffff-ffff-ffff-ffff-ffffffffffff', '22222222-2222-2222-2222-222222222222',
    'withdraw_all', 'processing', 162500, 0,
    null, null, false, '99999999-9999-9999-9999-999999999999',
    null, null, null, null, gen_random_uuid());


insert into public.next_of_kin (user_id, legal_name, relationship, phone, address)
values ('22222222-2222-2222-2222-222222222222', 'Test Kin', 'Sibling', '+256700000003', 'Kampala');
-- These fixtures exercise the per-investment ROI workflow that cycles settled
-- before cycle-wide actual returns keep (see cycle_actual_returns.test.sql).
select set_config('ourmu.recording_cycle_actual_return', 'on', true);
update public.investment_cycles set legacy_settlement = true where actual_return_bps is null;
select set_config('ourmu.recording_cycle_actual_return', 'off', true);

select is((select count(*)::int from public.investment_accounts where is_default),2,'new profiles receive Main Account');
select ok(not has_function_privilege('authenticated','public.request_account_investment(uuid,uuid,uuid,numeric,uuid,text,bytea,uuid)','EXECUTE'),'account reservation RPC is backend-only');
select ok(not has_function_privilege('authenticated','public.manage_investment_account(uuid,text,uuid,uuid,boolean)','EXECUTE'),'account management RPC is backend-only');
select ok(not has_table_privilege('authenticated','public.investment_accounts','INSERT'),'browser cannot create accounts directly');
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
set local role authenticated;
select is((select count(*)::int from public.investment_accounts),2,'partner sees only own accounts');
reset role;
set local role service_role;
select throws_ok($$select public.request_account_investment((select id from public.investment_accounts where investor_id='11111111-1111-1111-1111-111111111111'), '22222222-2222-2222-2222-222222222222','cccccccc-cccc-cccc-cccc-cccccccccccc',125000,gen_random_uuid(),'test','\x01')$$,'42501','investment account unavailable','cannot reserve in another owner account');
select lives_ok($$select public.request_account_investment('12345678-1234-4234-8234-123456789012','22222222-2222-2222-2222-222222222222','cccccccc-cccc-cccc-cccc-cccccccccccc',30000000,gen_random_uuid(),'test','\x01')$$,'reserve in School Fees');
select lives_ok($$select public.request_investment('22222222-2222-2222-2222-222222222222','cccccccc-cccc-cccc-cccc-cccccccccccc',20000000,gen_random_uuid(),'test','\x01')$$,'old app reserves into Main Account during migration-first rollout');
select is((select sum(principal_ugx) from public.investments where account_id='12345678-1234-4234-8234-123456789012' and cycle_id='cccccccc-cccc-cccc-cccc-cccccccccccc'),30000000::numeric,'account principal stays separate');
select throws_ok($$select public.request_account_investment('12345678-1234-4234-8234-123456789012','22222222-2222-2222-2222-222222222222','cccccccc-cccc-cccc-cccc-cccccccccccc',125000,gen_random_uuid(),'test','\x01')$$,'23514','investor cycle limit exceeded','combined accounts cannot exceed partner cap');
select throws_ok($$update public.investments set account_id=(select id from public.investment_accounts where investor_id='22222222-2222-2222-2222-222222222222' and is_default) where id='dddddddd-dddd-dddd-dddd-dddddddddddd'$$,'23514','investment account cannot be changed','placements cannot move between accounts');
select throws_ok($$select public.manage_investment_account('22222222-2222-2222-2222-222222222222','School Fees',gen_random_uuid(),'12345678-1234-4234-8234-123456789012',true)$$,'P0001','account has outstanding investments','outstanding account cannot archive');
select throws_ok($$select public.manage_investment_account('22222222-2222-2222-2222-222222222222','Main Account',gen_random_uuid(),(select id from public.investment_accounts where investor_id='22222222-2222-2222-2222-222222222222' and is_default),true)$$,'P0001','Main Account cannot be archived','default account stays open');
select lives_ok($$select public.manage_investment_account('22222222-2222-2222-2222-222222222222','Retirement',gen_random_uuid())$$,'create an additional account');
select lives_ok($$select public.manage_investment_account('22222222-2222-2222-2222-222222222222','Retirement',gen_random_uuid(),(select id from public.investment_accounts where name='Retirement'),true)$$,'empty account archives');
select throws_ok($$select public.request_account_investment((select id from public.investment_accounts where name='Retirement'),'22222222-2222-2222-2222-222222222222','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',125000,gen_random_uuid(),'test','\x01')$$,'23514',null,'archived account cannot reserve');
update public.investments set status='cancelled' where cycle_id='cccccccc-cccc-cccc-cccc-cccccccccccc';
update public.maturity_instructions set proposed_actual_roi_ugx=0,confirmed_actual_roi_ugx=0 where id='aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
select ok((public.fulfill_maturity_instruction('11111111-1111-1111-1111-111111111111','aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',0,'','FULFILL',true,gen_random_uuid(),false)->>'fulfilled')::boolean,'reinvest source principal');
select is((select i.account_id from public.investments i join public.investment_receipts r on r.investment_id=i.id where r.original_investment_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),'12345678-1234-4234-8234-123456789012'::uuid,'reinvestment stays in School Fees');
select ok(exists(select 1 from public.audit_events where action='investment_account.created'),'account creation is audited');
select * from finish();
rollback;
