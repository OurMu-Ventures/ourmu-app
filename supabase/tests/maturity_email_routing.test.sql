-- Synthetic fixtures only; the transaction is rolled back.
begin;
select plan(1);
create temp table maturity_test_ids(admin_id uuid, investor_id uuid, investment_id uuid, job_id uuid);
insert into auth.users(id) select gen_random_uuid() from generate_series(1,2);
insert into public.profiles(id,role,legal_name,email)
select id,case when row_number() over(order by id)=1 then 'admin'::public.user_role else 'investor'::public.user_role end,
  'Synthetic maturity test '||row_number() over(order by id),
  'maturity-test-'||id||'@example.test'
from (select id from auth.users where id not in (select id from public.profiles) order by id limit 2) users;
insert into maturity_test_ids(admin_id,investor_id)
select min(id::text) filter(where role='admin')::uuid, min(id::text) filter(where role='investor')::uuid
from public.profiles where email like 'maturity-test-%@example.test';
insert into public.account_emails(user_id,email,is_primary,verified_at,created_at)
select investor_id,'second@example.test',false,now(),now()-interval '2 days' from maturity_test_ids;
insert into public.account_emails(user_id,email,is_primary,verified_at,created_at)
select investor_id,'third@example.test',false,now(),now()-interval '1 day' from maturity_test_ids;
insert into public.agreement_versions(version,title,template_markdown,content_hash)
values ('maturity-routing-test','Synthetic terms','Synthetic terms','synthetic-maturity-routing');
insert into public.investment_cycles(name,opens_at,closes_at,maturity_date,capacity_ugx,agreement_version_id,created_by)
select 'Synthetic maturity routing',now()-interval '30 days',now()-interval '1 day','2027-01-31',50000000,
  (select id from public.agreement_versions where version='maturity-routing-test'),admin_id from maturity_test_ids;
insert into public.investments(investor_id,cycle_id,unit_price_ugx,principal_ugx,projected_return_bps,projected_return_ugx,projected_value_ugx,maturity_date,reservation_expires_at,status)
select investor_id,(select id from public.investment_cycles where name='Synthetic maturity routing'),125000,1000000,3000,300000,1300000,'2027-01-31',now()+interval '1 day','active' from maturity_test_ids;
update maturity_test_ids set investment_id=(select id from public.investments where cycle_id=(select id from public.investment_cycles where name='Synthetic maturity routing'));
insert into public.jobs(kind,entity_type,entity_id,payload)
select 'send_email','investment',investment_id,'{"template":"maturity_notice"}'::jsonb from maturity_test_ids;
update maturity_test_ids set job_id=(select id from public.jobs where entity_id=investment_id);

do $$
declare a uuid; begin
 select admin_id into a from maturity_test_ids;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'aal','aal1')::text,true);
 begin
  execute 'set local role authenticated';
  perform public.update_maturity_email_settings(array['team@example.test'],true,gen_random_uuid());
  raise exception 'AAL1 settings change was accepted';
 exception when insufficient_privilege then
  execute 'reset role';
 end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'aal','aal2')::text,true);
 begin
  execute 'set local role authenticated';
  perform public.update_maturity_email_settings(array['team@example.test'],true,gen_random_uuid());
  raise exception 'non-admin settings change was accepted';
 exception when insufficient_privilege then
  execute 'reset role';
 end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'aal','aal2')::text,true);
 execute 'set local role authenticated';
 perform public.update_maturity_email_settings(array[' TEAM@example.test ','team@example.test','other@example.test'],true,gen_random_uuid());
 execute 'reset role';
 if (select contacts from public.maturity_email_settings) is distinct from array['team@example.test','other@example.test'] then raise exception 'contacts not normalized'; end if;
 if not exists(select 1 from public.audit_events where action='maturity_email_settings.updated' and actor_id=a) then raise exception 'settings audit missing'; end if;
end $$;

do $$
declare j uuid; n integer; begin
 select job_id into j from maturity_test_ids;
 n:=public.fan_out_maturity_email(j,'https://example.test/investments/synthetic');
 if n<>3 then raise exception 'expected three deliveries, got %',n; end if;
 n:=public.fan_out_maturity_email(j,'https://example.test/investments/synthetic');
 if n<>0 then raise exception 'duplicate deliveries created'; end if;
 if (select count(*) from public.jobs where payload->>'idempotencyKey' like 'job-'||j||'-%')<>3 then raise exception 'wrong child count'; end if;
 if (select count(*) from public.jobs where payload->'routing'->>'teamCopySelected'='true')<>1 then raise exception 'CC recipient selection failed'; end if;
 if (select count(*) from public.jobs where payload->'routing'->'replyTo'='["team@example.test","other@example.test"]'::jsonb)<>3 then raise exception 'reply recipients mismatch'; end if;
 if (select count(*) from public.jobs where payload->'routing'->'cc'='["team@example.test","other@example.test"]'::jsonb)<>1 then raise exception 'CC count mismatch'; end if;
 if not exists(select 1 from public.jobs c join public.account_emails e on e.id=(c.payload->>'accountEmailId')::uuid where c.payload->'routing'->>'teamCopySelected'='true' and e.is_primary) then raise exception 'primary was not selected'; end if;
end $$;
select pass('maturity routing authorization, audit and fan-out checks pass');
select * from finish();
rollback;
