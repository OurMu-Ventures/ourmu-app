begin;
select no_plan();
select ok(not has_function_privilege('anon','public.save_admin_maturity_payout_destination(uuid,boolean,uuid,uuid,text,text,timestamptz,jsonb)','execute'),'anonymous cannot set destinations');
select ok(not has_function_privilege('authenticated','public.save_admin_maturity_payout_destination(uuid,boolean,uuid,uuid,text,text,timestamptz,jsonb)','execute'),'browser roles cannot set destinations directly');
select ok(has_function_privilege('service_role','public.save_admin_maturity_payout_destination(uuid,boolean,uuid,uuid,text,text,timestamptz,jsonb)','execute'),'trusted server can call RPC');
select ok(not (select prosecdef from pg_proc where oid='public.save_admin_maturity_payout_destination(uuid,boolean,uuid,uuid,text,text,timestamptz,jsonb)'::regprocedure),'RPC retains caller privileges');
insert into auth.users(id,email) values
 ('50000000-0000-4000-8000-000000000001','payout-admin@test.local'),
 ('50000000-0000-4000-8000-000000000002','payout-partner@test.local');
insert into public.profiles(id,role,access_status,legal_name,email,phone,kyc_status) values
 ('50000000-0000-4000-8000-000000000001','admin','active','Payout Admin','payout-admin@test.local','+256700000001','verified'),
 ('50000000-0000-4000-8000-000000000002','investor','active','Payout Partner','payout-partner@test.local','+256700001234','verified');
insert into public.agreement_versions(id,version,title,template_markdown,content_hash,is_legally_approved,approved_by,approved_at,published_at)
values('50000000-0000-4000-8000-000000000003','admin-payout-test','Test Agreement','Test terms',repeat('a',64),true,'50000000-0000-4000-8000-000000000001',now(),now());
insert into public.investment_cycles(id,name,opens_at,closes_at,maturity_date,capacity_ugx,unit_price_ugx,projected_return_bps,status,agreement_version_id,created_by,record_origin)
values('50000000-0000-4000-8000-000000000004','Payout Test Cycle',now()-interval '200 days',now()-interval '190 days',(date_trunc('month',current_date)-interval '1 day')::date,200000000,125000,3000,'closed','50000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000001','portal');
insert into public.investments(id,investor_id,cycle_id,principal_ugx,unit_price_ugx,projected_return_bps,projected_return_ugx,projected_value_ugx,maturity_date,status,record_origin)
select ('60000000-0000-4000-8000-00000000000'||n)::uuid,'50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000004',5000000,125000,3000,1500000,6500000,(date_trunc('month',current_date)-interval '1 day')::date,'matured','portal' from generate_series(1,4) n;
insert into public.maturity_instructions(id,investment_id,investor_id,choice,status,projected_payout_ugx,projected_reinvest_ugx,needs_resolution,request_id)
select ('70000000-0000-4000-8000-00000000000'||n)::uuid,('60000000-0000-4000-8000-00000000000'||n)::uuid,'50000000-0000-4000-8000-000000000002','withdraw_all',case when n=3 then 'processing'::public.maturity_instruction_status else 'requested'::public.maturity_instruction_status end,6500000,0,true,gen_random_uuid() from generate_series(1,4) n;
insert into public.audit_events(action,entity_type,entity_id,request_id,metadata) values
 ('maturity_instruction.requested','maturity_instruction','70000000-0000-4000-8000-000000000001',gen_random_uuid(),'{"payout_destination_setup_pending":true}'),
 ('maturity_instruction.requested','maturity_instruction','70000000-0000-4000-8000-000000000002',gen_random_uuid(),'{"payout_destination_setup_pending":true}'),
 ('maturity_instruction.held','maturity_instruction','70000000-0000-4000-8000-000000000002',gen_random_uuid(),'{"reason":"unrelated capacity hold"}');
create function pg_temp.destination_payload(p_fingerprint bytea default decode(repeat('11',32),'hex'),p_provider text default 'MTN') returns jsonb language sql as $$
 select jsonb_build_object('channel','mobile_money','provider_label',p_provider,'account_name','Test Holder',
 'account_ref_ciphertext','\x121212121212','account_ref_iv',decode(repeat('13',12),'hex'),
 'account_ref_auth_tag',decode(repeat('14',16),'hex'),'account_ref_fingerprint',p_fingerprint,'account_last_four','1234','key_version',1);
$$;
create function pg_temp.setup_destination(p_instruction uuid,p_admin uuid default '50000000-0000-4000-8000-000000000001',p_aal2 boolean default true,p_payload jsonb default pg_temp.destination_payload(),p_source text default 'manual',p_updated_at timestamptz default null) returns jsonb language sql security invoker as $$
 select public.save_admin_maturity_payout_destination(p_admin,p_aal2,p_instruction,gen_random_uuid(),'phone',p_source,p_updated_at,p_payload);
$$;
set local role service_role;
select throws_ok($$select pg_temp.setup_destination('70000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002')$$,'42501','Active administrator two-factor authentication required','non-admin rejected');
select throws_ok($$select pg_temp.setup_destination('70000000-0000-4000-8000-000000000001',p_aal2=>false)$$,'42501','Active administrator two-factor authentication required','AAL1 rejected');
select throws_ok($$select pg_temp.setup_destination('70000000-0000-4000-8000-000000000003')$$,'23514','Only a pending, unlocked payout request can receive a destination','locked request rejected');
select throws_ok($$select pg_temp.setup_destination('70000000-0000-4000-8000-000000000001',p_payload=>'{}')$$,'22023','A complete encrypted payout destination is required','incomplete envelope rejected');
select throws_ok($$select pg_temp.setup_destination('70000000-0000-4000-8000-000000000001',p_source=>'profile_phone',p_updated_at=>'2000-01-01')$$,'23514','The phone on file changed or is unavailable; refresh and verify it again','stale profile phone rejected');
select lives_ok($$select pg_temp.setup_destination('70000000-0000-4000-8000-000000000001',p_source=>'profile_phone',p_updated_at=>(select updated_at from public.profiles where id='50000000-0000-4000-8000-000000000002'))$$,'admin saves verified destination');
select lives_ok($$select pg_temp.setup_destination('70000000-0000-4000-8000-000000000001')$$,'same destination retry is idempotent');
select lives_ok($$select pg_temp.setup_destination('70000000-0000-4000-8000-000000000002')$$,'another request can reuse the immutable saved destination');
select throws_ok($$select pg_temp.setup_destination('70000000-0000-4000-8000-000000000004',p_payload=>pg_temp.destination_payload(p_provider=>'Different provider'))$$,'23514','This account reference already has different or inactive destination details','same reference with different details cannot overwrite');
select throws_ok($$select pg_temp.setup_destination('70000000-0000-4000-8000-000000000001',p_payload=>pg_temp.destination_payload(decode(repeat('22',32),'hex')))$$,'23514','This request already has a payout destination; it cannot be replaced here','linked destination cannot be replaced');
select lives_ok($$select pg_temp.setup_destination('70000000-0000-4000-8000-000000000004')$$,'destination can be saved without dismissing unexplained hold');
reset role;
select is((select count(*) from public.payout_destinations where investor_id='50000000-0000-4000-8000-000000000002'),1::bigint,'no duplicate or orphan destinations');
select ok((select destination_confirmed and destination_verified and destination_verified_at is not null and not needs_resolution from public.maturity_instructions where id='70000000-0000-4000-8000-000000000001'),'missing-destination hold resolved with verification');
select ok((select needs_resolution from public.maturity_instructions where id='70000000-0000-4000-8000-000000000002'),'unrelated fulfillment hold preserved');
select ok((select needs_resolution from public.maturity_instructions where id='70000000-0000-4000-8000-000000000004'),'unexplained hold preserved');
select ok((select status='requested' and fulfilled_at is null and actual_payout_ugx is null and fulfilled_investment_id is null and payout_reference is null from public.maturity_instructions where id='70000000-0000-4000-8000-000000000001'),'setup does not record a transfer or reinvestment');
select is((select actor_id from public.audit_events where entity_id='70000000-0000-4000-8000-000000000001' and action='maturity_instruction.payout_destination_saved'),'50000000-0000-4000-8000-000000000001'::uuid,'verified setup audited against administrator');
select is((select count(*) from public.audit_events where entity_id='70000000-0000-4000-8000-000000000001' and action='maturity_instruction.payout_destination_saved'),1::bigint,'retry does not duplicate audit event');
select * from finish();
rollback;
