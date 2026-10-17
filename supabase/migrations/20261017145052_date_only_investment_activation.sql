-- Apply before the date-only admin form. Timestamp callers remain supported.
begin;

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
  v_is_date_only boolean := false;
  v_date_cycles uuid[];
begin
  if private.is_admin(p_admin_id) is distinct from true or p_admin_aal2 is distinct from true then
    raise exception using errcode = '42501', message = 'active administrator AAL2 required';
  end if;
  if p_confirmation is distinct from 'ACTIVATE' then raise exception using errcode = '22023', message = 'typed confirmation is invalid'; end if;
  if nullif(trim(p_bank_reference), '') is null then raise exception using errcode = '22023', message = 'bank reference is required'; end if;
  if p_received_date is null or not isfinite(p_received_date) then raise exception using errcode = '22023', message = 'valid payment received date is required'; end if;
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
    -- New clients supply a verified Uganda calendar date. Retain the old
    -- timestamp path during migration-first rollout; never invent a paid time.
    v_is_date_only := p_received_at is null;
    if v_is_date_only then
      if p_received_date < (v_investment.requested_at at time zone 'Africa/Kampala')::date then
        raise exception using errcode = '23514', message = 'payment date predates the reservation date; held for staff resolution';
      end if;
      -- A cycle intersects this Uganda day. Midnight closes are exclusive;
      -- an end-of-day close includes that date. A split day is ambiguous.
      select array_agg(id order by opens_at,id) into v_date_cycles
      from public.investment_cycles
      where record_origin='portal'
        and opens_at < ((p_received_date + 1)::timestamp at time zone 'Africa/Kampala')
        and closes_at > (p_received_date::timestamp at time zone 'Africa/Kampala');
      if coalesce(array_length(v_date_cycles,1),0)=0 then
        raise exception using errcode = '23514', message = 'no eligible cycle is available for this payment date';
      end if;
      if array_length(v_date_cycles,1)>1 then
        raise exception using errcode = '23514', message = 'multiple eligible cycles match this payment date; held for staff resolution';
      end if;
      v_resolved_id := v_date_cycles[1];
      if v_investment.status <> 'reserved' then
        raise exception using errcode = '23514', message = 'only a pending reservation can be activated';
      end if;
      if v_resolved_id is distinct from v_investment.cycle_id then
        raise exception using errcode = '23514', message = 'payment date resolves to a different cycle; held for staff resolution without moving funds';
      end if;
    else
      -- Compatibility path for older timestamp-based app deployments.
      if not isfinite(p_received_at) or p_received_at > now() then
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
    end if;
    if v_resolved_id is distinct from v_investment.cycle_id then
      raise exception using errcode = '23514', message = 'payment timestamp resolves to a different cycle; held for staff resolution without moving funds';
    end if;
    if p_received_amount_ugx is distinct from v_investment.principal_ugx then
      raise exception using errcode = '23514', message = 'received amount must exactly match expected principal';
    end if;
    -- Recheck capacity and cumulative partner limit atomically (never revive
    -- cancelled rows; the current row is excluded from the sums).
    select * into v_profile from public.profiles where id = v_investment.investor_id for update;
    select * into v_cycle from public.investment_cycles where id = v_investment.cycle_id for update;
    if not found or v_cycle.capacity_ugx is null or v_cycle.status not in ('open', 'closed')
      or v_cycle.maturity_date <= (now() at time zone 'Africa/Kampala')::date then
      raise exception using errcode = '23514', message = 'destination cycle is not valid; held for staff resolution';
    end if;
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
    if p_received_amount_ugx is distinct from v_investment.principal_ugx then
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
    case when v_is_date_only then
      jsonb_build_object('received_amount_ugx', p_received_amount_ugx, 'received_date', p_received_date,
        'assignment_basis', 'payment_date', 'payment_date_timezone', 'Africa/Kampala',
        'payment_precision', 'date', 'cycle_id', v_investment.cycle_id,
        'policy_version', 'auto_cycle_v1', 'receipt_id', v_receipt_id, 'bank_receipt_id', v_bank_receipt_id,
        'receipt_number', v_receipt_number)
    when v_is_auto then
      jsonb_build_object('received_amount_ugx', p_received_amount_ugx, 'received_date', p_received_date,
        'received_at', p_received_at, 'assignment_basis', 'payment_timestamp',
        'applicable_timestamp', p_received_at, 'cycle_id', v_investment.cycle_id,
        'policy_version', 'auto_cycle_v1', 'receipt_id', v_receipt_id, 'bank_receipt_id', v_bank_receipt_id,
        'receipt_number', v_receipt_number)
    else
      jsonb_build_object('received_amount_ugx', p_received_amount_ugx, 'received_date', p_received_date,
        'receipt_id', v_receipt_id, 'bank_receipt_id', v_bank_receipt_id, 'receipt_number', v_receipt_number)
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
revoke all on function public.activate_investment(uuid,uuid,text,numeric,date,text,boolean,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.activate_investment(uuid,uuid,text,numeric,date,text,boolean,uuid,timestamptz) to service_role;
notify pgrst, 'reload schema';
commit;
