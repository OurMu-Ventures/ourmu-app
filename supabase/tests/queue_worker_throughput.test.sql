begin;
select plan(4);

select ok(
  (select count(*)::integer from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs' and column_name = 'claim_token') = 1,
  'jobs.claim_token exists for atomic worker claims');

select ok(
  (select count(*)::integer from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs' and column_name = 'lease_expires_at') = 1,
  'jobs.lease_expires_at exists for five-minute leases');

select ok(
  (select is_nullable = 'YES' from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs' and column_name = 'claim_token'),
  'jobs.claim_token is nullable so pending jobs carry no claim');

select ok(
  (select count(*)::integer from pg_indexes
    where schemaname = 'public' and tablename = 'jobs' and indexname = 'jobs_lease_recovery_idx') = 1,
  'jobs_lease_recovery_idx exists for expired-lease recovery');

select * from finish();
rollback;
