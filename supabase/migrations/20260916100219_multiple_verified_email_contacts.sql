begin;

create table public.account_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  email text not null,
  is_primary boolean not null default false,
  verified_at timestamptz,
  verification_token_hash bytea unique,
  verification_expires_at timestamptz,
  verification_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_emails_normalized check (email = lower(trim(email))),
  constraint account_emails_verification_state check (
    (verified_at is not null and verification_token_hash is null and verification_expires_at is null)
    or
    (not is_primary and verified_at is null and verification_token_hash is not null and verification_expires_at is not null)
  ),
  constraint account_emails_primary_verified check (not is_primary or verified_at is not null)
);

create unique index account_emails_email_unique on public.account_emails (lower(email));
create unique index account_emails_one_primary_per_user on public.account_emails (user_id) where is_primary;
create index account_emails_user_idx on public.account_emails (user_id, is_primary desc, created_at);

insert into public.account_emails (user_id, email, is_primary, verified_at)
select id, email, true, coalesce(kyc_verified_at, created_at)
from public.profiles;

create or replace function private.guard_account_email() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_profile_email text;
  v_alias_count integer;
begin
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

create trigger account_emails_guard
before insert or update on public.account_emails
for each row execute function private.guard_account_email();

create or replace function private.guard_account_email_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.is_primary then
    raise exception using errcode = '55000', message = 'primary account email cannot be removed';
  end if;
  return old;
end;
$$;

create trigger account_emails_delete_guard
before delete on public.account_emails
for each row execute function private.guard_account_email_delete();

create trigger account_emails_touch before update on public.account_emails
for each row execute function private.touch_updated_at();

create or replace function private.sync_profile_account_email() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.account_emails (user_id, email, is_primary, verified_at)
    values (new.id, new.email, true, coalesce(new.kyc_verified_at, now()));
  elsif new.email is distinct from old.email then
    update public.account_emails
    set email = new.email
    where user_id = new.id and is_primary;
  end if;
  return new;
end;
$$;

create trigger profiles_sync_account_email
after insert or update of email on public.profiles
for each row execute function private.sync_profile_account_email();

alter table public.account_emails enable row level security;
create policy account_emails_self_read on public.account_emails for select to authenticated
  using ((select auth.uid()) = user_id);
create policy account_emails_admin_read on public.account_emails for select to authenticated
  using (private.is_admin());
revoke all on public.account_emails from public, anon, authenticated;
grant select on public.account_emails to authenticated;
grant all on public.account_emails to service_role;

create table private.alias_login_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  ip_fingerprint bytea not null,
  requested_at timestamptz not null default now()
);
create index alias_login_attempts_user_recent_idx on private.alias_login_attempts (user_id, requested_at desc);
create index alias_login_attempts_ip_recent_idx on private.alias_login_attempts (ip_fingerprint, requested_at desc);
alter table private.alias_login_attempts enable row level security;
revoke all on private.alias_login_attempts from public, anon, authenticated;
grant all on private.alias_login_attempts to service_role;

alter table public.jobs add column email_dedupe_key text;
create unique index jobs_email_dedupe_unique on public.jobs (email_dedupe_key)
  where kind = 'send_email' and email_dedupe_key is not null;

commit;
