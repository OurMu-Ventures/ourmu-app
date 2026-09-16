begin;
select plan(50);
select has_schema('private','private identity schema exists');
select has_table('public','profiles','profiles exists');
select has_table('private','investor_identities','identities are isolated');
select ok(has_schema_privilege('authenticated','private','USAGE'),'authenticated users can resolve the admin policy helper');
select ok(has_schema_privilege('service_role','private','USAGE'),'service role can run maintenance against private identity data');
select ok(not has_schema_privilege('anon','private','USAGE'),'anonymous users cannot resolve the private schema');
select has_table('public','investment_cycles','cycles exist');
select has_table('public','investments','investments exist');
select has_table('public','bank_receipts','bank receipts exist');
select has_table('public','investment_agreements','agreement receipts exist');
select has_table('public','audit_events','audit log exists');
select has_table('public','jobs','job outbox exists');
select has_table('public','account_emails','account email registry exists');
select has_table('private','alias_login_attempts','alias login throttling is private');
select has_table('public','import_batches','import batches exist');
select has_table('public','legacy_partner_identities','legacy parties exist');
select has_table('public','legacy_monthly_financial_summaries','legacy financial summaries exist');
select has_trigger('public','legacy_monthly_financial_summaries','legacy_summary_immutable_guard','legacy summaries have an immutability trigger');
select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),'profiles RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.investments'::regclass),'investments RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.bank_receipts'::regclass),'receipts RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.audit_events'::regclass),'audit RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.account_emails'::regclass),'account emails RLS enabled');
select has_trigger('public','account_emails','account_emails_guard','account email limits are enforced');
select has_trigger('public','account_emails','account_emails_delete_guard','primary account email is protected');
select has_trigger('public','profiles','profiles_sync_account_email','profile emails synchronize into the registry');
select function_privs_are('public','request_investment',array['uuid','uuid','numeric','uuid','text','bytea'],'service_role',array['EXECUTE'],'service role alone executes reservation function');
select function_privs_are('public','activate_investment',array['uuid','uuid','text','numeric','date','text','boolean','uuid'],'service_role',array['EXECUTE'],'service role alone executes activation function');
select is_empty($$select 1 from information_schema.role_routine_grants where routine_schema='public' and routine_name='activate_investment' and grantee in ('PUBLIC','anon','authenticated')$$,'browser roles cannot activate');
select is_empty($$select 1 from information_schema.role_routine_grants where routine_schema='public' and routine_name in ('stage_partner_import','accept_partner_import','link_legacy_partner') and grantee in ('PUBLIC','anon','authenticated')$$,'browser roles cannot execute import operations');
select is_empty($$select 1 from information_schema.role_routine_grants where routine_schema='public' and routine_name='rls_auto_enable' and grantee in ('PUBLIC','anon','authenticated')$$,'browser roles cannot execute the production RLS helper');
select is_empty($$select 1 from information_schema.role_table_grants where table_schema='private' and table_name='investor_identities' and grantee in ('PUBLIC','anon','authenticated')$$,'browser roles cannot access identity envelope');
select is_empty($$select 1 from information_schema.role_table_grants where table_schema='private' and table_name='alias_login_attempts' and grantee in ('PUBLIC','anon','authenticated')$$,'browser roles cannot access alias login throttling');
select col_type_is('public','investments','principal_ugx','numeric(28,8)','principal preserves imported decimals');
select col_type_is('public','investments','projected_value_ugx','numeric(28,8)','projection preserves imported decimals');
select col_type_is('public','investments','units','numeric(28,14)','fractional units are derived precisely');
select col_type_is('public','investment_cycles','capacity_ugx','numeric(28,8)','cycle capacity is cash-authoritative');
select col_type_is('public','investment_cycles','unit_price_ugx','numeric(28,8)','unit price uses the same decimal money type');
select col_type_is('public','profiles','is_test','boolean','profiles explicitly distinguish test accounts');
select col_type_is('public','investments','is_test','boolean','investments explicitly distinguish test money');
select has_trigger('public','investments','investment_test_flag_guard','investment test status is derived from its owner');
select is_empty($$
  select 1
  from pg_index i
  cross join lateral (
    select array_agg(a.attname order by a.attname) as column_names
    from unnest(i.indkey::smallint[]) as k(attnum)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
  ) keys
  where i.indrelid = 'public.investments'::regclass
    and i.indisunique
    and keys.column_names = array['cycle_id', 'investor_id']::name[]
$$,'investors may hold multiple distinct placements in the same monthly cycle');
select throws_ok($$insert into public.investment_cycles(name,opens_at,closes_at,maturity_date,capacity_ugx,unit_price_ugx,agreement_version_id,created_by) values('bad',now(),now()+interval '1 day',current_date+2,1250000,1,gen_random_uuid(),gen_random_uuid())$$,'23514',null,'unit price cannot drift');
select throws_ok($$insert into public.investments(investor_id,cycle_id,unit_price_ugx,principal_ugx,projected_return_bps,projected_return_ugx,projected_value_ugx,maturity_date,status,record_origin) values(gen_random_uuid(),gen_random_uuid(),125000,124999,3000,37499.7,162498.7,current_date,'reserved','portal')$$,'23514',null,'portal records cannot bypass the minimum principal and reservation constraints');
insert into public.audit_events (action, entity_type, request_id) values ('test.created', 'test', gen_random_uuid());
select throws_ok($$delete from public.audit_events where action = 'test.created'$$,'55000','audit_events records are immutable','audit history cannot be deleted');
select ok((select not public from storage.buckets where id='agreements'),'agreement bucket is private');
select is((select file_size_limit from storage.buckets where id='agreements'),10485760::bigint,'agreement size cap is 10 MB');
select ok((select relrowsecurity from pg_class where oid = 'public.import_batches'::regclass),'import batches RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.legacy_partner_identities'::regclass),'legacy parties RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.legacy_monthly_financial_summaries'::regclass),'legacy summaries RLS enabled');
select * from finish();
rollback;
