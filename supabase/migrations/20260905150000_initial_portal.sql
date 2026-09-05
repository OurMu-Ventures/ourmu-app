begin;

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.user_role as enum ('investor', 'admin');
create type public.access_status as enum ('active', 'disabled', 'closed');
create type public.application_status as enum ('submitted', 'approved', 'rejected', 'abandoned');
create type public.cycle_status as enum ('draft', 'open', 'closed', 'matured');
create type public.investment_status as enum ('reserved', 'active', 'cancelled', 'rejected', 'expired', 'matured');
create type public.agreement_status as enum ('accepted', 'generating', 'ready', 'failed');
create type public.job_status as enum ('pending', 'running', 'succeeded', 'failed', 'dead');
create type public.job_kind as enum ('send_email', 'generate_agreement_pdf', 'revoke_sessions');
create type public.closure_status as enum ('requested', 'resolved', 'declined');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  role public.user_role not null default 'investor',
  access_status public.access_status not null default 'active',
  legal_name text not null,
  email text not null,
  phone text,
  date_of_birth date,
  address text,
  district text,
  country text not null default 'Uganda',
  kyc_status text not null default 'verified' check (kyc_status in ('pending', 'verified', 'rejected')),
  kyc_verified_at timestamptz,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_normalized check (email = lower(trim(email)))
);
create unique index profiles_email_unique on public.profiles (lower(email));

create table public.application_invitations (
  id uuid primary key default gen_random_uuid(),
  invited_email text not null,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  issued_by uuid not null references public.profiles(id),
  supersedes_id uuid references public.application_invitations(id),
  created_at timestamptz not null default now(),
  constraint invitation_email_normalized check (invited_email = lower(trim(invited_email))),
  constraint invitation_expiry_window check (expires_at > created_at and expires_at <= created_at + interval '7 days 5 minutes'),
  constraint invitation_terminal_state check (not (used_at is not null and revoked_at is not null))
);
create index invitation_email_idx on public.application_invitations (invited_email, created_at desc);

create table public.investor_applications (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null unique references public.application_invitations(id),
  legal_name text not null,
  email text not null,
  phone text not null,
  date_of_birth date not null,
  address text not null,
  district text not null,
  country text not null default 'Uganda',
  privacy_policy_version text not null,
  privacy_consented_at timestamptz not null,
  status public.application_status not null default 'submitted',
  kyc_verification_reference text,
  kyc_notes text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  auth_user_id uuid unique references auth.users(id) on delete restrict,
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_email_normalized check (email = lower(trim(email))),
  constraint application_decision_fields check (
    (status = 'submitted' and reviewed_at is null)
    or (status in ('approved', 'rejected') and reviewed_at is not null and reviewed_by is not null)
    or status = 'abandoned'
  )
);
create unique index active_application_email_unique on public.investor_applications (lower(email))
  where status in ('submitted', 'approved');

create table private.investor_identities (
  id uuid primary key default gen_random_uuid(),
  application_id uuid unique references public.investor_applications(id) on delete restrict,
  user_id uuid unique references auth.users(id) on delete restrict,
  nin_ciphertext bytea,
  nin_iv bytea,
  nin_auth_tag bytea,
  nin_fingerprint bytea unique,
  nin_last_four text,
  key_version smallint not null,
  erased_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint identity_owner check (application_id is not null or user_id is not null),
  constraint identity_envelope_complete check (
    (erased_at is null and nin_ciphertext is not null and nin_iv is not null and nin_auth_tag is not null and nin_fingerprint is not null and nin_last_four is not null)
    or (erased_at is not null and nin_ciphertext is null and nin_iv is null and nin_auth_tag is null and nin_fingerprint is null)
  )
);

create table public.next_of_kin (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete restrict,
  legal_name text not null,
  relationship text not null,
  phone text not null,
  email text,
  address text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agreement_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null,
  template_markdown text not null,
  content_hash text not null unique,
  is_legally_approved boolean not null default false,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  constraint approved_agreement_complete check (
    not is_legally_approved or (approved_by is not null and approved_at is not null and published_at is not null)
  )
);

create table public.investment_cycles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  maturity_date date not null,
  capacity_units integer not null check (capacity_units > 0),
  unit_price_ugx bigint not null default 125000 check (unit_price_ugx = 125000),
  projected_return_bps integer not null default 3000 check (projected_return_bps = 3000),
  status public.cycle_status not null default 'draft',
  agreement_version_id uuid not null references public.agreement_versions(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cycle_dates_valid check (opens_at < closes_at and closes_at::date <= maturity_date)
);
create unique index one_open_cycle on public.investment_cycles ((status)) where status = 'open';

create table public.investments (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid not null references public.profiles(id) on delete restrict,
  cycle_id uuid not null references public.investment_cycles(id) on delete restrict,
  units integer not null check (units between 1 and 500),
  unit_price_ugx bigint not null check (unit_price_ugx = 125000),
  principal_ugx bigint not null check (principal_ugx > 0),
  projected_return_bps integer not null check (projected_return_bps = 3000),
  projected_return_ugx bigint not null check (projected_return_ugx >= 0),
  projected_value_ugx bigint not null check (projected_value_ugx > 0),
  maturity_date date not null,
  reservation_expires_at timestamptz not null,
  status public.investment_status not null default 'reserved',
  requested_at timestamptz not null default now(),
  activated_at timestamptz,
  cancelled_at timestamptz,
  matured_at timestamptz,
  created_at timestamptz not null default now(),
  constraint investment_amount_math check (principal_ugx = units::bigint * unit_price_ugx),
  constraint investment_return_math check (projected_return_ugx = (principal_ugx * projected_return_bps) / 10000),
  constraint investment_value_math check (projected_value_ugx = principal_ugx + projected_return_ugx)
);
create index investments_investor_idx on public.investments (investor_id, requested_at desc);
create index investments_cycle_capacity_idx on public.investments (cycle_id, status);

create table public.investment_agreements (
  id uuid primary key default gen_random_uuid(),
  investment_id uuid not null unique references public.investments(id) on delete restrict,
  investor_id uuid not null references public.profiles(id) on delete restrict,
  agreement_version_id uuid not null references public.agreement_versions(id) on delete restrict,
  accepted_content_hash text not null,
  accepted_at timestamptz not null,
  acceptance_request_id uuid not null,
  accepted_user_agent text not null,
  accepted_ip_fingerprint bytea not null,
  pdf_status public.agreement_status not null default 'accepted',
  pdf_path text,
  pdf_hash text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint agreement_pdf_fields check (
    (pdf_status = 'ready' and pdf_path is not null and pdf_hash is not null and generated_at is not null)
    or pdf_status <> 'ready'
  )
);

create table public.bank_receipts (
  id uuid primary key default gen_random_uuid(),
  investment_id uuid not null unique references public.investments(id) on delete restrict,
  bank_reference text not null unique,
  received_amount_ugx bigint not null check (received_amount_ugx > 0),
  received_date date not null,
  recorded_by uuid not null references public.profiles(id),
  activated_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.bank_instructions (
  id uuid primary key default gen_random_uuid(),
  bank_name text not null,
  account_name text not null,
  account_number text not null,
  branch text,
  swift_code text,
  instructions text not null,
  is_active boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_active_bank_instruction on public.bank_instructions ((is_active)) where is_active;

create table public.account_closure_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  reason text,
  status public.closure_status not null default 'requested',
  requested_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  resolution_notes text,
  constraint closure_resolution check (
    (status = 'requested' and resolved_at is null and resolved_by is null)
    or (status in ('resolved', 'declined') and resolved_at is not null and resolved_by is not null)
  )
);
create unique index one_pending_closure on public.account_closure_requests (user_id) where status = 'requested';

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind public.job_kind not null,
  status public.job_status not null default 'pending',
  entity_type text not null,
  entity_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_payload_object check (jsonb_typeof(payload) = 'object')
);
create index jobs_work_queue_idx on public.jobs (status, available_at) where status in ('pending', 'failed');

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  request_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_metadata_object check (jsonb_typeof(metadata) = 'object')
);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, created_at desc);
create index audit_events_actor_idx on public.audit_events (actor_id, created_at desc);

create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles for each row execute function private.touch_updated_at();
create trigger applications_touch before update on public.investor_applications for each row execute function private.touch_updated_at();
create trigger identities_touch before update on private.investor_identities for each row execute function private.touch_updated_at();
create trigger next_of_kin_touch before update on public.next_of_kin for each row execute function private.touch_updated_at();
create trigger cycles_touch before update on public.investment_cycles for each row execute function private.touch_updated_at();
create trigger bank_instructions_touch before update on public.bank_instructions for each row execute function private.touch_updated_at();
create trigger jobs_touch before update on public.jobs for each row execute function private.touch_updated_at();

create or replace function private.reject_immutable_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = tg_table_name || ' records are immutable';
end;
$$;
create trigger bank_receipts_immutable before update or delete on public.bank_receipts for each row execute function private.reject_immutable_change();
create trigger audit_events_immutable before update or delete on public.audit_events for each row execute function private.reject_immutable_change();
create trigger agreement_versions_immutable before update or delete on public.agreement_versions
  for each row when (old.published_at is not null) execute function private.reject_immutable_change();

create or replace function private.guard_investment_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status in ('active', 'matured') and row(new.investor_id, new.cycle_id, new.units, new.unit_price_ugx,
    new.principal_ugx, new.projected_return_bps, new.projected_return_ugx, new.projected_value_ugx,
    new.maturity_date, new.reservation_expires_at) is distinct from
    row(old.investor_id, old.cycle_id, old.units, old.unit_price_ugx, old.principal_ugx,
    old.projected_return_bps, old.projected_return_ugx, old.projected_value_ugx, old.maturity_date,
    old.reservation_expires_at) then
    raise exception using errcode = '55000', message = 'activated investment terms are immutable';
  end if;
  return new;
end;
$$;
create trigger investment_immutable_guard before update on public.investments for each row execute function private.guard_investment_immutable();

create or replace function private.is_admin(check_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = check_user_id and p.role = 'admin' and p.access_status = 'active'
  );
$$;
revoke all on function private.is_admin(uuid) from public;
grant execute on function private.is_admin(uuid) to authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.application_invitations enable row level security;
alter table public.investor_applications enable row level security;
alter table public.next_of_kin enable row level security;
alter table public.agreement_versions enable row level security;
alter table public.investment_cycles enable row level security;
alter table public.investments enable row level security;
alter table public.investment_agreements enable row level security;
alter table public.bank_receipts enable row level security;
alter table public.bank_instructions enable row level security;
alter table public.account_closure_requests enable row level security;
alter table public.jobs enable row level security;
alter table public.audit_events enable row level security;
alter table private.investor_identities enable row level security;

create policy profiles_self_read on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_admin_read on public.profiles for select to authenticated using (private.is_admin());
create policy next_of_kin_self_read on public.next_of_kin for select to authenticated using (user_id = auth.uid());
create policy next_of_kin_admin_read on public.next_of_kin for select to authenticated using (private.is_admin());
create policy cycles_approved_investor_read on public.investment_cycles for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.access_status = 'active' and p.kyc_status = 'verified'));
create policy agreements_approved_investor_read on public.agreement_versions for select to authenticated
  using (published_at is not null and exists (select 1 from public.profiles p where p.id = auth.uid() and p.access_status = 'active' and p.kyc_status = 'verified'));
create policy investments_self_read on public.investments for select to authenticated using (investor_id = auth.uid());
create policy investments_admin_read on public.investments for select to authenticated using (private.is_admin());
create policy investment_agreements_self_read on public.investment_agreements for select to authenticated using (investor_id = auth.uid());
create policy investment_agreements_admin_read on public.investment_agreements for select to authenticated using (private.is_admin());
create policy bank_receipts_self_read on public.bank_receipts for select to authenticated
  using (exists (select 1 from public.investments i where i.id = investment_id and i.investor_id = auth.uid()));
create policy bank_receipts_admin_read on public.bank_receipts for select to authenticated using (private.is_admin());
create policy bank_instructions_approved_read on public.bank_instructions for select to authenticated
  using (is_active and exists (select 1 from public.profiles p where p.id = auth.uid() and p.access_status = 'active' and p.kyc_status = 'verified'));
create policy closure_self_read on public.account_closure_requests for select to authenticated using (user_id = auth.uid());
create policy closure_admin_read on public.account_closure_requests for select to authenticated using (private.is_admin());
create policy admin_invitations_read on public.application_invitations for select to authenticated using (private.is_admin());
create policy admin_applications_read on public.investor_applications for select to authenticated using (private.is_admin());
create policy admin_jobs_read on public.jobs for select to authenticated using (private.is_admin());
create policy audit_admin_read on public.audit_events for select to authenticated using (private.is_admin());
create policy audit_self_read on public.audit_events for select to authenticated using (actor_id = auth.uid());

revoke all on all tables in schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant select on public.profiles, public.next_of_kin, public.agreement_versions, public.investment_cycles,
  public.investments, public.investment_agreements, public.bank_receipts, public.bank_instructions,
  public.account_closure_requests, public.application_invitations, public.investor_applications,
  public.jobs, public.audit_events to authenticated;
grant all on all tables in schema public to service_role;
grant all on all tables in schema private to service_role;
grant usage, select on all sequences in schema public to service_role;

create or replace function public.request_investment(
  p_investor_id uuid,
  p_cycle_id uuid,
  p_units integer,
  p_request_id uuid,
  p_user_agent text,
  p_ip_fingerprint bytea
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_cycle public.investment_cycles%rowtype;
  v_profile public.profiles%rowtype;
  v_agreement public.agreement_versions%rowtype;
  v_investment_id uuid := gen_random_uuid();
  v_used_units integer;
  v_investor_units integer;
  v_principal bigint;
  v_return bigint;
begin
  if p_units < 1 or p_units > 500 then raise exception using errcode = '22023', message = 'units must be between 1 and 500'; end if;
  select * into v_profile from public.profiles where id = p_investor_id for update;
  if not found or v_profile.access_status <> 'active' or v_profile.kyc_status <> 'verified' then
    raise exception using errcode = '42501', message = 'investor is not eligible';
  end if;
  if not exists (select 1 from public.next_of_kin where user_id = p_investor_id) then
    raise exception using errcode = '23514', message = 'next of kin is required';
  end if;
  select * into v_cycle from public.investment_cycles where id = p_cycle_id for update;
  if not found or v_cycle.status <> 'open' or now() < v_cycle.opens_at or now() >= v_cycle.closes_at then
    raise exception using errcode = '23514', message = 'cycle is not open';
  end if;
  select * into v_agreement from public.agreement_versions where id = v_cycle.agreement_version_id;
  if not found or not v_agreement.is_legally_approved or v_agreement.published_at is null then
    raise exception using errcode = '23514', message = 'approved agreement is required';
  end if;
  select coalesce(sum(units), 0)::integer into v_used_units from public.investments
    where cycle_id = p_cycle_id and status in ('reserved', 'active');
  if v_used_units + p_units > v_cycle.capacity_units then
    raise exception using errcode = '23514', message = 'cycle capacity exceeded';
  end if;
  select coalesce(sum(units), 0)::integer into v_investor_units from public.investments
    where cycle_id = p_cycle_id and investor_id = p_investor_id and status in ('reserved', 'active');
  if v_investor_units + p_units > 500 then
    raise exception using errcode = '23514', message = 'investor cycle limit exceeded';
  end if;
  v_principal := p_units::bigint * v_cycle.unit_price_ugx;
  v_return := (v_principal * v_cycle.projected_return_bps) / 10000;
  insert into public.investments (id, investor_id, cycle_id, units, unit_price_ugx, principal_ugx,
    projected_return_bps, projected_return_ugx, projected_value_ugx, maturity_date, reservation_expires_at)
  values (v_investment_id, p_investor_id, p_cycle_id, p_units, v_cycle.unit_price_ugx, v_principal,
    v_cycle.projected_return_bps, v_return, v_principal + v_return, v_cycle.maturity_date, now() + interval '48 hours');
  insert into public.investment_agreements (investment_id, investor_id, agreement_version_id,
    accepted_content_hash, accepted_at, acceptance_request_id, accepted_user_agent, accepted_ip_fingerprint)
  values (v_investment_id, p_investor_id, v_agreement.id, v_agreement.content_hash, now(), p_request_id,
    left(coalesce(p_user_agent, 'unknown'), 500), p_ip_fingerprint);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_investor_id, 'investment.requested', 'investment', v_investment_id, p_request_id,
    jsonb_build_object('cycle_id', p_cycle_id, 'units', p_units));
  insert into public.jobs (kind, entity_type, entity_id, payload)
  values ('send_email', 'investment', v_investment_id, jsonb_build_object('template', 'reservation_created'));
  return v_investment_id;
end;
$$;

create or replace function public.cancel_investment(p_investor_id uuid, p_investment_id uuid, p_request_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.investments set status = 'cancelled', cancelled_at = now()
  where id = p_investment_id and investor_id = p_investor_id and status = 'reserved' and reservation_expires_at > now();
  if not found then raise exception using errcode = '23514', message = 'reservation cannot be cancelled'; end if;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id)
  values (p_investor_id, 'investment.cancelled', 'investment', p_investment_id, p_request_id);
end;
$$;

create or replace function public.activate_investment(
  p_admin_id uuid,
  p_investment_id uuid,
  p_bank_reference text,
  p_received_amount_ugx bigint,
  p_received_date date,
  p_confirmation text,
  p_admin_aal2 boolean,
  p_request_id uuid
) returns void language plpgsql security invoker set search_path = '' as $$
declare v_investment public.investments%rowtype;
begin
  if not private.is_admin(p_admin_id) or not p_admin_aal2 then
    raise exception using errcode = '42501', message = 'active administrator AAL2 required';
  end if;
  if p_confirmation <> 'ACTIVATE' then raise exception using errcode = '22023', message = 'typed confirmation is invalid'; end if;
  if nullif(trim(p_bank_reference), '') is null then raise exception using errcode = '22023', message = 'bank reference is required'; end if;
  if p_received_date > current_date then raise exception using errcode = '22023', message = 'received date cannot be in the future'; end if;
  select * into v_investment from public.investments where id = p_investment_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'investment not found'; end if;
  if v_investment.status = 'active' and exists (select 1 from public.bank_receipts where investment_id = p_investment_id and bank_reference = trim(p_bank_reference)) then return; end if;
  if v_investment.status <> 'reserved' or v_investment.reservation_expires_at <= now() then
    raise exception using errcode = '23514', message = 'only an unexpired reservation can be activated';
  end if;
  if p_received_amount_ugx <> v_investment.principal_ugx then
    raise exception using errcode = '23514', message = 'received amount must exactly match expected principal';
  end if;
  insert into public.bank_receipts (investment_id, bank_reference, received_amount_ugx, received_date, recorded_by, activated_at)
  values (p_investment_id, trim(p_bank_reference), p_received_amount_ugx, p_received_date, p_admin_id, now());
  update public.investments set status = 'active', activated_at = now() where id = p_investment_id;
  update public.investment_agreements set pdf_status = 'generating' where investment_id = p_investment_id;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_admin_id, 'investment.activated', 'investment', p_investment_id, p_request_id,
    jsonb_build_object('received_amount_ugx', p_received_amount_ugx, 'received_date', p_received_date));
  insert into public.jobs (kind, entity_type, entity_id, payload) values
    ('generate_agreement_pdf', 'investment', p_investment_id, '{}'::jsonb),
    ('send_email', 'investment', p_investment_id, jsonb_build_object('template', 'investment_activated'));
end;
$$;

create or replace function public.run_maintenance(p_request_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_expired integer; v_matured integer; v_anonymized integer;
begin
  with changed as (
    update public.investments set status = 'expired'
    where status = 'reserved' and reservation_expires_at <= now() returning id
  ) select count(*) into v_expired from changed;
  with changed as (
    update public.investments set status = 'matured', matured_at = now()
    where status = 'active' and maturity_date <= current_date returning id
  ) select count(*) into v_matured from changed;
  update private.investor_identities ii set nin_ciphertext = null, nin_iv = null, nin_auth_tag = null,
    nin_fingerprint = null, erased_at = now()
  from public.investor_applications a where ii.application_id = a.id and a.status = 'rejected' and ii.erased_at is null;
  with changed as (
    update public.investor_applications set legal_name = 'Anonymized applicant', email = 'anonymized+' || id || '@invalid.local',
      phone = '', address = '', district = '', kyc_notes = null, anonymized_at = now()
    where anonymized_at is null and status in ('rejected', 'abandoned') and created_at <= now() - interval '30 days'
    returning id
  ) select count(*) into v_anonymized from changed;
  insert into public.audit_events (action, entity_type, request_id, metadata)
  values ('maintenance.completed', 'system', p_request_id,
    jsonb_build_object('expired', v_expired, 'matured', v_matured, 'anonymized', v_anonymized));
  return jsonb_build_object('expired', v_expired, 'matured', v_matured, 'anonymized', v_anonymized);
end;
$$;

revoke all on function public.request_investment(uuid, uuid, integer, uuid, text, bytea) from public, anon, authenticated;
revoke all on function public.cancel_investment(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.activate_investment(uuid, uuid, text, bigint, date, text, boolean, uuid) from public, anon, authenticated;
revoke all on function public.run_maintenance(uuid) from public, anon, authenticated;
grant execute on function public.request_investment(uuid, uuid, integer, uuid, text, bytea) to service_role;
grant execute on function public.cancel_investment(uuid, uuid, uuid) to service_role;
grant execute on function public.activate_investment(uuid, uuid, text, bigint, date, text, boolean, uuid) to service_role;
grant execute on function public.run_maintenance(uuid) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agreements', 'agreements', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy agreement_pdf_owner_read on storage.objects for select to authenticated
using (
  bucket_id = 'agreements'
  and exists (
    select 1 from public.investment_agreements a
    where a.investor_id = auth.uid() and a.pdf_path = name and a.pdf_status = 'ready'
  )
);
create policy agreement_pdf_admin_read on storage.objects for select to authenticated
using (bucket_id = 'agreements' and private.is_admin());

commit;
