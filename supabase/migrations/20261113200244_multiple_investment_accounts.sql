begin;

create table public.investment_accounts (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid not null references public.profiles(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 80),
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, investor_id),
  check (not is_default or archived_at is null)
);
create unique index investment_accounts_default on public.investment_accounts(investor_id) where is_default;
create unique index investment_accounts_name on public.investment_accounts(investor_id, lower(trim(name))) where archived_at is null;
alter table public.investment_accounts enable row level security;
create policy accounts_self_read on public.investment_accounts for select to authenticated using (investor_id = (select auth.uid()));
create policy accounts_admin_read on public.investment_accounts for select to authenticated using (private.is_admin());
grant select on public.investment_accounts to authenticated;
grant all on public.investment_accounts to service_role;

insert into public.investment_accounts(investor_id, name, is_default) select id, 'Main Account', true from public.profiles;
alter table public.investments add column account_id uuid;
update public.investments i set account_id = a.id from public.investment_accounts a where a.investor_id = i.investor_id and a.is_default;
alter table public.investments add constraint investments_account_owner_fkey foreign key (account_id, investor_id) references public.investment_accounts(id, investor_id) on delete restrict;
alter table public.investments add constraint investments_claimed_account check (investor_id is null or account_id is not null);
create index investments_account_idx on public.investments(account_id, requested_at desc);

-- Includes new partners and legacy identities claimed after this migration.
create function private.ensure_main_investment_account() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.investment_accounts(investor_id, name, is_default) values (new.id, 'Main Account', true);
  return new;
end;
$$;
create trigger profile_main_investment_account after insert on public.profiles for each row execute function private.ensure_main_investment_account();

create function private.assign_investment_account() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' and old.account_id is not null and new.account_id is distinct from old.account_id then
    raise exception using errcode = '23514', message = 'investment account cannot be changed';
  end if;
  if new.investor_id is not null and new.account_id is null then
    select id into new.account_id from public.investment_accounts where investor_id = new.investor_id and is_default;
  end if;
  if TG_OP = 'INSERT' or new.account_id is distinct from old.account_id then
    if new.account_id is not null then
      perform 1 from public.investment_accounts where id = new.account_id and investor_id = new.investor_id and archived_at is null for update;
      if not found then raise exception using errcode = '42501', message = 'investment account unavailable'; end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger investment_account_assignment before insert or update on public.investments for each row execute function private.assign_investment_account();

create function public.manage_investment_account(p_investor_id uuid, p_name text, p_request_id uuid, p_account_id uuid default null, p_archive boolean default false)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_default boolean;
begin
  perform 1 from public.profiles where id = p_investor_id and access_status = 'active' for update;
  if not found then raise exception using errcode = '42501', message = 'partner unavailable'; end if;
  if p_account_id is null then
    if p_archive then raise exception 'account required'; end if;
    insert into public.investment_accounts(investor_id, name) values(p_investor_id, trim(p_name)) returning id into v_id;
  else
    select id, is_default into v_id, v_default from public.investment_accounts where id = p_account_id and investor_id = p_investor_id and archived_at is null for update;
    if not found then raise exception using errcode = '42501', message = 'investment account unavailable'; end if;
    if p_archive then
      if v_default then raise exception 'Main Account cannot be archived'; end if;
      if exists(select 1 from public.investments i where i.account_id = v_id and (i.status in ('reserved','active') or (i.status = 'matured' and i.payout_basis <> 'reported_paid' and i.offline_settlement_id is null and not exists(select 1 from public.maturity_instructions mi where mi.investment_id = i.id and mi.status = 'fulfilled')))) then
        raise exception 'account has outstanding investments';
      end if;
      update public.investment_accounts set archived_at = now() where id = v_id;
    else
      update public.investment_accounts set name = trim(p_name) where id = v_id;
    end if;
  end if;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, request_id) values(p_investor_id, case when p_archive then 'investment_account.archived' when p_account_id is null then 'investment_account.created' else 'investment_account.renamed' end, 'investment_account', v_id, p_request_id);
  return v_id;
end;
$$;
revoke all on function public.manage_investment_account(uuid,text,uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.manage_investment_account(uuid,text,uuid,uuid,boolean) to service_role;

create or replace function public.request_account_investment(
  p_account_id uuid,
  p_investor_id uuid,
  p_cycle_id uuid,
  p_principal_ugx numeric,
  p_request_id uuid,
  p_user_agent text,
  p_ip_fingerprint bytea,
  p_expected_agreement_version_id uuid default null
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
  v_resolved_id uuid;
  v_expiry timestamptz;
begin
  if p_account_id is null then raise exception using errcode = '42501', message = 'investment account required'; end if;
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
  -- Database-owned assignment: the cycle open now. The submitted cycle id is
  -- evidence of what the partner saw, never authority to select.
  -- Older app callers omit agreement evidence: keep their reservations on
  -- the legacy activation contract during the migration-first rollout.
  v_resolved_id := case when p_expected_agreement_version_id is null then p_cycle_id
    else private.resolve_portal_cycle(now()) end;
  if p_cycle_id is distinct from v_resolved_id then
    raise exception using errcode = '23514', message = 'the displayed cycle changed; review the refreshed terms and accept again';
  end if;
  select * into v_cycle from public.investment_cycles where id = v_resolved_id for update;
  if not found or v_cycle.status <> 'open' or now() < v_cycle.opens_at or now() >= v_cycle.closes_at
    or v_cycle.capacity_ugx is null then
    raise exception using errcode = '23514', message = 'reinvestment and new investment are unavailable; no eligible cycle is open. Full withdrawal remains available.';
  end if;
  if v_cycle.record_origin <> 'portal' or v_cycle.agreement_version_id is null then
    raise exception using errcode = '23514', message = 'reinvestment and new investment are unavailable; no eligible cycle is open. Full withdrawal remains available.';
  end if;
  select * into v_agreement from public.agreement_versions where id = v_cycle.agreement_version_id;
  if not found or not v_agreement.is_legally_approved or v_agreement.published_at is null then
    raise exception using errcode = '23514', message = 'approved agreement is required';
  end if;
  if p_expected_agreement_version_id is not null
    and p_expected_agreement_version_id is distinct from v_cycle.agreement_version_id then
    raise exception using errcode = '23514', message = 'the agreement changed; review the refreshed terms and accept again';
  end if;
  select coalesce(sum(principal_ugx), 0)::numeric(28,8) into v_used_principal
    from public.investments
    where cycle_id = v_resolved_id and status in ('reserved', 'active') and not is_test;
  if not v_profile.is_test and v_used_principal + p_principal_ugx > v_cycle.capacity_ugx then
    raise exception using errcode = '23514', message = 'cycle capacity exceeded';
  end if;
  select coalesce(sum(principal_ugx), 0)::numeric(28,8) into v_investor_principal
    from public.investments
    where cycle_id = v_resolved_id and investor_id = p_investor_id and status in ('reserved', 'active');
  if v_investor_principal + p_principal_ugx > coalesce(v_profile.investment_limit_ugx, 50000000) then
    raise exception using errcode = '23514', message = 'investor cycle limit exceeded';
  end if;
  v_return := round((p_principal_ugx * v_cycle.projected_return_bps::numeric) / 10000::numeric, 8);
  -- Reservations remain pending until manually resolved.
  v_expiry := null;
  insert into public.investments (account_id, id, investor_id, cycle_id, unit_price_ugx, principal_ugx,
    projected_return_bps, projected_return_ugx, projected_value_ugx, maturity_date,
    reservation_expires_at, record_origin, is_test, policy_version)
  values (p_account_id, v_investment_id, p_investor_id, v_resolved_id, v_cycle.unit_price_ugx, p_principal_ugx,
    v_cycle.projected_return_bps, v_return, p_principal_ugx + v_return, v_cycle.maturity_date,
    v_expiry, 'portal', v_profile.is_test, case when p_expected_agreement_version_id is not null then 'auto_cycle_v1' end);
  insert into public.investment_agreements (investment_id, investor_id, agreement_version_id,
    accepted_content_hash, accepted_at, acceptance_request_id, accepted_user_agent, accepted_ip_fingerprint)
  values (v_investment_id, p_investor_id, v_agreement.id, v_agreement.content_hash, now(), p_request_id,
    left(coalesce(p_user_agent, 'unknown'), 500), p_ip_fingerprint);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_investor_id, 'investment.requested', 'investment', v_investment_id, p_request_id,
    jsonb_build_object('account_id', p_account_id, 'cycle_id', v_resolved_id, 'principal_ugx', p_principal_ugx, 'is_test', v_profile.is_test,
      'assignment_basis', 'reservation_time', 'applicable_timestamp', now(), 'policy_version', case when p_expected_agreement_version_id is not null then 'auto_cycle_v1' else 'legacy' end,
      'reservation_expires_at', v_expiry, 'expected_cycle_id', p_cycle_id));
  insert into public.jobs (kind, entity_type, entity_id, payload)
  values ('send_email', 'investment', v_investment_id, jsonb_build_object('template', 'reservation_created'));
  return v_investment_id;
end;
$$;
revoke all on function public.request_account_investment(uuid, uuid, uuid, numeric, uuid, text, bytea, uuid) from public, anon, authenticated;
grant execute on function public.request_account_investment(uuid, uuid, uuid, numeric, uuid, text, bytea, uuid) to service_role;


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
  v_source_cycle public.investment_cycles%rowtype;
  v_roi numeric(28,8);
  v_accepted_on_actual boolean;
  v_company_name text := 'OurMu Ventures Limited';
  v_company_address text := 'Katabbi Town Council, Entebbe, Wakiso';
begin
  if not private.is_admin(p_admin_id) or p_admin_aal2 is distinct from true then
    raise exception using errcode = '42501', message = 'active administrator AAL2 required';
  end if;
  if p_confirmation is null or p_confirmation not in ('FULFILL', 'PROPOSE') then
    raise exception using errcode = '22023', message = 'typed confirmation is invalid';
  end if;
  if p_actual_roi_ugx is not null
    and (p_actual_roi_ugx::text in ('NaN', 'Infinity', '-Infinity') or p_actual_roi_ugx < 0) then
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

  -- The cycle-wide actual return is authoritative. The share lock serializes
  -- with record_cycle_actual_return, which locks the cycle for update.
  select * into v_source_cycle from public.investment_cycles
  where id = v_investment.cycle_id for share;
  if v_source_cycle.actual_return_bps is not null then
    v_roi := private.cycle_actual_return_ugx(v_investment.principal_ugx, v_source_cycle.actual_return_bps);
    if p_actual_roi_ugx is not null and p_actual_roi_ugx is distinct from v_roi then
      raise exception using errcode = '40001',
        message = 'the actual return for this cycle differs from the submitted amount; reload before fulfilling';
    end if;
  elsif v_source_cycle.legacy_settlement then
    -- Cycles already partly settled keep the per-investment ROI workflow.
    if p_actual_roi_ugx is null then
      raise exception using errcode = '22023', message = 'actual ROI must be zero or more';
    end if;
    v_roi := p_actual_roi_ugx;
  else
    raise exception using errcode = '23514',
      message = 'the actual return for this cycle is pending; settlement is blocked until it is recorded';
  end if;

  v_projected_roi := v_instruction.projected_payout_ugx
    + v_instruction.projected_reinvest_ugx - v_investment.principal_ugx;

  if v_instruction.choice = 'withdraw_all' then
    v_actual_payout := v_investment.principal_ugx + v_roi;
    v_actual_reinvest := 0;
  elsif v_instruction.choice = 'withdraw_roi_reinvest_principal' then

    if v_instruction.requested_withdrawal_ugx is null then
      v_actual_payout := v_roi;
      v_actual_reinvest := v_investment.principal_ugx;
    else
      v_actual_payout := round((v_investment.principal_ugx + v_roi)
        * v_instruction.requested_withdrawal_ugx
        / (v_instruction.projected_payout_ugx + v_instruction.projected_reinvest_ugx), 2);
      v_actual_reinvest := v_investment.principal_ugx + v_roi - v_actual_payout;
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
    v_actual_reinvest := v_investment.principal_ugx + v_roi;
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
    or v_instruction.proposed_actual_roi_ugx is distinct from v_roi
    or v_instruction.confirmed_actual_roi_ugx is distinct from v_roi then
    -- Amounts the partner accepted on this exact recorded rate need no
    -- second confirmation; projection-based choices keep the revised-amount
    -- confirmation flow.
    v_accepted_on_actual := v_instruction.amount_basis = 'actual'
      and v_instruction.basis_actual_return_bps is not distinct from v_source_cycle.actual_return_bps;
    if (v_accepted_on_actual or v_roi = v_projected_roi)
      and v_instruction.proposed_actual_roi_ugx is null then
      null;
    else
      -- The instruction row is locked above. Repeated calls from stale pages
      -- or concurrent tabs must not re-notify the partner about the same ROI.
      if v_instruction.proposed_actual_roi_ugx is not distinct from v_roi then
        return jsonb_build_object('instruction_id', p_instruction_id,
          'pending_partner_confirmation', true,
          'already_pending_partner_confirmation', true,
          'proposed_actual_roi_ugx', v_roi,
          'proposed_payout_ugx', v_actual_payout,
          'proposed_reinvest_ugx', v_actual_reinvest);
      end if;
      update public.maturity_instructions
      set proposed_actual_roi_ugx = v_roi,
        confirmed_actual_roi_ugx = null
      where id = p_instruction_id;
      insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
      values (p_admin_id, 'maturity_instruction.amounts_proposed', 'maturity_instruction',
        p_instruction_id, p_request_id,
        jsonb_build_object('proposed_actual_roi_ugx', v_roi,
          'proposed_payout_ugx', v_actual_payout,
          'proposed_reinvest_ugx', v_actual_reinvest));
      insert into public.jobs (kind, entity_type, entity_id, payload)
      values ('send_email', 'investment', v_instruction.investment_id,
        jsonb_build_object('template', 'maturity_action_needed'));
      return jsonb_build_object('instruction_id', p_instruction_id,
        'pending_partner_confirmation', true,
        'proposed_actual_roi_ugx', v_roi,
        'proposed_payout_ugx', v_actual_payout,
        'proposed_reinvest_ugx', v_actual_reinvest);
    end if;
  end if;

  -- A request to notify the partner never authorizes settlement. Their
  -- confirmation may have arrived while the admin's dialog was open.
  if p_confirmation = 'PROPOSE' then
    return jsonb_build_object('instruction_id', p_instruction_id,
      'already_accepted', true);
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
      account_id, id, investor_id, cycle_id, unit_price_ugx, principal_ugx, projected_return_bps,
      projected_return_ugx, projected_value_ugx, maturity_date, reservation_expires_at,
      status, requested_at, activated_at, record_origin, is_test, policy_version
    ) values (
      v_investment.account_id, v_new_investment_id, v_instruction.investor_id, v_target.id, v_target.unit_price_ugx,
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
    actual_roi_ugx = v_roi,
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
    p_request_id, jsonb_build_object('actual_roi_ugx', v_roi,
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

notify pgrst, 'reload schema';
create function private.receipt_investment_account() returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_account_id uuid;
begin
  select account_id into v_account_id from public.investments where id = new.investment_id;
  if v_account_id is not null then
    new.account_description := new.account_description || ' | Investment account: ' || v_account_id::text;
  end if;
  return new;
end;
$$;
create trigger receipt_investment_account before insert on public.investment_receipts for each row execute function private.receipt_investment_account();
revoke all on function private.ensure_main_investment_account(), private.assign_investment_account(), private.receipt_investment_account() from public, anon, authenticated;
grant execute on function private.ensure_main_investment_account(), private.assign_investment_account(), private.receipt_investment_account() to service_role;
commit;
