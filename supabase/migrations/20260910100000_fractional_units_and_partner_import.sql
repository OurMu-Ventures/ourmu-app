begin;

create type public.record_origin as enum ('portal', 'legacy_import', 'hybrid');
create type public.import_batch_status as enum ('staged', 'accepted', 'failed');
create type public.payout_basis as enum ('projected', 'reported_paid');

create table public.import_batches (
  id uuid primary key,
  source_filename text not null,
  source_sha256 text not null unique check (source_sha256 ~ '^[0-9a-f]{64}$'),
  status public.import_batch_status not null default 'staged',
  partner_count integer not null check (partner_count >= 0),
  profile_count integer not null check (profile_count >= 0),
  unclaimed_count integer not null check (unclaimed_count >= 0),
  cycle_count integer not null check (cycle_count >= 0),
  investment_count integer not null check (investment_count >= 0),
  monthly_summary_count integer not null check (monthly_summary_count >= 0),
  principal_total_ugx numeric(28,8) not null,
  return_total_ugx numeric(28,8) not null,
  payout_total_ugx numeric(28,8) not null,
  staged_by uuid not null references public.profiles(id) on delete restrict,
  staged_at timestamptz not null default now(),
  accepted_by uuid references public.profiles(id) on delete restrict,
  accepted_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  constraint import_batch_acceptance_complete check (
    (status = 'staged' and accepted_by is null and accepted_at is null)
    or (status = 'accepted' and accepted_by is not null and accepted_at is not null)
    or status = 'failed'
  )
);

alter table public.profiles
  add column import_batch_id uuid references public.import_batches(id) on delete restrict;
create index profiles_import_batch_idx on public.profiles (import_batch_id)
  where import_batch_id is not null;

create table public.legacy_partner_identities (
  id uuid primary key,
  import_batch_id uuid not null references public.import_batches(id) on delete restrict,
  profile_id uuid unique references public.profiles(id) on delete restrict,
  canonical_name text not null,
  normalized_email text,
  normalized_phone text,
  source_aliases jsonb not null default '[]'::jsonb,
  source_rows jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint legacy_partner_email_normalized check (
    normalized_email is null or normalized_email = lower(trim(normalized_email))
  ),
  constraint legacy_partner_arrays check (
    jsonb_typeof(source_aliases) = 'array' and jsonb_typeof(source_rows) = 'array'
  ),
  unique (import_batch_id, canonical_name)
);
create index legacy_partner_profile_idx on public.legacy_partner_identities (profile_id)
  where profile_id is not null;
create index legacy_partner_batch_idx on public.legacy_partner_identities (import_batch_id);

alter table public.investment_cycles
  add column capacity_ugx numeric(28,8),
  add column record_origin public.record_origin not null default 'portal',
  add column import_batch_id uuid references public.import_batches(id) on delete restrict;

update public.investment_cycles
set capacity_ugx = capacity_units::numeric * unit_price_ugx::numeric;

alter table public.investment_cycles
  drop constraint if exists investment_cycles_capacity_units_check,
  drop constraint if exists investment_cycles_unit_price_ugx_check,
  drop constraint if exists investment_cycles_projected_return_bps_check,
  drop column capacity_units,
  alter column unit_price_ugx type numeric(28,8) using unit_price_ugx::numeric,
  alter column agreement_version_id drop not null;

alter table public.investment_cycles
  add column capacity_units numeric(28,14)
    generated always as (round(capacity_ugx / unit_price_ugx, 14)) stored,
  add constraint cycle_unit_price_fixed check (unit_price_ugx = 125000::numeric),
  add constraint cycle_return_fixed check (projected_return_bps = 3000),
  add constraint cycle_origin_fields check (
    (record_origin = 'portal' and import_batch_id is null and capacity_ugx > 0 and agreement_version_id is not null)
    or (record_origin = 'hybrid' and import_batch_id is not null and capacity_ugx > 0 and agreement_version_id is not null)
    or (record_origin = 'legacy_import' and import_batch_id is not null and capacity_ugx is null
      and agreement_version_id is null and status in ('closed', 'matured'))
  );

create index investment_cycles_import_batch_idx on public.investment_cycles (import_batch_id)
  where import_batch_id is not null;

drop trigger investment_immutable_guard on public.investments;
alter table public.investments
  drop constraint if exists investments_units_check,
  drop constraint if exists investments_unit_price_ugx_check,
  drop constraint if exists investments_principal_ugx_check,
  drop constraint if exists investments_projected_return_bps_check,
  drop constraint if exists investments_projected_return_ugx_check,
  drop constraint if exists investments_projected_value_ugx_check,
  drop constraint if exists investment_amount_math,
  drop constraint if exists investment_return_math,
  drop constraint if exists investment_value_math,
  drop column units,
  alter column investor_id drop not null,
  alter column reservation_expires_at drop not null,
  alter column unit_price_ugx type numeric(28,8) using unit_price_ugx::numeric,
  alter column principal_ugx type numeric(28,8) using principal_ugx::numeric,
  alter column projected_return_ugx type numeric(28,8) using projected_return_ugx::numeric,
  alter column projected_value_ugx type numeric(28,8) using projected_value_ugx::numeric;

alter table public.investments
  add column units numeric(28,14)
    generated always as (round(principal_ugx / unit_price_ugx, 14)) stored,
  add column record_origin public.record_origin not null default 'portal',
  add column import_batch_id uuid references public.import_batches(id) on delete restrict,
  add column legacy_partner_id uuid references public.legacy_partner_identities(id) on delete restrict,
  add column source_sheet text,
  add column source_row integer,
  add column source_key text unique,
  add column payout_basis public.payout_basis not null default 'projected',
  add column reported_return_ugx numeric(28,8),
  add column reported_payout_ugx numeric(28,8),
  add constraint investment_unit_price_fixed check (unit_price_ugx = 125000::numeric),
  add constraint investment_principal_positive check (principal_ugx > 0),
  add constraint investment_return_nonnegative check (projected_return_ugx >= 0),
  add constraint investment_value_positive check (projected_value_ugx > 0),
  add constraint investment_return_math_decimal check (
    (record_origin = 'portal' and projected_return_ugx = round((principal_ugx * projected_return_bps::numeric) / 10000::numeric, 8))
    or (record_origin = 'legacy_import' and abs(projected_return_ugx -
      ((principal_ugx * projected_return_bps::numeric) / 10000::numeric)) <= 0.0000001)
  ),
  add constraint investment_value_math_decimal check (
    (record_origin = 'portal' and projected_value_ugx = principal_ugx + projected_return_ugx)
    or (record_origin = 'legacy_import' and abs(projected_value_ugx -
      (principal_ugx + projected_return_ugx)) <= 0.0000001)
  ),
  add constraint investment_reported_values check (
    (payout_basis = 'projected' and reported_return_ugx is null and reported_payout_ugx is null)
    or (payout_basis = 'reported_paid' and reported_return_ugx = projected_return_ugx
      and reported_payout_ugx = projected_value_ugx)
  ),
  add constraint investment_origin_fields check (
    (record_origin = 'portal' and investor_id is not null and legacy_partner_id is null
      and import_batch_id is null and source_sheet is null and source_row is null and source_key is null
      and projected_return_bps = 3000 and principal_ugx between 125000 and 62500000
      and principal_ugx = round(principal_ugx, 2) and reservation_expires_at is not null)
    or (record_origin = 'legacy_import' and legacy_partner_id is not null and import_batch_id is not null
      and source_sheet is not null and source_row >= 2 and source_key is not null
      and projected_return_bps in (3000, 3500) and principal_ugx >= 125000
      and reservation_expires_at is null and status in ('active', 'matured'))
  );

create index investments_import_batch_idx on public.investments (import_batch_id)
  where import_batch_id is not null;
create index investments_legacy_partner_idx on public.investments (legacy_partner_id)
  where legacy_partner_id is not null;
create index investments_investor_cycle_capacity_idx
  on public.investments (investor_id, cycle_id)
  where status in ('reserved', 'active');
comment on table public.investments is
  'Each row is a distinct investment placement. One investor may have multiple placements in the same monthly cycle.';

alter table public.bank_receipts
  drop constraint if exists bank_receipts_received_amount_ugx_check,
  alter column received_amount_ugx type numeric(28,8) using received_amount_ugx::numeric,
  add constraint bank_receipt_amount_positive check (received_amount_ugx > 0);

create table public.legacy_monthly_financial_summaries (
  id uuid primary key,
  import_batch_id uuid not null references public.import_batches(id) on delete restrict,
  month_label text not null,
  month_start date not null,
  entry_count integer not null check (entry_count >= 0),
  total_investment_ugx numeric(28,8) not null,
  partner_return_ugx numeric(28,8) not null,
  payout_ugx numeric(28,8) not null,
  ourmu_receivable_ugx numeric(28,8) not null,
  profit_margin_ugx numeric(28,8) not null,
  created_at timestamptz not null default now(),
  unique (import_batch_id, month_start),
  constraint legacy_summary_math check (
    abs(payout_ugx - (total_investment_ugx + partner_return_ugx)) <= 0.000001
  )
);
create index legacy_summary_batch_idx on public.legacy_monthly_financial_summaries (import_batch_id);

create function private.guard_legacy_summary_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'legacy financial summaries are immutable';
end;
$$;
create trigger legacy_summary_immutable_guard
before update or delete on public.legacy_monthly_financial_summaries
for each row execute function private.guard_legacy_summary_immutable();

create or replace function private.guard_investment_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.record_origin = 'legacy_import' and old.investor_id is null and new.investor_id is not null
    and row(new.cycle_id, new.unit_price_ugx, new.principal_ugx, new.projected_return_bps,
      new.projected_return_ugx, new.projected_value_ugx, new.maturity_date,
      new.reservation_expires_at, new.record_origin, new.import_batch_id, new.legacy_partner_id,
      new.source_sheet, new.source_row, new.source_key, new.payout_basis,
      new.reported_return_ugx, new.reported_payout_ugx) is not distinct from
    row(old.cycle_id, old.unit_price_ugx, old.principal_ugx, old.projected_return_bps,
      old.projected_return_ugx, old.projected_value_ugx, old.maturity_date,
      old.reservation_expires_at, old.record_origin, old.import_batch_id, old.legacy_partner_id,
      old.source_sheet, old.source_row, old.source_key, old.payout_basis,
      old.reported_return_ugx, old.reported_payout_ugx) then
    return new;
  end if;
  if old.status in ('active', 'matured') and row(new.investor_id, new.cycle_id, new.unit_price_ugx,
    new.principal_ugx, new.projected_return_bps, new.projected_return_ugx, new.projected_value_ugx,
    new.maturity_date, new.reservation_expires_at, new.record_origin, new.import_batch_id,
    new.legacy_partner_id, new.source_sheet, new.source_row, new.source_key, new.payout_basis,
    new.reported_return_ugx, new.reported_payout_ugx) is distinct from
    row(old.investor_id, old.cycle_id, old.unit_price_ugx, old.principal_ugx,
    old.projected_return_bps, old.projected_return_ugx, old.projected_value_ugx, old.maturity_date,
    old.reservation_expires_at, old.record_origin, old.import_batch_id, old.legacy_partner_id,
    old.source_sheet, old.source_row, old.source_key, old.payout_basis, old.reported_return_ugx,
    old.reported_payout_ugx) then
    raise exception using errcode = '55000', message = 'activated investment terms are immutable';
  end if;
  return new;
end;
$$;
create trigger investment_immutable_guard before update on public.investments
  for each row execute function private.guard_investment_immutable();

drop policy investments_self_read on public.investments;
create policy investments_self_read on public.investments for select to authenticated
using (
  investor_id = (select auth.uid())
  and (
    record_origin = 'portal'
    or exists (
      select 1 from public.import_batches b
      where b.id = investments.import_batch_id and b.status = 'accepted'
    )
  )
);

alter table public.import_batches enable row level security;
alter table public.legacy_partner_identities enable row level security;
alter table public.legacy_monthly_financial_summaries enable row level security;

create policy import_batches_admin_read on public.import_batches for select to authenticated
  using ((select private.is_admin()));
create policy legacy_partners_admin_read on public.legacy_partner_identities for select to authenticated
  using ((select private.is_admin()));
create policy legacy_partners_self_read on public.legacy_partner_identities for select to authenticated
  using (
    profile_id = (select auth.uid())
    and exists (
      select 1 from public.import_batches b
      where b.id = legacy_partner_identities.import_batch_id and b.status = 'accepted'
    )
  );
create policy legacy_summaries_admin_read on public.legacy_monthly_financial_summaries for select to authenticated
  using ((select private.is_admin()));

revoke all on public.import_batches, public.legacy_partner_identities,
  public.legacy_monthly_financial_summaries from public, anon, authenticated;
grant select on public.import_batches, public.legacy_partner_identities,
  public.legacy_monthly_financial_summaries to authenticated;
grant all on public.import_batches, public.legacy_partner_identities,
  public.legacy_monthly_financial_summaries to service_role;

create or replace function public.request_investment(
  p_investor_id uuid,
  p_cycle_id uuid,
  p_principal_ugx numeric,
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
  v_used_principal numeric(28,8);
  v_investor_principal numeric(28,8);
  v_return numeric(28,8);
begin
  if p_principal_ugx < 125000 or p_principal_ugx > 62500000 or p_principal_ugx <> round(p_principal_ugx, 2) then
    raise exception using errcode = '22023', message = 'amount must be UGX 125,000–62,500,000 with at most two decimals';
  end if;
  select * into v_profile from public.profiles where id = p_investor_id for update;
  if not found or v_profile.access_status <> 'active' or v_profile.kyc_status <> 'verified' then
    raise exception using errcode = '42501', message = 'investor is not eligible';
  end if;
  if not exists (select 1 from public.next_of_kin where user_id = p_investor_id) then
    raise exception using errcode = '23514', message = 'next of kin is required';
  end if;
  select * into v_cycle from public.investment_cycles where id = p_cycle_id for update;
  if not found or v_cycle.status <> 'open' or now() < v_cycle.opens_at or now() >= v_cycle.closes_at
    or v_cycle.capacity_ugx is null then
    raise exception using errcode = '23514', message = 'cycle is not open';
  end if;
  select * into v_agreement from public.agreement_versions where id = v_cycle.agreement_version_id;
  if not found or not v_agreement.is_legally_approved or v_agreement.published_at is null then
    raise exception using errcode = '23514', message = 'approved agreement is required';
  end if;
  select coalesce(sum(principal_ugx), 0)::numeric(28,8) into v_used_principal
    from public.investments where cycle_id = p_cycle_id and status in ('reserved', 'active');
  if v_used_principal + p_principal_ugx > v_cycle.capacity_ugx then
    raise exception using errcode = '23514', message = 'cycle capacity exceeded';
  end if;
  select coalesce(sum(principal_ugx), 0)::numeric(28,8) into v_investor_principal
    from public.investments
    where cycle_id = p_cycle_id and investor_id = p_investor_id and status in ('reserved', 'active');
  if v_investor_principal + p_principal_ugx > 62500000 then
    raise exception using errcode = '23514', message = 'investor cycle limit exceeded';
  end if;
  v_return := round((p_principal_ugx * v_cycle.projected_return_bps::numeric) / 10000::numeric, 8);
  insert into public.investments (id, investor_id, cycle_id, unit_price_ugx, principal_ugx,
    projected_return_bps, projected_return_ugx, projected_value_ugx, maturity_date,
    reservation_expires_at, record_origin)
  values (v_investment_id, p_investor_id, p_cycle_id, v_cycle.unit_price_ugx, p_principal_ugx,
    v_cycle.projected_return_bps, v_return, p_principal_ugx + v_return, v_cycle.maturity_date,
    now() + interval '48 hours', 'portal');
  insert into public.investment_agreements (investment_id, investor_id, agreement_version_id,
    accepted_content_hash, accepted_at, acceptance_request_id, accepted_user_agent, accepted_ip_fingerprint)
  values (v_investment_id, p_investor_id, v_agreement.id, v_agreement.content_hash, now(), p_request_id,
    left(coalesce(p_user_agent, 'unknown'), 500), p_ip_fingerprint);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_investor_id, 'investment.requested', 'investment', v_investment_id, p_request_id,
    jsonb_build_object('cycle_id', p_cycle_id, 'principal_ugx', p_principal_ugx));
  insert into public.jobs (kind, entity_type, entity_id, payload)
  values ('send_email', 'investment', v_investment_id, jsonb_build_object('template', 'reservation_created'));
  return v_investment_id;
end;
$$;

create or replace function public.activate_investment(
  p_admin_id uuid,
  p_investment_id uuid,
  p_bank_reference text,
  p_received_amount_ugx numeric,
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
  if v_investment.record_origin <> 'portal' then
    raise exception using errcode = '23514', message = 'imported investments cannot be activated';
  end if;
  if v_investment.status = 'active' and exists (
    select 1 from public.bank_receipts where investment_id = p_investment_id and bank_reference = trim(p_bank_reference)
  ) then return; end if;
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

revoke all on function public.request_investment(uuid, uuid, integer, uuid, text, bytea) from public, anon, authenticated, service_role;
drop function public.request_investment(uuid, uuid, integer, uuid, text, bytea);
revoke all on function public.activate_investment(uuid, uuid, text, bigint, date, text, boolean, uuid) from public, anon, authenticated, service_role;
drop function public.activate_investment(uuid, uuid, text, bigint, date, text, boolean, uuid);
revoke all on function public.request_investment(uuid, uuid, numeric, uuid, text, bytea) from public, anon, authenticated;
revoke all on function public.activate_investment(uuid, uuid, text, numeric, date, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.request_investment(uuid, uuid, numeric, uuid, text, bytea) to service_role;
grant execute on function public.activate_investment(uuid, uuid, text, numeric, date, text, boolean, uuid) to service_role;

create or replace function public.stage_partner_import(
  p_admin_id uuid,
  p_manifest jsonb,
  p_request_id uuid
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_batch_id uuid := (p_manifest->>'batch_id')::uuid;
  v_existing public.import_batches%rowtype;
  v_agreement_id uuid;
  v_principal numeric(28,8);
  v_return numeric(28,8);
  v_payout numeric(28,8);
begin
  perform pg_advisory_xact_lock(hashtext('ourmu_partner_import'));
  if not private.is_admin(p_admin_id) then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;
  if coalesce(p_manifest->>'source_sha256', '') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'valid source workbook checksum is required';
  end if;
  select * into v_existing from public.import_batches where id = v_batch_id;
  if found then return v_existing.id; end if;
  if jsonb_array_length(p_manifest->'profiles') <> (p_manifest->'summary'->>'profiles')::integer
    or jsonb_array_length(p_manifest->'partners') <> (p_manifest->'summary'->>'partners')::integer
    or jsonb_array_length(p_manifest->'cycles') <> (p_manifest->'summary'->>'cycles')::integer
    or jsonb_array_length(p_manifest->'investments') <> (p_manifest->'summary'->>'investments')::integer
    or jsonb_array_length(p_manifest->'monthly_summaries') <> (p_manifest->'summary'->>'summaries')::integer then
    raise exception using errcode = '22023', message = 'manifest record counts do not reconcile';
  end if;
  select id into v_agreement_id from public.agreement_versions
  where version = p_manifest->>'agreement_version' and is_legally_approved and published_at is not null;
  if v_agreement_id is null then
    raise exception using errcode = '23514', message = 'manifest approved agreement is required';
  end if;

  insert into public.import_batches (id, source_filename, source_sha256, status, partner_count,
    profile_count, unclaimed_count, cycle_count, investment_count, monthly_summary_count,
    principal_total_ugx, return_total_ugx, payout_total_ugx, staged_by)
  values (v_batch_id, p_manifest->>'source_filename', p_manifest->>'source_sha256', 'staged',
    (p_manifest->'summary'->>'partners')::integer,
    (p_manifest->'summary'->>'profiles')::integer,
    (p_manifest->'summary'->>'unclaimed')::integer,
    (p_manifest->'summary'->>'cycles')::integer,
    (p_manifest->'summary'->>'investments')::integer,
    (p_manifest->'summary'->>'summaries')::integer,
    (p_manifest->'summary'->>'principal')::numeric,
    (p_manifest->'summary'->>'returns')::numeric,
    (p_manifest->'summary'->>'payout')::numeric, p_admin_id);

  insert into public.profiles (id, role, access_status, legal_name, email, phone, country,
    kyc_status, import_batch_id)
  select (x->>'id')::uuid, 'investor', 'disabled', x->>'legal_name', lower(trim(x->>'email')),
    nullif(x->>'phone', ''), 'Uganda', 'pending', v_batch_id
  from jsonb_array_elements(p_manifest->'profiles') x;

  insert into public.legacy_partner_identities (id, import_batch_id, profile_id, canonical_name,
    normalized_email, normalized_phone, source_aliases, source_rows)
  select (x->>'id')::uuid, v_batch_id, nullif(x->>'profile_id', '')::uuid,
    x->>'canonical_name', nullif(x->>'email', ''), nullif(x->>'phone', ''),
    coalesce(x->'aliases', '[]'::jsonb), coalesce(x->'source_rows', '[]'::jsonb)
  from jsonb_array_elements(p_manifest->'partners') x;

  insert into public.investment_cycles (id, name, opens_at, closes_at, maturity_date,
    capacity_ugx, unit_price_ugx, projected_return_bps, status, agreement_version_id,
    created_by, record_origin, import_batch_id)
  select (x->>'id')::uuid, x->>'name', (x->>'opens_at')::timestamptz,
    (x->>'closes_at')::timestamptz, (x->>'maturity_date')::date,
    nullif(x->>'capacity_ugx', '')::numeric, 125000, 3000,
    (x->>'status')::public.cycle_status,
    case when x->>'record_origin' = 'hybrid' then v_agreement_id else null end,
    p_admin_id, (x->>'record_origin')::public.record_origin, v_batch_id
  from jsonb_array_elements(p_manifest->'cycles') x;

  insert into public.investments (id, investor_id, cycle_id, unit_price_ugx, principal_ugx,
    projected_return_bps, projected_return_ugx, projected_value_ugx, maturity_date,
    reservation_expires_at, status, requested_at, record_origin, import_batch_id,
    legacy_partner_id, source_sheet, source_row, source_key, payout_basis,
    reported_return_ugx, reported_payout_ugx)
  select (x->>'id')::uuid, nullif(x->>'investor_id', '')::uuid, (x->>'cycle_id')::uuid,
    125000, (x->>'principal_ugx')::numeric, (x->>'return_bps')::integer,
    (x->>'return_ugx')::numeric, (x->>'payout_ugx')::numeric,
    (x->>'maturity_date')::date, null, (x->>'status')::public.investment_status,
    (x->>'requested_at')::timestamptz, 'legacy_import', v_batch_id,
    (x->>'legacy_partner_id')::uuid, x->>'source_sheet', (x->>'source_row')::integer,
    x->>'source_key', (x->>'payout_basis')::public.payout_basis,
    nullif(x->>'reported_return_ugx', '')::numeric,
    nullif(x->>'reported_payout_ugx', '')::numeric
  from jsonb_array_elements(p_manifest->'investments') x;

  insert into public.legacy_monthly_financial_summaries (id, import_batch_id, month_label,
    month_start, entry_count, total_investment_ugx, partner_return_ugx, payout_ugx,
    ourmu_receivable_ugx, profit_margin_ugx)
  select (x->>'id')::uuid, v_batch_id, x->>'month_label', (x->>'month_start')::date,
    (x->>'entry_count')::integer, (x->>'total_investment_ugx')::numeric,
    (x->>'partner_return_ugx')::numeric, (x->>'payout_ugx')::numeric,
    (x->>'ourmu_receivable_ugx')::numeric, (x->>'profit_margin_ugx')::numeric
  from jsonb_array_elements(p_manifest->'monthly_summaries') x;

  select sum(principal_ugx), sum(projected_return_ugx), sum(projected_value_ugx)
  into v_principal, v_return, v_payout
  from public.investments where import_batch_id = v_batch_id;
  if v_principal <> (p_manifest->'summary'->>'principal')::numeric
    or v_return <> (p_manifest->'summary'->>'returns')::numeric
    or v_payout <> (p_manifest->'summary'->>'payout')::numeric
    or (select count(*) from public.investments where import_batch_id = v_batch_id and status = 'matured') <> (p_manifest->'summary'->>'matured')::integer
    or (select count(*) from public.investments where import_batch_id = v_batch_id and status = 'active') <> (p_manifest->'summary'->>'active')::integer
    or (select count(*) from public.investments where import_batch_id = v_batch_id and projected_return_bps = 3500) <> (p_manifest->'summary'->>'rate35')::integer
    or (select count(*) from public.legacy_partner_identities where import_batch_id = v_batch_id and profile_id is null) <> (p_manifest->'summary'->>'unclaimed')::integer then
    raise exception using errcode = '23514', message = 'staged import failed financial reconciliation';
  end if;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_admin_id, 'partner_import.staged', 'import_batch', v_batch_id, p_request_id,
    jsonb_build_object('source_sha256', p_manifest->>'source_sha256',
      'partners', (p_manifest->'summary'->>'partners')::integer,
      'profiles', (p_manifest->'summary'->>'profiles')::integer,
      'investments', (p_manifest->'summary'->>'investments')::integer));
  return v_batch_id;
end;
$$;

create or replace function public.accept_partner_import(
  p_admin_id uuid,
  p_batch_id uuid,
  p_confirmation text,
  p_admin_aal2 boolean,
  p_request_id uuid
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_batch public.import_batches%rowtype;
  v_opened integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('ourmu_partner_import'));
  if not private.is_admin(p_admin_id) or not p_admin_aal2 then
    raise exception using errcode = '42501', message = 'active administrator AAL2 required';
  end if;
  if p_confirmation <> 'ACCEPT IMPORT' then
    raise exception using errcode = '22023', message = 'typed confirmation is invalid';
  end if;
  select * into v_batch from public.import_batches where id = p_batch_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'import batch not found'; end if;
  if v_batch.status = 'accepted' then
    return jsonb_build_object('batch_id', p_batch_id, 'already_accepted', true);
  end if;
  if v_batch.status <> 'staged'
    or (select count(*) from public.profiles where import_batch_id = p_batch_id) <> v_batch.profile_count
    or (select count(*) from public.legacy_partner_identities where import_batch_id = p_batch_id) <> v_batch.partner_count
    or (select count(*) from public.investment_cycles where import_batch_id = p_batch_id) <> v_batch.cycle_count
    or (select count(*) from public.investments where import_batch_id = p_batch_id) <> v_batch.investment_count
    or (select count(*) from public.legacy_monthly_financial_summaries where import_batch_id = p_batch_id) <> v_batch.monthly_summary_count then
    raise exception using errcode = '23514', message = 'import batch cannot be accepted';
  end if;
  update public.profiles set access_status = 'active' where import_batch_id = p_batch_id;
  update public.investment_cycles
  set status = case when now() < closes_at then 'open'::public.cycle_status else 'closed'::public.cycle_status end
  where import_batch_id = p_batch_id and record_origin = 'hybrid';
  get diagnostics v_opened = row_count;
  update public.import_batches
  set status = 'accepted', accepted_by = p_admin_id, accepted_at = now()
  where id = p_batch_id;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_admin_id, 'partner_import.accepted', 'import_batch', p_batch_id, p_request_id,
    jsonb_build_object('profiles_activated', v_batch.profile_count,
      'cycles_processed', v_opened, 'investments', v_batch.investment_count));
  return jsonb_build_object('batch_id', p_batch_id,
    'profiles_activated', v_batch.profile_count,
    'cycles_processed', v_opened, 'investments', v_batch.investment_count);
end;
$$;

create or replace function public.link_legacy_partner(
  p_admin_id uuid,
  p_legacy_partner_id uuid,
  p_auth_user_id uuid,
  p_email text,
  p_phone text,
  p_confirmation text,
  p_admin_aal2 boolean,
  p_request_id uuid
) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_partner public.legacy_partner_identities%rowtype;
begin
  if not private.is_admin(p_admin_id) or not p_admin_aal2 then
    raise exception using errcode = '42501', message = 'active administrator AAL2 required';
  end if;
  if p_confirmation <> 'LINK PARTNER' then
    raise exception using errcode = '22023', message = 'typed confirmation is invalid';
  end if;
  select * into v_partner from public.legacy_partner_identities
  where id = p_legacy_partner_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'legacy partner not found'; end if;
  if v_partner.profile_id is not null then return; end if;
  if not exists (
    select 1 from public.import_batches where id = v_partner.import_batch_id and status = 'accepted'
  ) then raise exception using errcode = '23514', message = 'only an accepted import can be linked'; end if;
  insert into public.profiles (id, role, access_status, legal_name, email, phone, country,
    kyc_status, import_batch_id)
  values (p_auth_user_id, 'investor', 'active', v_partner.canonical_name, lower(trim(p_email)),
    nullif(trim(p_phone), ''), 'Uganda', 'pending', v_partner.import_batch_id);
  update public.legacy_partner_identities
  set profile_id = p_auth_user_id, normalized_email = lower(trim(p_email)),
    normalized_phone = coalesce(nullif(trim(p_phone), ''), normalized_phone)
  where id = p_legacy_partner_id;
  update public.investments set investor_id = p_auth_user_id
  where legacy_partner_id = p_legacy_partner_id and investor_id is null;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_admin_id, 'legacy_partner.linked', 'legacy_partner', p_legacy_partner_id,
    p_request_id, jsonb_build_object('auth_user_id', p_auth_user_id));
end;
$$;

revoke all on function public.stage_partner_import(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.accept_partner_import(uuid, uuid, text, boolean, uuid) from public, anon, authenticated;
revoke all on function public.link_legacy_partner(uuid, uuid, uuid, text, text, text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.stage_partner_import(uuid, jsonb, uuid) to service_role;
grant execute on function public.accept_partner_import(uuid, uuid, text, boolean, uuid) to service_role;
grant execute on function public.link_legacy_partner(uuid, uuid, uuid, text, text, text, boolean, uuid)
  to service_role;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;

commit;
