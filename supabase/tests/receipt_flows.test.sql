begin;
select plan(50);

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

insert into public.maturity_instructions (id, investment_id, investor_id, choice, status, projected_payout_ugx, projected_reinvest_ugx,
  target_cycle_id, target_agreement_version_id, agreement_accepted, payout_destination_id,
  acceptance_captured_at, acceptance_request_id, acceptance_user_agent, acceptance_ip_fingerprint, request_id)
values
  ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '22222222-2222-2222-2222-222222222222',
    'reinvest_all', 'processing', 0, 325000,
    'cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, null,
    now(), gen_random_uuid(), 'test-agent', '\x05', gen_random_uuid()),
  ('bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', 'ffffffff-ffff-ffff-ffff-ffffffffffff', '22222222-2222-2222-2222-222222222222',
    'withdraw_all', 'processing', 162500, 0,
    null, null, false, '99999999-9999-9999-9999-999999999999',
    null, null, null, null, gen_random_uuid());

-- Everything below runs as service_role, mirroring the application worker.
set local role service_role;

select matches(
  private.allocate_receipt_number(true),
  '^TEST-OURMU-[0-9]{4}-[0-9]{6}$',
  'allocator is executable as service_role and issues test numbers'
);
select matches(
  private.allocate_receipt_number(false),
  '^OURMU-[0-9]{4}-[0-9]{6}$',
  'allocator issues production numbers as service_role'
);

-- Bank activation issues a receipt and queues generation, not a bare email.
select lives_ok($$select public.activate_investment(
  '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'BANKREF-001', 500000, (now() - interval '1 day')::date, 'ACTIVATE', true, gen_random_uuid())$$,
  'bank activation completes as service_role');

select is(
  (select status::text from public.investments where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'active', 'bank activation flips the investment to active');
select is(
  (select count(*)::integer from public.investment_receipts where investment_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  1, 'bank activation creates exactly one receipt');
select is(
  (select source::text from public.investment_receipts where investment_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'bank_activation', 'bank receipt carries the bank_activation source');
select matches(
  (select receipt_number from public.investment_receipts where investment_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  '^OURMU-[0-9]{4}-[0-9]{6}$', 'bank receipt number uses the production series');
select is(
  (select company_name from public.investment_receipts where investment_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'OurMu Ventures Limited', 'bank receipt snapshots the company name');
select is(
  (select company_address from public.investment_receipts where investment_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'Katabbi Town Council, Entebbe, Wakiso', 'bank receipt snapshots the company address');
select is(
  (select account_description from public.investment_receipts where investment_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'Accounts payable — Receipt Partner', 'bank receipt keeps the accounts-payable description');
select is(
  (select amount_ugx::text from public.investment_receipts where investment_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  '500000.00000000', 'bank receipt amount matches the recorded bank amount');
select is(
  (select count(*)::integer from public.jobs where kind = 'generate_receipt_pdf'
    and entity_type = 'investment_receipt'
    and entity_id = (select id from public.investment_receipts where investment_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd')),
  1, 'bank activation queues receipt generation');
select is(
  (select count(*)::integer from public.jobs where kind = 'send_email' and entity_type = 'investment'
    and entity_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    and payload->>'template' = 'investment_activated'),
  0, 'bank activation does not queue a bare activation email');

-- Repeated activation with the same reference is idempotent: no new receipt.
select lives_ok($$select public.activate_investment(
  '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'BANKREF-001', 500000, (now() - interval '1 day')::date, 'ACTIVATE', true, gen_random_uuid())$$,
  'repeated activation with the same reference is accepted');
select is(
  (select count(*)::integer from public.investment_receipts where investment_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  1, 'repeated activation creates no second receipt');

-- Reinvestment fulfillment issues a reinvestment receipt for the rollover.
select ok(
  ((select public.fulfill_maturity_instruction(
    '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
    75000, '', 'FULFILL', true, gen_random_uuid(), false))->>'fulfilled') = 'true',
  'reinvestment fulfillment completes as service_role');
select ok(
  (select fulfilled_investment_id from public.maturity_instructions where id = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa') is not null,
  'fulfillment links the rollover investment');
select is(
  (select count(*)::integer from public.investment_receipts where maturity_instruction_id = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'),
  1, 'reinvestment creates exactly one receipt');
select is(
  (select source::text from public.investment_receipts where maturity_instruction_id = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'),
  'reinvestment', 'rollover receipt carries the reinvestment source');
select is(
  (select amount_ugx::text from public.investment_receipts where maturity_instruction_id = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'),
  '325000.00000000', 'rollover receipt amount equals the actual reinvestment');
select is(
  (select original_investment_id from public.investment_receipts where maturity_instruction_id = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'),
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'rollover receipt references the matured investment');
select is(
  (select company_address from public.investment_receipts where maturity_instruction_id = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'),
  'Katabbi Town Council, Entebbe, Wakiso', 'rollover receipt snapshots the company address');
select is(
  (select count(*)::integer from public.jobs where kind = 'generate_receipt_pdf'
    and entity_id = (select id from public.investment_receipts where maturity_instruction_id = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa')),
  1, 'reinvestment queues receipt generation');
select is(
  (select count(*)::integer from public.jobs where kind = 'send_email'
    and entity_id = (select fulfilled_investment_id from public.maturity_instructions where id = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa')
    and payload->>'template' = 'investment_activated'),
  0, 'reinvestment does not queue a bare activation email');

-- Payout-only fulfillment creates no new receipt.
select ok(
  ((select public.fulfill_maturity_instruction(
    '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb',
    37500, 'EXT-1', 'FULFILL', true, gen_random_uuid(), true))->>'fulfilled') = 'true',
  'payout-only fulfillment completes as service_role');
select is(
  (select count(*)::integer from public.investment_receipts where maturity_instruction_id = 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb'),
  0, 'payout-only fulfillment creates no receipt');
select is(
  (select fulfilled_investment_id from public.maturity_instructions where id = 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb'),
  null, 'payout-only fulfillment links no rollover investment');

-- Receipt business details are immutable once issued.
select throws_ok($$update public.investment_receipts set amount_ugx = 1
  where investment_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'$$,
  '55000', null, 'issued receipt amounts cannot be edited');
select lives_ok($$update public.investment_receipts set pdf_status = 'failed', last_error_code = 'PDF_UPLOAD_FAILED'
  where investment_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'$$,
  'generation fields on a receipt stay writable for retries');

-- On-demand issuance for existing/imported investments.
select is(
  public.ensure_investment_receipt('22222222-2222-2222-2222-222222222222', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  (select id from public.investment_receipts where investment_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'on-demand download reuses the bank receipt even when generation failed');
select is(
  public.ensure_investment_receipt('22222222-2222-2222-2222-222222222222',
    (select fulfilled_investment_id from public.maturity_instructions where id = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa')),
  (select id from public.investment_receipts where maturity_instruction_id = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'),
  'on-demand download reuses the existing reinvestment receipt');

update public.investments set status = 'matured'
where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
select is(
  public.ensure_investment_receipt('22222222-2222-2222-2222-222222222222', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  (select id from public.investment_receipts where investment_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'existing receipts remain retrievable after maturity through the RPC');
select is(
  (select count(*)::integer from public.investment_receipts where investment_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  1, 'retrieving a matured investment receipt does not mint another receipt');

reset role;
insert into public.import_batches (id, source_filename, source_sha256, partner_count, profile_count,
  unclaimed_count, cycle_count, investment_count, monthly_summary_count,
  principal_total_ugx, return_total_ugx, payout_total_ugx, staged_by)
values ('71000000-0000-4000-8000-000000000001', 'receipt-fixture.xlsx', repeat('7', 64),
  1, 1, 0, 1, 1, 0, 10000000, 3000000, 13000000, '11111111-1111-1111-1111-111111111111');
insert into public.legacy_partner_identities (id, import_batch_id, profile_id, canonical_name)
values ('71000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001',
  '22222222-2222-2222-2222-222222222222', 'Receipt Partner');
insert into public.investments (id, investor_id, cycle_id, principal_ugx, unit_price_ugx,
  projected_return_bps, projected_return_ugx, projected_value_ugx, maturity_date,
  status, record_origin, import_batch_id, legacy_partner_id, source_sheet, source_row, source_key,
  requested_at, reservation_expires_at)
values ('71000000-0000-4000-8000-000000000003', '22222222-2222-2222-2222-222222222222',
  'cccccccc-cccc-cccc-cccc-cccccccccccc', 10000000, 125000, 3000, 3000000, 13000000,
  (now() + interval '6 months')::date, 'active', 'legacy_import',
  '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002',
  'Reinvestments', 2, 'receipt-import-fixture', '2026-09-01 00:00:00+03', null);
insert into public.investments (id, investor_id, cycle_id, principal_ugx, unit_price_ugx,
  projected_return_bps, projected_return_ugx, projected_value_ugx, maturity_date,
  status, record_origin, reservation_expires_at)
select ('71000000-0000-4000-8000-00000000000' || n)::uuid,
  '22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  125000.12, 125000, 3000, 37500.036, 162500.156, (now() + interval '6 months')::date,
  st::public.investment_status, 'portal', now() + interval '1 day'
from (values (4, 'active'), (5, 'reserved'), (6, 'expired'), (7, 'cancelled')) f(n, st);
set local role service_role;

select lives_ok($$select public.ensure_investment_receipt('22222222-2222-2222-2222-222222222222',
  '71000000-0000-4000-8000-000000000003')$$, 'imported active investment can issue a receipt');
select is((select source::text from public.investment_receipts where investment_id = '71000000-0000-4000-8000-000000000003'),
  'investment_record', 'imported receipt acknowledges the record without inventing bank/rollover evidence');
select is((select amount_ugx::text from public.investment_receipts where investment_id = '71000000-0000-4000-8000-000000000003'),
  '10000000.00000000', 'imported receipt has the actual principal');
select is((select transaction_date from public.investment_receipts where investment_id = '71000000-0000-4000-8000-000000000003'),
  '2026-09-01'::date, 'imported receipt uses the recorded investment date in Kampala');
select is((select partner_name from public.investment_receipts where investment_id = '71000000-0000-4000-8000-000000000003'),
  'Receipt Partner', 'receipt snapshots the authenticated investment owner');
select is(public.ensure_investment_receipt('22222222-2222-2222-2222-222222222222', '71000000-0000-4000-8000-000000000003'),
  (select id from public.investment_receipts where investment_id = '71000000-0000-4000-8000-000000000003'),
  'repeated downloads retain the same receipt ID and number');
select is((select count(*)::integer from public.jobs where entity_id in
  ('71000000-0000-4000-8000-000000000003'::uuid,
   (select id from public.investment_receipts where investment_id = '71000000-0000-4000-8000-000000000003'))),
  0, 'on-demand receipts queue no activation emails or background jobs');
select lives_ok($$select public.ensure_investment_receipt('22222222-2222-2222-2222-222222222222',
  '71000000-0000-4000-8000-000000000004')$$, 'old portal active investment without payment links can issue a receipt');
select is((select amount_ugx::text from public.investment_receipts where investment_id = '71000000-0000-4000-8000-000000000004'),
  '125000.12000000', 'on-demand receipt preserves fractional principal');
select throws_ok($$select public.ensure_investment_receipt('11111111-1111-1111-1111-111111111111',
  '71000000-0000-4000-8000-000000000003')$$, 'P0002', null, 'another investor cannot issue or retrieve the receipt');
select throws_ok($$select public.ensure_investment_receipt('22222222-2222-2222-2222-222222222222',
  '71000000-0000-4000-8000-000000000005')$$, '23514', null, 'unpaid reservation cannot issue a receipt');
select throws_ok($$select public.ensure_investment_receipt('22222222-2222-2222-2222-222222222222',
  '71000000-0000-4000-8000-000000000006')$$, '23514', null, 'expired reservation cannot issue a receipt');
select throws_ok($$select public.ensure_investment_receipt('22222222-2222-2222-2222-222222222222',
  '71000000-0000-4000-8000-000000000007')$$, '23514', null, 'cancelled reservation cannot issue a receipt');
select throws_ok($$select public.ensure_investment_receipt('22222222-2222-2222-2222-222222222222',
  'ffffffff-ffff-ffff-ffff-ffffffffffff')$$, '23514', null, 'payout-only matured record still does not issue a missing receipt');
select throws_ok($$update public.investment_receipts set transaction_date = current_date
  where investment_id = '71000000-0000-4000-8000-000000000003'$$,
  '55000', null, 'imported receipt business details are immutable');
select ok(not has_function_privilege('anon', 'public.ensure_investment_receipt(uuid,uuid)', 'EXECUTE'),
  'anonymous users cannot invoke privileged issuance');
select ok(not has_function_privilege('authenticated', 'public.ensure_investment_receipt(uuid,uuid)', 'EXECUTE'),
  'browser clients cannot spoof the investor ID to invoke issuance');

reset role;
select * from finish();
rollback;
