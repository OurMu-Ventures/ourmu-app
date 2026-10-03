begin;

alter table public.investments
  drop constraint investment_origin_fields,
  add constraint investment_origin_fields check (
    (record_origin = 'portal' and investor_id is not null and legacy_partner_id is null
      and import_batch_id is null and source_sheet is null and source_row is null
      and source_key is null and projected_return_bps = 3000
      and principal_ugx >= 125000
      and principal_ugx = round(principal_ugx, 2))
    or (record_origin = 'legacy_import' and legacy_partner_id is not null
      and import_batch_id is not null and source_sheet is not null and source_row >= 2
      and source_key is not null and projected_return_bps in (3000, 3500)
      and principal_ugx >= 125000 and reservation_expires_at is null
      and status in ('active', 'matured'))
  );


-- Keep historical terminal records unchanged; pending reservations no longer expire.
update public.investments set reservation_expires_at = null
where record_origin = 'portal' and status = 'reserved';

create or replace function public.request_investment(
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
  v_resolved_id := private.resolve_portal_cycle(now());
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
  -- Reservations remain pending until an administrator resolves them.
  v_expiry := null;
  insert into public.investments (id, investor_id, cycle_id, unit_price_ugx, principal_ugx,
    projected_return_bps, projected_return_ugx, projected_value_ugx, maturity_date,
    reservation_expires_at, record_origin, is_test, policy_version)
  values (v_investment_id, p_investor_id, v_resolved_id, v_cycle.unit_price_ugx, p_principal_ugx,
    v_cycle.projected_return_bps, v_return, p_principal_ugx + v_return, v_cycle.maturity_date,
    v_expiry, 'portal', v_profile.is_test, 'auto_cycle_v1');
  insert into public.investment_agreements (investment_id, investor_id, agreement_version_id,
    accepted_content_hash, accepted_at, acceptance_request_id, accepted_user_agent, accepted_ip_fingerprint)
  values (v_investment_id, p_investor_id, v_agreement.id, v_agreement.content_hash, now(), p_request_id,
    left(coalesce(p_user_agent, 'unknown'), 500), p_ip_fingerprint);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_investor_id, 'investment.requested', 'investment', v_investment_id, p_request_id,
    jsonb_build_object('cycle_id', v_resolved_id, 'principal_ugx', p_principal_ugx, 'is_test', v_profile.is_test,
      'assignment_basis', 'reservation_time', 'applicable_timestamp', now(), 'policy_version', 'auto_cycle_v1',
      'reservation_expires_at', v_expiry, 'expected_cycle_id', p_cycle_id));
  insert into public.jobs (kind, entity_type, entity_id, payload)
  values ('send_email', 'investment', v_investment_id, jsonb_build_object('template', 'reservation_created'));
  return v_investment_id;
end;
$$;
revoke all on function public.request_investment(uuid, uuid, numeric, uuid, text, bytea, uuid) from public, anon, authenticated;
grant execute on function public.request_investment(uuid, uuid, numeric, uuid, text, bytea, uuid) to service_role;

-- activate_investment: optional payment timestamp; new-policy requires it and
-- verifies the timely payment resolves to the reservation cycle. Legacy rows
-- require a pending reservation without any automatic deadline.

create or replace function public.activate_investment(
  p_admin_id uuid,
  p_investment_id uuid,
  p_bank_reference text,
  p_received_amount_ugx numeric,
  p_received_date date,
  p_confirmation text,
  p_admin_aal2 boolean,
  p_request_id uuid,
  p_received_at timestamptz default null
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_investment public.investments%rowtype;
  v_profile public.profiles%rowtype;
  v_cycle public.investment_cycles%rowtype;
  v_bank_receipt_id uuid;
  v_receipt_id uuid;
  v_receipt_number text;
  v_company_name text := 'OurMu Ventures Limited';
  v_company_address text := 'Katabbi Town Council, Entebbe, Wakiso';
  v_resolved_id uuid;
  v_used_principal numeric(28,8);
  v_investor_principal numeric(28,8);
  v_kampala_date date;
  v_is_auto boolean := false;
begin
  if not private.is_admin(p_admin_id) or not p_admin_aal2 then
    raise exception using errcode = '42501', message = 'active administrator AAL2 required';
  end if;
  if p_confirmation <> 'ACTIVATE' then raise exception using errcode = '22023', message = 'typed confirmation is invalid'; end if;
  if nullif(trim(p_bank_reference), '') is null then raise exception using errcode = '22023', message = 'bank reference is required'; end if;
  if p_received_date > (now() at time zone 'Africa/Kampala')::date then raise exception using errcode = '22023', message = 'received date cannot be in the future'; end if;
  select * into v_investment from public.investments where id = p_investment_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'investment not found'; end if;
  if v_investment.record_origin <> 'portal' then
    raise exception using errcode = '23514', message = 'imported investments cannot be activated';
  end if;
  if v_investment.status = 'active' and exists (
    select 1 from public.bank_receipts where investment_id = p_investment_id and bank_reference = trim(p_bank_reference)
  ) then return; end if;
  if v_investment.status = 'cancelled' then
    raise exception using errcode = '23514', message = 'cancelled reservations cannot be revived; create a new reservation';
  end if;

  if v_investment.policy_version = 'auto_cycle_v1' then
    -- New policy: verified bank payment timestamp is required.
    if p_received_at is null then
      raise exception using errcode = '22023', message = 'verified bank payment date and time (Africa/Kampala) is required';
    end if;
    if p_received_at > now() + interval '5 minutes' then
      raise exception using errcode = '22023', message = 'payment timestamp cannot be in the future';
    end if;
    v_kampala_date := (p_received_at at time zone 'Africa/Kampala')::date;
    if v_kampala_date is distinct from p_received_date then
      raise exception using errcode = '22023', message = 'received date must match the Kampala date of the verified payment timestamp';
    end if;
    if p_received_at < v_investment.requested_at then
      raise exception using errcode = '23514', message = 'payment timestamp predates the reservation; held for staff resolution';
    end if;
    if v_investment.status <> 'reserved' then
      raise exception using errcode = '23514', message = 'only a pending reservation can be activated';
    end if;
    -- The payment must resolve to the same cycle provisionally identified.
    v_resolved_id := private.resolve_portal_cycle(p_received_at);
    if v_resolved_id is distinct from v_investment.cycle_id then
      raise exception using errcode = '23514', message = 'payment timestamp resolves to a different cycle; held for staff resolution without moving funds';
    end if;
    if p_received_amount_ugx <> v_investment.principal_ugx then
      raise exception using errcode = '23514', message = 'received amount must exactly match expected principal';
    end if;
    -- Recheck capacity and cumulative partner limit atomically (never revive
    -- cancelled rows; the current row is excluded from the sums).
    select * into v_cycle from public.investment_cycles where id = v_investment.cycle_id for update;
    if not found or v_cycle.capacity_ugx is null then
      raise exception using errcode = '23514', message = 'destination cycle is not valid; held for staff resolution';
    end if;
    select * into v_profile from public.profiles where id = v_investment.investor_id for update;
    select coalesce(sum(principal_ugx), 0)::numeric(28,8) into v_used_principal
      from public.investments
      where cycle_id = v_investment.cycle_id and status in ('reserved', 'active') and not is_test and id <> v_investment.id;
    if not coalesce(v_profile.is_test, false) and v_used_principal + v_investment.principal_ugx > v_cycle.capacity_ugx then
      raise exception using errcode = '23514', message = 'cycle capacity exceeded; held for staff resolution';
    end if;
    select coalesce(sum(principal_ugx), 0)::numeric(28,8) into v_investor_principal
      from public.investments
      where cycle_id = v_investment.cycle_id and investor_id = v_investment.investor_id
        and status in ('reserved', 'active') and id <> v_investment.id;
    if v_investor_principal + v_investment.principal_ugx > coalesce(v_profile.investment_limit_ugx, 50000000) then
      raise exception using errcode = '23514', message = 'investor cycle limit exceeded; held for staff resolution';
    end if;
    insert into public.bank_receipts (investment_id, bank_reference, received_amount_ugx, received_date, received_at, recorded_by, activated_at)
    values (p_investment_id, trim(p_bank_reference), p_received_amount_ugx, p_received_date, p_received_at, p_admin_id, now())
    returning id into v_bank_receipt_id;
    update public.investments set status = 'active', activated_at = now() where id = p_investment_id;
    update public.investment_agreements set pdf_status = 'generating' where investment_id = p_investment_id;
    v_is_auto := true;
  else
    -- Legacy path preserves historical activation rules.
    if v_investment.status <> 'reserved' then
      raise exception using errcode = '23514', message = 'only a pending reservation can be activated';
    end if;
    if p_received_amount_ugx <> v_investment.principal_ugx then
      raise exception using errcode = '23514', message = 'received amount must exactly match expected principal';
    end if;
    insert into public.bank_receipts (investment_id, bank_reference, received_amount_ugx, received_date, received_at, recorded_by, activated_at)
    values (p_investment_id, trim(p_bank_reference), p_received_amount_ugx, p_received_date, p_received_at, p_admin_id, now())
    returning id into v_bank_receipt_id;
    update public.investments set status = 'active', activated_at = now() where id = p_investment_id;
    update public.investment_agreements set pdf_status = 'generating' where investment_id = p_investment_id;
    select * into v_profile from public.profiles where id = v_investment.investor_id;
    v_is_auto := false;
  end if;

  select * into v_profile from public.profiles where id = v_investment.investor_id;
  if found then
    v_receipt_number := private.allocate_receipt_number(coalesce(v_profile.is_test, false));
    insert into public.investment_receipts (
      investment_id, investor_id, source, bank_receipt_id, receipt_number, is_test,
      partner_name, partner_phone, company_name, company_address,
      amount_ugx, transaction_date, account_description
    ) values (
      p_investment_id, v_investment.investor_id, 'bank_activation', v_bank_receipt_id,
      v_receipt_number, coalesce(v_profile.is_test, false),
      v_profile.legal_name, v_profile.phone, v_company_name, v_company_address,
      p_received_amount_ugx, p_received_date,
      'Accounts payable — ' || v_profile.legal_name
    ) returning id into v_receipt_id;
  end if;
  -- Single immutable audit row, written once with the receipt attached.
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_admin_id, 'investment.activated', 'investment', p_investment_id, p_request_id,
    case when v_is_auto then
      jsonb_build_object('received_amount_ugx', p_received_amount_ugx, 'received_date', p_received_date,
        'received_at', p_received_at, 'assignment_basis', 'payment_timestamp',
        'applicable_timestamp', p_received_at, 'cycle_id', v_investment.cycle_id,
        'policy_version', 'auto_cycle_v1', 'receipt_id', v_bank_receipt_id,
        'receipt_number', v_receipt_number)
    else
      jsonb_build_object('received_amount_ugx', p_received_amount_ugx, 'received_date', p_received_date,
        'receipt_id', v_bank_receipt_id, 'receipt_number', v_receipt_number)
    end);
  insert into public.jobs (kind, entity_type, entity_id, payload) values
    ('generate_agreement_pdf', 'investment', p_investment_id, '{}'::jsonb);
  if v_receipt_id is not null then
    insert into public.jobs (kind, entity_type, entity_id, payload) values
      ('generate_receipt_pdf', 'investment_receipt', v_receipt_id,
        jsonb_build_object('investment_id', p_investment_id, 'receipt_number', v_receipt_number));
  else
    insert into public.jobs (kind, entity_type, entity_id, payload) values
      ('send_email', 'investment', p_investment_id, jsonb_build_object('template', 'investment_activated'));
  end if;
end;
$$;

revoke all on function public.activate_investment(uuid, uuid, text, numeric, date, text, boolean, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.activate_investment(uuid, uuid, text, numeric, date, text, boolean, uuid, timestamptz) to service_role;

create or replace function public.cancel_investment(p_investor_id uuid, p_investment_id uuid, p_request_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.investments set status = 'cancelled', cancelled_at = now()
  where id = p_investment_id and investor_id = p_investor_id and status = 'reserved';
  if not found then raise exception using errcode = '23514', message = 'reservation cannot be cancelled'; end if;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id)
  values (p_investor_id, 'investment.cancelled', 'investment', p_investment_id, p_request_id);
end;
$$;


create function public.expire_investment(
  p_admin_id uuid, p_investment_id uuid, p_confirmation text,
  p_admin_aal2 boolean, p_request_id uuid
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not private.is_admin(p_admin_id) or p_admin_aal2 is distinct from true then
    raise exception using errcode = '42501', message = 'active administrator AAL2 required';
  end if;
  if p_confirmation is distinct from 'EXPIRE' then
    raise exception using errcode = '22023', message = 'typed confirmation is invalid';
  end if;
  update public.investments set status = 'expired', reservation_expires_at = now()
  where id = p_investment_id and status = 'reserved' and record_origin = 'portal';
  if not found then
    raise exception using errcode = '23514', message = 'only a pending reservation can be expired';
  end if;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, request_id)
  values(p_admin_id, 'investment.expired', 'investment', p_investment_id, p_request_id);
end;
$$;
revoke all on function public.expire_investment(uuid, uuid, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.expire_investment(uuid, uuid, text, boolean, uuid) to service_role;
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
  -- Expiry is an explicit administrator action.
  v_expired := 0;

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

commit;
