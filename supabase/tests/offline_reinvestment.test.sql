begin;
select no_plan();
select ok(not has_function_privilege('anon','public.record_offline_reinvestment(uuid,boolean,uuid,uuid,uuid,text,numeric,date,text,text,text,date,integer,boolean,boolean,boolean)','execute'),'anonymous cannot record offline authority');
select ok(not has_function_privilege('authenticated','public.complete_offline_reinvestment(uuid,boolean,uuid,uuid,text)','execute'),'browser cannot settle directly');
select ok(not (select prosecdef from pg_proc where oid='public.complete_offline_reinvestment(uuid,boolean,uuid,uuid,text)'::regprocedure),'settlement preserves caller privileges');
insert into auth.users(id,email) values ('e1000000-0000-4000-8000-000000000001','offline-admin@test.local'),('e1000000-0000-4000-8000-000000000002','offline-partner@test.local');
insert into public.profiles(id,role,access_status,legal_name,email) values
 ('e1000000-0000-4000-8000-000000000001','admin','active','Offline Admin','offline-admin@test.local'),
 ('e1000000-0000-4000-8000-000000000002','investor','active','Linked Partner','offline-partner@test.local');
insert into public.agreement_versions(id,version,title,template_markdown,content_hash,is_legally_approved,approved_by,approved_at,published_at)
values ('e1000000-0000-4000-8000-000000000003','offline-test','Offline test','Approved fixture terms',repeat('a',64),true,'e1000000-0000-4000-8000-000000000001',now()-interval '10 days',now()-interval '10 days');
insert into public.import_batches(id,source_filename,source_sha256,status,partner_count,profile_count,unclaimed_count,cycle_count,investment_count,monthly_summary_count,principal_total_ugx,return_total_ugx,payout_total_ugx,staged_by,accepted_by,accepted_at)
values ('e1000000-0000-4000-8000-000000000004','offline-test.csv',repeat('b',64),'accepted',2,0,2,1,6,0,780000,234000,1014000,'e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',now());
insert into public.legacy_partner_identities(id,import_batch_id,canonical_name,normalized_phone) values
 ('e1000000-0000-4000-8000-000000000005','e1000000-0000-4000-8000-000000000004','Unclaimed Offline Partner','+256700000005');
insert into public.investment_cycles(id,name,opens_at,closes_at,maturity_date,capacity_ugx,unit_price_ugx,projected_return_bps,status,agreement_version_id,created_by)
values ('e1000000-0000-4000-8000-000000000006','Offline source',now()-interval '300 days',now()-interval '290 days',(date_trunc('month',current_date)-interval '2 months 1 day')::date,300000000,125000,3000,'closed','e1000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000001');
insert into public.investment_cycles(id,name,opens_at,closes_at,maturity_date,capacity_ugx,unit_price_ugx,projected_return_bps,status,agreement_version_id,created_by)
values ('e1000000-0000-4000-8000-000000000007','Offline destination',now()-interval '5 days',now()+interval '5 days',(date_trunc('month',current_date)+interval '7 months' - interval '1 day')::date,300000000,125000,3000,'open','e1000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000001');
insert into public.investments(id,legacy_partner_id,import_batch_id,source_sheet,source_row,source_key,cycle_id,principal_ugx,unit_price_ugx,projected_return_bps,projected_return_ugx,projected_value_ugx,maturity_date,status,record_origin)
select ('e2000000-0000-4000-8000-00000000000'||n)::uuid,'e1000000-0000-4000-8000-000000000005','e1000000-0000-4000-8000-000000000004','Source',n+1,'offline-fixture-'||n,'e1000000-0000-4000-8000-000000000006',130000,125000,3000,39000,169000,(date_trunc('month',current_date)-interval '2 months 1 day')::date,'matured','legacy_import' from generate_series(1,6) n;
select public.record_cycle_actual_return('e1000000-0000-4000-8000-000000000001',true,'e1000000-0000-4000-8000-000000000006',3000,0,6,780000,true,gen_random_uuid());
create function pg_temp.record_authority(p_source integer default 1,p_admin uuid default 'e1000000-0000-4000-8000-000000000001',p_aal boolean default true,p_amount numeric default 169000,p_hash text default repeat('a',64),p_date date default current_date,p_ref text default 'Signed form TEST-001',p_verified boolean default true) returns uuid language sql as $$
 select public.record_offline_reinvestment(p_admin,p_aal,('e3000000-0000-4000-8000-00000000000'||p_source)::uuid,('e2000000-0000-4000-8000-00000000000'||p_source)::uuid,'e1000000-0000-4000-8000-000000000007',p_hash,p_amount,p_date,'signed_document',p_ref,'Identity and external settlement records checked by administrator',(select maturity_date from public.investment_cycles where id='e1000000-0000-4000-8000-000000000007'),3000,p_verified,true,true);
$$;
create function pg_temp.complete_authority(p_source integer default 1,p_confirmation text default 'REINVEST') returns uuid language sql as $$
 select public.complete_offline_reinvestment('e1000000-0000-4000-8000-000000000001',true,gen_random_uuid(),(select id from public.offline_reinvestment_authorizations where investment_id=('e2000000-0000-4000-8000-00000000000'||p_source)::uuid and status<>'revoked'),p_confirmation);
$$;
set local role service_role;
select throws_ok($$select pg_temp.record_authority(p_admin=>'e1000000-0000-4000-8000-000000000002')$$,'42501','Active administrator two-factor authentication required','non-admin rejected');
select throws_ok($$select pg_temp.record_authority(p_aal=>false)$$,'42501','Active administrator two-factor authentication required','AAL1 rejected');
select throws_ok($$select pg_temp.record_authority(p_amount=>168000)$$,'23514','The recorded actual return and authorized full amount must match','amount mismatch rejected');
select throws_ok($$select pg_temp.record_authority(p_hash=>repeat('c',64))$$,'23514','The accepted destination agreement is unavailable or changed','stale agreement rejected');
select throws_ok($$select pg_temp.record_authority(p_date=>(now() at time zone 'Africa/Kampala')::date+1)$$,'22023','Dated offline evidence and verification notes are required','future authorization rejected');
select throws_ok($$select pg_temp.record_authority(p_ref=>'')$$,'22023','Dated offline evidence and verification notes are required','missing evidence rejected');
select throws_ok($$select pg_temp.record_authority(p_verified=>false)$$,'22023','Confirm identity, prior settlement checks, and offline agreement acceptance','identity attestation is required by database');
select lives_ok($$select pg_temp.record_authority()$$,'record specific offline authority without login');
select is((select count(*) from public.offline_reinvestment_authorizations),1::bigint,'one authority recorded');
select is((select investment_count from private.cycle_return_totals('e1000000-0000-4000-8000-000000000006',3000)),6::bigint,'pending offline authority remains in unsettled totals');
select ok(not private.cycle_settlement_started('e1000000-0000-4000-8000-000000000006'),'recording authority does not start financial settlement');
select lives_ok($$select pg_temp.record_authority()$$,'record retry is idempotent');
select is((select count(*) from public.audit_events where action='offline_reinvestment.authorized'),1::bigint,'record retry does not duplicate audit');
select is((select count(*) from public.investments where offline_authorization_id is not null),0::bigint,'recording never activates an investment');
select throws_ok($$update public.offline_reinvestment_authorizations set evidence_reference='Replacement evidence'$$,'55000','Offline authorization evidence is immutable','evidence cannot be overwritten');
select throws_ok($$select pg_temp.complete_authority(p_confirmation=>'')$$,'22023','Type REINVEST to complete','completion requires explicit confirmation');
select lives_ok($$select pg_temp.record_authority(2)$$,'record second request for revocation');
select lives_ok($$select public.revoke_offline_reinvestment('e1000000-0000-4000-8000-000000000001',true,gen_random_uuid(),(select id from public.offline_reinvestment_authorizations where investment_id='e2000000-0000-4000-8000-000000000002'),'Partner withdrew this authorization')$$,'revoke evidence without deleting audit');
select throws_ok($$select public.complete_offline_reinvestment('e1000000-0000-4000-8000-000000000001',true,gen_random_uuid(),(select id from public.offline_reinvestment_authorizations where investment_id='e2000000-0000-4000-8000-000000000002'),'REINVEST')$$,'23514','Offline authorization was revoked','revoked authority cannot settle');
-- Enrollment, archive exclusions, competing instructions, and changed terms.
reset role;
update public.investment_cycles set closes_at=now()-interval '1 day' where id='e1000000-0000-4000-8000-000000000007';
set local role service_role;
select throws_ok($$select pg_temp.record_authority(3)$$,'23514','Record authorization within the open destination enrollment window','cannot backdate evidence into a closed enrollment window');
reset role;
update public.investment_cycles set closes_at=now()+interval '5 days' where id='e1000000-0000-4000-8000-000000000007';
update public.investments set administratively_archived_at=now() where id='e2000000-0000-4000-8000-000000000004';
set local role service_role;
select throws_ok($$select pg_temp.record_authority(4)$$,'23514','An unclaimed, unpaid matured legacy investment is required','archived source is excluded');
reset role;
insert into public.maturity_instructions(investment_id,investor_id,choice,projected_payout_ugx,projected_reinvest_ugx,request_id)
values('e2000000-0000-4000-8000-000000000006','e1000000-0000-4000-8000-000000000002','reinvest_all',0,169000,gen_random_uuid());
set local role service_role;
select throws_ok($$select pg_temp.record_authority(6)$$,'23514','A maturity instruction already exists','offline flow cannot override an existing portal instruction');
reset role;
update public.investment_cycles set maturity_date=(date_trunc('month',maturity_date)+interval '2 months'-interval '1 day')::date where id='e1000000-0000-4000-8000-000000000007';
set local role service_role;
select throws_ok($$select pg_temp.complete_authority()$$,'23514','Destination maturity or projected return changed; review the offline authorization','changed destination terms block settlement');
reset role;
update public.investment_cycles set maturity_date=(select target_maturity_date from public.offline_reinvestment_authorizations where status='recorded') where id='e1000000-0000-4000-8000-000000000007';
set local role service_role;
-- Capacity failures roll back all settlement effects.
reset role;
update public.investment_cycles set capacity_ugx=125000 where id='e1000000-0000-4000-8000-000000000007';
set local role service_role;
select throws_ok($$select pg_temp.complete_authority()$$,'23514','Destination cycle capacity exceeded','capacity rechecked at completion');
select is((select count(*) from public.investments where offline_authorization_id is not null),0::bigint,'capacity rejection creates no partial investment');
reset role;
update public.investment_cycles set capacity_ugx=300000000,status='closed' where id='e1000000-0000-4000-8000-000000000007';
set local role service_role;
select lives_ok($$select pg_temp.complete_authority()$$,'valid recorded enrollment can finish after cycle closure');
select lives_ok($$select pg_temp.complete_authority()$$,'completion retry is idempotent');
select is((select count(*) from public.investments where offline_authorization_id is not null),1::bigint,'exactly one active investment');
select is((select principal_ugx from public.investments where offline_authorization_id is not null),169000::numeric,'full matured value rolled over');
select ok((select import_batch_id is null and source_row is null and source_sheet is null from public.investments where offline_authorization_id is not null),'new placement does not alter the historical import batch');
select is((select count(*) from public.investment_receipts where offline_authorization_id is not null),1::bigint,'exactly one immutable receipt');
select ok((select offline_settlement_id is not null from public.investments where id='e2000000-0000-4000-8000-000000000001'),'source carries a settlement marker for portfolio and reporting');
select ok((select investor_id is null and source='reinvestment' from public.investment_receipts where offline_authorization_id is not null),'receipt does not invent a login');
select is((select count(*) from public.audit_events where action='offline_reinvestment.fulfilled'),1::bigint,'completion audited exactly once');
select ok(private.cycle_settlement_started('e1000000-0000-4000-8000-000000000006'),'offline completion is recognized by shared settlement detection');
select is((select investment_count from private.cycle_return_totals('e1000000-0000-4000-8000-000000000006',3000)),5::bigint,'offline completion removes exactly one source from unsettled totals');
select is((select principal_ugx from private.cycle_return_totals('e1000000-0000-4000-8000-000000000006',3000)),650000::numeric,'unsettled principal excludes the offline-settled source');
select is((select total_value_ugx from private.cycle_return_totals('e1000000-0000-4000-8000-000000000006',3000)),845000::numeric,'unsettled actual value excludes the offline-settled source');
select is((select count(*) from public.jobs where kind='send_email'),0::bigint,'no email sent to a placeholder');
select throws_ok($$select public.revoke_offline_reinvestment('e1000000-0000-4000-8000-000000000001',true,gen_random_uuid(),(select id from public.offline_reinvestment_authorizations where status='fulfilled'),'Try to undo completed investment')$$,'23514','Completed reinvestment cannot be revoked','completed financial records cannot be revoked');
reset role;
select is((select count(*) from auth.users),2::bigint,'no auth account created');
-- Keep a second pending offline authority to test maintenance after claiming.
update public.investment_cycles set status='open' where id='e1000000-0000-4000-8000-000000000007';
select lives_ok($$select pg_temp.record_authority(3)$$,'record pending offline authority before claiming');
-- Later legitimate claiming attaches investments and existing receipt to owner.
insert into auth.users(id,email) values('e1000000-0000-4000-8000-000000000008','claimed-offline@test.local');
select lives_ok($$select public.link_legacy_partner('e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000005','e1000000-0000-4000-8000-000000000008','claimed-offline@test.local','+256700000005','LINK PARTNER',true,gen_random_uuid())$$,'later real account claim succeeds');
select is((select investor_id from public.investment_receipts where offline_authorization_id is not null),'e1000000-0000-4000-8000-000000000008'::uuid,'existing offline receipt follows verified account claim');
select throws_ok($$insert into public.maturity_instructions(investment_id,investor_id,choice,projected_payout_ugx,projected_reinvest_ugx,request_id) values('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000008','reinvest_all',0,169000,gen_random_uuid())$$,'23514','This investment already has an offline reinvestment authorization','portal cannot settle the same source again');
-- A claimed partner with standing terms must not abort the maintenance run.
select public.accept_standing_reinvest_terms('e1000000-0000-4000-8000-000000000008','e1000000-0000-4000-8000-000000000003','fixture',decode('01','hex'),gen_random_uuid());
update public.maturity_policy_gates set enabled=true where name='current_agreement_auto_reinvest';
set local role service_role;
select lives_ok($$select public.run_maintenance(gen_random_uuid())$$,'maintenance completes after offline partner claims account and accepts standing terms');
select is((select count(*) from public.maturity_instructions where investment_id in ('e2000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000003')),0::bigint,'maintenance skips fulfilled and pending offline sources');
select is((select count(*) from public.maturity_instructions where investment_id='e2000000-0000-4000-8000-000000000002'),1::bigint,'revoked offline authority releases the source to automatic instruction creation');
select is((select count(*) from public.audit_events where action='maintenance.completed'),1::bigint,'maintenance transaction and its completion audit persist');
reset role;
select set_config('request.jwt.claims','{"sub":"e1000000-0000-4000-8000-000000000008","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.investments where offline_authorization_id is not null),1::bigint,'claimed partner can read the resulting hybrid investment');
select is((select count(*) from public.investment_receipts where offline_authorization_id is not null),1::bigint,'claimed partner can read the existing receipt');
select is((select count(*) from public.offline_reinvestment_authorizations),0::bigint,'non-admin cannot read offline evidence');
reset role;
select * from finish();
rollback;
