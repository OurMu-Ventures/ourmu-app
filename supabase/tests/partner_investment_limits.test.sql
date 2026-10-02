begin;
select no_plan();

-- Partner limit integration: default, overrides, cumulative cap,
-- reinvestment, capacity isolation, grandfathering and backend permissions.

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

insert into public.investments (id, investor_id, cycle_id, unit_price_ugx, principal_ugx, projected_return_bps, projected_return_ugx, projected_value_ugx, maturity_date, reservation_expires_at, status, record_origin)
values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    125000, 500000, 3000, 150000, 650000, (now() + interval '300 days')::date, now() + interval '1 day', 'reserved', 'portal'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    125000, 50000000, 3000, 15000000, 65000000, (now() - interval '200 days')::date, now() - interval '190 days', 'matured', 'portal'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
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
set local role service_role;
update public.maturity_instructions set proposed_actual_roi_ugx = 10000000,
  confirmed_actual_roi_ugx = 10000000 where id = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
select is(public.fulfill_maturity_instruction(
  '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
  10000000, '', 'FULFILL', true, gen_random_uuid(), false)->>'reason',
  'reinvestment amount is outside placement limits', 'default reinvestment cap holds 60m rollover');

select throws_ok($$select public.request_investment('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 50000000.01, gen_random_uuid(), 'test', '\x01')$$, '22023', null, 'default rejects amount above 50m');
select lives_ok($$select public.request_investment('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 50000000, gen_random_uuid(), 'test', '\x01')$$, 'default accepts exactly 50m');
select throws_ok($$select public.request_investment('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 125000, gen_random_uuid(), 'test', '\x01')$$, '23514', null, 'default cumulative limit is enforced');
update public.investments set status = 'cancelled' where cycle_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' and status = 'reserved';
select throws_ok($$select public.set_partner_investment_limit('22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 100000000, 'Approved partner exception', gen_random_uuid())$$, '42501', null, 'investors cannot act as administrators');
select throws_ok($$select public.set_partner_investment_limit('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 50000000, 'Approved partner exception', gen_random_uuid())$$, '22023', null, 'invalid override 50000000');
select throws_ok($$select public.set_partner_investment_limit('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 49999999, 'Approved partner exception', gen_random_uuid())$$, '22023', null, 'invalid override 49999999');
select throws_ok($$select public.set_partner_investment_limit('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 100000000.001, 'Approved partner exception', gen_random_uuid())$$, '22023', null, 'invalid override 100000000.001');
select throws_ok($$select public.set_partner_investment_limit('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'NaN'::numeric, 'Approved partner exception', gen_random_uuid())$$, '22023', null, 'invalid override NaN::numeric');
select throws_ok($$select public.set_partner_investment_limit('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Infinity'::numeric, 'Approved partner exception', gen_random_uuid())$$, '22023', null, 'invalid override Infinity::numeric');
select throws_ok($$select public.set_partner_investment_limit('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 100000000, ' ', gen_random_uuid())$$, '22023', null, 'reason is mandatory');
select lives_ok($$select public.set_partner_investment_limit('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 100000000, 'Approved partner exception', gen_random_uuid())$$, 'admin sets persistent 100m override');
select is((select investment_limit_ugx from public.profiles where id = '22222222-2222-2222-2222-222222222222'), 100000000::numeric, 'override is stored');
select ok(exists(select 1 from public.audit_events where action = 'partner.investment_limit_changed' and entity_id = '22222222-2222-2222-2222-222222222222' and metadata->>'new_limit_ugx' = '100000000' and metadata->>'reason' = 'Approved partner exception'), 'change is audited');
select throws_ok($$select public.request_investment('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 100000000.01, gen_random_uuid(), 'test', '\x01')$$, '22023', null, 'override rejects amount above 100m');
select ok((public.fulfill_maturity_instruction('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', 10000000, '', 'FULFILL', true, gen_random_uuid(), false)->>'fulfilled')::boolean, '60m reinvestment honors override');
select lives_ok($$select public.request_investment('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 40000000, gen_random_uuid(), 'test', '\x01')$$, '40m placement reaches cumulative 100m');
select throws_ok($$select public.request_investment('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 125000, gen_random_uuid(), 'test', '\x01')$$, '23514', null, 'cumulative override rejects additional placement');
select throws_ok($$insert into public.investments (investor_id,cycle_id,unit_price_ugx,principal_ugx,projected_return_bps,projected_return_ugx,projected_value_ugx,maturity_date,reservation_expires_at,status,record_origin) values ('22222222-2222-2222-2222-222222222222','cccccccc-cccc-cccc-cccc-cccccccccccc',125000,125000,3000,125000*0.3,125000*1.3,current_date,now()+interval '1 day','reserved','portal')$$, '23514', 'investor cycle limit exceeded', 'direct inserts cannot bypass the cumulative override');
select lives_ok($$select public.set_partner_investment_limit('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', NULL, 'Approved partner exception', gen_random_uuid())$$, 'clearing override restores default');
select is((select sum(principal_ugx) from public.investments where cycle_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' and status in ('active','reserved')), 100000000::numeric, 'clearing preserves existing investments');
select lives_ok($$update public.investments set requested_at = requested_at where cycle_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'$$, 'existing placements remain updatable after clearing');
select throws_ok($$select public.request_investment('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 125000, gen_random_uuid(), 'test', '\x01')$$, '23514', null, 'restored default blocks additional placement');
select throws_ok($$insert into public.investments (investor_id,cycle_id,unit_price_ugx,principal_ugx,projected_return_bps,projected_return_ugx,projected_value_ugx,maturity_date,reservation_expires_at,status,record_origin) values ('22222222-2222-2222-2222-222222222222','cccccccc-cccc-cccc-cccc-cccccccccccc',125000,60000000,3000,60000000*0.3,60000000*1.3,current_date,now()+interval '1 day','reserved','portal')$$, '23514', 'investment amount exceeds partner limit', 'direct inserts cannot bypass the default placement cap');
select lives_ok($$select public.set_partner_investment_limit('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 300000000, 'Approved partner exception', gen_random_uuid())$$, 'higher override can exceed cycle capacity');
select throws_ok($$select public.request_investment('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 100000000.01, gen_random_uuid(), 'test', '\x01')$$, '23514', null, 'cycle capacity remains enforced');
update public.profiles set is_test = true where id = '22222222-2222-2222-2222-222222222222';
select lives_ok($$select public.request_investment('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 100000000.01, gen_random_uuid(), 'test', '\x01')$$, 'test accounts preserve capacity isolation');
reset role;
set local role authenticated;
select throws_ok($$select public.set_partner_investment_limit('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 100000000, 'Approved partner exception', gen_random_uuid())$$, '42501', null, 'authenticated clients cannot call limit setter');
select throws_ok($$update public.profiles set investment_limit_ugx = 100000000 where id = '22222222-2222-2222-2222-222222222222'$$, '42501', null, 'authenticated clients cannot modify profile limit');
reset role;
select * from finish();
rollback;
