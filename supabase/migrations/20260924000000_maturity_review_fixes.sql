begin;

-- Review fixes for matured investment choices:
-- partner acceptance evidence, destination verification, held-instruction
-- resolution, placement-control parity, destination immutability, partner
-- confirmation on changed ROI, and a payout-day fulfillment guard.

alter table public.maturity_instructions
  add column acceptance_user_agent text,
  add column acceptance_ip_fingerprint bytea,
  add column acceptance_request_id uuid,
  add column acceptance_captured_at timestamptz,
  add column destination_verified boolean not null default false,
  add column destination_verified_at timestamptz,
  add column proposed_actual_roi_ugx numeric(28,8)
    check (proposed_actual_roi_ugx is null or proposed_actual_roi_ugx >= 0),
  add column confirmed_actual_roi_ugx numeric(28,8)
    check (confirmed_actual_roi_ugx is null or confirmed_actual_roi_ugx >= 0),
  add column resolution_notes text;

-- Referenced payout destinations are immutable: an instruction points at a
-- confirmed row, so no later submission may rewrite what an admin sees.
create or replace function private.guard_payout_destination_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'payout destinations are immutable';
end;
$$;
create trigger payout_destinations_immutable_guard
before update or delete on public.payout_destinations
for each row execute function private.guard_payout_destination_immutable();

-- Submission now captures the partner's own acceptance evidence (user agent,
-- IP fingerprint, request id, timestamp) whenever the choice involves
-- reinvestment. The fulfillment placement links back to this evidence.
drop function if exists public.submit_maturity_instruction(uuid, uuid, public.maturity_choice, uuid, uuid, boolean, boolean, uuid);
create or replace function public.submit_maturity_instruction(
  p_investor_id uuid,
  p_investment_id uuid,
  p_choice public.maturity_choice,
  p_target_cycle_id uuid,
  p_payout_destination_id uuid,
  p_agreement_accepted boolean,
  p_destination_confirmed boolean,
  p_request_id uuid,
  p_user_agent text,
  p_ip_fingerprint bytea
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
    if p_ip_fingerprint is null then
      raise exception using errcode = '22023', message = 'acceptance evidence is required';
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
      acceptance_user_agent = case when v_reinvest > 0 then left(coalesce(p_user_agent, 'unknown'), 500) else null end,
      acceptance_ip_fingerprint = case when v_reinvest > 0 then p_ip_fingerprint else null end,
      acceptance_request_id = case when v_reinvest > 0 then p_request_id else null end,
      acceptance_captured_at = case when v_reinvest > 0 then now() else null end,
      proposed_actual_roi_ugx = null,
      confirmed_actual_roi_ugx = null,
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
    agreement_accepted, destination_confirmed,
    acceptance_user_agent, acceptance_ip_fingerprint, acceptance_request_id,
    acceptance_captured_at, request_id
  ) values (
    p_investment_id, p_investor_id, p_choice, v_payout, v_reinvest,
    case when v_payout > 0 then p_payout_destination_id else null end,
    case when v_reinvest > 0 then p_target_cycle_id else null end,
    case when v_reinvest > 0 then v_target.agreement_version_id else null end,
    p_agreement_accepted, p_destination_confirmed,
    case when v_reinvest > 0 then left(coalesce(p_user_agent, 'unknown'), 500) else null end,
    case when v_reinvest > 0 then p_ip_fingerprint else null end,
    case when v_reinvest > 0 then p_request_id else null end,
    case when v_reinvest > 0 then now() else null end,
    p_request_id
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

-- Partner confirmation of admin-proposed actual amounts. The confirmation
-- snapshots exactly what was proposed, so a later admin edit re-arms
-- the confirmation requirement instead of executing unseen numbers.
create or replace function public.confirm_maturity_amounts(
  p_investor_id uuid,
  p_instruction_id uuid,
  p_request_id uuid
) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_instruction public.maturity_instructions%rowtype;
begin
  select * into v_instruction from public.maturity_instructions
  where id = p_instruction_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'maturity instruction not found';
  end if;
  if v_instruction.investor_id is distinct from p_investor_id then
    raise exception using errcode = '42501', message = 'instruction is not owned by this partner';
  end if;
  if v_instruction.status <> 'processing' or v_instruction.proposed_actual_roi_ugx is null then
    raise exception using errcode = '23514', message = 'there are no proposed amounts to confirm';
  end if;
  update public.maturity_instructions
  set confirmed_actual_roi_ugx = proposed_actual_roi_ugx
  where id = p_instruction_id;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_investor_id, 'maturity_instruction.amounts_confirmed', 'maturity_instruction',
    p_instruction_id, p_request_id,
    jsonb_build_object('confirmed_actual_roi_ugx', v_instruction.proposed_actual_roi_ugx));
end;
$$;

-- Resolution path for held instructions: an admin records notes and re-opens
-- the instruction to 'requested'. The partner then revises (choosing a new
-- target cycle and re-accepting its agreement with fresh evidence) before
-- processing begins again. Nothing is held indefinitely.
create or replace function public.reopen_maturity_instruction(
  p_admin_id uuid,
  p_instruction_id uuid,
  p_notes text,
  p_admin_aal2 boolean,
  p_request_id uuid
) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_instruction public.maturity_instructions%rowtype;
begin
  if not private.is_admin(p_admin_id) or not p_admin_aal2 then
    raise exception using errcode = '42501', message = 'active administrator AAL2 required';
  end if;
  if nullif(trim(coalesce(p_notes, '')), '') is null then
    raise exception using errcode = '22023', message = 'resolution notes are required';
  end if;
  select * into v_instruction from public.maturity_instructions
  where id = p_instruction_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'maturity instruction not found';
  end if;
  if v_instruction.status <> 'processing' or not v_instruction.needs_resolution then
    raise exception using errcode = '23514', message = 'only a held instruction can be reopened';
  end if;
  update public.maturity_instructions set
    status = 'requested',
    processed_by = null,
    processed_at = null,
    needs_resolution = false,
    proposed_actual_roi_ugx = null,
    confirmed_actual_roi_ugx = null,
    resolution_notes = trim(p_notes)
  where id = p_instruction_id;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_admin_id, 'maturity_instruction.reopened', 'maturity_instruction', p_instruction_id,
    p_request_id, jsonb_build_object('notes', trim(p_notes)));
  insert into public.jobs (kind, entity_type, entity_id, payload)
  values ('send_email', 'investment', v_instruction.investment_id,
    jsonb_build_object('template', 'maturity_action_needed'));
end;
$$;

-- Fulfillment with review fixes: payout-day guard, verified destination,
-- partner confirmation on changed ROI, placement-control parity, and the
-- partner's own acceptance evidence on the new agreement row.
drop function if exists public.fulfill_maturity_instruction(uuid, uuid, numeric, text, text, boolean, uuid);
create or replace function public.fulfill_maturity_instruction(
  p_admin_id uuid,
  p_instruction_id uuid,
  p_actual_roi_ugx numeric,
  p_payout_reference text,
  p_confirmation text,
  p_admin_aal2 boolean,
  p_request_id uuid,
  p_destination_verified boolean
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_instruction public.maturity_instructions%rowtype;
  v_investment public.investments%rowtype;
  v_profile public.profiles%rowtype;
  v_target public.investment_cycles%rowtype;
  v_agreement public.agreement_versions%rowtype;
  v_used_principal numeric(28,8);
  v_investor_principal numeric(28,8);
  v_projected_roi numeric(28,8);
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
  select * into v_profile from public.profiles where id = v_instruction.investor_id;

  -- Payouts are scheduled for the 15th of the maturity month; fulfillment
  -- (which moves money) cannot complete before that day.
  if current_date < public.maturity_payout_date(v_investment.maturity_date) then
    raise exception using errcode = '23514',
      message = 'payouts are scheduled for the 15th of the maturity month';
  end if;

  v_projected_roi := v_instruction.projected_payout_ugx
    + v_instruction.projected_reinvest_ugx - v_investment.principal_ugx;

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
    -- The admin must have seen the revealed destination and verified it
    -- before the payout leg can be marked fulfilled.
    if not p_destination_verified then
      raise exception using errcode = '23514', message = 'the payout destination has not been verified';
    end if;
  end if;

  -- A changed actual ROI recalculates the partner's split, so the partner
  -- must confirm the new amounts before anything is paid or reinvested.
  if v_instruction.proposed_actual_roi_ugx is null
    or v_instruction.proposed_actual_roi_ugx is distinct from p_actual_roi_ugx
    or v_instruction.confirmed_actual_roi_ugx is distinct from p_actual_roi_ugx then
    if p_actual_roi_ugx = v_projected_roi
      and v_instruction.proposed_actual_roi_ugx is null then
      -- Matches the projection the partner already accepted: proceed.
      null;
    else
      update public.maturity_instructions
      set proposed_actual_roi_ugx = p_actual_roi_ugx,
        confirmed_actual_roi_ugx = null
      where id = p_instruction_id;
      insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
      values (p_admin_id, 'maturity_instruction.amounts_proposed', 'maturity_instruction',
        p_instruction_id, p_request_id,
        jsonb_build_object('proposed_actual_roi_ugx', p_actual_roi_ugx,
          'proposed_payout_ugx', v_actual_payout,
          'proposed_reinvest_ugx', v_actual_reinvest));
      insert into public.jobs (kind, entity_type, entity_id, payload)
      values ('send_email', 'investment', v_instruction.investment_id,
        jsonb_build_object('template', 'maturity_action_needed'));
      return jsonb_build_object('instruction_id', p_instruction_id,
        'pending_partner_confirmation', true,
        'proposed_actual_roi_ugx', p_actual_roi_ugx,
        'proposed_payout_ugx', v_actual_payout,
        'proposed_reinvest_ugx', v_actual_reinvest);
    end if;
  end if;

  if v_actual_reinvest > 0 then
    if v_instruction.target_cycle_id is null or not v_instruction.agreement_accepted then
      raise exception using errcode = '23514', message = 'an accepted destination cycle is required';
    end if;
    if v_instruction.acceptance_captured_at is null
      or v_instruction.acceptance_request_id is null
      or v_instruction.acceptance_ip_fingerprint is null then
      update public.maturity_instructions
      set needs_resolution = true where id = p_instruction_id;
      insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
      values (p_admin_id, 'maturity_instruction.held', 'maturity_instruction', p_instruction_id,
        p_request_id, jsonb_build_object('reason', 'partner acceptance evidence is missing'));
      return jsonb_build_object('instruction_id', p_instruction_id, 'held', true,
        'reason', 'partner acceptance evidence is missing');
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
    -- Same capacity and per-investor controls as request_investment: test
    -- money never consumes real capacity.
    select coalesce(sum(principal_ugx), 0)::numeric(28,8) into v_used_principal
    from public.investments
    where cycle_id = v_target.id and status in ('reserved', 'active') and not is_test;
    if not coalesce(v_profile.is_test, false)
      and v_used_principal + v_actual_reinvest > v_target.capacity_ugx then
      update public.maturity_instructions
      set needs_resolution = true where id = p_instruction_id;
      insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
      values (p_admin_id, 'maturity_instruction.held', 'maturity_instruction', p_instruction_id,
        p_request_id, jsonb_build_object('reason', 'destination capacity exceeded'));
      return jsonb_build_object('instruction_id', p_instruction_id, 'held', true,
        'reason', 'destination capacity exceeded');
    end if;
    select coalesce(sum(principal_ugx), 0)::numeric(28,8) into v_investor_principal
    from public.investments
    where cycle_id = v_target.id and investor_id = v_instruction.investor_id
      and status in ('reserved', 'active');
    if v_investor_principal + v_actual_reinvest > 62500000 then
      update public.maturity_instructions
      set needs_resolution = true where id = p_instruction_id;
      insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
      values (p_admin_id, 'maturity_instruction.held', 'maturity_instruction', p_instruction_id,
        p_request_id, jsonb_build_object('reason', 'investor cycle limit exceeded'));
      return jsonb_build_object('instruction_id', p_instruction_id, 'held', true,
        'reason', 'investor cycle limit exceeded');
    end if;
    v_return := round(
      (v_actual_reinvest * v_target.projected_return_bps::numeric) / 10000::numeric, 8);
    insert into public.investments (
      id, investor_id, cycle_id, unit_price_ugx, principal_ugx, projected_return_bps,
      projected_return_ugx, projected_value_ugx, maturity_date, reservation_expires_at,
      status, requested_at, activated_at, record_origin, is_test
    ) values (
      v_new_investment_id, v_instruction.investor_id, v_target.id, v_target.unit_price_ugx,
      v_actual_reinvest, v_target.projected_return_bps, v_return,
      v_actual_reinvest + v_return, v_target.maturity_date, now(),
      'active', now(), now(), 'portal', coalesce(v_profile.is_test, false)
    );
    -- The agreement row links the partner's own acceptance event captured
    -- at submission: their timestamp, request id, user agent, and IP
    -- fingerprint — never the admin's fulfillment context.
    insert into public.investment_agreements (
      investment_id, investor_id, agreement_version_id, accepted_content_hash,
      accepted_at, acceptance_request_id, accepted_user_agent, accepted_ip_fingerprint
    ) values (
      v_new_investment_id, v_instruction.investor_id, v_agreement.id,
      v_agreement.content_hash, v_instruction.acceptance_captured_at,
      v_instruction.acceptance_request_id, v_instruction.acceptance_user_agent,
      v_instruction.acceptance_ip_fingerprint
    );
  end if;

  update public.maturity_instructions set
    status = 'fulfilled',
    actual_roi_ugx = p_actual_roi_ugx,
    actual_payout_ugx = v_actual_payout,
    actual_reinvest_ugx = v_actual_reinvest,
    payout_reference = case when v_actual_payout > 0 then trim(p_payout_reference) else null end,
    payout_verified_at = case when v_actual_payout > 0 then now() else null end,
    destination_verified = case when v_actual_payout > 0 then true else destination_verified end,
    destination_verified_at = case when v_actual_payout > 0 then now() else destination_verified_at end,
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

revoke all on function public.submit_maturity_instruction(uuid, uuid, public.maturity_choice, uuid, uuid, boolean, boolean, uuid, text, bytea) from public, anon, authenticated;
revoke all on function public.fulfill_maturity_instruction(uuid, uuid, numeric, text, text, boolean, uuid, boolean) from public, anon, authenticated;
revoke all on function public.confirm_maturity_amounts(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.reopen_maturity_instruction(uuid, uuid, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.submit_maturity_instruction(uuid, uuid, public.maturity_choice, uuid, uuid, boolean, boolean, uuid, text, bytea) to service_role;
grant execute on function public.fulfill_maturity_instruction(uuid, uuid, numeric, text, text, boolean, uuid, boolean) to service_role;
grant execute on function public.confirm_maturity_amounts(uuid, uuid, uuid) to service_role;
grant execute on function public.reopen_maturity_instruction(uuid, uuid, text, boolean, uuid) to service_role;

commit;
