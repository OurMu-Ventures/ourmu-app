begin;
select plan(28);

select has_table('public', 'newsletter_visits', 'visits table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.newsletter_visits'::regclass), 'RLS enabled');
select ok(not has_table_privilege('anon', 'public.newsletter_visits', 'select'), 'anonymous cannot read visits');
select ok(not has_table_privilege('authenticated', 'public.newsletter_visits', 'insert'), 'partners cannot insert visits directly');
select ok(not has_function_privilege('anon', 'public.record_newsletter_visit(uuid,text,uuid,text)', 'execute'), 'anonymous cannot record');
select ok(not has_function_privilege('anon', 'public.newsletter_reading_report(text[])', 'execute'), 'anonymous cannot report');
select ok(not has_function_privilege('authenticated', 'public.record_newsletter_visit(uuid,text,uuid,text)', 'execute'), 'partners cannot call recorder directly');
select ok(not has_function_privilege('authenticated', 'public.newsletter_reading_report(text[])', 'execute'), 'partners cannot report');
select ok(has_function_privilege('service_role', 'public.record_newsletter_visit(uuid,text,uuid,text)', 'execute'), 'server can record');
select ok(has_function_privilege('service_role', 'public.newsletter_reading_report(text[])', 'execute'), 'server can report');

insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000101','newsletter-a@example.test'),
 ('00000000-0000-4000-8000-000000000102','newsletter-b@example.test'),
 ('00000000-0000-4000-8000-000000000103','newsletter-test@example.test'),
 ('00000000-0000-4000-8000-000000000104','newsletter-admin@example.test'),
 ('00000000-0000-4000-8000-000000000105','newsletter-disabled@example.test');
insert into public.profiles(id,email,legal_name,role,access_status,is_test)
select id,email,'Synthetic newsletter '||right(id::text,3),
 case when right(id::text,3) = '104' then 'admin'::public.user_role else 'investor'::public.user_role end,
 case when right(id::text,3) = '105' then 'disabled'::public.access_status else 'active'::public.access_status end,
 right(id::text,3) = '103'
from auth.users where email like 'newsletter-%@example.test';

set local role service_role;
select is(public.record_newsletter_visit('00000000-0000-4000-8000-000000000101','october-2026','00000000-0000-4000-8000-000000000201','opened'),true,'first open accepted');
select is(public.record_newsletter_visit('00000000-0000-4000-8000-000000000101','october-2026','00000000-0000-4000-8000-000000000201','opened'),true,'duplicate open accepted idempotently');
select is((select count(*)::integer from public.newsletter_visits where partner_id='00000000-0000-4000-8000-000000000101'),1,'duplicate does not inflate opens');
select is(public.record_newsletter_visit('00000000-0000-4000-8000-000000000101','october-2026','00000000-0000-4000-8000-000000000201','reached_end'),false,'cannot complete immediately');
update public.newsletter_visits set opened_at=clock_timestamp()-interval '31 seconds' where partner_id='00000000-0000-4000-8000-000000000101';
select is(public.record_newsletter_visit('00000000-0000-4000-8000-000000000101','october-2026','00000000-0000-4000-8000-000000000201','reached_end'),true,'completion after 30 seconds accepted');
select is(public.record_newsletter_visit('00000000-0000-4000-8000-000000000101','october-2026','00000000-0000-4000-8000-000000000201','reached_end'),true,'completion retries idempotent');
select is(public.record_newsletter_visit('00000000-0000-4000-8000-000000000102','october-2026','00000000-0000-4000-8000-000000000201','reached_end'),false,'cannot complete another partner visit');
select is(public.record_newsletter_visit('00000000-0000-4000-8000-000000000103','october-2026','00000000-0000-4000-8000-000000000201','opened'),false,'test account excluded');
select is(public.record_newsletter_visit('00000000-0000-4000-8000-000000000104','october-2026','00000000-0000-4000-8000-000000000201','opened'),false,'admin excluded');
select is(public.record_newsletter_visit('00000000-0000-4000-8000-000000000105','october-2026','00000000-0000-4000-8000-000000000201','opened'),false,'disabled account excluded');

create temp table newsletter_report as select value row from jsonb_array_elements(public.newsletter_reading_report(array['october-2026']));
select is((select (row->>'opens')::integer from newsletter_report where row->>'partner_id'='00000000-0000-4000-8000-000000000102'),0,'unread partners included with zero opens');
select is((select count(*)::integer from newsletter_report where row->>'partner_id'='00000000-0000-4000-8000-000000000103'),0,'test accounts excluded from audience');
select is((select count(*)::integer from newsletter_report where row->>'partner_id'='00000000-0000-4000-8000-000000000104'),0,'admins excluded from audience');
select is((select count(*)::integer from newsletter_report where row->>'partner_id'='00000000-0000-4000-8000-000000000105'),0,'disabled accounts excluded from audience');
select ok((select row->>'reached_end_at' is not null from newsletter_report where row->>'partner_id'='00000000-0000-4000-8000-000000000101'),'completion reported');
select is(public.record_newsletter_visit('00000000-0000-4000-8000-000000000101','october-2026','00000000-0000-4000-8000-000000000202','opened'),true,'new visit accepted');
select is((select (value->>'opens')::integer from jsonb_array_elements(public.newsletter_reading_report(array['october-2026'])) where value->>'partner_id'='00000000-0000-4000-8000-000000000101'),2,'two visits aggregated to one partner');
select is((select count(*)::integer from jsonb_array_elements(public.newsletter_reading_report(array['october-2026','august-2026','october-2026'])) where value->>'partner_id' in ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102')),4,'duplicate input slugs do not inflate audience');
reset role;
select * from finish();
rollback;
