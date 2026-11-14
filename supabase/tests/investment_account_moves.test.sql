begin;
select no_plan();

-- Moving whole investments between a partner's own open accounts.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'move-admin@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'move-partner@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'move-other@test.local');

insert into public.profiles (id, role, access_status, legal_name, email, phone, kyc_status)
values
  ('11111111-1111-1111-1111-111111111111', 'admin', 'active', 'Move Admin', 'move-admin@test.local', '+256700000001', 'verified'),
  ('22222222-2222-2222-2222-222222222222', 'investor', 'active', 'Move Partner', 'move-partner@test.local', '+256700000002', 'verified'),
  ('33333333-3333-3333-3333-333333333333', 'investor', 'active', 'Other Partner', 'move-other@test.local', '+256700000003', 'verified');

insert into public.agreement_versions (id, version, title, template_markdown, content_hash, is_legally_approved, approved_by, approved_at, published_at)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'v-move-test', 'Move Test Agreement', 'Move test terms.',
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', true,
  '11111111-1111-1111-1111-111111111111', now(), now());

insert into public.investment_cycles (id, name, opens_at, closes_at, maturity_date, capacity_ugx, unit_price_ugx, projected_return_bps, status, agreement_version_id, created_by)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Move Cycle', now() - interval '400 days', now() - interval '300 days',
  (date_trunc('month', now() - interval '7 months') + interval '1 month - 1 day')::date, 200000000, 125000, 3000, 'closed',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111');

insert into public.investment_accounts (id, investor_id, name) values
  ('12345678-1234-4234-8234-123456789012', '22222222-2222-2222-2222-222222222222', 'School Fees'),
  ('12345678-1234-4234-8234-123456789013', '22222222-2222-2222-2222-222222222222', 'Retirement');

-- Main Account holds a reserved, an active and a matured investment.
insert into public.investments (id, investor_id, cycle_id, unit_price_ugx, principal_ugx, projected_return_bps, projected_return_ugx, projected_value_ugx, maturity_date, reservation_expires_at, status, record_origin)
values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    125000, 500000, 3000, 150000, 650000, (now() + interval '300 days')::date, now() + interval '1 day', 'reserved', 'portal'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    125000, 1000000, 3000, 300000, 1300000, (now() + interval '300 days')::date, now() + interval '1 day', 'active', 'portal'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    125000, 125000, 3000, 37500, 162500, (now() - interval '200 days')::date, now() - interval '190 days', 'matured', 'portal');

create temp table main_account as
  select id from public.investment_accounts where investor_id = '22222222-2222-2222-2222-222222222222' and is_default;
grant select on main_account to service_role;

select ok(not has_function_privilege('authenticated', 'public.move_investment_account(uuid,uuid,uuid,uuid,uuid)', 'EXECUTE'), 'move RPC is backend-only');
select ok(not has_table_privilege('authenticated', 'public.investment_account_moves', 'INSERT'), 'browser cannot write move history');
select throws_ok($$update public.investments set account_id = '12345678-1234-4234-8234-123456789012' where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'$$,
  '23514', 'investment account cannot be changed', 'direct updates still cannot reassign an investment');

set local role service_role;
select lives_ok($$select public.move_investment_account('22222222-2222-2222-2222-222222222222', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  (select id from main_account), '12345678-1234-4234-8234-123456789012', '99999999-0000-4000-8000-000000000001')$$, 'move an active investment');
select is((select account_id from public.investments where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'), '12345678-1234-4234-8234-123456789012'::uuid, 'active investment now in School Fees');
select ok((select (principal_ugx, projected_return_ugx, projected_value_ugx, maturity_date, status::text)
  = (1000000::numeric, 300000::numeric, 1300000::numeric, (now() + interval '300 days')::date, 'active')
  from public.investments where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'), 'terms, maturity and status are unchanged');
select is((select sum(principal_ugx) from public.investments where investor_id = '22222222-2222-2222-2222-222222222222'), 1625000::numeric, 'combined principal unchanged');
select is((select count(*)::int from public.investment_account_moves where investment_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'), 1, 'move recorded once');
select ok(exists(select 1 from public.audit_events where action = 'investment.account_moved' and entity_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
  and request_id = '99999999-0000-4000-8000-000000000001'), 'move audited');

select is((public.move_investment_account('22222222-2222-2222-2222-222222222222', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  (select id from main_account), '12345678-1234-4234-8234-123456789012', '99999999-0000-4000-8000-000000000001')->>'replayed')::boolean, true, 'retried request replays');
select is((select count(*)::int from public.investment_account_moves where investment_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'), 1, 'retry adds no history');
select throws_ok($$select public.move_investment_account('22222222-2222-2222-2222-222222222222', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  (select id from main_account), '12345678-1234-4234-8234-123456789012', '99999999-0000-4000-8000-000000000001')$$, '23505', 'request already used', 'request ID cannot be reused for another move');
select throws_ok($$select public.move_investment_account('22222222-2222-2222-2222-222222222222', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  (select id from main_account), '12345678-1234-4234-8234-123456789013', gen_random_uuid())$$, '23514', 'investment already moved', 'stale form is rejected');

select lives_ok($$select public.move_investment_account('22222222-2222-2222-2222-222222222222', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  (select id from main_account), '12345678-1234-4234-8234-123456789013', gen_random_uuid())$$, 'move a reserved investment');
select throws_ok($$select public.move_investment_account('22222222-2222-2222-2222-222222222222', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  (select id from main_account), '12345678-1234-4234-8234-123456789012', gen_random_uuid())$$, '55000', 'investment cannot be moved', 'matured investments stay put');
select throws_ok($$select public.move_investment_account('22222222-2222-2222-2222-222222222222', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  '12345678-1234-4234-8234-123456789013', '12345678-1234-4234-8234-123456789013', gen_random_uuid())$$, '23514', 'investment already in account', 'same-account move is rejected');
select throws_ok($$select public.move_investment_account('22222222-2222-2222-2222-222222222222', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  '12345678-1234-4234-8234-123456789013', (select id from public.investment_accounts where investor_id = '33333333-3333-3333-3333-333333333333'), gen_random_uuid())$$,
  '42501', 'investment account unavailable', 'cannot move into another partner''s account');
select throws_ok($$select public.move_investment_account('33333333-3333-3333-3333-333333333333', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  '12345678-1234-4234-8234-123456789013', (select id from public.investment_accounts where investor_id = '33333333-3333-3333-3333-333333333333'), gen_random_uuid())$$,
  '42501', 'investment unavailable', 'cannot move another partner''s investment');

-- An emptied account can archive; an archived account cannot receive moves.
select lives_ok($$select public.move_investment_account('22222222-2222-2222-2222-222222222222', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  '12345678-1234-4234-8234-123456789012', (select id from main_account), gen_random_uuid())$$, 'move back to Main Account');
select lives_ok($$select public.manage_investment_account('22222222-2222-2222-2222-222222222222', 'School Fees', gen_random_uuid(), '12345678-1234-4234-8234-123456789012', true)$$,
  'emptied account archives');
select throws_ok($$select public.move_investment_account('22222222-2222-2222-2222-222222222222', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  (select id from main_account), '12345678-1234-4234-8234-123456789012', gen_random_uuid())$$, '42501', 'investment account unavailable', 'archived account cannot receive moves');
select is((select count(*)::int from public.investment_account_moves where investment_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'), 2, 'history keeps both moves');
reset role;

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
set local role authenticated;
select is((select count(*)::int from public.investment_account_moves), 0, 'partners cannot read others'' move history');
reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
set local role authenticated;
select is((select count(*)::int from public.investment_account_moves), 3, 'partner reads own move history');
reset role;

select * from finish();
rollback;
