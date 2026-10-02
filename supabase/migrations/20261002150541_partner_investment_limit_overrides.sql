begin;

alter table public.profiles add column investment_limit_ugx numeric;
alter table public.profiles add constraint profiles_investment_limit_valid check (
  investment_limit_ugx is null or (
    investment_limit_ugx > 50000000
    and investment_limit_ugx::text not in ('NaN', 'Infinity', '-Infinity')
    and investment_limit_ugx = round(investment_limit_ugx, 2)
  )
);
comment on column public.profiles.investment_limit_ugx is
  'Persistent per-cycle partner cap; NULL uses UGX 50,000,000. Backend managed only.';

create function public.set_partner_investment_limit(
  p_investor_id uuid, p_admin_id uuid, p_limit_ugx numeric,
  p_reason text, p_request_id uuid
) returns void
language plpgsql security invoker set search_path = '' as $function$
declare
  v_old_limit numeric;
begin
  if not exists (select 1 from public.profiles
    where id = p_admin_id and role = 'admin' and access_status = 'active') then
    raise exception using errcode = '42501', message = 'active administrator is required';
  end if;
  if p_request_id is null or p_reason is null or length(trim(p_reason)) < 3
    or length(p_reason) > 1000 then
    raise exception using errcode = '22023', message = 'request ID and reason (3–1000 characters) are required';
  end if;
  if p_limit_ugx is not null and (
    p_limit_ugx::text in ('NaN', 'Infinity', '-Infinity') or p_limit_ugx <= 50000000
    or p_limit_ugx <> round(p_limit_ugx, 2)
  ) then
    raise exception using errcode = '22023', message = 'override must exceed UGX 50,000,000 with at most two decimals';
  end if;
  select investment_limit_ugx into v_old_limit from public.profiles
    where id = p_investor_id and role = 'investor' for update;
  if not found then
    raise exception using errcode = '22023', message = 'partner profile was not found';
  end if;
  update public.profiles set investment_limit_ugx = p_limit_ugx, updated_at = now()
    where id = p_investor_id;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
    values (p_admin_id, 'partner.investment_limit_changed', 'profile', p_investor_id,
      p_request_id, jsonb_build_object('old_limit_ugx', v_old_limit,
        'new_limit_ugx', p_limit_ugx, 'effective_limit_ugx', coalesce(p_limit_ugx, 50000000),
        'reason', trim(p_reason)));
end;
$function$;
revoke all on function public.set_partner_investment_limit(uuid, uuid, numeric, text, uuid)
  from public, anon, authenticated;
grant execute on function public.set_partner_investment_limit(uuid, uuid, numeric, text, uuid)
  to service_role;

-- Keep all origin checks, but enforce the variable cap only on NEW placements.
-- Clearing an override must not invalidate existing investments during activation.
alter table public.investments
  drop constraint investment_origin_fields,
  add constraint investment_origin_fields check (
    (record_origin = 'portal' and investor_id is not null and legacy_partner_id is null
      and import_batch_id is null and source_sheet is null and source_row is null
      and source_key is null and projected_return_bps = 3000
      and principal_ugx >= 125000
      and principal_ugx = round(principal_ugx, 2) and reservation_expires_at is not null)
    or (record_origin = 'legacy_import' and legacy_partner_id is not null
      and import_batch_id is not null and source_sheet is not null and source_row >= 2
      and source_key is not null and projected_return_bps in (3000, 3500)
      and principal_ugx >= 125000 and reservation_expires_at is null
      and status in ('active', 'matured'))
  );

create function private.guard_partner_investment_limit() returns trigger
language plpgsql security invoker set search_path = '' as $function$
declare
  v_limit numeric;
  v_used numeric;
begin
  if tg_op = 'UPDATE' then
    if old.record_origin = 'portal' and
      row(new.principal_ugx, new.investor_id, new.cycle_id, new.record_origin) is distinct from
      row(old.principal_ugx, old.investor_id, old.cycle_id, old.record_origin) then
      raise exception using errcode = '55000', message = 'portal investment principal and ownership are immutable';
    end if;
    return new; -- Status changes, including activation, preserve existing terms.
  end if;
  if new.record_origin <> 'portal' or new.investor_id is null then return new; end if;
  select coalesce(investment_limit_ugx, 50000000) into v_limit
    from public.profiles where id = new.investor_id for update;
  if not found then return new; end if; -- Existing FK reports missing profiles.
  if new.principal_ugx > v_limit then
    raise exception using errcode = '23514', message = 'investment amount exceeds partner limit';
  end if;
  -- Serialize all placements for this partner, including direct backend inserts.
  if new.status in ('reserved', 'active') then
    select coalesce(sum(principal_ugx), 0) into v_used from public.investments
      where investor_id = new.investor_id and cycle_id = new.cycle_id
        and status in ('reserved', 'active');
    if v_used + new.principal_ugx > v_limit then
      raise exception using errcode = '23514', message = 'investor cycle limit exceeded';
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_partner_investment_limit() from public, anon, authenticated;
create trigger partner_investment_limit_guard before insert or update on public.investments
  for each row execute function private.guard_partner_investment_limit();

-- Explicit definitions pinned to main db87767f (including flexible Paka Paka,
-- paid-investment protection and receipts). No live-definition text rewriting.
alter table public.maturity_instructions
  drop constraint maturity_custom_withdrawal,
  add constraint maturity_custom_withdrawal check (
    requested_withdrawal_ugx is null or (
      choice = 'withdraw_roi_reinvest_principal'
      and requested_withdrawal_ugx::text not in ('NaN', 'Infinity', '-Infinity')
      and requested_withdrawal_ugx > 0
      and requested_withdrawal_ugx = round(requested_withdrawal_ugx, 2)
      and requested_withdrawal_ugx = projected_payout_ugx
      and projected_reinvest_ugx >= 125000
      and projected_reinvest_ugx = round(projected_reinvest_ugx, 2)
    )
  );

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
  select * into v_profile from public.profiles where id = p_investor_id for update;
  if p_principal_ugx is null or p_principal_ugx < 125000 or p_principal_ugx > coalesce(v_profile.investment_limit_ugx, 50000000) or p_principal_ugx <> round(p_principal_ugx, 2) then
    raise exception using errcode = '22023', message = 'amount must be at least UGX 125,000 and within your partner limit with at most two decimals';
  end if;

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
    from public.investments
    where cycle_id = p_cycle_id and status in ('reserved', 'active') and not is_test;
  if not v_profile.is_test and v_used_principal + p_principal_ugx > v_cycle.capacity_ugx then
    raise exception using errcode = '23514', message = 'cycle capacity exceeded';
  end if;
  select coalesce(sum(principal_ugx), 0)::numeric(28,8) into v_investor_principal
    from public.investments
    where cycle_id = p_cycle_id and investor_id = p_investor_id and status in ('reserved', 'active');
  if v_investor_principal + p_principal_ugx > coalesce(v_profile.investment_limit_ugx, 50000000) then
    raise exception using errcode = '23514', message = 'investor cycle limit exceeded';
  end if;
  v_return := round((p_principal_ugx * v_cycle.projected_return_bps::numeric) / 10000::numeric, 8);
  insert into public.investments (id, investor_id, cycle_id, unit_price_ugx, principal_ugx,
    projected_return_bps, projected_return_ugx, projected_value_ugx, maturity_date,
    reservation_expires_at, record_origin, is_test)
  values (v_investment_id, p_investor_id, p_cycle_id, v_cycle.unit_price_ugx, p_principal_ugx,
    v_cycle.projected_return_bps, v_return, p_principal_ugx + v_return, v_cycle.maturity_date,
    now() + interval '48 hours', 'portal', v_profile.is_test);
  insert into public.investment_agreements (investment_id, investor_id, agreement_version_id,
    accepted_content_hash, accepted_at, acceptance_request_id, accepted_user_agent, accepted_ip_fingerprint)
  values (v_investment_id, p_investor_id, v_agreement.id, v_agreement.content_hash, now(), p_request_id,
    left(coalesce(p_user_agent, 'unknown'), 500), p_ip_fingerprint);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_investor_id, 'investment.requested', 'investment', v_investment_id, p_request_id,
    jsonb_build_object('cycle_id', p_cycle_id, 'principal_ugx', p_principal_ugx, 'is_test', v_profile.is_test));
  insert into public.jobs (kind, entity_type, entity_id, payload)
  values ('send_email', 'investment', v_investment_id, jsonb_build_object('template', 'reservation_created'));
  return v_investment_id;
end;
$$;


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
  v_company_name text := 'OurMu Ventures Limited';
  v_company_address text := 'Katabbi Town Council, Entebbe, Wakiso';
begin
  if not private.is_admin(p_admin_id) or not p_admin_aal2 then
    raise exception using errcode = '42501', message = 'active administrator AAL2 required';
  end if;
  if p_confirmation <> 'FULFILL' then
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
      status, requested_at, activated_at, record_origin, is_test
    ) values (
      v_new_investment_id, v_instruction.investor_id, v_target.id, v_target.unit_price_ugx,
      v_actual_reinvest, v_target.projected_return_bps, v_return,
      v_actual_reinvest + v_return, v_target.maturity_date, now(),
      'active', now(), now(), 'portal', coalesce(v_profile.is_test, false)
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
      'receipt_id', v_receipt_id, 'receipt_number', v_receipt_number));
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


CREATE OR REPLACE FUNCTION public.submit_maturity_instruction(p_investor_id uuid, p_investment_id uuid, p_choice public.maturity_choice, p_target_cycle_id uuid, p_payout_destination_id uuid, p_agreement_accepted boolean, p_destination_confirmed boolean, p_request_id uuid, p_user_agent text, p_ip_fingerprint bytea, p_requested_withdrawal_ugx numeric DEFAULT NULL::numeric, p_custom_split boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
      requested_withdrawal_ugx = case when p_choice = 'withdraw_roi_reinvest_principal' then p_requested_withdrawal_ugx else null end,
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
      p_request_id, jsonb_build_object('requested_withdrawal_ugx', case when p_choice = 'withdraw_roi_reinvest_principal' then p_requested_withdrawal_ugx else null end, 'choice', p_choice));
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
    acceptance_captured_at, request_id
  ) values (
    p_investment_id, p_investor_id, p_choice, case when p_choice = 'withdraw_roi_reinvest_principal' then p_requested_withdrawal_ugx else null end, v_payout, v_reinvest,
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
    p_request_id, jsonb_build_object('requested_withdrawal_ugx', case when p_choice = 'withdraw_roi_reinvest_principal' then p_requested_withdrawal_ugx else null end, 'choice', p_choice, 'investment_id', p_investment_id));
  insert into public.jobs (kind, entity_type, entity_id, payload)
  values ('send_email', 'investment', p_investment_id,
    jsonb_build_object('template', 'maturity_choice_confirmed'));
  return v_existing.id;
end;
$function$;



notify pgrst, 'reload schema';
commit;
