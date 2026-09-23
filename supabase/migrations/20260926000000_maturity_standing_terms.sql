begin;

-- Standing authorizations name the approved terms they accept
-- (agreement version, content hash, and the partner's own acceptance
-- evidence). Fulfillment of an automatic reinvestment completes only when
-- those terms are the destination cycle's exact agreement, and links the
-- rollover to the stored evidence.

alter table public.maturity_reinvest_authorizations
  add column agreement_version_id uuid not null
    references public.agreement_versions(id) on delete restrict,
  add column accepted_content_hash text not null,
  add column accepted_user_agent text not null,
  add column accepted_ip_fingerprint bytea not null,
  add column acceptance_request_id uuid not null;

-- Partner grant: accept an approved, published, non-placeholder agreement
-- version as standing reinvest terms, capturing the partner's own
-- acceptance evidence. Re-accepting replaces the terms and evidence.
create or replace function public.accept_standing_reinvest_terms(
  p_investor_id uuid,
  p_agreement_version_id uuid,
  p_user_agent text,
  p_ip_fingerprint bytea,
  p_request_id uuid
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_profile public.profiles%rowtype;
  v_agreement public.agreement_versions%rowtype;
  v_auth_id uuid;
begin
  select * into v_profile from public.profiles where id = p_investor_id;
  if not found or v_profile.access_status <> 'active' then
    raise exception using errcode = '42501', message = 'investor is not eligible';
  end if;
  select * into v_agreement from public.agreement_versions
  where id = p_agreement_version_id;
  if not found or not v_agreement.is_legally_approved or v_agreement.published_at is null
    or v_agreement.template_markdown ~* 'PLACEHOLDER|TBD' then
    raise exception using errcode = '23514', message = 'approved standing terms are required';
  end if;
  if p_ip_fingerprint is null then
    raise exception using errcode = '22023', message = 'acceptance evidence is required';
  end if;
  select id into v_auth_id from public.maturity_reinvest_authorizations
  where investor_id = p_investor_id and scope = 'all_portal'
    and acceptance_request_id = p_request_id;
  if found then return v_auth_id; end if;
  insert into public.maturity_reinvest_authorizations (
    investor_id, scope, agreement_version_id, accepted_content_hash,
    accepted_user_agent, accepted_ip_fingerprint, acceptance_request_id,
    authorized_at, authorized_by, revoked_at
  ) values (
    p_investor_id, 'all_portal', v_agreement.id, v_agreement.content_hash,
    left(coalesce(p_user_agent, 'unknown'), 500), p_ip_fingerprint, p_request_id,
    now(), p_investor_id, null
  )
  on conflict (investor_id, scope) do update set
    agreement_version_id = excluded.agreement_version_id,
    accepted_content_hash = excluded.accepted_content_hash,
    accepted_user_agent = excluded.accepted_user_agent,
    accepted_ip_fingerprint = excluded.accepted_ip_fingerprint,
    acceptance_request_id = excluded.acceptance_request_id,
    authorized_at = now(),
    authorized_by = excluded.authorized_by,
    revoked_at = null
  returning id into v_auth_id;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_investor_id, 'maturity_standing_terms.accepted', 'maturity_reinvest_authorization',
    v_auth_id, p_request_id,
    jsonb_build_object('agreement_version_id', v_agreement.id));
  return v_auth_id;
end;
$$;

-- Partner self-revoke; fulfillment re-checks revocation live.
create or replace function public.revoke_standing_reinvest_authorization(
  p_investor_id uuid,
  p_request_id uuid
) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_auth_id uuid;
begin
  select id into v_auth_id from public.maturity_reinvest_authorizations
  where investor_id = p_investor_id and scope = 'all_portal' and revoked_at is null
  for update;
  if not found then return; end if;
  update public.maturity_reinvest_authorizations
  set revoked_at = now() where id = v_auth_id;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id)
  values (p_investor_id, 'maturity_standing_terms.revoked', 'maturity_reinvest_authorization',
    v_auth_id, p_request_id);
end;
$$;

-- Admin revoke for operations (e.g. terms withdrawn): AAL2 + audit.
create or replace function public.admin_revoke_standing_reinvest_authorization(
  p_admin_id uuid,
  p_investor_id uuid,
  p_admin_aal2 boolean,
  p_request_id uuid
) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_auth_id uuid;
begin
  if not private.is_admin(p_admin_id) or not p_admin_aal2 then
    raise exception using errcode = '42501', message = 'active administrator AAL2 required';
  end if;
  select id into v_auth_id from public.maturity_reinvest_authorizations
  where investor_id = p_investor_id and scope = 'all_portal' and revoked_at is null
  for update;
  if not found then return; end if;
  update public.maturity_reinvest_authorizations
  set revoked_at = now() where id = v_auth_id;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id)
  values (p_admin_id, 'maturity_standing_terms.admin_revoked', 'maturity_reinvest_authorization',
    v_auth_id, p_request_id);
end;
$$;

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
  v_gate_enabled boolean;
  v_standing_accepted_at timestamptz;
  v_auth_agreement uuid;
  v_auth_hash text;
  v_accept_at timestamptz;
  v_accept_request uuid;
  v_accept_ua text;
  v_accept_ip bytea;
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
      -- Standing authorizations carry their own valid agreement path: the
      -- partner's prior acceptance, recorded on the instruction at payout
      -- day and re-verified live here (still unrevoked, gate still on).
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
      v_agreement.content_hash, v_accept_at,
      v_accept_request, v_accept_ua,
      v_accept_ip
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

revoke all on function public.accept_standing_reinvest_terms(uuid, uuid, text, bytea, uuid) from public, anon, authenticated;
revoke all on function public.revoke_standing_reinvest_authorization(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_revoke_standing_reinvest_authorization(uuid, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.accept_standing_reinvest_terms(uuid, uuid, text, bytea, uuid) to service_role;
grant execute on function public.revoke_standing_reinvest_authorization(uuid, uuid) to service_role;
grant execute on function public.admin_revoke_standing_reinvest_authorization(uuid, uuid, boolean, uuid) to service_role;

commit;
