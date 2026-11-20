-- Apply before deploying the Allocate bank deposit admin page. Existing
-- activation, receipts and their duplicate protections keep working unchanged.
begin;

-- One verified bank transfer from one partner, split across that partner's
-- investments. The deposit holds the unique reference, the verified payment
-- date (and time when the statement shows one), the partner's offline split
-- authority, and who posted it and when. Placements never get an electronic
-- acceptance record: the offline authority below is their agreement evidence.
create table public.bank_deposits (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid not null references public.profiles(id) on delete restrict,
  cycle_id uuid not null references public.investment_cycles(id) on delete restrict,
  bank_reference text not null check (bank_reference = trim(bank_reference) and length(bank_reference) between 3 and 120),
  received_amount_ugx numeric(28,8) not null check (received_amount_ugx > 0 and received_amount_ugx = round(received_amount_ugx, 2)),
  received_date date not null,
  received_at timestamptz,
  authorized_on date not null,
  authorization_method text not null check (authorization_method in ('signed_document','email','recorded_call','in_person')),
  evidence_reference text not null check (length(trim(evidence_reference)) between 5 and 500),
  verification_notes text not null check (length(trim(verification_notes)) between 10 and 2000),
  identity_verified boolean not null check (identity_verified),
  split_verified boolean not null check (split_verified),
  agreement_accepted_offline boolean not null,
  placement_agreement_version_id uuid references public.agreement_versions(id) on delete restrict,
  placement_agreement_hash text check (placement_agreement_hash ~ '^[a-fA-F0-9]{64}$'),
  allocation_count integer not null check (allocation_count between 1 and 20),
  is_test boolean not null,
  posted_by uuid not null references public.profiles(id) on delete restrict,
  posted_at timestamptz not null default now(),
  request_id uuid not null unique,
  request_fingerprint text not null,
  constraint bank_deposit_kampala_date check (received_at is null or received_date = (received_at at time zone 'Africa/Kampala')::date),
  constraint bank_deposit_posted_after_receipt check (
    (posted_at at time zone 'Africa/Kampala')::date >= received_date and (received_at is null or posted_at >= received_at)),
  constraint bank_deposit_placement_agreement check (
    (placement_agreement_version_id is null) = (placement_agreement_hash is null)
    and agreement_accepted_offline = (placement_agreement_version_id is not null))
);
comment on table public.bank_deposits is
  'One verified bank transfer allocated across one partner''s investments. Each allocation is a bank_receipts row with deposit_id; reconcile deposits once, not per allocation.';
comment on column public.bank_deposits.received_date is 'Verified Uganda payment date. Decides the cycle, as in date-only activation.';
comment on column public.bank_deposits.received_at is 'Verified payment time when the bank statement shows one; never invented.';
comment on column public.bank_deposits.agreement_accepted_offline is
  'True when the deposit created offline placements: the partner accepted placement_agreement_version_id/hash offline, evidenced by authorization_method and evidence_reference.';
comment on column public.bank_deposits.posted_at is 'Actual time an administrator posted the allocation; may be after the cycle closed.';
create unique index bank_deposits_reference_key on public.bank_deposits (upper(bank_reference));
create index bank_deposits_investor_idx on public.bank_deposits (investor_id, posted_at desc);
create index bank_deposits_posted_idx on public.bank_deposits (posted_at desc);
alter table public.bank_deposits enable row level security;
create policy bank_deposits_admin_read on public.bank_deposits for select to authenticated using (private.is_admin());
revoke all on public.bank_deposits from public, anon, authenticated;
grant select on public.bank_deposits to authenticated;
grant select, insert on public.bank_deposits to service_role;
create trigger bank_deposits_immutable before update or delete on public.bank_deposits
  for each row execute function private.reject_immutable_change();

-- Allocations stay one bank_receipts row per investment, so the existing
-- single-payment rule (unique investment_id), receipts and partner reads hold.
alter table public.bank_receipts
  add column deposit_id uuid references public.bank_deposits(id) on delete restrict,
  add column deposit_line smallint check (deposit_line between 1 and 20),
  add column allocation_kind text check (allocation_kind in ('reservation','offline_placement')),
  add constraint bank_receipt_deposit_fields check (
    (deposit_id is null and deposit_line is null and allocation_kind is null)
    or (deposit_id is not null and deposit_line is not null and allocation_kind is not null)
  ),
  add constraint bank_receipt_deposit_line unique (deposit_id, deposit_line);
comment on column public.bank_receipts.deposit_id is
  'Set when this payment is one allocation of a shared bank deposit. NULL for single-investment payments.';
-- Keep the single-payment reference rule and its constraint name.
alter table public.bank_receipts drop constraint bank_receipts_bank_reference_key;
create unique index bank_receipts_bank_reference_key on public.bank_receipts (bank_reference) where deposit_id is null;
create index bank_receipts_reference_upper_idx on public.bank_receipts (upper(trim(bank_reference))) where deposit_id is null;
create index bank_receipts_deposit_idx on public.bank_receipts (deposit_id) where deposit_id is not null;

-- An offline placement's agreement evidence is its deposit's offline
-- authority. It never gets an electronic acceptance row, so no PDF claiming
-- electronic acceptance can be generated for it.
create function private.guard_offline_placement_agreement() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if exists (select 1 from public.bank_receipts
    where investment_id = new.investment_id and allocation_kind = 'offline_placement') then
    raise exception using errcode = '23514', message = 'offline placements have no electronic agreement acceptance';
  end if;
  return new;
end;
$$;
create trigger offline_placement_agreement before insert or update of investment_id on public.investment_agreements
  for each row execute function private.guard_offline_placement_agreement();

-- A reference belongs to one single payment or one deposit, never both. The
-- advisory lock serializes the cross-table check for the same reference.
create function private.guard_bank_reference() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_deposit public.bank_deposits%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('ourmu.bank_reference:' || upper(trim(new.bank_reference)), 0));
  if tg_table_name = 'bank_deposits' then
    if exists (select 1 from public.bank_receipts
      where deposit_id is null and upper(trim(bank_reference)) = upper(trim(new.bank_reference))) then
      raise exception using errcode = '23505', message = 'bank reference is already recorded';
    end if;
    return new;
  end if;
  if new.deposit_id is null then
    if exists (select 1 from public.bank_deposits where upper(bank_reference) = upper(trim(new.bank_reference))) then
      raise exception using errcode = '23505', message = 'bank reference is already recorded';
    end if;
    return new;
  end if;
  -- Allocations are written with their deposit, in the same transaction.
  select * into v_deposit from public.bank_deposits where id = new.deposit_id;
  if not found or v_deposit.posted_at <> now()
    or new.bank_reference is distinct from v_deposit.bank_reference
    or new.received_date is distinct from v_deposit.received_date
    or new.received_at is distinct from v_deposit.received_at
    or new.recorded_by is distinct from v_deposit.posted_by
    or new.activated_at is distinct from v_deposit.posted_at then
    raise exception using errcode = '23514', message = 'deposit allocation does not match its deposit';
  end if;
  return new;
end;
$$;
create trigger bank_deposit_reference before insert on public.bank_deposits
  for each row execute function private.guard_bank_reference();
create trigger bank_receipt_reference before insert on public.bank_receipts
  for each row execute function private.guard_bank_reference();

-- Checked at commit: a deposit and its allocations are written together and
-- must balance exactly, so no partial or later-appended split can persist.
create function private.check_bank_deposit_balance() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := (to_jsonb(new) ->> case when tg_table_name = 'bank_deposits' then 'id' else 'deposit_id' end)::uuid;
  v_amount numeric(28,8);
  v_count integer;
  v_sum numeric(28,8);
  v_lines integer;
begin
  select received_amount_ugx, allocation_count into v_amount, v_count from public.bank_deposits where id = v_id;
  select coalesce(sum(received_amount_ugx), 0), count(*) into v_sum, v_lines
    from public.bank_receipts where deposit_id = v_id;
  if v_sum is distinct from v_amount or v_lines is distinct from v_count then
    raise exception using errcode = '23514', message = 'bank deposit allocations must add up to the deposit';
  end if;
  return null;
end;
$$;
create constraint trigger bank_deposit_balanced after insert on public.bank_deposits
  deferrable initially deferred for each row execute function private.check_bank_deposit_balance();
create constraint trigger bank_receipt_deposit_balanced after insert on public.bank_receipts
  deferrable initially deferred for each row when (new.deposit_id is not null)
  execute function private.check_bank_deposit_balance();

-- Receipts snapshot the shared reference and deposit total at issuance.
-- Single-payment and historical receipts keep these NULL and render as before.
alter table public.investment_receipts
  add column bank_deposit_id uuid references public.bank_deposits(id) on delete restrict,
  add column payment_reference text,
  add column deposit_amount_ugx numeric(28,8),
  add column deposit_allocation_count integer,
  add constraint receipt_deposit_snapshot check (
    (bank_deposit_id is null and payment_reference is null and deposit_amount_ugx is null and deposit_allocation_count is null)
    or (source = 'bank_activation' and bank_deposit_id is not null and payment_reference is not null
      and deposit_amount_ugx >= amount_ugx and deposit_allocation_count between 1 and 20)
  );
create function private.guard_receipt_deposit_snapshot() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if row(new.bank_deposit_id, new.payment_reference, new.deposit_amount_ugx, new.deposit_allocation_count)
      is distinct from row(old.bank_deposit_id, old.payment_reference, old.deposit_amount_ugx, old.deposit_allocation_count) then
      raise exception using errcode = '55000', message = 'issued receipt details are immutable';
    end if;
    return new;
  end if;
  if new.bank_deposit_id is not null and not exists (
    select 1 from public.bank_receipts r join public.bank_deposits d on d.id = r.deposit_id
    where r.id = new.bank_receipt_id and r.investment_id = new.investment_id and d.id = new.bank_deposit_id
      and r.received_amount_ugx = new.amount_ugx and d.bank_reference = new.payment_reference
      and d.received_amount_ugx = new.deposit_amount_ugx and d.allocation_count = new.deposit_allocation_count
  ) then
    raise exception using errcode = '23514', message = 'receipt does not match its deposit allocation';
  end if;
  return new;
end;
$$;
create trigger receipt_deposit_snapshot before insert or update on public.investment_receipts
  for each row execute function private.guard_receipt_deposit_snapshot();

-- Reconciliation: one row per real bank transfer. A split deposit appears
-- once with its full amount, never once per allocation.
create view public.bank_payment_reconciliation with (security_invoker = true) as
  select r.id as payment_id, 'single_investment'::text as payment_kind, r.bank_reference,
    r.received_amount_ugx, r.received_date, r.received_at, r.recorded_by as posted_by,
    r.activated_at as posted_at, 1 as investment_count, i.investor_id, i.is_test
  from public.bank_receipts r join public.investments i on i.id = r.investment_id
  where r.deposit_id is null
  union all
  select d.id, 'split_deposit', d.bank_reference, d.received_amount_ugx, d.received_date, d.received_at,
    d.posted_by, d.posted_at, d.allocation_count, d.investor_id, d.is_test
  from public.bank_deposits d;
revoke all on public.bank_payment_reconciliation from public, anon, authenticated;
grant select on public.bank_payment_reconciliation to service_role;

-- Post one verified bank deposit across one partner's investments in one
-- transaction. Lines are pending reservations (funded in full) or new
-- placements the partner instructed offline. Lock order matches activation:
-- investments, partner, cycle, the reference lock, then accounts.
create function public.allocate_bank_deposit(
  p_admin_id uuid,
  p_admin_aal2 boolean,
  p_request_id uuid,
  p_investor_id uuid,
  p_expected_cycle_id uuid,
  p_bank_reference text,
  p_received_amount_ugx numeric,
  p_received_date date,
  p_authorized_on date,
  p_authorization_method text,
  p_evidence_reference text,
  p_verification_notes text,
  p_allocations jsonb,
  p_identity_verified boolean,
  p_split_verified boolean,
  p_expected_agreement_hash text,
  p_agreement_accepted_offline boolean,
  p_confirmation text,
  p_received_at timestamptz default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_reference text := nullif(trim(p_bank_reference), '');
  v_today date := (now() at time zone 'Africa/Kampala')::date;
  v_uuid text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_line jsonb;
  v_kind text[] := '{}';
  v_investment uuid[] := '{}';
  v_account uuid[] := '{}';
  v_amount numeric(28,8)[] := '{}';
  v_count integer;
  v_i integer;
  v_has_placement boolean;
  v_profile public.profiles%rowtype;
  v_cycle public.investment_cycles%rowtype;
  v_cycles uuid[];
  v_agreement public.agreement_versions%rowtype;
  v_row public.investments%rowtype;
  v_existing public.bank_deposits%rowtype;
  v_fingerprint text;
  v_placement_total numeric(28,8);
  v_used numeric(28,8);
  v_partner_used numeric(28,8);
  v_deposit_id uuid := gen_random_uuid();
  v_investment_id uuid;
  v_bank_receipt_id uuid;
  v_receipt_id uuid;
  v_receipt_number text;
  v_return numeric(28,8);
  v_investment_ids uuid[] := '{}';
begin
  if private.is_admin(p_admin_id) is distinct from true or p_admin_aal2 is distinct from true then
    raise exception using errcode = '42501', message = 'active administrator AAL2 required';
  end if;
  if p_confirmation is distinct from 'ALLOCATE' then
    raise exception using errcode = '22023', message = 'typed confirmation is invalid';
  end if;
  if p_request_id is null then raise exception using errcode = '22023', message = 'request id is required'; end if;
  if v_reference is null or length(v_reference) not between 3 and 120 then
    raise exception using errcode = '22023', message = 'bank reference is required';
  end if;
  if p_received_amount_ugx is null or p_received_amount_ugx::text in ('NaN', 'Infinity', '-Infinity')
    or p_received_amount_ugx <= 0 or p_received_amount_ugx <> round(p_received_amount_ugx, 2) then
    raise exception using errcode = '22023', message = 'received amount must be positive with at most two decimals';
  end if;
  if p_received_date is null or not isfinite(p_received_date) then
    raise exception using errcode = '22023', message = 'valid payment received date is required';
  end if;
  if p_received_date > v_today then
    raise exception using errcode = '22023', message = 'received date cannot be in the future';
  end if;
  -- An optional statement time is kept as evidence; the date decides the cycle.
  if p_received_at is not null and (not isfinite(p_received_at) or p_received_at > now()) then
    raise exception using errcode = '22023', message = 'payment timestamp cannot be in the future';
  end if;
  if p_received_at is not null and (p_received_at at time zone 'Africa/Kampala')::date is distinct from p_received_date then
    raise exception using errcode = '22023', message = 'received date must match the Kampala date of the verified payment timestamp';
  end if;
  if coalesce(p_authorization_method, '') not in ('signed_document', 'email', 'recorded_call', 'in_person')
    or p_authorized_on is null or not isfinite(p_authorized_on)
    or coalesce(length(trim(p_evidence_reference)), 0) not between 5 and 500
    or coalesce(length(trim(p_verification_notes)), 0) not between 10 and 2000 then
    raise exception using errcode = '22023', message = 'dated partner split instructions and verification notes are required';
  end if;
  if p_authorized_on > v_today then
    raise exception using errcode = '22023', message = 'split instruction date cannot be in the future';
  end if;
  if p_identity_verified is distinct from true or p_split_verified is distinct from true then
    raise exception using errcode = '22023', message = 'confirm the partner identity, bank statement and split instructions were verified';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) not between 1 and 20 then
    raise exception using errcode = '22023', message = 'allocations must list between 1 and 20 investments';
  end if;
  for v_line in select value from jsonb_array_elements(p_allocations) with ordinality order by ordinality loop
    if jsonb_typeof(v_line) <> 'object'
      or coalesce(v_line->>'kind', '') not in ('reservation', 'offline_placement')
      or coalesce(v_line->>'amount_ugx', '') !~ '^[0-9]{1,15}(\.[0-9]{1,2})?$'
      or coalesce(v_line->>'account_id', '') !~ v_uuid
      or (v_line->>'kind' = 'reservation') is distinct from (coalesce(v_line->>'investment_id', '') ~ v_uuid)
      or (v_line->>'kind' = 'offline_placement' and v_line ? 'investment_id')
      or (v_line->>'amount_ugx')::numeric <= 0 then
      raise exception using errcode = '22023', message = 'allocation line is invalid';
    end if;
    v_kind := v_kind || (v_line->>'kind');
    v_investment := v_investment || (v_line->>'investment_id')::uuid;
    v_account := v_account || (v_line->>'account_id')::uuid;
    v_amount := v_amount || (v_line->>'amount_ugx')::numeric(28,8);
  end loop;
  v_count := array_length(v_kind, 1);
  if (select count(*) <> count(distinct i) from unnest(v_investment) i where i is not null) then
    raise exception using errcode = '22023', message = 'an investment can appear only once in a deposit';
  end if;
  v_has_placement := 'offline_placement' = any(v_kind);

  perform 1 from public.investments where id = any(v_investment) order by id for update;
  select * into v_profile from public.profiles where id = p_investor_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'partner not found'; end if;

  -- A retry or double submit with the same request replays the original result.
  v_fingerprint := encode(sha256(convert_to(jsonb_build_object(
    'investor', p_investor_id, 'cycle', p_expected_cycle_id, 'reference', v_reference,
    'amount', round(p_received_amount_ugx, 2)::text, 'received_date', p_received_date,
    'received_at', to_char(p_received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    'method', p_authorization_method, 'authorized_on', p_authorized_on,
    'evidence', trim(p_evidence_reference), 'notes', trim(p_verification_notes),
    'agreement', case when v_has_placement then lower(p_expected_agreement_hash) end,
    'lines', (select jsonb_agg(jsonb_build_array(k, i, a, round(m, 2)::text) order by k, i, a, m)
      from unnest(v_kind, v_investment, v_account, v_amount) as t(k, i, a, m))
  )::text, 'UTF8')), 'hex');
  select * into v_existing from public.bank_deposits where request_id = p_request_id;
  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint or v_existing.posted_by is distinct from p_admin_id then
      raise exception using errcode = '23505', message = 'request already used for a different deposit';
    end if;
    return jsonb_build_object('deposit_id', v_existing.id, 'replayed', true,
      'investment_ids', (select jsonb_agg(investment_id order by deposit_line) from public.bank_receipts where deposit_id = v_existing.id));
  end if;

  -- The Uganda payment date decides the cycle, as in date-only activation:
  -- a cycle intersecting that day, midnight closes exclusive, a split day
  -- ambiguous. A payment inside a cycle can be posted after it closes.
  select array_agg(id order by opens_at, id) into v_cycles from public.investment_cycles
    where record_origin = 'portal'
      and opens_at < ((p_received_date + 1)::timestamp at time zone 'Africa/Kampala')
      and closes_at > (p_received_date::timestamp at time zone 'Africa/Kampala');
  if coalesce(array_length(v_cycles, 1), 0) = 0 then
    raise exception using errcode = '23514', message = 'no eligible cycle is available for this payment date';
  end if;
  if array_length(v_cycles, 1) > 1 then
    raise exception using errcode = '23514', message = 'multiple eligible cycles match this payment date; held for staff resolution';
  end if;
  if v_cycles[1] is distinct from p_expected_cycle_id then
    raise exception using errcode = '23514', message = 'payment date resolves to a different cycle than reviewed; refresh and review again';
  end if;
  select * into v_cycle from public.investment_cycles where id = v_cycles[1] for update;
  if v_cycle.capacity_ugx is null or v_cycle.status not in ('open', 'closed') or v_cycle.maturity_date <= v_today then
    raise exception using errcode = '23514', message = 'destination cycle is not valid; held for staff resolution';
  end if;
  -- After the cycle lock, as in activation, whose receipt trigger takes this lock.
  perform pg_advisory_xact_lock(hashtextextended('ourmu.bank_reference:' || upper(v_reference), 0));
  if exists (select 1 from public.bank_deposits where upper(bank_reference) = upper(v_reference))
    or exists (select 1 from public.bank_receipts where deposit_id is null and upper(trim(bank_reference)) = upper(v_reference)) then
    raise exception using errcode = '23505', message = 'bank reference is already recorded';
  end if;

  for v_i in 1..v_count loop
    continue when v_kind[v_i] <> 'reservation';
    select * into v_row from public.investments where id = v_investment[v_i];
    if not found or v_row.investor_id is distinct from p_investor_id then
      raise exception using errcode = 'P0002', message = 'reservation not found for this partner';
    end if;
    if v_row.record_origin <> 'portal' then
      raise exception using errcode = '23514', message = 'imported investments cannot be activated';
    end if;
    if v_row.status = 'cancelled' then
      raise exception using errcode = '23514', message = 'cancelled reservations cannot be revived; create a new reservation';
    end if;
    if v_row.status <> 'reserved' then
      raise exception using errcode = '23514', message = 'only a pending reservation can be activated';
    end if;
    if v_row.account_id is distinct from v_account[v_i] then
      raise exception using errcode = '23514', message = 'reservation moved to another account; refresh and review again';
    end if;
    if v_row.cycle_id is distinct from v_cycle.id then
      raise exception using errcode = '23514', message = 'payment date resolves to a different cycle; held for staff resolution without moving funds';
    end if;
    if p_received_date < (v_row.requested_at at time zone 'Africa/Kampala')::date then
      raise exception using errcode = '23514', message = 'payment date predates the reservation date; held for staff resolution';
    end if;
    if v_amount[v_i] is distinct from v_row.principal_ugx then
      raise exception using errcode = '23514', message = 'reservation allocation must exactly match its reserved principal';
    end if;
    if v_row.is_test is distinct from coalesce(v_profile.is_test, false) then
      raise exception using errcode = '23514', message = 'test and live records cannot share a deposit';
    end if;
  end loop;

  if v_has_placement then
    if v_profile.access_status <> 'active' or v_profile.kyc_status <> 'verified' then
      raise exception using errcode = '42501', message = 'partner is not eligible for a new placement';
    end if;
    if not exists (select 1 from public.next_of_kin where user_id = p_investor_id) then
      raise exception using errcode = '23514', message = 'next of kin is required';
    end if;
    if p_agreement_accepted_offline is distinct from true then
      raise exception using errcode = '22023', message = 'confirm the partner accepted the cycle agreement offline';
    end if;
    select * into v_agreement from public.agreement_versions where id = v_cycle.agreement_version_id;
    if not found or not v_agreement.is_legally_approved or v_agreement.published_at is null then
      raise exception using errcode = '23514', message = 'approved agreement is required';
    end if;
    if lower(v_agreement.content_hash) is distinct from lower(p_expected_agreement_hash) then
      raise exception using errcode = '23514', message = 'the agreement changed; review the refreshed terms';
    end if;
    perform 1 from public.investment_accounts
      where id in (select a from unnest(v_account, v_kind) as t(a, k) where k = 'offline_placement')
      order by id for update;
    for v_i in 1..v_count loop
      continue when v_kind[v_i] <> 'offline_placement';
      if not exists (select 1 from public.investment_accounts
        where id = v_account[v_i] and investor_id = p_investor_id and archived_at is null) then
        raise exception using errcode = '42501', message = 'investment account unavailable';
      end if;
      if v_amount[v_i] < 125000 then
        raise exception using errcode = '23514', message = 'placement amount must be at least UGX 125,000';
      end if;
    end loop;
  end if;

  if (select sum(m) from unnest(v_amount) m) is distinct from p_received_amount_ugx then
    raise exception using errcode = '23514', message = 'allocations must add up exactly to the received amount';
  end if;
  -- Funded reservations are already counted; only new placements add principal.
  select coalesce(sum(m), 0) into v_placement_total from unnest(v_amount, v_kind) as t(m, k) where k = 'offline_placement';
  select coalesce(sum(principal_ugx), 0)::numeric(28,8) into v_used from public.investments
    where cycle_id = v_cycle.id and status in ('reserved', 'active') and not is_test;
  if not coalesce(v_profile.is_test, false) and v_used + v_placement_total > v_cycle.capacity_ugx then
    raise exception using errcode = '23514', message = 'cycle capacity exceeded; held for staff resolution';
  end if;
  select coalesce(sum(principal_ugx), 0)::numeric(28,8) into v_partner_used from public.investments
    where cycle_id = v_cycle.id and investor_id = p_investor_id and status in ('reserved', 'active');
  if v_partner_used + v_placement_total > coalesce(v_profile.investment_limit_ugx, 50000000) then
    raise exception using errcode = '23514', message = 'investor cycle limit exceeded; held for staff resolution';
  end if;

  insert into public.bank_deposits (id, investor_id, cycle_id, bank_reference, received_amount_ugx, received_date,
    received_at, authorized_on, authorization_method, evidence_reference, verification_notes, identity_verified,
    split_verified, agreement_accepted_offline, placement_agreement_version_id, placement_agreement_hash,
    allocation_count, is_test, posted_by, request_id, request_fingerprint)
  values (v_deposit_id, p_investor_id, v_cycle.id, v_reference, p_received_amount_ugx, p_received_date,
    p_received_at, p_authorized_on, p_authorization_method, trim(p_evidence_reference), trim(p_verification_notes),
    true, true, v_has_placement, case when v_has_placement then v_agreement.id end,
    case when v_has_placement then v_agreement.content_hash end, v_count, coalesce(v_profile.is_test, false),
    p_admin_id, p_request_id, v_fingerprint);

  for v_i in 1..v_count loop
    if v_kind[v_i] = 'offline_placement' then
      v_investment_id := gen_random_uuid();
      v_return := round((v_amount[v_i] * v_cycle.projected_return_bps::numeric) / 10000::numeric, 8);
      insert into public.investments (account_id, id, investor_id, cycle_id, unit_price_ugx, principal_ugx,
        projected_return_bps, projected_return_ugx, projected_value_ugx, maturity_date, reservation_expires_at,
        status, requested_at, activated_at, record_origin, is_test, policy_version)
      values (v_account[v_i], v_investment_id, p_investor_id, v_cycle.id, v_cycle.unit_price_ugx, v_amount[v_i],
        v_cycle.projected_return_bps, v_return, v_amount[v_i] + v_return, v_cycle.maturity_date, null,
        'active', now(), now(), 'portal', coalesce(v_profile.is_test, false), 'auto_cycle_v1');
    else
      v_investment_id := v_investment[v_i];
    end if;
    insert into public.bank_receipts (investment_id, bank_reference, received_amount_ugx, received_date, received_at,
      recorded_by, activated_at, deposit_id, deposit_line, allocation_kind)
    values (v_investment_id, v_reference, v_amount[v_i], p_received_date, p_received_at,
      p_admin_id, now(), v_deposit_id, v_i, v_kind[v_i])
    returning id into v_bank_receipt_id;
    if v_kind[v_i] = 'reservation' then
      update public.investments set status = 'active', activated_at = now() where id = v_investment_id;
      update public.investment_agreements set pdf_status = 'generating' where investment_id = v_investment_id;
    end if;
    v_receipt_number := private.allocate_receipt_number(coalesce(v_profile.is_test, false));
    insert into public.investment_receipts (investment_id, investor_id, source, bank_receipt_id, receipt_number,
      is_test, partner_name, partner_phone, company_name, company_address, amount_ugx, transaction_date,
      account_description, bank_deposit_id, payment_reference, deposit_amount_ugx, deposit_allocation_count)
    values (v_investment_id, p_investor_id, 'bank_activation', v_bank_receipt_id, v_receipt_number,
      coalesce(v_profile.is_test, false), v_profile.legal_name, v_profile.phone,
      'OurMu Ventures Limited', 'Katabbi Town Council, Entebbe, Wakiso', v_amount[v_i], p_received_date,
      'Accounts payable — ' || v_profile.legal_name, v_deposit_id, v_reference, p_received_amount_ugx, v_count)
    returning id into v_receipt_id;
    insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
    values (p_admin_id, 'investment.activated', 'investment', v_investment_id, p_request_id,
      jsonb_build_object('received_amount_ugx', v_amount[v_i], 'received_date', p_received_date,
        'received_at', p_received_at, 'assignment_basis', 'payment_date', 'payment_date_timezone', 'Africa/Kampala',
        'payment_precision', 'date', 'posted_at', now(), 'cycle_id', v_cycle.id, 'policy_version', 'auto_cycle_v1', 'receipt_id', v_receipt_id,
        'bank_receipt_id', v_bank_receipt_id, 'receipt_number', v_receipt_number, 'bank_deposit_id', v_deposit_id,
        'allocation_kind', v_kind[v_i], 'account_id', v_account[v_i], 'deposit_amount_ugx', p_received_amount_ugx));
    if v_kind[v_i] = 'reservation' then
      insert into public.jobs (kind, entity_type, entity_id, payload)
      values ('generate_agreement_pdf', 'investment', v_investment_id, '{}'::jsonb);
    end if;
    insert into public.jobs (kind, entity_type, entity_id, payload)
    values ('generate_receipt_pdf', 'investment_receipt', v_receipt_id,
      jsonb_build_object('investment_id', v_investment_id, 'receipt_number', v_receipt_number));
    v_investment_ids := v_investment_ids || v_investment_id;
  end loop;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_admin_id, 'bank_deposit.allocated', 'bank_deposit', v_deposit_id, p_request_id,
    jsonb_build_object('investor_id', p_investor_id, 'cycle_id', v_cycle.id, 'bank_reference', v_reference,
      'received_amount_ugx', p_received_amount_ugx, 'received_at', p_received_at, 'received_date', p_received_date,
      'posted_at', now(), 'authorization_method', p_authorization_method, 'authorized_on', p_authorized_on,
      'evidence_reference', trim(p_evidence_reference), 'identity_verified', true, 'split_verified', true,
      'agreement_accepted_offline', v_has_placement,
      'placement_agreement_version_id', case when v_has_placement then v_agreement.id end,
      'placement_agreement_hash', case when v_has_placement then v_agreement.content_hash end,
      'allocations', (select jsonb_agg(jsonb_build_object('line', n, 'kind', k, 'investment_id', i,
        'account_id', a, 'amount_ugx', m) order by n)
        from unnest(v_kind, v_investment_ids, v_account, v_amount) with ordinality as t(k, i, a, m, n))));
  return jsonb_build_object('deposit_id', v_deposit_id, 'replayed', false, 'investment_ids', to_jsonb(v_investment_ids));
end;
$$;

revoke all on function public.allocate_bank_deposit(uuid,boolean,uuid,uuid,uuid,text,numeric,date,date,text,text,text,jsonb,boolean,boolean,text,boolean,text,timestamptz) from public, anon, authenticated;
grant execute on function public.allocate_bank_deposit(uuid,boolean,uuid,uuid,uuid,text,numeric,date,date,text,text,text,jsonb,boolean,boolean,text,boolean,text,timestamptz) to service_role;
revoke all on function private.guard_bank_reference(), private.check_bank_deposit_balance(), private.guard_receipt_deposit_snapshot(), private.guard_offline_placement_agreement() from public, anon, authenticated;
grant execute on function private.guard_bank_reference(), private.check_bank_deposit_balance(), private.guard_receipt_deposit_snapshot(), private.guard_offline_placement_agreement() to service_role;

notify pgrst, 'reload schema';
commit;
