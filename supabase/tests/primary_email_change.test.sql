-- Partner primary-email changes: replace vs promote finalization, the auth
-- trigger guard, conflict rollback, expiry, reuse, and concurrency.
-- Synthetic fixtures only; the transaction is rolled back.
begin;
select plan(1);

create temp table primary_test_ids(
  investor_a uuid,
  investor_b uuid,
  alias_verified uuid,
  alias_pending uuid
);

-- Two partners with distinct primaries. Auth and profile emails are aligned
-- row-for-row so old/new address assertions are deterministic.
insert into auth.users(id, email)
select gen_random_uuid(), 'primary-change-a' || gs || '@example.test'
from generate_series(1, 2) gs;
insert into public.profiles(id, role, legal_name, email)
select id,
  'investor'::public.user_role,
  'Synthetic primary test ' || row_number() over (order by email),
  email
from (select id, email from auth.users where id not in (select id from public.profiles) order by email limit 2) users;
insert into primary_test_ids(investor_a, investor_b)
select
  (select id from public.profiles where email = 'primary-change-a1@example.test'),
  (select id from public.profiles where email = 'primary-change-a2@example.test');

-- Investor A: one verified alias (promotion source), one pending alias.
insert into public.account_emails(user_id, email, is_primary, verified_at)
select investor_a, 'verified-alias@example.test', false, now() from primary_test_ids;
insert into public.account_emails(user_id, email, is_primary, verified_at,
  verification_token_hash, verification_expires_at, verification_sent_at)
select investor_a, 'pending-alias@example.test', false, null,
  decode('ab', 'hex'), now() + interval '1 hour', now() from primary_test_ids;
update primary_test_ids set
  alias_verified = (select id from public.account_emails where email = 'verified-alias@example.test'),
  alias_pending = (select id from public.account_emails where email = 'pending-alias@example.test');

-- An already-queued delivery to A's old primary: finalization must not
-- rewrite recorded recipients.
insert into public.jobs(kind, entity_type, entity_id, payload, email_dedupe_key)
select 'send_email', 'investment', gen_random_uuid(),
  jsonb_build_object('template', 'maturity_notice', 'to', email,
    'accountEmailId', (select id from public.account_emails where user_id = investor_a and is_primary)),
  'primary-test:old-queued'
from public.profiles, primary_test_ids
where profiles.id = investor_a;

do $$
declare
  a uuid; b uuid; r uuid; old_primary_id uuid;
  old_primary_email text; new_jobs integer;
begin
  if has_function_privilege('anon', 'private.finalize_primary_email_change()', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.finalize_primary_email_change()', 'EXECUTE') then
    raise exception 'finalizer: SECURITY DEFINER trigger function is publicly executable';
  end if;

  select investor_a, investor_b into a, b from primary_test_ids;
  select email into old_primary_email from public.profiles where id = a;
  select id into old_primary_id from public.account_emails where user_id = a and is_primary;

  -- 1. Replace path: confirmed request for a fresh address.
  insert into public.primary_email_change_requests(user_id, new_email, mode, token_hash, expires_at, confirmed_at)
  values (a, 'fresh-primary@example.test', 'new_address', decode('01', 'hex'), now() + interval '1 day', now())
  returning id into r;
  update auth.users set email = 'fresh-primary@example.test' where id = a;
  if (select email from public.profiles where id = a) <> 'fresh-primary@example.test' then
    raise exception 'replace: profiles.email did not move';
  end if;
  if (select email from public.account_emails where user_id = a and is_primary) <> 'fresh-primary@example.test' then
    raise exception 'replace: primary row did not move';
  end if;
  if (select id from public.account_emails where user_id = a and is_primary) <> old_primary_id then
    raise exception 'replace: primary row identity changed';
  end if;
  if (select verified_at from public.account_emails where user_id = a and is_primary) is null then
    raise exception 'replace: replacement primary is unverified';
  end if;
  if exists(select 1 from public.account_emails where user_id = a and email = old_primary_email) then
    raise exception 'replace: old primary was kept instead of replaced';
  end if;
  if (select count(*) from public.account_emails where user_id = a and not is_primary) <> 2 then
    raise exception 'replace: alias list changed';
  end if;
  if (select finalized_at is null from public.primary_email_change_requests where id = r) then
    raise exception 'replace: request not finalized';
  end if;
  if (select token_hash from public.primary_email_change_requests where id = r) is not null then
    raise exception 'replace: token not retired';
  end if;
  if not exists(select 1 from public.audit_events where action = 'account_email.primary_changed'
    and actor_id = a and metadata->>'old_email' = old_primary_email
    and metadata->>'new_email' = 'fresh-primary@example.test'
    and metadata->>'mode' = 'new_address') then
    raise exception 'replace: audit missing';
  end if;
  select count(*) into new_jobs from public.jobs
  where email_dedupe_key in ('primary-email-change:' || r::text || ':old', 'primary-email-change:' || r::text || ':new');
  if new_jobs <> 2 then raise exception 'replace: expected two notification jobs'; end if;
  if (select payload->>'to' from public.jobs where email_dedupe_key = 'primary-email-change:' || r::text || ':old') <> old_primary_email then
    raise exception 'replace: old-address notice misaddressed';
  end if;
  if (select payload->>'to' from public.jobs where email_dedupe_key = 'primary-email-change:' || r::text || ':new') <> 'fresh-primary@example.test' then
    raise exception 'replace: new-address notice misaddressed';
  end if;
  if (select payload->>'template' from public.jobs where email_dedupe_key = 'primary-email-change:' || r::text || ':old') <> 'primary_email_changed' then
    raise exception 'replace: notice template mismatch';
  end if;
  if (select payload->>'to' from public.jobs where email_dedupe_key = 'primary-test:old-queued') <> old_primary_email then
    raise exception 'replace: queued delivery recipient rewritten';
  end if;

  -- 2. Reuse: the retired token row is gone and a repeat Auth edit for a
  -- third address with no live request passes through untouched.
  update auth.users set email = 'third-address@example.test' where id = a;
  if (select email from public.profiles where id = a) <> 'fresh-primary@example.test' then
    raise exception 'guard: unrelated auth edit moved profiles';
  end if;
  if exists(select 1 from public.audit_events where action = 'account_email.primary_changed' and metadata->>'new_email' = 'third-address@example.test') then
    raise exception 'guard: unrelated auth edit audited';
  end if;
  update auth.users set email = 'fresh-primary@example.test' where id = a;

  -- 3. Promote path: swap the verified alias up, keep the old primary down.
  insert into public.primary_email_change_requests(user_id, new_email, mode, account_email_id, confirmed_at)
  select a, 'verified-alias@example.test', 'promote_alias', alias_verified, now() from primary_test_ids
  returning id into r;
  update auth.users set email = 'verified-alias@example.test' where id = a;
  if (select email from public.account_emails where user_id = a and is_primary) <> 'verified-alias@example.test' then
    raise exception 'promote: alias not raised';
  end if;
  if not exists(select 1 from public.account_emails where user_id = a and email = 'fresh-primary@example.test' and not is_primary and verified_at is not null) then
    raise exception 'promote: old primary not kept as verified alias';
  end if;
  if (select count(*) from public.account_emails where user_id = a and not is_primary) <> 2 then
    raise exception 'promote: alias limit exceeded';
  end if;
  if (select email from public.profiles where id = a) <> 'verified-alias@example.test' then
    raise exception 'promote: profiles.email did not move';
  end if;
  if not exists(select 1 from public.audit_events where action = 'account_email.primary_changed'
    and metadata->>'mode' = 'promote_alias' and metadata->>'new_email' = 'verified-alias@example.test') then
    raise exception 'promote: audit missing';
  end if;

  -- 4. Conflict: B holds the target as a verified alias (no auth.users
  -- collision), so the trigger itself must refuse and roll everything back.
  insert into public.account_emails(user_id, email, is_primary, verified_at)
  values (b, 'contested@example.test', false, now());
  insert into public.primary_email_change_requests(user_id, new_email, mode, token_hash, expires_at, confirmed_at)
  values (a, 'contested@example.test', 'new_address', decode('02', 'hex'), now() + interval '1 day', now())
  returning id into r;
  begin
    update auth.users set email = 'contested@example.test' where id = a;
    raise exception 'conflict: contested update was accepted';
  exception when unique_violation then null;
  end;
  if (select email from auth.users where id = a) <> 'verified-alias@example.test' then
    raise exception 'conflict: auth email moved';
  end if;
  if (select email from public.profiles where id = a) <> 'verified-alias@example.test' then
    raise exception 'conflict: profiles.email moved';
  end if;
  if (select finalized_at from public.primary_email_change_requests where id = r) is not null then
    raise exception 'conflict: contested request finalized';
  end if;
  if exists(select 1 from public.audit_events where action = 'account_email.primary_changed' and metadata->>'new_email' = 'contested@example.test') then
    raise exception 'conflict: contested change audited';
  end if;
  if exists(select 1 from public.jobs where email_dedupe_key = 'primary-email-change:' || r::text || ':new') then
    raise exception 'conflict: contested notifications queued';
  end if;
  delete from public.primary_email_change_requests where id = r;

  -- 5. Expired requests never finalize.
  insert into public.primary_email_change_requests(user_id, new_email, mode, token_hash, expires_at, confirmed_at)
  values (a, 'stale-target@example.test', 'new_address', decode('03', 'hex'), now() - interval '1 hour', now())
  returning id into r;
  update auth.users set email = 'stale-target@example.test' where id = a;
  if (select email from public.profiles where id = a) <> 'verified-alias@example.test' then
    raise exception 'expiry: stale request finalized';
  end if;
  update auth.users set email = 'verified-alias@example.test' where id = a;
  delete from public.primary_email_change_requests where id = r;

  -- 6. Unconfirmed requests never finalize.
  insert into public.primary_email_change_requests(user_id, new_email, mode, token_hash, expires_at)
  values (a, 'unconfirmed-target@example.test', 'new_address', decode('04', 'hex'), now() + interval '1 day')
  returning id into r;
  update auth.users set email = 'unconfirmed-target@example.test' where id = a;
  if (select email from public.profiles where id = a) <> 'verified-alias@example.test' then
    raise exception 'unconfirmed request finalized';
  end if;
  update auth.users set email = 'verified-alias@example.test' where id = a;
  delete from public.primary_email_change_requests where id = r;

  -- 7. One live request per partner: a concurrent second request fails.
  insert into public.primary_email_change_requests(user_id, new_email, mode, token_hash, expires_at)
  values (a, 'held-target@example.test', 'new_address', decode('05', 'hex'), now() + interval '1 day')
  returning id into r;
  begin
    insert into public.primary_email_change_requests(user_id, new_email, mode, token_hash, expires_at)
    values (a, 'racing-target@example.test', 'new_address', decode('06', 'hex'), now() + interval '1 day');
    raise exception 'concurrency: second live request was accepted';
  exception when unique_violation then null;
  end;
  delete from public.primary_email_change_requests where id = r;
end $$;

select pass('primary email replace/promote finalization, guards, and audit checks pass');
select * from finish();
rollback;
