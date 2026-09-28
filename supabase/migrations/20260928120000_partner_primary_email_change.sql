begin;

-- Partner primary-email changes. Two paths share one finalizer:
--   * new_address:  partner enters a fresh address, proves mailbox ownership
--     via a token link plus a deliberate confirm action, then the old primary
--     row is REPLACED by the new address.
--   * promote_alias: partner promotes an already-verified additional address;
--     the old primary is SWAPPED down to a verified additional address.
--
-- The application calls Supabase Auth's server-only admin email update API.
-- GoTrue applies that update inside a Postgres transaction, where the guarded
-- trigger below completes the linked-record change (profiles.email,
-- account_emails, audit, notification jobs). A trigger failure rolls the Auth
-- update back too, so Auth, profiles, and account_emails move together or
-- not at all.

create table public.primary_email_change_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  new_email text not null,
  mode text not null check (mode in ('new_address', 'promote_alias')),
  account_email_id uuid references public.account_emails(id) on delete cascade,
  token_hash bytea unique,
  expires_at timestamptz,
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  finalized_at timestamptz,
  constraint primary_email_change_email_normalized check (new_email = lower(trim(new_email))),
  constraint primary_email_change_mode_state check (
    (mode = 'promote_alias' and account_email_id is not null and token_hash is null and expires_at is null)
    or
    -- A new-address request holds its token until finalization consumes it;
    -- clearing the hash afterwards retires the link for reuse checks.
    (mode = 'new_address' and account_email_id is null and expires_at is not null
      and (token_hash is not null or finalized_at is not null))
  ),
  constraint primary_email_change_lifecycle check (
    finalized_at is null or (confirmed_at is not null and finalized_at >= confirmed_at)
  )
);

-- One live request per partner: concurrent second requests fail instead of
-- racing the finalizer. Expired rows are pruned by the application when a
-- new request starts.
create unique index primary_email_change_one_active_per_user
  on public.primary_email_change_requests (user_id)
  where finalized_at is null;
create index primary_email_change_token_idx
  on public.primary_email_change_requests (token_hash)
  where finalized_at is null;

alter table public.primary_email_change_requests enable row level security;
revoke all on public.primary_email_change_requests from public, anon, authenticated;
grant all on public.primary_email_change_requests to service_role;

-- Relax the immutable-primary rules for the authorized finalizer only. The
-- trigger sets a transaction-local marker; every other writer still hits the
-- original errors. The marker dies with the transaction, so it cannot leak
-- into later work.
create or replace function private.guard_account_email() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_profile_email text;
  v_alias_count integer;
begin
  if current_setting('primary_email_change.request_id', true) is not null then
    -- Finalizer transaction: the matching confirmed request was already
    -- validated, so permit the mechanical primary swap/replacement.
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  select p.email into v_profile_email from public.profiles p where p.id = new.user_id;
  if v_profile_email is null then
    raise exception using errcode = '23503', message = 'account email profile is missing';
  end if;
  if new.is_primary then
    if new.email <> v_profile_email then
      raise exception using errcode = '23514', message = 'primary account email must match profile email';
    end if;
  else
    if new.email = v_profile_email then
      raise exception using errcode = '23505', message = 'email is already the primary account email';
    end if;
    select count(*) into v_alias_count
    from public.account_emails ae
    where ae.user_id = new.user_id and not ae.is_primary and ae.id <> new.id;
    if v_alias_count >= 2 then
      raise exception using errcode = '23514', message = 'account may have at most two additional emails';
    end if;
  end if;
  if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.is_primary <> old.is_primary) then
    raise exception using errcode = '55000', message = 'account email ownership and primary status are immutable';
  end if;
  return new;
end;
$$;

create or replace function private.finalize_primary_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.primary_email_change_requests%rowtype;
  v_old_email text;
  v_old_primary_id uuid;
  v_alias_count integer;
  v_old_notice text;
  v_new_notice text;
begin
  -- Guarded: only a confirmed, unexpired, unfinalized request for this exact
  -- address completes the change. Any other Auth email edit (administrators,
  -- support flows) passes through untouched.
  select * into v_request
  from public.primary_email_change_requests
  where user_id = new.id
    and new_email = lower(trim(new.email))
    and confirmed_at is not null
    and finalized_at is null
    and (expires_at is null or expires_at > now())
  order by confirmed_at desc
  limit 1
  for update;
  if not found then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.id::text, 0));
  -- Re-read under the advisory lock: a concurrent finalizer may have
  -- finished between the first read and the lock.
  select * into v_request
  from public.primary_email_change_requests
  where id = v_request.id and finalized_at is null
  for update;
  if not found then
    return new;
  end if;

  v_old_email := lower(trim(old.email));

  -- Last-resort race guards: the application pre-checks these, but only a
  -- trigger failure rolls the Auth update back with the linked records.
  if exists (
    select 1 from public.account_emails
    where lower(email) = lower(trim(new.email)) and user_id <> new.id
  ) or exists (
    select 1 from public.profiles
    where lower(email) = lower(trim(new.email)) and id <> new.id
  ) then
    raise exception using errcode = '23505', message = 'email address is already linked to another account';
  end if;

  perform set_config('primary_email_change.request_id', v_request.id::text, true);

  if v_request.mode = 'promote_alias' then
    select id into v_old_primary_id
    from public.account_emails
    where user_id = new.id and is_primary
    for update;
    if v_old_primary_id is null then
      raise exception using errcode = '22023', message = 'current primary email is missing';
    end if;
    if not exists (
      select 1 from public.account_emails
      where id = v_request.account_email_id
        and user_id = new.id
        and verified_at is not null
        and not is_primary
    ) then
      raise exception using errcode = '22023', message = 'promotion source is not a verified additional email';
    end if;
    -- Demote first so the partial unique index never sees two primaries.
    update public.account_emails set is_primary = false where id = v_old_primary_id;
    update public.account_emails set is_primary = true where id = v_request.account_email_id;
    v_old_notice := 'Your OURMU primary email was changed to ' || lower(trim(new.email)) || '. That address is now kept as a verified additional contact: it still receives account notifications and can still be used to sign in. If you did not request this, contact the OURMU team immediately.';
    v_new_notice := 'This address is now your OURMU primary email. Sign-in links and account notifications will arrive here. Your previous primary ' || v_old_email || ' remains as a verified additional contact.';
  else
    select id into v_old_primary_id
    from public.account_emails
    where user_id = new.id and is_primary
    for update;
    if v_old_primary_id is null then
      raise exception using errcode = '22023', message = 'current primary email is missing';
    end if;
    -- Replace in place: the old address leaves the account entirely while
    -- the row identity stays stable for audit history.
    update public.account_emails
    set email = lower(trim(new.email)),
        verified_at = now(),
        verification_token_hash = null,
        verification_expires_at = null,
        verification_sent_at = null
    where id = v_old_primary_id;
    v_old_notice := 'Your OURMU primary email was changed from ' || v_old_email || ' to ' || lower(trim(new.email)) || '. Sign-in links and account notifications now go to the new address, which replaced this one. If you did not request this, contact the OURMU team immediately.';
    v_new_notice := 'This address is now your OURMU primary email. Sign-in links and account notifications will arrive here. It replaced ' || v_old_email || ', which no longer receives account messages.';
  end if;

  -- The swap/replacement never grows the alias list, but refuse to finalize
  -- on drifted data rather than silently exceeding the two-alias limit.
  select count(*) into v_alias_count
  from public.account_emails
  where user_id = new.id and not is_primary;
  if v_alias_count > 2 then
    raise exception using errcode = '23514', message = 'account may have at most two additional emails';
  end if;

  -- The profiles sync trigger renames the primary row to the same value
  -- (a no-op); the guard bypass above keeps it quiet.
  update public.profiles set email = lower(trim(new.email)) where id = new.id;
  if not found then
    raise exception using errcode = '23503', message = 'account email profile is missing';
  end if;

  update public.primary_email_change_requests
  set finalized_at = now(), token_hash = null
  where id = v_request.id;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (new.id, 'account_email.primary_changed', 'account_email',
    coalesce(v_request.account_email_id, v_old_primary_id), gen_random_uuid(),
    jsonb_build_object('mode', v_request.mode, 'old_email', v_old_email,
      'new_email', lower(trim(new.email)), 'request_id', v_request.id));

  -- Queued notifications carry explicit recipients: already-queued
  -- deliveries keep their recorded payloads untouched, while future fan-outs
  -- naturally read the new primary.
  insert into public.jobs (kind, entity_type, entity_id, payload, email_dedupe_key)
  values
    ('send_email', 'profile', new.id,
      jsonb_build_object('template', 'primary_email_changed', 'to', v_old_email,
        'detail', v_old_notice,
        'idempotencyKey', 'primary-email-change-' || v_request.id::text || '-old'),
      'primary-email-change:' || v_request.id::text || ':old'),
    ('send_email', 'profile', new.id,
      jsonb_build_object('template', 'primary_email_changed', 'to', lower(trim(new.email)),
        'detail', v_new_notice,
        'idempotencyKey', 'primary-email-change-' || v_request.id::text || '-new'),
      'primary-email-change:' || v_request.id::text || ':new');

  return new;
end;
$$;

drop trigger if exists auth_users_finalize_primary_email on auth.users;
create trigger auth_users_finalize_primary_email
after update of email on auth.users
for each row when (old.email is distinct from new.email)
execute function private.finalize_primary_email_change();

commit;
