begin;
select no_plan();

-- Cycle-wide actual returns: authorization, validation, precision, included
-- records, Kampala timing, stale protection, settlement blocking, actual-based
-- choices, legacy projection confirmations and automatic reinvestment.

-- Privileges -----------------------------------------------------------------
select ok(not has_function_privilege('anon','public.record_cycle_actual_return(uuid,boolean,uuid,integer,integer,bigint,numeric,boolean,uuid)','execute'),'anonymous cannot record actual returns');
select ok(not has_function_privilege('authenticated','public.record_cycle_actual_return(uuid,boolean,uuid,integer,integer,bigint,numeric,boolean,uuid)','execute'),'browser roles cannot record actual returns');
select ok(has_function_privilege('service_role','public.record_cycle_actual_return(uuid,boolean,uuid,integer,integer,bigint,numeric,boolean,uuid)','execute'),'trusted server can record actual returns');
select ok(not has_function_privilege('authenticated','public.preview_cycle_actual_return(uuid,boolean,uuid,integer)','execute'),'browser roles cannot preview actual returns');
select ok(not (select prosecdef from pg_proc where oid='public.record_cycle_actual_return(uuid,boolean,uuid,integer,integer,bigint,numeric,boolean,uuid)'::regprocedure),'record RPC retains caller privileges');

-- Kampala timing ---------------------------------------------------------------
select ok(not private.cycle_actual_return_locked('2026-10-31','2026-10-30 20:59:59+00'),'editable until 23:59:59 Kampala the day before maturity');
select ok(private.cycle_actual_return_locked('2026-10-31','2026-10-30 21:00:00+00'),'locked from Kampala midnight on the maturity date');
select is(private.kampala_date('2026-10-30 21:00:00+00'),'2026-10-31'::date,'Kampala dates are UTC+3');

-- Fixtures ---------------------------------------------------------------------
alter table public.investment_cycles disable trigger cycle_maturity_day_guard;
insert into auth.users(id,email) values
 ('ca000000-0000-4000-8000-000000000001','actual-admin@test.local'),
 ('ca000000-0000-4000-8000-000000000002','actual-partner@test.local'),
 ('ca000000-0000-4000-8000-000000000003','actual-test-partner@test.local');
insert into public.profiles(id,role,access_status,legal_name,email,phone,kyc_status,is_test) values
 ('ca000000-0000-4000-8000-000000000001','admin','active','Actual Admin','actual-admin@test.local','+256700000301','verified',false),
 ('ca000000-0000-4000-8000-000000000002','investor','active','Actual Partner','actual-partner@test.local','+256700000302','verified',false),
 ('ca000000-0000-4000-8000-000000000003','investor','active','Actual Test Partner','actual-test-partner@test.local','+256700000303','verified',true);
insert into public.agreement_versions(id,version,title,template_markdown,content_hash,is_legally_approved,approved_by,approved_at,published_at)
values('ca000000-0000-4000-8000-000000000010','actual-return-test','Actual Return Agreement','Terms',repeat('c',64),true,'ca000000-0000-4000-8000-000000000001',now(),now());
insert into public.payout_destinations(id,investor_id,channel,provider_label,account_name,account_ref_ciphertext,account_ref_iv,account_ref_auth_tag,account_ref_fingerprint,account_last_four,key_version)
values('ca000000-0000-4000-8000-000000000020','ca000000-0000-4000-8000-000000000002','bank','Test Bank','Actual Partner','\x01','\x02','\x03','\x04','0302',1);

create function pg_temp.cycle(p_id text,p_name text,p_maturity date,p_status public.cycle_status default 'closed',p_opens timestamptz default now()-interval '200 days',p_closes timestamptz default now()-interval '190 days') returns void language sql as $$
 insert into public.investment_cycles(id,name,opens_at,closes_at,maturity_date,capacity_ugx,unit_price_ugx,projected_return_bps,status,agreement_version_id,created_by,record_origin)
 values(('ca000000-0000-4000-8000-0000000001'||p_id)::uuid,p_name,p_opens,p_closes,p_maturity,500000000,125000,3000,p_status,'ca000000-0000-4000-8000-000000000010','ca000000-0000-4000-8000-000000000001','portal');
$$;
create function pg_temp.c(p_id text) returns uuid language sql as $$ select ('ca000000-0000-4000-8000-0000000001'||p_id)::uuid $$;
create function pg_temp.i(p_id text) returns uuid language sql as $$ select ('ca000000-0000-4000-8000-0000000002'||p_id)::uuid $$;
create function pg_temp.investment(p_id text,p_cycle text,p_principal numeric,p_status public.investment_status,p_investor text default '02') returns void language sql as $$
 insert into public.investments(id,investor_id,cycle_id,unit_price_ugx,principal_ugx,projected_return_bps,projected_return_ugx,projected_value_ugx,maturity_date,reservation_expires_at,status,record_origin,activated_at,matured_at)
 select pg_temp.i(p_id),('ca000000-0000-4000-8000-0000000000'||p_investor)::uuid,c.id,125000,p_principal,3000,
  round(p_principal*3000/10000.0,8),p_principal+round(p_principal*3000/10000.0,8),c.maturity_date,
  case when p_status='reserved' then now()+interval '1 day' end,p_status,'portal',
  case when p_status in ('active','matured') then now()-interval '180 days' end,
  case when p_status='matured' then now()-interval '1 day' end
 from public.investment_cycles c where c.id=pg_temp.c(p_cycle);
$$;
create function pg_temp.record(p_cycle uuid,p_bps integer,p_revision integer default null,p_count bigint default null,p_principal numeric default null,p_admin uuid default 'ca000000-0000-4000-8000-000000000001',p_aal2 boolean default true,p_confirmed boolean default true,p_request uuid default gen_random_uuid()) returns jsonb language plpgsql as $$
declare v jsonb;
begin
 select public.preview_cycle_actual_return('ca000000-0000-4000-8000-000000000001',true,p_cycle,p_bps) into v;
 return public.record_cycle_actual_return(p_admin,p_aal2,p_cycle,p_bps,
  coalesce(p_revision,(v->>'actual_return_revision')::integer),
  coalesce(p_count,(v->>'investment_count')::bigint),
  coalesce(p_principal,(v->>'principal_ugx')::numeric),p_confirmed,p_request);
end;
$$;

-- Open target cycle for reinvestments.
select pg_temp.cycle('01','Actual Open',(date_trunc('month',now()+interval '6 months')+interval '1 month - 1 day')::date,'open',now()-interval '1 day',now()+interval '30 days');
-- Future maturity: editable.
select pg_temp.cycle('02','Actual Future',(date_trunc('month',now()+interval '2 months')+interval '1 month - 1 day')::date);
select pg_temp.investment('01','02',333333.33,'active');
select pg_temp.investment('02','02',125000,'active');
select pg_temp.investment('03','02',500000,'reserved');
select pg_temp.investment('04','02',250000,'expired');
select pg_temp.investment('05','02',375000,'cancelled');
select pg_temp.investment('06','02',250000,'active','03');
-- Maturity today in Kampala with a recorded rate: locked.
select pg_temp.cycle('03','Actual Locked',private.kampala_date());
select pg_temp.investment('07','03',125000,'active');
select set_config('ourmu.recording_cycle_actual_return','on',true);
update public.investment_cycles set actual_return_bps=2500,actual_return_recorded_at=now()-interval '2 days',
 actual_return_recorded_by='ca000000-0000-4000-8000-000000000001',actual_return_revision=1 where id=pg_temp.c('03');
select set_config('ourmu.recording_cycle_actual_return','off',true);
-- Matured and payable, rate missing: one late entry allowed.
select pg_temp.cycle('04','Actual Past',(date_trunc('month',current_date-interval '1 month')-interval '1 day')::date);
select pg_temp.investment('10','04',1000000,'matured');
select pg_temp.investment('11','04',500000,'matured');
select pg_temp.investment('12','04',1250000,'matured');
select pg_temp.investment('13','04',2000000,'matured');
select pg_temp.investment('14','04',750000,'matured');
insert into public.investments(id,investor_id,cycle_id,unit_price_ugx,principal_ugx,projected_return_bps,projected_return_ugx,projected_value_ugx,maturity_date,status,record_origin,payout_basis,reported_return_ugx,reported_payout_ugx,activated_at,matured_at)
select pg_temp.i('15'),'ca000000-0000-4000-8000-000000000002',pg_temp.c('04'),125000,4000000,3000,1200000,5200000,maturity_date,'matured','portal','reported_paid',1200000,5200000,now()-interval '200 days',now()-interval '10 days'
from public.investment_cycles where id=pg_temp.c('04');
-- Settled without a rate, legacy-flagged, draft, and maturing tomorrow.
select pg_temp.cycle('05','Actual Settled',(date_trunc('month',current_date-interval '1 month')-interval '1 day')::date);
select pg_temp.investment('20','05',125000,'matured');
insert into public.maturity_instructions(investment_id,investor_id,choice,status,projected_payout_ugx,projected_reinvest_ugx,actual_roi_ugx,actual_payout_ugx,actual_reinvest_ugx,fulfilled_at,request_id)
values(pg_temp.i('20'),'ca000000-0000-4000-8000-000000000002','withdraw_all','fulfilled',162500,0,37500,162500,0,now(),gen_random_uuid());
select pg_temp.cycle('06','Actual Legacy',(date_trunc('month',current_date-interval '1 month')-interval '1 day')::date);
select set_config('ourmu.recording_cycle_actual_return','on',true);
update public.investment_cycles set legacy_settlement=true where id=pg_temp.c('06');
select set_config('ourmu.recording_cycle_actual_return','off',true);
select pg_temp.cycle('07','Actual Draft',(date_trunc('month',now()+interval '8 months')+interval '1 month - 1 day')::date,'draft',now()+interval '100 days',now()+interval '120 days');
select pg_temp.cycle('08','Actual Tomorrow',private.kampala_date()+1);
select pg_temp.investment('08','08',125000,'active');

-- Direct writes are refused --------------------------------------------------------
select throws_ok($$update public.investment_cycles set actual_return_bps=4000 where id=pg_temp.c('02')$$,'55000','actual returns are recorded only through record_cycle_actual_return','direct rate writes are refused');
select throws_ok($$update public.investment_cycles set legacy_settlement=true where id=pg_temp.c('02')$$,'55000','legacy settlement flags are immutable','legacy flags are immutable');

set local role service_role;

-- Authorization and validation -----------------------------------------------------
select throws_ok($$select pg_temp.record(pg_temp.c('02'),2735,p_admin=>'ca000000-0000-4000-8000-000000000002')$$,'42501','Active administrator two-factor authentication required','non-admin rejected');
select throws_ok($$select pg_temp.record(pg_temp.c('02'),2735,p_aal2=>false)$$,'42501','Active administrator two-factor authentication required','admin without MFA rejected');
select throws_ok($$select public.preview_cycle_actual_return('ca000000-0000-4000-8000-000000000001',false,pg_temp.c('02'),2735)$$,'42501',null,'preview requires MFA');
select throws_ok($$select public.record_cycle_actual_return('ca000000-0000-4000-8000-000000000001',true,pg_temp.c('02'),-1,0,2,458333.33,true,gen_random_uuid())$$,'22023',null,'negative returns rejected');
select throws_ok($$select public.record_cycle_actual_return('ca000000-0000-4000-8000-000000000001',true,pg_temp.c('02'),100001,0,2,458333.33,true,gen_random_uuid())$$,'22023',null,'returns above 1,000% rejected');
select throws_ok($$select public.record_cycle_actual_return('ca000000-0000-4000-8000-000000000001',true,pg_temp.c('02'),null,0,2,458333.33,true,gen_random_uuid())$$,'22023',null,'missing rate rejected');
select throws_ok($$select pg_temp.record(pg_temp.c('02'),2735,p_confirmed=>false)$$,'22023','confirm the actual return and its affected totals before saving','explicit confirmation required');
select throws_ok($$select pg_temp.record(pg_temp.c('07'),2735)$$,'23514','the actual return can only be recorded for a funded cycle','draft cycles rejected');

-- Preview: included records and precision -------------------------------------------
select is((public.preview_cycle_actual_return('ca000000-0000-4000-8000-000000000001',true,pg_temp.c('02'),2735)->>'investment_count')::bigint,2::bigint,'only funded real investments counted');
select is((public.preview_cycle_actual_return('ca000000-0000-4000-8000-000000000001',true,pg_temp.c('02'),2735)->>'test_investment_count')::bigint,1::bigint,'test placements counted separately');
select is((public.preview_cycle_actual_return('ca000000-0000-4000-8000-000000000001',true,pg_temp.c('02'),2735)->>'principal_ugx')::numeric,458333.33::numeric,'reservations, expired and cancelled excluded from principal');
select is((public.preview_cycle_actual_return('ca000000-0000-4000-8000-000000000001',true,pg_temp.c('02'),2735)->>'actual_profit_ugx')::numeric,125354.165755::numeric,'actual profit sums individually rounded amounts');
select is((public.preview_cycle_actual_return('ca000000-0000-4000-8000-000000000001',true,pg_temp.c('02'),2735)->>'total_value_ugx')::numeric,583687.495755::numeric,'total value is principal plus actual profit');
select is((public.preview_cycle_actual_return('ca000000-0000-4000-8000-000000000001',true,pg_temp.c('02'),2735)->>'difference_from_projection_ugx')::numeric,-12145.833245::numeric,'difference from projection');
select is(private.cycle_actual_return_ugx(333333.33,2735),91166.66575500::numeric,'per-investment profit at eight-decimal scale');
select is((public.preview_cycle_actual_return('ca000000-0000-4000-8000-000000000001',true,pg_temp.c('02'),null)->>'actual_profit_ugx'),null,'no actual totals without a rate');
select ok((public.preview_cycle_actual_return('ca000000-0000-4000-8000-000000000001',true,pg_temp.c('08'),null)->>'required')::boolean,'missing rate flagged from the day before maturity');
select ok(not (public.preview_cycle_actual_return('ca000000-0000-4000-8000-000000000001',true,pg_temp.c('02'),null)->>'required')::boolean,'future cycles are not yet flagged');
select ok(not (public.preview_cycle_actual_return('ca000000-0000-4000-8000-000000000001',true,pg_temp.c('06'),null)->>'required')::boolean,'legacy cycles are not flagged');
select ok(not (public.preview_cycle_actual_return('ca000000-0000-4000-8000-000000000001',true,pg_temp.c('05'),null)->>'required')::boolean,'settled cycles are not flagged');

-- Recording and revising before maturity ------------------------------------------------
select is((pg_temp.record(pg_temp.c('02'),0)->>'actual_profit_ugx')::numeric,0::numeric,'zero percent return recorded');
select is((select actual_return_bps from public.investment_cycles where id=pg_temp.c('02')),0,'zero rate stored');
select throws_ok($$select pg_temp.record(pg_temp.c('02'),2735,p_revision=>0)$$,'40001',null,'stale revision rejected');
select throws_ok($$select pg_temp.record(pg_temp.c('02'),2735,p_count=>3)$$,'40001',null,'stale investment set rejected');
select throws_ok($$select pg_temp.record(pg_temp.c('02'),2735,p_principal=>458333.34)$$,'40001',null,'stale principal rejected');
select lives_ok($$select pg_temp.record(pg_temp.c('02'),2735,p_request=>'ca000000-0000-4000-8000-000000000999')$$,'revision before maturity accepted');
select ok((pg_temp.record(pg_temp.c('02'),9999,p_revision=>1,p_request=>'ca000000-0000-4000-8000-000000000999')->>'replayed')::boolean,'retried request replays without reapplying');
select is((select actual_return_bps||'/'||actual_return_revision from public.investment_cycles where id=pg_temp.c('02')),'2735/2','rate and revision updated once');
select ok((pg_temp.record(pg_temp.c('02'),2735)->>'unchanged')::boolean,'resaving the same rate is a no-op');
select is((select count(*) from public.audit_events where entity_id=pg_temp.c('02') and action='cycle.actual_return_recorded'),2::bigint,'each change audited once');
select is((select metadata->>'previous_actual_return_bps'||'>'||(metadata->>'actual_return_bps')||'@'||actor_id from public.audit_events where entity_id=pg_temp.c('02') and action='cycle.actual_return_recorded' order by (metadata->>'actual_return_revision')::int desc limit 1),'0>2735@ca000000-0000-4000-8000-000000000001','audit records administrator and previous/new rate');
select is((select (metadata->>'actual_profit_ugx')::numeric from public.audit_events where entity_id=pg_temp.c('02') and action='cycle.actual_return_recorded' order by (metadata->>'actual_return_revision')::int desc limit 1),125354.165755::numeric,'audit records affected totals');
select is((select count(*) from public.investments where cycle_id=pg_temp.c('02') and status='active'),3::bigint,'recording a return does not mature investments');
select is((select count(*) from public.jobs where entity_id in (select id from public.investments where cycle_id=pg_temp.c('02'))),0::bigint,'recording a return queues no payments or emails');

-- Lock at maturity, settled and legacy cycles --------------------------------------------
select throws_ok($$select pg_temp.record(pg_temp.c('03'),2600)$$,'23514','the actual return is locked at maturity and can no longer be revised','revision rejected at maturity');
select throws_ok($$select pg_temp.record(pg_temp.c('05'),2600)$$,'23514',null,'cycles with settled investments rejected');
select throws_ok($$select pg_temp.record(pg_temp.c('06'),2600)$$,'23514',null,'legacy-settlement cycles keep per-investment workflow');
select is(public.preview_cycle_actual_return('ca000000-0000-4000-8000-000000000001',true,pg_temp.c('06'),null)->>'blocked_reason','legacy_settlement','legacy cycles are flagged for admins');

-- Missing rate blocks settlement ------------------------------------------------------------
create function pg_temp.submit(p_source text,p_choice public.maturity_choice,p_withdrawal numeric default null) returns uuid language sql as $$
 select public.submit_maturity_instruction('ca000000-0000-4000-8000-000000000002',pg_temp.i(p_source),p_choice,
  case when p_choice='withdraw_all' then null else pg_temp.c('01') end,
  case when p_choice='reinvest_all' then null else 'ca000000-0000-4000-8000-000000000020'::uuid end,
  p_choice<>'withdraw_all',true,gen_random_uuid(),'test-agent','\x05',p_withdrawal,p_withdrawal is not null,
  case when p_choice='withdraw_all' then null else 'ca000000-0000-4000-8000-000000000010'::uuid end);
$$;
create function pg_temp.mi(p_source text) returns uuid language sql as $$ select id from public.maturity_instructions where investment_id=pg_temp.i(p_source) $$;
create function pg_temp.begin(p_source text) returns void language sql as $$
 select public.begin_maturity_instruction_processing('ca000000-0000-4000-8000-000000000001',pg_temp.mi(p_source),true,gen_random_uuid());
$$;
create function pg_temp.fulfill(p_source text,p_roi numeric default null) returns jsonb language sql as $$
 select public.fulfill_maturity_instruction('ca000000-0000-4000-8000-000000000001',pg_temp.mi(p_source),p_roi,'ACTUAL-REF','FULFILL',true,gen_random_uuid(),true);
$$;

select lives_ok($$select pg_temp.submit('12','withdraw_all')$$,'choice before the rate uses the projection');
select is((select amount_basis||':'||projected_payout_ugx::numeric(28,2) from public.maturity_instructions where id=pg_temp.mi('12')),'projected:1625000.00','projection basis stored explicitly');
select lives_ok($$select pg_temp.begin('12')$$,'processing can begin while the rate is missing');
select throws_ok($$select pg_temp.fulfill('12',375000)$$,'23514','the actual return for this cycle is pending; settlement is blocked until it is recorded','fulfillment blocked while the rate is missing');
reset role;
update public.maturity_policy_gates set enabled=true where name='current_agreement_auto_reinvest';
insert into public.maturity_reinvest_authorizations(investor_id,agreement_version_id,accepted_content_hash,accepted_user_agent,accepted_ip_fingerprint,acceptance_request_id)
values('ca000000-0000-4000-8000-000000000002','ca000000-0000-4000-8000-000000000010',repeat('c',64),'test-agent','\x05',gen_random_uuid());
set local role service_role;
select ok((public.run_maintenance(gen_random_uuid())->>'awaiting_actual_return')::int >= 3,'maintenance reports maturities awaiting a rate');
select is((select count(*) from public.maturity_instructions where investment_id=pg_temp.i('14')),0::bigint,'no automatic reinvestment while the rate is missing');

-- One late first entry -------------------------------------------------------------------------
select ok((pg_temp.record(pg_temp.c('04'),2735)->>'late_entry')::boolean,'missing rate can be entered once after maturity');
select ok((select actual_return_late_entry from public.investment_cycles where id=pg_temp.c('04')),'late entry recorded');
select is((select count(*) from public.investments where cycle_id=pg_temp.c('04') and payout_basis='reported_paid' and status='matured'),1::bigint,'paid history untouched');
select throws_ok($$select pg_temp.record(pg_temp.c('04'),2800)$$,'23514','the actual return is locked at maturity and can no longer be revised','late entry is not revisable');

-- Actual-based choices fulfil without redundant confirmation -------------------------------------
select lives_ok($$select pg_temp.submit('10','withdraw_all')$$,'withdraw-all choice on the actual rate');
select is((select amount_basis||':'||basis_actual_return_bps||':'||projected_payout_ugx::numeric(28,2) from public.maturity_instructions where id=pg_temp.mi('10')),'actual:2735:1273500.00','actual basis and amount stored');
select throws_ok($$select pg_temp.submit('13','withdraw_roi_reinvest_principal',2547000)$$,'22023',null,'custom withdrawal validated against the actual total, not the larger projection');
select lives_ok($$select pg_temp.submit('13','withdraw_roi_reinvest_principal',547000)$$,'custom withdrawal on the actual total');
select is((select projected_reinvest_ugx::numeric(28,2) from public.maturity_instructions where id=pg_temp.mi('13')),2000000.00::numeric,'custom split uses the actual total');
select lives_ok($$select pg_temp.submit('11','reinvest_all')$$,'reinvest-all choice on the actual rate');
select lives_ok($$select pg_temp.begin('10')$$,'begin withdraw-all');
select throws_ok($$select pg_temp.fulfill('10',273500.01)$$,'40001',null,'stale per-investment ROI rejected');
select is(pg_temp.fulfill('10')->>'fulfilled','true','actual-based choice fulfilled without confirmation');
select is((select actual_roi_ugx::numeric(28,2)||'/'||actual_payout_ugx::numeric(28,2) from public.maturity_instructions where id=pg_temp.mi('10')),'273500.00/1273500.00','fulfilled with the cycle rate');
select lives_ok($$select pg_temp.begin('13')$$,'begin custom split');
select is(pg_temp.fulfill('13',547000)->>'fulfilled','true','matching submitted ROI accepted');
select is((select actual_payout_ugx::numeric(28,2)||'/'||actual_reinvest_ugx::numeric(28,2) from public.maturity_instructions where id=pg_temp.mi('13')),'547000.00/2000000.00','custom withdrawal honoured exactly');
select lives_ok($$select pg_temp.begin('11')$$,'begin reinvestment');
select is(pg_temp.fulfill('11')->>'fulfilled','true','reinvestment fulfilled on the actual rate');
select is((select principal_ugx::numeric(28,2) from public.investments where id=(select fulfilled_investment_id from public.maturity_instructions where id=pg_temp.mi('11'))),636750.00::numeric,'reinvested principal includes actual profit');

-- Projection-based choices keep the revised-amount confirmation -----------------------------------
select is(pg_temp.fulfill('12')->>'pending_partner_confirmation','true','projection-based choice needs partner confirmation');
select is((select proposed_actual_roi_ugx::numeric(28,2) from public.maturity_instructions where id=pg_temp.mi('12')),341875.00::numeric,'proposal uses the cycle rate');
select lives_ok($$select public.confirm_maturity_amounts('ca000000-0000-4000-8000-000000000002',pg_temp.mi('12'),gen_random_uuid())$$,'partner confirms revised amounts');
select is(pg_temp.fulfill('12')->>'fulfilled','true','confirmed projection-based choice fulfilled');
select is((select actual_payout_ugx::numeric(28,2) from public.maturity_instructions where id=pg_temp.mi('12')),1591875.00::numeric,'paid on the actual return');

-- Standing reinvestment uses the actual rate ----------------------------------------------------
select lives_ok($$select public.run_maintenance(gen_random_uuid())$$,'maintenance runs after the rate exists');
select is((select amount_basis||':'||projected_reinvest_ugx::numeric(28,2) from public.maturity_instructions where investment_id=pg_temp.i('14')),'actual:955125.00','automatic reinvestment on the actual rate');
select throws_ok($$select pg_temp.record(pg_temp.c('04'),2735,p_revision=>1)$$,'23514',null,'settled cycles cannot be re-recorded');

-- Investors see the recorded rate immediately -----------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ca000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select actual_return_bps from public.investment_cycles where id=pg_temp.c('02')),2735,'investor reads the published rate');
reset role;

alter table public.investment_cycles enable trigger cycle_maturity_day_guard;
select * from finish();
rollback;
