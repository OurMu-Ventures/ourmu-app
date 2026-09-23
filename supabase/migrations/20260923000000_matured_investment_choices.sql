begin;

-- Matured investment choices: partner instructions, payout destinations,
-- launch-gated auto-reinvestment, and payout-day handling in maintenance.

create type public.maturity_choice as enum (
  'withdraw_all',
  'withdraw_roi_reinvest_principal',
  'reinvest_all'
);
create type public.maturity_instruction_status as enum (
  'requested',
  'processing',
  'fulfilled'
);
create type public.payout_channel as enum ('bank', 'mobile_money');

-- Saved payout destinations. The account reference itself is encrypted by the
-- application layer (AES-256-GCM); the database keeps only the envelope, a
-- lookup fingerprint, and the last four characters for display.
create table public.payout_destinations (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid not null references public.profiles(id) on delete restrict,
  channel public.payout_channel not null,
  provider_label text not null,
  account_name text not null,
  account_ref_ciphertext bytea not null,
  account_ref_iv bytea not null,
  account_ref_auth_tag bytea not null,
  account_ref_fingerprint bytea not null,
  account_last_four text not null,
  key_version smallint not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (investor_id, account_ref_fingerprint)
);
create index payout_destinations_investor_idx
  on public.payout_destinations (investor_id, is_active);

-- One auditable maturity instruction per investment. The instruction status
-- (requested/processing/fulfilled) is independent of the investment status
-- (matured). Revisions are allowed while status = 'requested'.
create table public.maturity_instructions (
  id uuid primary key default gen_random_uuid(),
  investment_id uuid not null unique references public.investments(id) on delete restrict,
  investor_id uuid not null references public.profiles(id) on delete restrict,
  choice public.maturity_choice not null,
  status public.maturity_instruction_status not null default 'requested',
  projected_payout_ugx numeric(28,8) not null check (projected_payout_ugx >= 0),
  projected_reinvest_ugx numeric(28,8) not null check (projected_reinvest_ugx >= 0),
  actual_roi_ugx numeric(28,8) check (actual_roi_ugx is null or actual_roi_ugx >= 0),
  actual_payout_ugx numeric(28,8) check (actual_payout_ugx is null or actual_payout_ugx >= 0),
  actual_reinvest_ugx numeric(28,8) check (actual_reinvest_ugx is null or actual_reinvest_ugx >= 0),
  payout_destination_id uuid references public.payout_destinations(id) on delete restrict,
  target_cycle_id uuid references public.investment_cycles(id) on delete restrict,
  target_agreement_version_id uuid references public.agreement_versions(id) on delete restrict,
  agreement_accepted boolean not null default false,
  destination_confirmed boolean not null default false,
  needs_resolution boolean not null default false,
  payout_reference text,
  payout_verified_at timestamptz,
  fulfilled_investment_id uuid references public.investments(id) on delete restrict,
  processed_by uuid references public.profiles(id) on delete restrict,
  processed_at timestamptz,
  fulfilled_at timestamptz,
  revision_count integer not null default 0 check (revision_count >= 0),
  request_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maturity_instruction_amounts check (
    (projected_payout_ugx > 0 or projected_reinvest_ugx > 0)
  ),
  constraint maturity_instruction_choice_amounts check (
    (choice = 'withdraw_all' and projected_reinvest_ugx = 0 and projected_payout_ugx > 0)
    or (choice = 'withdraw_roi_reinvest_principal' and projected_payout_ugx > 0 and projected_reinvest_ugx > 0)
    or (choice = 'reinvest_all' and projected_payout_ugx = 0 and projected_reinvest_ugx > 0)
  ),
  constraint maturity_instruction_fulfillment_fields check (
    (status <> 'fulfilled')
    or (actual_roi_ugx is not null and actual_payout_ugx is not null
      and actual_reinvest_ugx is not null and fulfilled_at is not null)
  ),
  constraint maturity_instruction_processing_fields check (
    (status = 'requested' and processed_by is null and processed_at is null)
    or status in ('processing', 'fulfilled')
  )
);
create index maturity_instructions_investor_idx
  on public.maturity_instructions (investor_id, status);
create index maturity_instructions_status_idx
  on public.maturity_instructions (status, created_at);

-- Launch gate: automatic full reinvestment of unanswered portal maturities
-- stays disabled until a documented legal basis is approved.
create table public.maturity_policy_gates (
  name text primary key,
  enabled boolean not null default false,
  updated_by uuid references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  notes text
);
insert into public.maturity_policy_gates (name, enabled, notes)
values (
  'current_agreement_auto_reinvest', false,
  'Disabled launch gate: unanswered portal maturities must never silently '
  'reinvest until a documented legal basis for the current agreement is approved.'
);

-- Standing authorizations from previously accepted terms. Auto-reinvestment
-- on payout day requires both the launch gate above and a live row here.
create table public.maturity_reinvest_authorizations (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid not null references public.profiles(id) on delete restrict,
  scope text not null default 'all_portal' check (scope = 'all_portal'),
  authorized_at timestamptz not null default now(),
  authorized_by uuid references public.profiles(id) on delete restrict,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (investor_id, scope)
);
create index maturity_authorizations_investor_idx
  on public.maturity_reinvest_authorizations (investor_id)
  where revoked_at is null;

create trigger payout_destinations_touch
  before update on public.payout_destinations
  for each row execute function private.touch_updated_at();
create trigger maturity_instructions_touch
  before update on public.maturity_instructions
  for each row execute function private.touch_updated_at();
create trigger maturity_policy_gates_touch
  before update on public.maturity_policy_gates
  for each row execute function private.touch_updated_at();

-- Scheduled payout day: the 15th of the maturity month.
create or replace function public.maturity_payout_date(p_maturity_date date)
returns date language sql immutable set search_path = '' as $$
  select make_date(
    extract(year from p_maturity_date)::integer,
    extract(month from p_maturity_date)::integer,
    15
  );
$$;

-- New portal cycles must mature on or before the payout day. Historical
-- imports are excluded from this rule.
create or replace function private.guard_cycle_maturity_day() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.record_origin = 'portal'
    and extract(day from new.maturity_date)::integer > 15 then
    raise exception using errcode = '23514',
      message = 'portal cycle maturity must fall on or before the 15th payout day';
  end if;
  return new;
end;
$$;
create trigger cycle_maturity_day_guard
  before insert or update of maturity_date, record_origin on public.investment_cycles
  for each row execute function private.guard_cycle_maturity_day();

-- Partner submission: exactly one instruction per investment, revisable while
-- 'requested'. Idempotent on p_request_id for safe retries.
create or replace function public.submit_maturity_instruction(
  p_investor_id uuid,
  p_investment_id uuid,
  p_choice public.maturity_choice,
  p_target_cycle_id uuid,
  p_payout_destination_id uuid,
  p_agreement_accepted boolean,
  p_destination_confirmed boolean,
  p_request_id uuid
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_investment public.investments%rowtype;
  v_profile public.profiles%rowtype;
  v_target public.investment_cycles%rowtype;
  v_existing public.maturity_instructions%rowtype;
  v_payout numeric(28,8);
  v_reinvest numeric(28,8);
begin
  select * into v_existing from public.maturity_instructions
  where request_id = p_request_id;
  if found then return v_existing.id; end if;

  select * into v_profile from public.profiles where id = p_investor_id;
  if not found or v_profile.access_status <> 'active' then
    raise exception using errcode = '42501', message = 'investor is not eligible';
  end if;

  select * into v_investment from public.investments
  where id = p_investment_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'investment not found';
  end if;
  if v_investment.investor_id is distinct from p_investor_id then
    raise exception using errcode = '42501', message = 'investment is not owned by this partner';
  end if;
  if v_investment.status <> 'matured' then
    raise exception using errcode = '23514', message = 'only a matured investment can record a maturity choice';
  end if;
  if v_investment.record_origin <> 'portal' then
    raise exception using errcode = '23514', message = 'imported investments are excluded from maturity choices';
  end if;

  if p_choice = 'withdraw_all' then
    v_payout := v_investment.principal_ugx + v_investment.projected_return_ugx;
    v_reinvest := 0;
  elsif p_choice = 'withdraw_roi_reinvest_principal' then
    v_payout := v_investment.projected_return_ugx;
    v_reinvest := v_investment.principal_ugx;
  else
    v_payout := 0;
    v_reinvest := v_investment.principal_ugx + v_investment.projected_return_ugx;
  end if;

  if v_payout > 0 then
    if p_payout_destination_id is null then
      raise exception using errcode = '23514', message = 'a payout destination is required';
    end if;
    if not exists (
      select 1 from public.payout_destinations
      where id = p_payout_destination_id and investor_id = p_investor_id and is_active
    ) then
      raise exception using errcode = '42501', message = 'payout destination is not owned by this partner';
    end if;
    if not p_destination_confirmed then
      raise exception using errcode = '23514', message = 'confirm the payout destination before submitting';
    end if;
  end if;

  if v_reinvest > 0 then
    if p_target_cycle_id is null then
      raise exception using errcode = '23514', message = 'a destination cycle is required for reinvestment';
    end if;
    select * into v_target from public.investment_cycles where id = p_target_cycle_id;
    if not found or v_target.record_origin <> 'portal' or v_target.agreement_version_id is null then
      raise exception using errcode = '23514', message = 'destination cycle is not valid';
    end if;
    if not p_agreement_accepted then
      raise exception using errcode = '23514', message = 'accept the destination cycle agreement before submitting';
    end if;
  end if;

  select * into v_existing from public.maturity_instructions
  where investment_id = p_investment_id for update;
  if found then
    if v_existing.request_id = p_request_id then return v_existing.id; end if;
    if v_existing.status <> 'requested' then
      raise exception using errcode = '23514',
        message = 'this choice is already being processed and can no longer be revised';
    end if;
    update public.maturity_instructions set
      choice = p_choice,
      projected_payout_ugx = v_payout,
      projected_reinvest_ugx = v_reinvest,
      payout_destination_id = case when v_payout > 0 then p_payout_destination_id else null end,
      target_cycle_id = case when v_reinvest > 0 then p_target_cycle_id else null end,
      target_agreement_version_id = case when v_reinvest > 0 then v_target.agreement_version_id else null end,
      agreement_accepted = p_agreement_accepted,
      destination_confirmed = p_destination_confirmed,
      needs_resolution = false,
      revision_count = v_existing.revision_count + 1,
      request_id = p_request_id
    where id = v_existing.id;
    insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
    values (p_investor_id, 'maturity_instruction.revised', 'maturity_instruction', v_existing.id,
      p_request_id, jsonb_build_object('choice', p_choice));
    insert into public.jobs (kind, entity_type, entity_id, payload)
    values ('send_email', 'investment', p_investment_id,
      jsonb_build_object('template', 'maturity_choice_confirmed'));
    return v_existing.id;
  end if;

  insert into public.maturity_instructions (
    investment_id, investor_id, choice, projected_payout_ugx, projected_reinvest_ugx,
    payout_destination_id, target_cycle_id, target_agreement_version_id,
    agreement_accepted, destination_confirmed, request_id
  ) values (
    p_investment_id, p_investor_id, p_choice, v_payout, v_reinvest,
    case when v_payout > 0 then p_payout_destination_id else null end,
    case when v_reinvest > 0 then p_target_cycle_id else null end,
    case when v_reinvest > 0 then v_target.agreement_version_id else null end,
    p_agreement_accepted, p_destination_confirmed, p_request_id
  ) returning id into v_existing;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_investor_id, 'maturity_instruction.submitted', 'maturity_instruction', v_existing.id,
    p_request_id, jsonb_build_object('choice', p_choice, 'investment_id', p_investment_id));
  insert into public.jobs (kind, entity_type, entity_id, payload)
  values ('send_email', 'investment', p_investment_id,
    jsonb_build_object('template', 'maturity_choice_confirmed'));
  return v_existing.id;
end;
$$;

-- Admin review step: move requested -> processing, locking partner revisions.
create or replace function public.begin_maturity_instruction_processing(
  p_admin_id uuid,
  p_instruction_id uuid,
  p_admin_aal2 boolean,
  p_request_id uuid
) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_instruction public.maturity_instructions%rowtype;
begin
  if not private.is_admin(p_admin_id) or not p_admin_aal2 then
    raise exception using errcode = '42501', message = 'active administrator AAL2 required';
  end if;
  select * into v_instruction from public.maturity_instructions
  where id = p_instruction_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'maturity instruction not found';
  end if;
  if v_instruction.status = 'processing' then return; end if;
  if v_instruction.status <> 'requested' then
    raise exception using errcode = '23514', message = 'only a requested instruction can begin processing';
  end if;
  update public.maturity_instructions
  set status = 'processing', processed_by = p_admin_id, processed_at = now()
  where id = p_instruction_id;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id)
  values (p_admin_id, 'maturity_instruction.processing', 'maturity_instruction',
    p_instruction_id, p_request_id);
end;
$$;

-- Admin fulfillment: record the actual ROI from the fund, verify the external
-- payout, and atomically create the reinvestment placement. The original
-- projected value and any imported reported-paid figures are never treated
-- as proof of available cash: capacity and agreement checks run against the
-- live destination cycle inside this transaction. Amounts that cannot fit
-- exactly are held (needs_resolution) for admin resolution and partner
-- confirmation instead of failing silently.
create or replace function public.fulfill_maturity_instruction(
  p_admin_id uuid,
  p_instruction_id uuid,
  p_actual_roi_ugx numeric,
  p_payout_reference text,
  p_confirmation text,
  p_admin_aal2 boolean,
  p_request_id uuid
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_instruction public.maturity_instructions%rowtype;
  v_investment public.investments%rowtype;
  v_target public.investment_cycles%rowtype;
  v_agreement public.agreement_versions%rowtype;
  v_used_principal numeric(28,8);
  v_actual_payout numeric(28,8);
  v_actual_reinvest numeric(28,8);
  v_new_investment_id uuid := gen_random_uuid();
  v_return numeric(28,8);
begin
  if not private.is_admin(p_admin_id) or not p_admin_aal2 then
    raise exception using errcode = '42501', message = 'active administrator AAL2 required';
  end if;
  if p_confirmation <> 'FULFILL' then
    raise exception using errcode = '22023', message = 'typed confirmation is invalid';
  end if;
  if p_actual_roi_ugx is null or p_actual_roi_ugx < 0 then
    raise exception using errcode = '22023', message = 'actual ROI must be zero or more';
  end if;
  select * into v_instruction from public.maturity_instructions
  where id = p_instruction_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'maturity instruction not found';
  end if;
  if v_instruction.status = 'fulfilled' then
    return jsonb_build_object('instruction_id', p_instruction_id, 'already_fulfilled', true);
  end if;
  if v_instruction.status <> 'processing' then
    raise exception using errcode = '23514', message = 'begin processing before fulfillment';
  end if;
  select * into v_investment from public.investments
  where id = v_instruction.investment_id for update;
  if not found or v_investment.status <> 'matured' then
    raise exception using errcode = '23514', message = 'the source investment is not matured';
  end if;

  if v_instruction.choice = 'withdraw_all' then
    v_actual_payout := v_investment.principal_ugx + p_actual_roi_ugx;
    v_actual_reinvest := 0;
  elsif v_instruction.choice = 'withdraw_roi_reinvest_principal' then
    v_actual_payout := p_actual_roi_ugx;
    v_actual_reinvest := v_investment.principal_ugx;
  else
    v_actual_payout := 0;
    v_actual_reinvest := v_investment.principal_ugx + p_actual_roi_ugx;
  end if;

  if v_actual_payout > 0 then
    if nullif(trim(coalesce(p_payout_reference, '')), '') is null then
      raise exception using errcode = '22023', message = 'an external payout reference is required';
    end if;
    if v_instruction.payout_destination_id is null then
      raise exception using errcode = '23514', message = 'a payout destination is required';
    end if;
  end if;

  if v_actual_reinvest > 0 then
    if v_instruction.target_cycle_id is null or not v_instruction.agreement_accepted then
      raise exception using errcode = '23514', message = 'an accepted destination cycle is required';
    end if;
    select * into v_target from public.investment_cycles
    where id = v_instruction.target_cycle_id for update;
    if not found or v_target.status <> 'open' or now() < v_target.opens_at
      or now() >= v_target.closes_at or v_target.capacity_ugx is null then
      update public.maturity_instructions
      set needs_resolution = true where id = p_instruction_id;
      insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
      values (p_admin_id, 'maturity_instruction.held', 'maturity_instruction', p_instruction_id,
        p_request_id, jsonb_build_object('reason', 'destination cycle is not open'));
      return jsonb_build_object('instruction_id', p_instruction_id, 'held', true,
        'reason', 'destination cycle is not open');
    end if;
    if v_target.agreement_version_id is distinct from v_instruction.target_agreement_version_id then
      update public.maturity_instructions
      set needs_resolution = true where id = p_instruction_id;
      insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
      values (p_admin_id, 'maturity_instruction.held', 'maturity_instruction', p_instruction_id,
        p_request_id, jsonb_build_object('reason', 'destination agreement changed'));
      return jsonb_build_object('instruction_id', p_instruction_id, 'held', true,
        'reason', 'destination agreement changed');
    end if;
    select * into v_agreement from public.agreement_versions
    where id = v_target.agreement_version_id;
    if not found or not v_agreement.is_legally_approved or v_agreement.published_at is null then
      update public.maturity_instructions
      set needs_resolution = true where id = p_instruction_id;
      insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
      values (p_admin_id, 'maturity_instruction.held', 'maturity_instruction', p_instruction_id,
        p_request_id, jsonb_build_object('reason', 'destination agreement is not approved'));
      return jsonb_build_object('instruction_id', p_instruction_id, 'held', true,
        'reason', 'destination agreement is not approved');
    end if;
    if v_actual_reinvest < 125000 or v_actual_reinvest > 62500000
      or v_actual_reinvest <> round(v_actual_reinvest, 2) then
      update public.maturity_instructions
      set needs_resolution = true where id = p_instruction_id;
      insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
      values (p_admin_id, 'maturity_instruction.held', 'maturity_instruction', p_instruction_id,
        p_request_id, jsonb_build_object('reason', 'reinvestment amount is outside placement limits'));
      return jsonb_build_object('instruction_id', p_instruction_id, 'held', true,
        'reason', 'reinvestment amount is outside placement limits');
    end if;
    select coalesce(sum(principal_ugx), 0)::numeric(28,8) into v_used_principal
    from public.investments
    where cycle_id = v_target.id and status in ('reserved', 'active');
    if v_used_principal + v_actual_reinvest > v_target.capacity_ugx then
      update public.maturity_instructions
      set needs_resolution = true where id = p_instruction_id;
      insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
      values (p_admin_id, 'maturity_instruction.held', 'maturity_instruction', p_instruction_id,
        p_request_id, jsonb_build_object('reason', 'destination capacity exceeded'));
      return jsonb_build_object('instruction_id', p_instruction_id, 'held', true,
        'reason', 'destination capacity exceeded');
    end if;
    v_return := round(
      (v_actual_reinvest * v_target.projected_return_bps::numeric) / 10000::numeric, 8);
    insert into public.investments (
      id, investor_id, cycle_id, unit_price_ugx, principal_ugx, projected_return_bps,
      projected_return_ugx, projected_value_ugx, maturity_date, reservation_expires_at,
      status, requested_at, activated_at, record_origin
    ) values (
      v_new_investment_id, v_instruction.investor_id, v_target.id, v_target.unit_price_ugx,
      v_actual_reinvest, v_target.projected_return_bps, v_return,
      v_actual_reinvest + v_return, v_target.maturity_date, now(),
      'active', now(), now(), 'portal'
    );
    insert into public.investment_agreements (
      investment_id, investor_id, agreement_version_id, accepted_content_hash,
      accepted_at, acceptance_request_id, accepted_user_agent, accepted_ip_fingerprint
    ) values (
      v_new_investment_id, v_instruction.investor_id, v_agreement.id,
      v_agreement.content_hash, now(), p_request_id,
      'maturity-reinvestment', decode('00', 'hex')
    );
  end if;

  update public.maturity_instructions set
    status = 'fulfilled',
    actual_roi_ugx = p_actual_roi_ugx,
    actual_payout_ugx = v_actual_payout,
    actual_reinvest_ugx = v_actual_reinvest,
    payout_reference = case when v_actual_payout > 0 then trim(p_payout_reference) else null end,
    payout_verified_at = case when v_actual_payout > 0 then now() else null end,
    fulfilled_investment_id = case when v_actual_reinvest > 0 then v_new_investment_id else null end,
    needs_resolution = false,
    fulfilled_at = now()
  where id = p_instruction_id;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_admin_id, 'maturity_instruction.fulfilled', 'maturity_instruction', p_instruction_id,
    p_request_id, jsonb_build_object('actual_roi_ugx', p_actual_roi_ugx,
      'actual_payout_ugx', v_actual_payout, 'actual_reinvest_ugx', v_actual_reinvest));
  insert into public.jobs (kind, entity_type, entity_id, payload) values
    ('send_email', 'investment', v_instruction.investment_id,
      jsonb_build_object('template', 'maturity_fulfilled'));
  if v_actual_reinvest > 0 then
    insert into public.jobs (kind, entity_type, entity_id, payload) values
      ('generate_agreement_pdf', 'investment', v_new_investment_id, '{}'::jsonb),
      ('send_email', 'investment', v_new_investment_id,
        jsonb_build_object('template', 'investment_activated'));
  end if;
  return jsonb_build_object('instruction_id', p_instruction_id, 'fulfilled', true,
    'actual_payout_ugx', v_actual_payout, 'actual_reinvest_ugx', v_actual_reinvest,
    'reinvestment_id', case when v_actual_reinvest > 0 then v_new_investment_id else null end);
end;
$$;

-- Maintenance also matures placements, queues maturity notices for newly
-- matured portal placements, and resolves payout-day defaults: unanswered
-- portal maturities auto-reinvest ONLY when the launch gate is enabled and a
-- live standing authorization exists; otherwise they are flagged once for
-- admin follow-up and never silently reinvested.
create or replace function public.run_maintenance(p_request_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_expired integer;
  v_matured integer;
  v_anonymized integer;
  v_maturity_emails integer := 0;
  v_auto_reinvested integer := 0;
  v_pending_followup integer := 0;
  v_gate_enabled boolean := false;
  v_open_cycle public.investment_cycles%rowtype;
  r record;
begin
  with changed as (
    update public.investments set status = 'expired'
    where status = 'reserved' and reservation_expires_at <= now() returning id
  ) select count(*) into v_expired from changed;

  create temporary table if not exists pg_temp.newly_matured (id uuid, record_origin public.record_origin, investor_id uuid)
    on commit drop;
  delete from pg_temp.newly_matured;
  with changed as (
    update public.investments set status = 'matured', matured_at = now()
    where status = 'active' and maturity_date <= current_date
    returning id, record_origin, investor_id
  ) insert into pg_temp.newly_matured select * from changed;
  select count(*) into v_matured from pg_temp.newly_matured;

  with queued as (
    insert into public.jobs (kind, entity_type, entity_id, payload)
    select 'send_email', 'investment', m.id, jsonb_build_object('template', 'maturity_notice')
    from pg_temp.newly_matured m
    where m.record_origin = 'portal' and m.investor_id is not null
    returning id
  ) select count(*) into v_maturity_emails from queued;

  select enabled into v_gate_enabled from public.maturity_policy_gates
  where name = 'current_agreement_auto_reinvest';
  select * into v_open_cycle from public.investment_cycles
  where status = 'open' and record_origin = 'portal' limit 1;

  for r in
    select i.id, i.investor_id, i.principal_ugx, i.projected_return_ugx
    from public.investments i
    where i.status = 'matured'
      and i.record_origin = 'portal'
      and i.investor_id is not null
      and public.maturity_payout_date(i.maturity_date) <= current_date
      and not exists (
        select 1 from public.maturity_instructions mi where mi.investment_id = i.id
      )
  loop
    if v_gate_enabled
      and v_open_cycle.id is not null
      and exists (
        select 1 from public.maturity_reinvest_authorizations a
        where a.investor_id = r.investor_id and a.revoked_at is null
      ) then
      insert into public.maturity_instructions (
        investment_id, investor_id, choice, projected_payout_ugx, projected_reinvest_ugx,
        target_cycle_id, target_agreement_version_id, agreement_accepted,
        destination_confirmed, request_id
      ) values (
        r.id, r.investor_id, 'reinvest_all', 0,
        r.principal_ugx + r.projected_return_ugx,
        v_open_cycle.id, v_open_cycle.agreement_version_id, true, false,
        gen_random_uuid()
      );
      insert into public.audit_events (action, entity_type, entity_id, request_id, metadata)
      values ('maturity.auto_instruction_created', 'investment', r.id, p_request_id,
        jsonb_build_object('choice', 'reinvest_all', 'target_cycle_id', v_open_cycle.id));
      insert into public.jobs (kind, entity_type, entity_id, payload)
      values ('send_email', 'investment', r.id,
        jsonb_build_object('template', 'maturity_choice_confirmed'));
      v_auto_reinvested := v_auto_reinvested + 1;
    elsif not exists (
      select 1 from public.audit_events a
      where a.action = 'maturity.pending_followup' and a.entity_id = r.id
        and a.created_at > now() - interval '7 days'
    ) then
      insert into public.audit_events (action, entity_type, entity_id, request_id)
      values ('maturity.pending_followup', 'investment', r.id, p_request_id);
      v_pending_followup := v_pending_followup + 1;
    end if;
  end loop;

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
    jsonb_build_object('expired', v_expired, 'matured', v_matured, 'anonymized', v_anonymized,
      'maturity_emails', v_maturity_emails, 'auto_reinvested', v_auto_reinvested,
      'pending_followup', v_pending_followup));
  return jsonb_build_object('expired', v_expired, 'matured', v_matured, 'anonymized', v_anonymized,
    'maturity_emails', v_maturity_emails, 'auto_reinvested', v_auto_reinvested,
    'pending_followup', v_pending_followup);
end;
$$;

alter table public.payout_destinations enable row level security;
alter table public.maturity_instructions enable row level security;
alter table public.maturity_policy_gates enable row level security;
alter table public.maturity_reinvest_authorizations enable row level security;

-- Partners read their own records; admins read all. All writes go through
-- service-role-only functions so ownership, status, capacity, agreement, and
-- idempotency checks commit atomically with the financial changes.
create policy payout_destinations_self_read on public.payout_destinations for select to authenticated
  using (investor_id = auth.uid());
create policy payout_destinations_admin_read on public.payout_destinations for select to authenticated
  using (private.is_admin());
create policy maturity_instructions_self_read on public.maturity_instructions for select to authenticated
  using (investor_id = auth.uid());
create policy maturity_instructions_admin_read on public.maturity_instructions for select to authenticated
  using (private.is_admin());
create policy maturity_gates_admin_read on public.maturity_policy_gates for select to authenticated
  using (private.is_admin());
create policy maturity_authorizations_self_read on public.maturity_reinvest_authorizations for select to authenticated
  using (investor_id = auth.uid());
create policy maturity_authorizations_admin_read on public.maturity_reinvest_authorizations for select to authenticated
  using (private.is_admin());

revoke all on public.payout_destinations, public.maturity_instructions,
  public.maturity_policy_gates, public.maturity_reinvest_authorizations
  from public, anon, authenticated;
grant select on public.payout_destinations, public.maturity_instructions,
  public.maturity_policy_gates, public.maturity_reinvest_authorizations
  to authenticated;
grant all on public.payout_destinations, public.maturity_instructions,
  public.maturity_policy_gates, public.maturity_reinvest_authorizations
  to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.maturity_payout_date(date) from public, anon, authenticated;
revoke all on function public.submit_maturity_instruction(uuid, uuid, public.maturity_choice, uuid, uuid, boolean, boolean, uuid) from public, anon, authenticated;
revoke all on function public.begin_maturity_instruction_processing(uuid, uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.fulfill_maturity_instruction(uuid, uuid, numeric, text, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.maturity_payout_date(date) to service_role, authenticated;
grant execute on function public.submit_maturity_instruction(uuid, uuid, public.maturity_choice, uuid, uuid, boolean, boolean, uuid) to service_role;
grant execute on function public.begin_maturity_instruction_processing(uuid, uuid, boolean, uuid) to service_role;
grant execute on function public.fulfill_maturity_instruction(uuid, uuid, numeric, text, text, boolean, uuid) to service_role;

commit;
