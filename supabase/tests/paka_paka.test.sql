begin;
select no_plan();

-- Receipt flow integration, executed as service_role (the only role granted
-- the activation functions). Covers the allocator grant, bank activation,
-- reinvestment fulfillment, payout-only fulfillment (no receipt), and
-- activation idempotency.

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
    (date_trunc('month', now() - interval '7 months') + interval '1 month - 1 day')::date, 100000000, 125000, 3000, 'closed',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Receipt Open Cycle', now() - interval '1 day', now() + interval '30 days',
    (date_trunc('month', now() + interval '6 months') + interval '1 month - 1 day')::date, 100000000, 125000, 3000, 'open',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111');

insert into public.investments (id, investor_id, cycle_id, unit_price_ugx, principal_ugx, projected_return_bps, projected_return_ugx, projected_value_ugx, maturity_date, reservation_expires_at, status, record_origin)
values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    125000, 500000, 3000, 150000, 650000, (now() + interval '300 days')::date, now() + interval '1 day', 'reserved', 'portal'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    125000, 250000, 3000, 75000, 325000, (now() - interval '200 days')::date, now() - interval '190 days', 'matured', 'portal'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    125000, 125000, 3000, 37500, 162500, (now() - interval '200 days')::date, now() - interval '190 days', 'matured', 'portal');

insert into public.payout_destinations (id, investor_id, channel, provider_label, account_name, account_ref_ciphertext, account_ref_iv, account_ref_auth_tag, account_ref_fingerprint, account_last_four, key_version)
values
  ('99999999-9999-9999-9999-999999999999', '22222222-2222-2222-2222-222222222222', 'bank', 'Test Bank',
    'Receipt Partner', '\x01', '\x02', '\x03', '\x04', '0002', 1);


insert into public.investments (id, investor_id, cycle_id, unit_price_ugx, principal_ugx, projected_return_bps, projected_return_ugx, projected_value_ugx, maturity_date, reservation_expires_at, status, record_origin)
select id, '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  125000, principal, 3000, principal * 0.3, principal * 1.3,
  (now() - interval '200 days')::date, now() - interval '190 days', 'matured', 'portal'
from (values ('33333333-3333-3333-3333-333333333333'::uuid, 4569760),
  ('44444444-4444-4444-4444-444444444444'::uuid, 50000000),
  ('55555555-5555-5555-5555-555555555555'::uuid, 4569760)) as examples(id, principal);

create function pg_temp.submit_paka(amount numeric, custom boolean default true,
  source uuid default '33333333-3333-3333-3333-333333333333',
  choice public.maturity_choice default 'withdraw_roi_reinvest_principal',
  partner uuid default '22222222-2222-2222-2222-222222222222',
  destination uuid default '99999999-9999-9999-9999-999999999999',
  agreement boolean default true, request uuid default gen_random_uuid()) returns uuid
language sql as $fn$
  select public.submit_maturity_instruction(partner, source, choice,
    'cccccccc-cccc-cccc-cccc-cccccccccccc', destination, agreement, true,
    request, 'test-agent', '\x05', amount, custom);
$fn$;
create function pg_temp.instruction(source uuid default '33333333-3333-3333-3333-333333333333') returns uuid
language sql as $fn$ select id from public.maturity_instructions where investment_id = source; $fn$;
create function pg_temp.fulfill_paka(roi numeric, source uuid default '33333333-3333-3333-3333-333333333333') returns jsonb
language sql as $fn$
  select public.fulfill_maturity_instruction('11111111-1111-1111-1111-111111111111',
    pg_temp.instruction(source), roi, 'TEST-TRANSFER', 'FULFILL', true, gen_random_uuid(), true);
$fn$;
create function pg_temp.process_paka(source uuid default '33333333-3333-3333-3333-333333333333') returns void
language sql as $fn$
  select public.begin_maturity_instruction_processing('11111111-1111-1111-1111-111111111111', pg_temp.instruction(source), true, gen_random_uuid());
$fn$;
create function pg_temp.confirm_paka(source uuid default '33333333-3333-3333-3333-333333333333') returns void
language sql as $fn$
  select public.confirm_maturity_amounts('22222222-2222-2222-2222-222222222222', pg_temp.instruction(source), gen_random_uuid());
$fn$;

-- Historical paid rows may already have instructions before the new guard.
insert into public.investments (id, investor_id, cycle_id, unit_price_ugx, principal_ugx, projected_return_bps, projected_return_ugx, projected_value_ugx, maturity_date, reservation_expires_at, status, record_origin, payout_basis, reported_return_ugx, reported_payout_ugx)
select id, '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  125000, 250000, 3000, 75000, 325000, (now() - interval '200 days')::date,
  now() - interval '190 days', 'matured', 'portal', 'reported_paid', 75000, 325000
from (values ('66666666-6666-6666-6666-666666666666'::uuid), ('77777777-7777-7777-7777-777777777777'::uuid)) as paid(id);
alter table public.maturity_instructions disable trigger guard_paid_maturity_instruction;
insert into public.maturity_instructions (investment_id, investor_id, choice, status, projected_payout_ugx, projected_reinvest_ugx, payout_destination_id, request_id)
values ('66666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', 'withdraw_all', 'requested', 325000, 0, '99999999-9999-9999-9999-999999999999', gen_random_uuid()),
('77777777-7777-7777-7777-777777777777', '22222222-2222-2222-2222-222222222222', 'withdraw_all', 'processing', 325000, 0, '99999999-9999-9999-9999-999999999999', gen_random_uuid());
alter table public.maturity_instructions enable trigger guard_paid_maturity_instruction;

set local role service_role;
select lives_ok($$select pg_temp.submit_paka(5000000)$$, 'partner example accepted');
select is((select projected_payout_ugx from public.maturity_instructions where id = pg_temp.instruction()), 5000000::numeric, 'example withdrawal is exact');
select is((select projected_reinvest_ugx from public.maturity_instructions where id = pg_temp.instruction()), 940688::numeric, 'example remainder is exact');
select is((select requested_withdrawal_ugx from public.maturity_instructions where id = pg_temp.instruction()), 5000000::numeric, 'requested amount is persisted');
select throws_ok($$select pg_temp.submit_paka(null)$$, '22023', null, 'invalid withdrawal null rejected');
select throws_ok($$select pg_temp.submit_paka(0)$$, '22023', null, 'invalid withdrawal 0 rejected');
select throws_ok($$select pg_temp.submit_paka(-1)$$, '22023', null, 'invalid withdrawal -1 rejected');
select throws_ok($$select pg_temp.submit_paka(5940688)$$, '22023', null, 'invalid withdrawal 5940688 rejected');
select throws_ok($$select pg_temp.submit_paka(6000000)$$, '22023', null, 'invalid withdrawal 6000000 rejected');
select throws_ok($$select pg_temp.submit_paka(5000000.001)$$, '22023', null, 'invalid withdrawal 5000000.001 rejected');
select throws_ok($$select pg_temp.submit_paka('NaN'::numeric)$$, '22023', null, 'invalid withdrawal NaN::numeric rejected');
select throws_ok($$select pg_temp.submit_paka('Infinity'::numeric)$$, '22023', null, 'invalid withdrawal Infinity::numeric rejected');
select throws_ok($$select pg_temp.submit_paka(5815688.01)$$, '22023', null, 'invalid withdrawal 5815688.01 rejected');
select throws_ok($$select pg_temp.submit_paka(14999999.99, true, '44444444-4444-4444-4444-444444444444')$$, '22023', null, 'reinvestment maximum enforced');
select lives_ok($$select pg_temp.submit_paka(5815688)$$, 'minimum remainder accepted');
select lives_ok($$select pg_temp.submit_paka(5000000)$$, 'partner may revise before processing');
select throws_ok($$select pg_temp.submit_paka(5000000, true, partner => '11111111-1111-1111-1111-111111111111')$$, '42501', null, 'another partner cannot submit');
select throws_ok($$select pg_temp.submit_paka(5000000, true, destination => '11111111-1111-1111-1111-111111111111')$$, '42501', null, 'destination ownership is required');
select throws_ok($$select pg_temp.submit_paka(5000000, true, agreement => false)$$, '23514', null, 'cycle agreement remains required');
select throws_ok($$select pg_temp.submit_paka(5000000, true, partner => '11111111-1111-1111-1111-111111111111', request => (select request_id from public.maturity_instructions where id = pg_temp.instruction()))$$, '42501', null, 'idempotent retry cannot cross ownership');
select lives_ok($$select pg_temp.process_paka()$$, 'begin processing locks the choice');
select throws_ok($$select pg_temp.submit_paka(4900000)$$, '23514', null, 'processing instructions cannot be revised');
select is(pg_temp.fulfill_paka(2000000)->>'pending_partner_confirmation', 'true', 'higher actual return requires confirmation');
select is((pg_temp.fulfill_paka(0)->>'proposed_payout_ugx')::numeric, 3846153.85::numeric, 'lower actual return scales the cash amount');
select is((select count(*) from public.investment_receipts where maturity_instruction_id = pg_temp.instruction()), 0::bigint, 'no receipt before partner confirmation');
select is((select fulfilled_investment_id from public.maturity_instructions where id = pg_temp.instruction()), null::uuid, 'no placement before partner confirmation');
select lives_ok($$select pg_temp.confirm_paka()$$, 'partner confirms revised amounts');
select is(pg_temp.fulfill_paka(0)->>'fulfilled', 'true', 'confirmed split fulfills');
select is((select actual_reinvest_ugx from public.maturity_instructions where id = pg_temp.instruction()), 723606.15::numeric, 'actual remainder conserves funds');
select is((select amount_ugx from public.investment_receipts where maturity_instruction_id = pg_temp.instruction()), 723606.15::numeric, 'receipt equals actual reinvestment');
select is(pg_temp.fulfill_paka(0)->>'already_fulfilled', 'true', 'fulfillment retry is idempotent');
select is((select count(*) from public.investment_receipts where maturity_instruction_id = pg_temp.instruction()), 1::bigint, 'retry does not duplicate receipt');
select lives_ok($$select pg_temp.submit_paka(5000000, true, '55555555-5555-5555-5555-555555555555')$$, 'second example submitted');
select pg_temp.process_paka('55555555-5555-5555-5555-555555555555');
select is(pg_temp.fulfill_paka(1370928, '55555555-5555-5555-5555-555555555555')->>'fulfilled', 'true', 'unchanged projection fulfills directly');
select is((select amount_ugx from public.investment_receipts where maturity_instruction_id = pg_temp.instruction('55555555-5555-5555-5555-555555555555')), 940688::numeric, 'partner example receipt is exact');
select lives_ok($$select public.submit_maturity_instruction('22222222-2222-2222-2222-222222222222', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'withdraw_roi_reinvest_principal', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '99999999-9999-9999-9999-999999999999', true, true, gen_random_uuid(), 'old-client', '\x05')$$, 'old app RPC arguments still work');
select is((select requested_withdrawal_ugx from public.maturity_instructions where investment_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'), null::numeric, 'old instructions retain legacy semantics');
select lives_ok($$select pg_temp.submit_paka(37500, true, 'ffffffff-ffff-ffff-ffff-ffffffffffff')$$, 'explicit revision adopts custom terms');
select lives_ok($$select pg_temp.submit_paka(37500, true, 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'withdraw_all')$$, 'switching to full withdrawal works');
select is((select requested_withdrawal_ugx from public.maturity_instructions where investment_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'), null::numeric, 'switching options clears requested withdrawal');
select pg_temp.submit_paka(null, false, 'ffffffff-ffff-ffff-ffff-ffffffffffff');
select pg_temp.process_paka('ffffffff-ffff-ffff-ffff-ffffffffffff');
select is((pg_temp.fulfill_paka(25000, 'ffffffff-ffff-ffff-ffff-ffffffffffff')->>'proposed_payout_ugx')::numeric, 25000::numeric, 'legacy payout follows actual ROI rather than a ratio');
select pg_temp.confirm_paka('ffffffff-ffff-ffff-ffff-ffffffffffff');
select is(pg_temp.fulfill_paka(25000, 'ffffffff-ffff-ffff-ffff-ffffffffffff')->>'fulfilled', 'true', 'legacy fulfillment still works');
select pg_temp.submit_paka(200000, true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
select pg_temp.process_paka('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
select is(pg_temp.fulfill_paka(0, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')->>'held', 'true', 'invalid actual remainder is held before confirmation');
select is((select proposed_actual_roi_ugx from public.maturity_instructions where investment_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'), null::numeric, 'invalid amounts are not offered for confirmation');
select lives_ok($$select pg_temp.submit_paka(15000000, true, '44444444-4444-4444-4444-444444444444')$$, 'maximum remainder accepted');
select pg_temp.process_paka('44444444-4444-4444-4444-444444444444');
update public.investment_cycles set status = 'closed' where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
select is(pg_temp.fulfill_paka(15000000, '44444444-4444-4444-4444-444444444444')->>'reason', 'destination cycle is not open', 'unavailable cycle remains held');
update public.investment_cycles set status = 'open' where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
select is(pg_temp.fulfill_paka(15000000, '44444444-4444-4444-4444-444444444444')->>'reason', 'investor cycle limit exceeded', 'per-partner cycle cap remains enforced');
select ok(not has_function_privilege('anon', 'public.submit_maturity_instruction(uuid,uuid,public.maturity_choice,uuid,uuid,boolean,boolean,uuid,text,bytea,numeric,boolean)', 'EXECUTE'), 'anon cannot invoke submission');
select ok(not has_function_privilege('authenticated', 'public.submit_maturity_instruction(uuid,uuid,public.maturity_choice,uuid,uuid,boolean,boolean,uuid,text,bytea,numeric,boolean)', 'EXECUTE'), 'authenticated role cannot invoke service RPC directly');

select throws_ok($$select pg_temp.submit_paka(150000, true, '66666666-6666-6666-6666-666666666666')$$, '23514', null, 'paid investment cannot submit again');
select throws_ok($$select pg_temp.process_paka('66666666-6666-6666-6666-666666666666')$$, '23514', null, 'paid investment with a stale instruction cannot begin processing');
select throws_ok($$select pg_temp.fulfill_paka(75000, '77777777-7777-7777-7777-777777777777')$$, '23514', null, 'paid investment with a stale processing instruction cannot fulfill');
select ok(position('i.payout_basis <> ''reported_paid''' in pg_get_functiondef('public.run_maintenance(uuid)'::regprocedure)) > 0, 'maintenance excludes independently paid maturities');

reset role;
select * from finish();
rollback;
