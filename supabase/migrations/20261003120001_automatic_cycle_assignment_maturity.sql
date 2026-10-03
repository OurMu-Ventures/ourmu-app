begin;

-- Automatic cycle assignment (part 2): submit / fulfill / maintenance use the same resolver.
-- Existing rows (policy_version IS NULL) keep legacy behavior until revised.

drop function public.submit_maturity_instruction(uuid,uuid,public.maturity_choice,uuid,uuid,boolean,boolean,uuid,text,bytea,numeric,boolean);

CREATE OR REPLACE FUNCTION public.submit_maturity_instruction(p_investor_id uuid, p_investment_id uuid, p_choice public.maturity_choice, p_target_cycle_id uuid, p_payout_destination_id uuid, p_agreement_accepted boolean, p_destination_confirmed boolean, p_request_id uuid, p_user_agent text, p_ip_fingerprint bytea, p_requested_withdrawal_ugx numeric DEFAULT NULL::numeric, p_custom_split boolean DEFAULT false, p_expected_agreement_version_id uuid DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_investment public.investments%rowtype;
  v_profile public.profiles%rowtype;
  v_target public.investment_cycles%rowtype;
  v_existing public.maturity_instructions%rowtype;
  v_agreement public.agreement_versions%rowtype;
  v_resolved_id uuid;
  v_payout numeric(28,8);
  v_reinvest numeric(28,8);
begin
  select * into v_existing from public.maturity_instructions
  where request_id = p_request_id;
  if found then
    if v_existing.investor_id is distinct from p_investor_id or v_existing.investment_id is distinct from p_investment_id then
      raise exception using errcode = '42501', message = 'request belongs to another investment or partner';
    end if;
    return v_existing.id;
  end if;

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
  if (v_investment.status <> 'matured' or v_investment.payout_basis = 'reported_paid') then
    raise exception using errcode = '23514', message = 'only a matured investment can record a maturity choice';
  end if;

  if p_choice = 'withdraw_all' then
    v_payout := v_investment.principal_ugx + v_investment.projected_return_ugx;
    v_reinvest := 0;
  elsif p_choice = 'withdraw_roi_reinvest_principal' then

    if coalesce(p_custom_split, false) or p_requested_withdrawal_ugx is not null then
      if p_requested_withdrawal_ugx is null
        or p_requested_withdrawal_ugx::text in ('NaN', 'Infinity', '-Infinity')
        or p_requested_withdrawal_ugx <= 0
        or p_requested_withdrawal_ugx >= v_investment.principal_ugx + v_investment.projected_return_ugx
        or p_requested_withdrawal_ugx <> round(p_requested_withdrawal_ugx, 2) then
        raise exception using errcode = '22023', message = 'enter a positive withdrawal below the total with up to two decimal places';
      end if;
      v_payout := p_requested_withdrawal_ugx;
      v_reinvest := v_investment.principal_ugx + v_investment.projected_return_ugx - v_payout;
      if v_reinvest < 125000 or v_reinvest > coalesce(v_profile.investment_limit_ugx, 50000000) or v_reinvest <> round(v_reinvest, 2) then
        raise exception using errcode = '22023', message = 'reinvestment must be at least UGX 125,000 and within your partner limit with up to two decimal places';
      end if;
    else
      v_payout := v_investment.projected_return_ugx;
      v_reinvest := v_investment.principal_ugx;
    end if;

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
    if p_destination_confirmed is distinct from true then
      raise exception using errcode = '23514', message = 'confirm the payout destination before submitting';
    end if;
  end if;

  if v_reinvest > 0 then
    -- Automatic assignment: the cycle open at submission time. Submitted
    -- identifiers are evidence of what the partner saw, never authority.
    v_resolved_id := private.resolve_portal_cycle(now());
    select * into v_target from public.investment_cycles where id = v_resolved_id for share;
    if not found or v_target.record_origin <> 'portal' or v_target.agreement_version_id is null
      or v_target.status <> 'open' or v_target.capacity_ugx is null then
      raise exception using errcode = '23514', message = 'reinvestment is unavailable; no eligible cycle is open. Full withdrawal remains available.';
    end if;
    if p_target_cycle_id is not null and p_target_cycle_id is distinct from v_resolved_id then
      raise exception using errcode = '23514', message = 'the displayed cycle changed; review the refreshed terms and accept again';
    end if;
    if p_expected_agreement_version_id is not null
      and p_expected_agreement_version_id is distinct from v_target.agreement_version_id then
      raise exception using errcode = '23514', message = 'the agreement changed; review the refreshed terms and accept again';
    end if;
    select * into v_agreement from public.agreement_versions where id = v_target.agreement_version_id for share;
    if not found or not v_agreement.is_legally_approved or v_agreement.published_at is null then
      raise exception using errcode = '23514', message = 'approved agreement is required';
    end if;
    if p_agreement_accepted is distinct from true then
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
      requested_withdrawal_ugx = case when p_choice = 'withdraw_roi_reinvest_principal' then p_requested_withdrawal_ugx else null end,
      projected_payout_ugx = v_payout,
      projected_reinvest_ugx = v_reinvest,
      payout_destination_id = case when v_payout > 0 then p_payout_destination_id else null end,
      target_cycle_id = case when v_reinvest > 0 then v_resolved_id else null end,
      target_agreement_version_id = case when v_reinvest > 0 then v_target.agreement_version_id else null end,
      policy_version = 'auto_cycle_v1',
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
      p_request_id, jsonb_build_object('requested_withdrawal_ugx', case when p_choice = 'withdraw_roi_reinvest_principal' then p_requested_withdrawal_ugx else null end, 'choice', p_choice, 'assignment_basis', 'submission_time', 'applicable_timestamp', now(), 'cycle_id', case when v_reinvest > 0 then v_resolved_id else null end, 'policy_version', 'auto_cycle_v1'));
    insert into public.jobs (kind, entity_type, entity_id, payload)
    values ('send_email', 'investment', p_investment_id,
      jsonb_build_object('template', 'maturity_choice_confirmed'));
    return v_existing.id;
  end if;

  insert into public.maturity_instructions (
    investment_id, investor_id, choice, requested_withdrawal_ugx, projected_payout_ugx, projected_reinvest_ugx,
    payout_destination_id, target_cycle_id, target_agreement_version_id,
    agreement_accepted, destination_confirmed,
    acceptance_user_agent, acceptance_ip_fingerprint, acceptance_request_id,
    acceptance_captured_at, request_id, policy_version
  ) values (
    p_investment_id, p_investor_id, p_choice, case when p_choice = 'withdraw_roi_reinvest_principal' then p_requested_withdrawal_ugx else null end, v_payout, v_reinvest,
    case when v_payout > 0 then p_payout_destination_id else null end,
    case when v_reinvest > 0 then v_resolved_id else null end,
    case when v_reinvest > 0 then v_target.agreement_version_id else null end,
    p_agreement_accepted, p_destination_confirmed,
    case when v_reinvest > 0 then left(coalesce(p_user_agent, 'unknown'), 500) else null end,
    case when v_reinvest > 0 then p_ip_fingerprint else null end,
    case when v_reinvest > 0 then p_request_id else null end,
    case when v_reinvest > 0 then now() else null end,
    p_request_id, 'auto_cycle_v1'
  ) returning id into v_existing;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_investor_id, 'maturity_instruction.submitted', 'maturity_instruction', v_existing.id,
    p_request_id, jsonb_build_object('requested_withdrawal_ugx', case when p_choice = 'withdraw_roi_reinvest_principal' then p_requested_withdrawal_ugx else null end, 'choice', p_choice, 'investment_id', p_investment_id, 'assignment_basis', 'submission_time', 'applicable_timestamp', now(), 'cycle_id', case when v_reinvest > 0 then v_resolved_id else null end, 'policy_version', 'auto_cycle_v1'));
  insert into public.jobs (kind, entity_type, entity_id, payload)
  values ('send_email', 'investment', p_investment_id,
    jsonb_build_object('template', 'maturity_choice_confirmed'));
  return v_existing.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fulfill_maturity_instruction(p_admin_id uuid, p_instruction_id uuid, p_actual_roi_ugx numeric, p_payout_reference text, p_confirmation text, p_admin_aal2 boolean, p_request_id uuid, p_destination_verified boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  v_gate_enabled boolean;
  v_standing_accepted_at timestamptz;
  v_auth_agreement uuid;
  v_auth_hash text;
  v_accept_at timestamptz;
  v_accept_request uuid;
  v_accept_ua text;
  v_accept_ip bytea;
  v_receipt_id uuid;
  v_receipt_number text;
  v_submission_at timestamptz;
  v_company_name text := 'OurMu Ventures Limited';
  v_company_address text := 'Katabbi Town Council, Entebbe, Wakiso';
begin
  if not private.is_admin(p_admin_id) or p_admin_aal2 is distinct from true then
    raise exception using errcode = '42501', message = 'active administrator AAL2 required';
  end if;
  if p_confirmation is distinct from 'FULFILL' then
    raise exception using errcode = '22023', message = 'typed confirmation is invalid';
  end if;
  if p_actual_roi_ugx is null or p_actual_roi_ugx::text in ('NaN', 'Infinity', '-Infinity') or p_actual_roi_ugx < 0 then
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
  if not found or (v_investment.status <> 'matured' or v_investment.payout_basis = 'reported_paid') then
    raise exception using errcode = '23514', message = 'the source investment is not matured';
  end if;
  select * into v_profile from public.profiles where id = v_instruction.investor_id for update;

  if current_date < public.maturity_payout_date(v_investment.maturity_date) then
    raise exception using errcode = '23514',
      message = 'payouts are scheduled for the 15th of the month after maturity';
  end if;

  v_projected_roi := v_instruction.projected_payout_ugx
    + v_instruction.projected_reinvest_ugx - v_investment.principal_ugx;

  if v_instruction.choice = 'withdraw_all' then
    v_actual_payout := v_investment.principal_ugx + p_actual_roi_ugx;
    v_actual_reinvest := 0;
  elsif v_instruction.choice = 'withdraw_roi_reinvest_principal' then

    if v_instruction.requested_withdrawal_ugx is null then
      v_actual_payout := p_actual_roi_ugx;
      v_actual_reinvest := v_investment.principal_ugx;
    else
      v_actual_payout := round((v_investment.principal_ugx + p_actual_roi_ugx)
        * v_instruction.requested_withdrawal_ugx
        / (v_instruction.projected_payout_ugx + v_instruction.projected_reinvest_ugx), 2);
      v_actual_reinvest := v_investment.principal_ugx + p_actual_roi_ugx - v_actual_payout;
      -- An invalid revised split is held before asking for confirmation.
      if v_actual_payout <= 0 or v_actual_reinvest < 125000 or v_actual_reinvest > coalesce(v_profile.investment_limit_ugx, 50000000)
        or v_actual_reinvest <> round(v_actual_reinvest, 2) then
        update public.maturity_instructions set needs_resolution = true,
          proposed_actual_roi_ugx = null, confirmed_actual_roi_ugx = null,
          resolution_notes = 'The revised split is outside placement limits. Please revise your withdrawal or payout plan.'
        where id = p_instruction_id;
        insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
        values (p_admin_id, 'maturity_instruction.held', 'maturity_instruction', p_instruction_id,
          p_request_id, jsonb_build_object('reason', 'reinvestment amount is outside placement limits'));
        insert into public.jobs (kind, entity_type, entity_id, payload)
        values ('send_email', 'investment', v_instruction.investment_id,
          jsonb_build_object('template', 'maturity_action_needed'));
        return jsonb_build_object('instruction_id', p_instruction_id, 'held', true,
          'reason', 'reinvestment amount is outside placement limits');
      end if;
    end if;

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
    if not p_destination_verified then
      raise exception using errcode = '23514', message = 'the payout destination has not been verified';
    end if;
  end if;

  if v_instruction.proposed_actual_roi_ugx is null
    or v_instruction.proposed_actual_roi_ugx is distinct from p_actual_roi_ugx
    or v_instruction.confirmed_actual_roi_ugx is distinct from p_actual_roi_ugx then
    if p_actual_roi_ugx = v_projected_roi
      and v_instruction.proposed_actual_roi_ugx is null then
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
      v_gate_enabled := false;
      v_standing_accepted_at := null;
      select g.enabled into v_gate_enabled from public.maturity_policy_gates g
      where g.name = 'current_agreement_auto_reinvest';
      if v_instruction.standing_authorization_id is not null then
        select a.authorized_at, a.agreement_version_id, a.accepted_content_hash,
               a.accepted_user_agent, a.accepted_ip_fingerprint, a.acceptance_request_id
          into v_standing_accepted_at, v_auth_agreement, v_auth_hash,
               v_accept_ua, v_accept_ip, v_accept_request
        from public.maturity_reinvest_authorizations a
        where a.id = v_instruction.standing_authorization_id
          and a.investor_id = v_instruction.investor_id
          and a.revoked_at is null;
      end if;
      if v_standing_accepted_at is null or not coalesce(v_gate_enabled, false) then
        update public.maturity_instructions
        set needs_resolution = true where id = p_instruction_id;
        insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
        values (p_admin_id, 'maturity_instruction.held', 'maturity_instruction', p_instruction_id,
          p_request_id, jsonb_build_object('reason', 'partner acceptance evidence is missing'));
        return jsonb_build_object('instruction_id', p_instruction_id, 'held', true,
          'reason', 'partner acceptance evidence is missing');
      end if;
      v_accept_at := v_standing_accepted_at;
    else
      v_accept_at := v_instruction.acceptance_captured_at;
      v_accept_request := v_instruction.acceptance_request_id;
      v_accept_ua := v_instruction.acceptance_user_agent;
      v_accept_ip := v_instruction.acceptance_ip_fingerprint;
    end if;
    select * into v_target from public.investment_cycles
    where id = v_instruction.target_cycle_id for update;
    if not found or v_target.capacity_ugx is null then
      update public.maturity_instructions
      set needs_resolution = true where id = p_instruction_id;
      insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
      values (p_admin_id, 'maturity_instruction.held', 'maturity_instruction', p_instruction_id,
        p_request_id, jsonb_build_object('reason', 'destination cycle is not valid', 'policy_version', v_instruction.policy_version));
      return jsonb_build_object('instruction_id', p_instruction_id, 'held', true,
        'reason', 'destination cycle is not valid');
    end if;
    if coalesce(v_instruction.policy_version, '') = 'auto_cycle_v1' then
      -- Auto assignment retains the submission-time cycle after closing.
      -- Fulfillment into a closed cycle is allowed only when submission fell
      -- inside its enrollment window and its maturity has not passed.
      v_submission_at := coalesce(v_instruction.acceptance_captured_at, v_instruction.created_at);
      if v_target.status not in ('open', 'closed') then
        update public.maturity_instructions
        set needs_resolution = true where id = p_instruction_id;
        insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
        values (p_admin_id, 'maturity_instruction.held', 'maturity_instruction', p_instruction_id,
          p_request_id, jsonb_build_object('reason', 'destination cycle is not open', 'policy_version', 'auto_cycle_v1'));
        return jsonb_build_object('instruction_id', p_instruction_id, 'held', true,
          'reason', 'destination cycle is not open');
      end if;
      if v_submission_at is null or v_submission_at < v_target.opens_at or v_submission_at >= v_target.closes_at then
        update public.maturity_instructions
        set needs_resolution = true where id = p_instruction_id;
        insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
        values (p_admin_id, 'maturity_instruction.held', 'maturity_instruction', p_instruction_id,
          p_request_id, jsonb_build_object('reason', 'submission fell outside the destination enrollment window', 'policy_version', 'auto_cycle_v1'));
        return jsonb_build_object('instruction_id', p_instruction_id, 'held', true,
          'reason', 'submission fell outside the destination enrollment window');
      end if;
      if v_target.maturity_date <= (now() at time zone 'Africa/Kampala')::date then
        update public.maturity_instructions
        set needs_resolution = true where id = p_instruction_id;
        insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
        values (p_admin_id, 'maturity_instruction.held', 'maturity_instruction', p_instruction_id,
          p_request_id, jsonb_build_object('reason', 'destination cycle already matured', 'policy_version', 'auto_cycle_v1'));
        return jsonb_build_object('instruction_id', p_instruction_id, 'held', true,
          'reason', 'destination cycle already matured');
      end if;
    else
      if v_target.status <> 'open' or now() < v_target.opens_at
        or now() >= v_target.closes_at then
        update public.maturity_instructions
        set needs_resolution = true where id = p_instruction_id;
        insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
        values (p_admin_id, 'maturity_instruction.held', 'maturity_instruction', p_instruction_id,
          p_request_id, jsonb_build_object('reason', 'destination cycle is not open'));
        return jsonb_build_object('instruction_id', p_instruction_id, 'held', true,
          'reason', 'destination cycle is not open');
      end if;
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
    if v_instruction.standing_authorization_id is not null
      and v_auth_agreement is distinct from v_target.agreement_version_id then
      update public.maturity_instructions
      set needs_resolution = true where id = p_instruction_id;
      insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
      values (p_admin_id, 'maturity_instruction.held', 'maturity_instruction', p_instruction_id,
        p_request_id, jsonb_build_object('reason', 'standing authorization does not cover the destination agreement'));
      return jsonb_build_object('instruction_id', p_instruction_id, 'held', true,
        'reason', 'standing authorization does not cover the destination agreement');
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
    if v_actual_reinvest < 125000 or v_actual_reinvest > coalesce(v_profile.investment_limit_ugx, 50000000)
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
    if v_investor_principal + v_actual_reinvest > coalesce(v_profile.investment_limit_ugx, 50000000) then
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
      status, requested_at, activated_at, record_origin, is_test, policy_version
    ) values (
      v_new_investment_id, v_instruction.investor_id, v_target.id, v_target.unit_price_ugx,
      v_actual_reinvest, v_target.projected_return_bps, v_return,
      v_actual_reinvest + v_return, v_target.maturity_date, now(),
      'active', now(), now(), 'portal', coalesce(v_profile.is_test, false), v_instruction.policy_version
    );
    insert into public.investment_agreements (
      investment_id, investor_id, agreement_version_id, accepted_content_hash,
      accepted_at, acceptance_request_id, accepted_user_agent, accepted_ip_fingerprint
    ) values (
      v_new_investment_id, v_instruction.investor_id, v_agreement.id,
      v_agreement.content_hash, v_accept_at,
      v_accept_request, v_accept_ua,
      v_accept_ip
    );
    -- Issue the reinvestment receipt in the same transaction. Retries reuse
    -- the same receipt number via the unique investment_id guard.
    v_receipt_number := private.allocate_receipt_number(coalesce(v_profile.is_test, false));
    insert into public.investment_receipts (
      investment_id, investor_id, source, maturity_instruction_id, original_investment_id,
      receipt_number, is_test, partner_name, partner_phone, company_name, company_address,
      amount_ugx, transaction_date, account_description
    ) values (
      v_new_investment_id, v_instruction.investor_id, 'reinvestment', p_instruction_id,
      v_instruction.investment_id, v_receipt_number, coalesce(v_profile.is_test, false),
      v_profile.legal_name, v_profile.phone, v_company_name, v_company_address,
      v_actual_reinvest, (now() at time zone 'Africa/Kampala')::date,
      'Accounts payable — ' || v_profile.legal_name
    ) returning id into v_receipt_id;
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
      'actual_payout_ugx', v_actual_payout, 'actual_reinvest_ugx', v_actual_reinvest,
      'receipt_id', v_receipt_id, 'receipt_number', v_receipt_number,
      'assignment_basis', 'submission_time', 'cycle_id', v_instruction.target_cycle_id,
      'policy_version', coalesce(v_instruction.policy_version, 'legacy')));
  insert into public.jobs (kind, entity_type, entity_id, payload) values
    ('send_email', 'investment', v_instruction.investment_id,
      jsonb_build_object('template', 'maturity_fulfilled'));
  if v_actual_reinvest > 0 then
    insert into public.jobs (kind, entity_type, entity_id, payload) values
      ('generate_agreement_pdf', 'investment', v_new_investment_id, '{}'::jsonb),
      ('generate_receipt_pdf', 'investment_receipt', v_receipt_id,
        jsonb_build_object('investment_id', v_new_investment_id, 'receipt_number', v_receipt_number));
  end if;
  return jsonb_build_object('instruction_id', p_instruction_id, 'fulfilled', true,
    'actual_payout_ugx', v_actual_payout, 'actual_reinvest_ugx', v_actual_reinvest,
    'reinvestment_id', case when v_actual_reinvest > 0 then v_new_investment_id else null end);
end;
$function$;

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
  v_auth_id uuid;
  v_auth_at timestamptz;
  r record;
begin
  with changed as (
    update public.investments set status = 'expired'
    where status = 'reserved' and reservation_expires_at <= now() returning id
  ) select count(*) into v_expired from changed;

  create temporary table if not exists pg_temp.newly_matured (id uuid, record_origin public.record_origin, investor_id uuid)
    on commit drop;
  truncate table pg_temp.newly_matured;
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
    where m.investor_id is not null
    returning id
  ) select count(*) into v_maturity_emails from queued;

  select enabled into v_gate_enabled from public.maturity_policy_gates
  where name = 'current_agreement_auto_reinvest';
  begin
    -- Same resolver as interactive submissions, keyed to creation time.
    v_open_cycle.id := null;
    select * into v_open_cycle from public.investment_cycles
    where id = private.resolve_portal_cycle(now());
    if v_open_cycle.status <> 'open' or v_open_cycle.record_origin <> 'portal'
      or v_open_cycle.agreement_version_id is null or v_open_cycle.capacity_ugx is null then
      v_open_cycle.id := null;
    end if;
  exception when others then
    v_open_cycle.id := null;
  end;

  for r in
    select i.id, i.investor_id, i.principal_ugx, i.projected_return_ugx
    from public.investments i
    where i.status = 'matured' and i.payout_basis <> 'reported_paid'
      and i.investor_id is not null
      and public.maturity_payout_date(i.maturity_date) <= current_date
      and not exists (
        select 1 from public.maturity_instructions mi where mi.investment_id = i.id
      )
  loop
    v_auth_id := null;
    v_auth_at := null;
    if v_gate_enabled and v_open_cycle.id is not null then
      select a.id, a.authorized_at into v_auth_id, v_auth_at
      from public.maturity_reinvest_authorizations a
      where a.investor_id = r.investor_id and a.revoked_at is null
      order by a.authorized_at desc
      limit 1;
    end if;
    if v_auth_id is not null then
      -- The standing authorization is the partner's own prior acceptance of
      -- reinvestment terms. Only its id travels with the instruction; the
      -- evidence itself is re-verified live at fulfillment, so a revoked
      -- authorization (or a disabled gate) can never complete.
      insert into public.maturity_instructions (
        investment_id, investor_id, choice, projected_payout_ugx, projected_reinvest_ugx,
        target_cycle_id, target_agreement_version_id, agreement_accepted,
        destination_confirmed, standing_authorization_id, request_id, policy_version
      ) values (
        r.id, r.investor_id, 'reinvest_all', 0,
        r.principal_ugx + r.projected_return_ugx,
        v_open_cycle.id, v_open_cycle.agreement_version_id, true, false,
        v_auth_id, gen_random_uuid(), 'auto_cycle_v1'
      );
      insert into public.audit_events (action, entity_type, entity_id, request_id, metadata)
      values ('maturity.auto_instruction_created', 'investment', r.id, p_request_id,
        jsonb_build_object('choice', 'reinvest_all', 'target_cycle_id', v_open_cycle.id,
          'assignment_basis', 'instruction_creation_time', 'applicable_timestamp', now(),
          'policy_version', 'auto_cycle_v1'));
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

-- Restrict the new signature before committing its creation.
revoke all on function public.submit_maturity_instruction(uuid,uuid,public.maturity_choice,uuid,uuid,boolean,boolean,uuid,text,bytea,numeric,boolean,uuid) from public, anon, authenticated;
grant execute on function public.submit_maturity_instruction(uuid,uuid,public.maturity_choice,uuid,uuid,boolean,boolean,uuid,text,bytea,numeric,boolean,uuid) to service_role;

notify pgrst, 'reload schema';
commit;