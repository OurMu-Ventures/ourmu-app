begin;
select no_plan();
select ok(not has_function_privilege('anon', 'public.submit_partner_application(bytea,jsonb,jsonb)', 'EXECUTE'), 'anonymous cannot submit directly');
select ok(not has_function_privilege('authenticated', 'public.submit_partner_application(bytea,jsonb,jsonb)', 'EXECUTE'), 'browser users cannot submit directly');
select ok(has_function_privilege('service_role', 'public.submit_partner_application(bytea,jsonb,jsonb)', 'EXECUTE'), 'server can submit');
select ok(not has_function_privilege('anon', 'public.review_partner_application(uuid,uuid,text,uuid,text,text)', 'EXECUTE'), 'anonymous cannot review');
select ok(not has_function_privilege('authenticated', 'public.review_partner_application(uuid,uuid,text,uuid,text,text)', 'EXECUTE'), 'browser users cannot review');
select ok(not (select prosecdef from pg_proc where oid = 'public.submit_partner_application(bytea,jsonb,jsonb)'::regprocedure), 'submission runs with caller privileges');
select ok(not (select prosecdef from pg_proc where oid = 'public.review_partner_application(uuid,uuid,text,uuid,text,text)'::regprocedure), 'review runs with caller privileges');
insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000001','identity-admin@test.local'),
 ('10000000-0000-4000-8000-000000000002','identity-partner@test.local');
insert into public.profiles(id,role,access_status,legal_name,email,phone,kyc_status) values
 ('10000000-0000-4000-8000-000000000001','admin','active','Identity Admin','identity-admin@test.local','+256700000000','verified');
insert into public.application_invitations(id,invited_email,token_hash,expires_at,issued_by,created_at) values
 ('20000000-0000-4000-8000-000000000001','identity-partner@test.local','\x01',now()+interval '1 day','10000000-0000-4000-8000-000000000001',now()),
 ('20000000-0000-4000-8000-000000000002','identity-other@test.local','\x02',now()+interval '1 day','10000000-0000-4000-8000-000000000001',now()),
 ('20000000-0000-4000-8000-000000000003','identity-expired@test.local','\x03',now()-interval '1 day','10000000-0000-4000-8000-000000000001',now()-interval '2 days');
-- Synthetic ciphertext only; no real personal data.
create function pg_temp.submit_fixture(p_hash bytea, p_id uuid, p_email text, p_fingerprint bytea default '\x11', p_ciphertext bytea default '\x12')
returns void language sql security invoker as $$
 select public.submit_partner_application(p_hash,
   jsonb_build_object('id',p_id,'legal_name','Test Partner','email',p_email,'phone','+256700000001',
    'date_of_birth','1990-01-01','address','Test address','district','Kampala','country','Uganda','privacy_policy_version','test'),
   jsonb_build_object('nin_ciphertext',p_ciphertext,'nin_iv','\x13','nin_auth_tag','\x14',
    'nin_fingerprint',p_fingerprint,'nin_last_four','1234','key_version',1));
$$;
set local role service_role;
select lives_ok($$select pg_temp.submit_fixture('\x01','30000000-0000-4000-8000-000000000001','identity-partner@test.local')$$, 'server submits into non-exposed identity schema');
select throws_ok($$select pg_temp.submit_fixture('\x01','30000000-0000-4000-8000-000000000002','identity-partner@test.local')$$,'P0001','Application link unavailable','used link cannot submit twice');
select throws_ok($$select pg_temp.submit_fixture('\x02','30000000-0000-4000-8000-000000000002','wrong@test.local')$$,'P0001','Application link unavailable','invited email must match');
select throws_ok($$select pg_temp.submit_fixture('\x03','30000000-0000-4000-8000-000000000003','identity-expired@test.local')$$,'P0001','Application link unavailable','expired invitation rejected');
select throws_ok($$select pg_temp.submit_fixture('\x02','30000000-0000-4000-8000-000000000002','identity-other@test.local')$$,'23505',null,'duplicate identity rejected');
select throws_ok($$select pg_temp.submit_fixture('\x02','30000000-0000-4000-8000-000000000002','identity-other@test.local','\x21',null)$$,'23514',null,'incomplete encrypted envelope rejected');
reset role;
update public.application_invitations set revoked_at = now() where token_hash = '\x02';
set local role service_role;
select throws_ok($$select pg_temp.submit_fixture('\x02','30000000-0000-4000-8000-000000000002','identity-other@test.local','\x21')$$,'P0001','Application link unavailable','revoked invitation rejected');
reset role;
update public.application_invitations set revoked_at = null where token_hash = '\x02';
reset role;
select is((select count(*) from public.investor_applications where id='30000000-0000-4000-8000-000000000002'),0::bigint,'identity failures roll back application');
select ok((select used_at is null from public.application_invitations where token_hash='\x02'),'identity failures leave invitation usable');
select ok((select used_at is not null from public.application_invitations where token_hash='\x01'),'successful submission consumes invitation');
set local role service_role;
select lives_ok($$select public.review_partner_application('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','approved','10000000-0000-4000-8000-000000000002','verified',null)$$,'approval links private identity');
select lives_ok($$select pg_temp.submit_fixture('\x02','30000000-0000-4000-8000-000000000002','identity-other@test.local','\x21')$$,'failed invitation can be retried');
select throws_ok($$select public.review_partner_application('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','rejected',null,'checked',null)$$,'P0001','Invalid application reviewer or reference','non-admin review rejected');
select lives_ok($$select public.review_partner_application('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','rejected',null,'checked',null)$$,'rejection erases private envelope');
reset role;
select is((select user_id from private.investor_identities where application_id='30000000-0000-4000-8000-000000000001'),'10000000-0000-4000-8000-000000000002'::uuid,'approved identity belongs to partner');
select ok((select nin_ciphertext is null and nin_iv is null and nin_auth_tag is null and nin_fingerprint is null and erased_at is not null from private.investor_identities where application_id='30000000-0000-4000-8000-000000000002'),'rejected identity material erased');
select is((select status::text from public.investor_applications where id='30000000-0000-4000-8000-000000000002'),'rejected','rejection finalized');
select * from finish();
rollback;
