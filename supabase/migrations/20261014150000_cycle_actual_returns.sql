-- Cycle-wide actual returns.
--
-- An administrator records one actual return percentage (in basis points) per
-- cycle. Every included investment derives its actual profit from its own
-- principal at the database's eight-decimal monetary scale; cycle totals are
-- sums of those individual amounts. Projected fields are never changed.
--
-- Timing uses Africa/Kampala calendar dates: the rate can be revised until
-- the maturity date begins in Kampala, then locks. A cycle that reaches
-- maturity without a rate may receive exactly one late first entry, provided
-- no investment in it has been settled. Settlement (fulfillment and automatic
-- reinvestment instructions) is blocked until the rate exists.
--
-- Cycles whose settlement already started under the per-investment ROI
-- workflow are flagged legacy_settlement and keep that workflow.
begin;

alter table public.investment_cycles
  add column actual_return_bps integer,
  add column actual_return_recorded_at timestamptz,
  add column actual_return_recorded_by uuid references public.profiles(id) on delete restrict,
  add column actual_return_revision integer not null default 0,
  add column actual_return_late_entry boolean not null default false,
  add column legacy_settlement boolean not null default false,
  add constraint cycle_actual_return_range check (
    actual_return_bps is null or actual_return_bps between 0 and 100000
  ),
  add constraint cycle_actual_return_metadata check (
    (actual_return_bps is null and actual_return_recorded_at is null
      and actual_return_recorded_by is null and not actual_return_late_entry)
    or (actual_return_bps is not null and actual_return_recorded_at is not null
      and actual_return_recorded_by is not null)
  ),
  add constraint cycle_actual_return_revision_nonnegative check (actual_return_revision >= 0),
  add constraint cycle_legacy_settlement_has_no_rate check (
    not legacy_settlement or actual_return_bps is null
  );

comment on column public.investment_cycles.actual_return_bps is
  'Actual cycle return in basis points (0.01%). NULL until recorded. Authoritative for settlement; projected_return_bps is preserved for comparison.';
comment on column public.investment_cycles.actual_return_revision is
  'Incremented on every recorded change. Clients pass the revision they saw so stale forms are rejected.';
comment on column public.investment_cycles.actual_return_late_entry is
  'True when the first actual return was recorded on or after the Kampala maturity date.';
comment on column public.investment_cycles.legacy_settlement is
  'Settlement had already started under the per-investment ROI workflow before cycle-wide returns existed. These cycles keep that workflow and cannot record a cycle-wide rate.';

-- Flag cycles that were already partly settled (an instruction fulfilled, or
-- an actual ROI already proposed to a partner) so their settlement continues
-- unchanged instead of being blocked.
update public.investment_cycles c set legacy_settlement = true
where exists (
  select 1 from public.maturity_instructions mi
  join public.investments i on i.id = mi.investment_id
  where i.cycle_id = c.id
    and (mi.status = 'fulfilled' or mi.proposed_actual_roi_ugx is not null)
);

alter table public.maturity_instructions
  add column amount_basis text not null default 'projected',
  add column basis_actual_return_bps integer,
  add constraint maturity_instruction_amount_basis check (
    (amount_basis = 'projected' and basis_actual_return_bps is null)
    or (amount_basis = 'actual' and basis_actual_return_bps between 0 and 100000)
  );
comment on column public.maturity_instructions.amount_basis is
  'Basis of projected_payout_ugx/projected_reinvest_ugx when the partner accepted them: projected (cycle rate not yet recorded) or actual (the recorded cycle rate in basis_actual_return_bps).';
comment on column public.maturity_instructions.projected_payout_ugx is
  'Payout accepted by the partner, on the basis named by amount_basis.';
comment on column public.maturity_instructions.projected_reinvest_ugx is
  'Reinvestment accepted by the partner, on the basis named by amount_basis.';

-- Helpers ------------------------------------------------------------------

create function private.kampala_date(p_at timestamptz default now())
returns date language sql stable set search_path = '' as $$
  select (p_at at time zone 'Africa/Kampala')::date;
$$;

-- Same arithmetic and scale as investments.projected_return_ugx.
create function private.cycle_actual_return_ugx(p_principal_ugx numeric, p_actual_return_bps integer)
returns numeric(28,8) language sql immutable set search_path = '' as $$
  select round(p_principal_ugx * p_actual_return_bps::numeric / 10000::numeric, 8)::numeric(28,8);
$$;

-- Revisions close when the maturity date begins in Kampala.
create function private.cycle_actual_return_locked(p_maturity_date date, p_at timestamptz default now())
returns boolean language sql stable set search_path = '' as $$
  select private.kampala_date(p_at) >= p_maturity_date;
$$;

create function private.cycle_settlement_started(p_cycle_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.maturity_instructions mi
    join public.investments i on i.id = mi.investment_id
    where i.cycle_id = p_cycle_id and mi.status = 'fulfilled'
  );
$$;

-- Included: funded (active) and unpaid matured investments, imported ones
-- too. Excluded: reservations, expired/cancelled, reported-paid history and
-- already-fulfilled maturities. Test placements are counted separately and
-- kept out of financial totals.
create function private.cycle_return_totals(p_cycle_id uuid, p_actual_return_bps integer)
returns table (
  investment_count bigint,
  test_investment_count bigint,
  principal_ugx numeric(28,8),
  projected_profit_ugx numeric(28,8),
  actual_profit_ugx numeric(28,8),
  total_value_ugx numeric(28,8)
) language sql stable set search_path = '' as $$
  with included as (
    select i.principal_ugx, i.projected_return_ugx, i.is_test,
      case when p_actual_return_bps is null then null
        else private.cycle_actual_return_ugx(i.principal_ugx, p_actual_return_bps) end as actual_ugx
    from public.investments i
    where i.cycle_id = p_cycle_id
      and i.status in ('active', 'matured')
      and i.payout_basis <> 'reported_paid'
      and not exists (
        select 1 from public.maturity_instructions mi
        where mi.investment_id = i.id and mi.status = 'fulfilled'
      )
  )
  select
    count(*) filter (where not is_test),
    count(*) filter (where is_test),
    coalesce(sum(principal_ugx) filter (where not is_test), 0)::numeric(28,8),
    coalesce(sum(projected_return_ugx) filter (where not is_test), 0)::numeric(28,8),
    case when p_actual_return_bps is null then null
      else coalesce(sum(actual_ugx) filter (where not is_test), 0) end::numeric(28,8),
    case when p_actual_return_bps is null then null
      else coalesce(sum(principal_ugx + actual_ugx) filter (where not is_test), 0) end::numeric(28,8)
  from included;
$$;

create function private.cycle_actual_return_state(
  p_cycle public.investment_cycles, p_actual_return_bps integer, p_at timestamptz default now()
) returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_totals record;
  v_locked boolean := private.cycle_actual_return_locked(p_cycle.maturity_date, p_at);
  v_settled boolean := private.cycle_settlement_started(p_cycle.id);
  v_can_record boolean;
  v_block text;
begin
  select * into v_totals from private.cycle_return_totals(p_cycle.id, p_actual_return_bps);
  v_block := case
    when p_cycle.status = 'draft' then 'draft'
    when p_cycle.legacy_settlement then 'legacy_settlement'
    when v_settled then 'settled'
    when v_locked and p_cycle.actual_return_bps is not null then 'locked'
    else null end;
  v_can_record := v_block is null;
  return jsonb_build_object(
    'cycle_id', p_cycle.id,
    'maturity_date', p_cycle.maturity_date,
    'kampala_today', private.kampala_date(p_at),
    'projected_return_bps', p_cycle.projected_return_bps,
    'actual_return_bps', p_cycle.actual_return_bps,
    'actual_return_revision', p_cycle.actual_return_revision,
    'actual_return_recorded_at', p_cycle.actual_return_recorded_at,
    'actual_return_recorded_by', p_cycle.actual_return_recorded_by,
    'actual_return_late_entry', p_cycle.actual_return_late_entry,
    'legacy_settlement', p_cycle.legacy_settlement,
    'settlement_started', v_settled,
    'locked', v_locked,
    'late_entry', v_locked and p_cycle.actual_return_bps is null,
    'can_record', v_can_record,
    'blocked_reason', v_block,
    -- Only cycles with something left to settle need attention: paid-history
    -- and fully settled cycles never nag.
    'required', p_cycle.actual_return_bps is null and not p_cycle.legacy_settlement
      and p_cycle.status <> 'draft' and not v_settled
      and v_totals.investment_count + v_totals.test_investment_count > 0
      and private.kampala_date(p_at) >= p_cycle.maturity_date - 1,
    'preview_bps', p_actual_return_bps,
    'investment_count', v_totals.investment_count,
    'test_investment_count', v_totals.test_investment_count,
    'principal_ugx', v_totals.principal_ugx,
    'projected_profit_ugx', v_totals.projected_profit_ugx,
    'actual_profit_ugx', v_totals.actual_profit_ugx,
    'total_value_ugx', v_totals.total_value_ugx,
    'difference_from_projection_ugx', v_totals.actual_profit_ugx - v_totals.projected_profit_ugx
  );
end;
$$;

-- Only record_cycle_actual_return may change the recorded rate.
create function private.guard_cycle_actual_return()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- The transaction-local setting is only set by record_cycle_actual_return
  -- (and by trusted maintenance SQL); API roles cannot run arbitrary SQL.
  if current_setting('ourmu.recording_cycle_actual_return', true) is not distinct from 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.actual_return_bps is not null or new.actual_return_revision <> 0
      or new.actual_return_late_entry or new.legacy_settlement then
      raise exception using errcode = '55000',
        message = 'actual returns are recorded only through record_cycle_actual_return';
    end if;
    return new;
  end if;
  if new.legacy_settlement is distinct from old.legacy_settlement then
    raise exception using errcode = '55000', message = 'legacy settlement flags are immutable';
  end if;
  if row(new.actual_return_bps, new.actual_return_recorded_at, new.actual_return_recorded_by,
      new.actual_return_revision, new.actual_return_late_entry)
    is distinct from row(old.actual_return_bps, old.actual_return_recorded_at,
      old.actual_return_recorded_by, old.actual_return_revision, old.actual_return_late_entry) then
    raise exception using errcode = '55000',
      message = 'actual returns are recorded only through record_cycle_actual_return';
  end if;
  return new;
end;
$$;
create trigger cycle_actual_return_guard
before insert or update on public.investment_cycles
for each row execute function private.guard_cycle_actual_return();

-- Admin RPCs ---------------------------------------------------------------

create function public.preview_cycle_actual_return(
  p_admin_id uuid, p_admin_aal2 boolean, p_cycle_id uuid, p_actual_return_bps integer default null
) returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_cycle public.investment_cycles%rowtype;
begin
  if private.is_admin(p_admin_id) is distinct from true or p_admin_aal2 is distinct from true then
    raise exception using errcode = '42501', message = 'Active administrator two-factor authentication required';
  end if;
  if p_actual_return_bps is not null and p_actual_return_bps not between 0 and 100000 then
    raise exception using errcode = '22023', message = 'the actual return must be between 0% and 1,000% with up to two decimal places';
  end if;
  select * into v_cycle from public.investment_cycles where id = p_cycle_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'cycle not found';
  end if;
  return private.cycle_actual_return_state(v_cycle, coalesce(p_actual_return_bps, v_cycle.actual_return_bps));
end;
$$;

create function public.record_cycle_actual_return(
  p_admin_id uuid,
  p_admin_aal2 boolean,
  p_cycle_id uuid,
  p_actual_return_bps integer,
  p_expected_revision integer,
  p_expected_investment_count bigint,
  p_expected_principal_ugx numeric,
  p_confirmed boolean,
  p_request_id uuid
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_cycle public.investment_cycles%rowtype;
  v_prior jsonb;
  v_state jsonb;
  v_previous_bps integer;
  v_late boolean;
begin
  if private.is_admin(p_admin_id) is distinct from true or p_admin_aal2 is distinct from true then
    raise exception using errcode = '42501', message = 'Active administrator two-factor authentication required';
  end if;
  if p_actual_return_bps is null or p_actual_return_bps not between 0 and 100000 then
    raise exception using errcode = '22023', message = 'the actual return must be between 0% and 1,000% with up to two decimal places';
  end if;
  if p_confirmed is distinct from true then
    raise exception using errcode = '22023', message = 'confirm the actual return and its affected totals before saving';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'a request id is required';
  end if;

  -- Serializes with fulfillment and maturity submissions, which take a share
  -- lock on the source cycle before reading its rate.
  select * into v_cycle from public.investment_cycles where id = p_cycle_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'cycle not found';
  end if;

  -- A retried request returns its original outcome instead of applying twice.
  select a.metadata into v_prior from public.audit_events a
  where a.request_id = p_request_id and a.action = 'cycle.actual_return_recorded'
    and a.entity_id = p_cycle_id;
  if found then
    return v_prior || jsonb_build_object('replayed', true);
  end if;

  if v_cycle.status = 'draft' then
    raise exception using errcode = '23514', message = 'the actual return can only be recorded for a funded cycle';
  end if;
  if v_cycle.legacy_settlement or private.cycle_settlement_started(v_cycle.id) then
    raise exception using errcode = '23514',
      message = 'settlement has started for this cycle, so its actual return cannot be recorded here; it keeps the per-investment workflow';
  end if;
  v_late := private.cycle_actual_return_locked(v_cycle.maturity_date);
  if v_late and v_cycle.actual_return_bps is not null then
    raise exception using errcode = '23514', message = 'the actual return is locked at maturity and can no longer be revised';
  end if;
  if p_expected_revision is distinct from v_cycle.actual_return_revision then
    raise exception using errcode = '40001',
      message = 'the actual return changed since you loaded this page; review the refreshed figures and confirm again';
  end if;

  v_state := private.cycle_actual_return_state(v_cycle, p_actual_return_bps);
  if p_expected_investment_count is distinct from (v_state->>'investment_count')::bigint
    or p_expected_principal_ugx is distinct from (v_state->>'principal_ugx')::numeric then
    raise exception using errcode = '40001',
      message = 'the affected investments changed since the preview; review the refreshed figures and confirm again';
  end if;

  v_previous_bps := v_cycle.actual_return_bps;
  if v_previous_bps is not distinct from p_actual_return_bps then
    return v_state || jsonb_build_object('unchanged', true);
  end if;

  perform set_config('ourmu.recording_cycle_actual_return', 'on', true);
  update public.investment_cycles set
    actual_return_bps = p_actual_return_bps,
    actual_return_recorded_at = now(),
    actual_return_recorded_by = p_admin_id,
    actual_return_revision = actual_return_revision + 1,
    actual_return_late_entry = v_late
  where id = p_cycle_id
  returning * into v_cycle;
  perform set_config('ourmu.recording_cycle_actual_return', 'off', true);

  v_state := private.cycle_actual_return_state(v_cycle, v_cycle.actual_return_bps)
    || jsonb_build_object('previous_actual_return_bps', v_previous_bps, 'late_entry', v_late);
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_admin_id, 'cycle.actual_return_recorded', 'investment_cycle', p_cycle_id, p_request_id,
    jsonb_build_object(
      'previous_actual_return_bps', v_previous_bps,
      'actual_return_bps', v_cycle.actual_return_bps,
      'projected_return_bps', v_cycle.projected_return_bps,
      'actual_return_revision', v_cycle.actual_return_revision,
      'late_entry', v_late,
      'investment_count', v_state->'investment_count',
      'test_investment_count', v_state->'test_investment_count',
      'principal_ugx', v_state->'principal_ugx',
      'projected_profit_ugx', v_state->'projected_profit_ugx',
      'actual_profit_ugx', v_state->'actual_profit_ugx',
      'total_value_ugx', v_state->'total_value_ugx',
      'difference_from_projection_ugx', v_state->'difference_from_projection_ugx',
      'recorded_at', v_cycle.actual_return_recorded_at));
  return v_state;
end;
$$;

revoke all on function public.preview_cycle_actual_return(uuid,boolean,uuid,integer) from public, anon, authenticated;
grant execute on function public.preview_cycle_actual_return(uuid,boolean,uuid,integer) to service_role;
revoke all on function public.record_cycle_actual_return(uuid,boolean,uuid,integer,integer,bigint,numeric,boolean,uuid) from public, anon, authenticated;
grant execute on function public.record_cycle_actual_return(uuid,boolean,uuid,integer,integer,bigint,numeric,boolean,uuid) to service_role;
revoke all on function private.kampala_date(timestamptz) from public, anon, authenticated;
revoke all on function private.cycle_actual_return_ugx(numeric,integer) from public, anon, authenticated;
revoke all on function private.cycle_actual_return_locked(date,timestamptz) from public, anon, authenticated;
revoke all on function private.cycle_settlement_started(uuid) from public, anon, authenticated;
revoke all on function private.cycle_return_totals(uuid,integer) from public, anon, authenticated;
revoke all on function private.cycle_actual_return_state(public.investment_cycles,integer,timestamptz) from public, anon, authenticated;
grant execute on function private.kampala_date(timestamptz) to service_role;
grant execute on function private.cycle_actual_return_ugx(numeric,integer) to service_role;
grant execute on function private.cycle_actual_return_locked(date,timestamptz) to service_role;
grant execute on function private.cycle_settlement_started(uuid) to service_role;
grant execute on function private.cycle_return_totals(uuid,integer) to service_role;
grant execute on function private.cycle_actual_return_state(public.investment_cycles,integer,timestamptz) to service_role;

-- Settlement ---------------------------------------------------------------




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
  if p_confirmation is distinct from 'FULFILL' then
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

CREATE OR REPLACE FUNCTION public.submit_maturity_instruction(p_investor_id uuid, p_investment_id uuid, p_choice maturity_choice, p_target_cycle_id uuid, p_payout_destination_id uuid, p_agreement_accepted boolean, p_destination_confirmed boolean, p_request_id uuid, p_user_agent text, p_ip_fingerprint bytea, p_requested_withdrawal_ugx numeric DEFAULT NULL::numeric, p_custom_split boolean DEFAULT false, p_expected_agreement_version_id uuid DEFAULT NULL::uuid)
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
  v_source_cycle public.investment_cycles%rowtype;
  v_return numeric(28,8);
  v_basis text;
  v_basis_bps integer;
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

  -- Quote the recorded cycle return when it exists; otherwise the
  -- projection, which fulfillment later re-confirms against the actual.
  select * into v_source_cycle from public.investment_cycles
  where id = v_investment.cycle_id for share;
  if v_source_cycle.actual_return_bps is not null then
    v_return := private.cycle_actual_return_ugx(v_investment.principal_ugx, v_source_cycle.actual_return_bps);
    v_basis := 'actual';
    v_basis_bps := v_source_cycle.actual_return_bps;
  else
    v_return := v_investment.projected_return_ugx;
    v_basis := 'projected';
    v_basis_bps := null;
  end if;

  if p_choice = 'withdraw_all' then
    v_payout := v_investment.principal_ugx + v_return;
    v_reinvest := 0;
  elsif p_choice = 'withdraw_roi_reinvest_principal' then

    if coalesce(p_custom_split, false) or p_requested_withdrawal_ugx is not null then
      if p_requested_withdrawal_ugx is null
        or p_requested_withdrawal_ugx::text in ('NaN', 'Infinity', '-Infinity')
        or p_requested_withdrawal_ugx <= 0
        or p_requested_withdrawal_ugx >= v_investment.principal_ugx + v_return
        or p_requested_withdrawal_ugx <> round(p_requested_withdrawal_ugx, 2) then
        raise exception using errcode = '22023', message = 'enter a positive withdrawal below the total with up to two decimal places';
      end if;
      v_payout := p_requested_withdrawal_ugx;
      v_reinvest := v_investment.principal_ugx + v_return - v_payout;
      if v_reinvest < 125000 or v_reinvest > coalesce(v_profile.investment_limit_ugx, 50000000) or v_reinvest <> round(v_reinvest, 2) then
        raise exception using errcode = '22023', message = 'reinvestment must be at least UGX 125,000 and within your partner limit with up to two decimal places';
      end if;
    else
      if v_return <= 0 then
        raise exception using errcode = '22023', message = 'there is no return to withdraw; choose another option';
      end if;
      v_payout := v_return;
      v_reinvest := v_investment.principal_ugx;
    end if;

  else
    v_payout := 0;
    v_reinvest := v_investment.principal_ugx + v_return;
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
      amount_basis = v_basis,
      basis_actual_return_bps = v_basis_bps,
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
      p_request_id, jsonb_build_object('requested_withdrawal_ugx', case when p_choice = 'withdraw_roi_reinvest_principal' then p_requested_withdrawal_ugx else null end, 'choice', p_choice, 'assignment_basis', 'submission_time', 'applicable_timestamp', now(), 'cycle_id', case when v_reinvest > 0 then v_resolved_id else null end, 'policy_version', 'auto_cycle_v1', 'amount_basis', v_basis, 'basis_actual_return_bps', v_basis_bps));
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
    acceptance_captured_at, request_id, policy_version, amount_basis, basis_actual_return_bps
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
    p_request_id, 'auto_cycle_v1', v_basis, v_basis_bps
  ) returning id into v_existing;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_investor_id, 'maturity_instruction.submitted', 'maturity_instruction', v_existing.id,
    p_request_id, jsonb_build_object('requested_withdrawal_ugx', case when p_choice = 'withdraw_roi_reinvest_principal' then p_requested_withdrawal_ugx else null end, 'choice', p_choice, 'investment_id', p_investment_id, 'assignment_basis', 'submission_time', 'applicable_timestamp', now(), 'cycle_id', case when v_reinvest > 0 then v_resolved_id else null end, 'policy_version', 'auto_cycle_v1', 'amount_basis', v_basis, 'basis_actual_return_bps', v_basis_bps));
  insert into public.jobs (kind, entity_type, entity_id, payload)
  values ('send_email', 'investment', p_investment_id,
    jsonb_build_object('template', 'maturity_choice_confirmed'));
  return v_existing.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.run_maintenance(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_expired integer;
  v_matured integer;
  v_anonymized integer;
  v_maturity_emails integer := 0;
  v_auto_reinvested integer := 0;
  v_pending_followup integer := 0;
  v_awaiting_actual_return integer := 0;
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
    select i.id, i.investor_id, i.principal_ugx, i.projected_return_ugx,
      c.actual_return_bps, c.legacy_settlement
    from public.investments i
    join public.investment_cycles c on c.id = i.cycle_id
    where i.status = 'matured' and i.payout_basis <> 'reported_paid'
      and i.investor_id is not null
      and public.maturity_payout_date(i.maturity_date) <= current_date
      and not exists (
        select 1 from public.maturity_instructions mi where mi.investment_id = i.id
      )
  loop
    v_auth_id := null;
    v_auth_at := null;
    -- Automatic reinvestment waits for the cycle's actual return. Cycles
    -- settled under the per-investment workflow keep projected amounts.
    if r.actual_return_bps is null and not r.legacy_settlement then
      v_awaiting_actual_return := v_awaiting_actual_return + 1;
    elsif v_gate_enabled and v_open_cycle.id is not null then
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
        destination_confirmed, standing_authorization_id, request_id, policy_version,
        amount_basis, basis_actual_return_bps
      ) values (
        r.id, r.investor_id, 'reinvest_all', 0,
        r.principal_ugx + case when r.actual_return_bps is null then r.projected_return_ugx
          else private.cycle_actual_return_ugx(r.principal_ugx, r.actual_return_bps) end,
        v_open_cycle.id, v_open_cycle.agreement_version_id, true, false,
        v_auth_id, gen_random_uuid(), 'auto_cycle_v1',
        case when r.actual_return_bps is null then 'projected' else 'actual' end,
        r.actual_return_bps
      );
      insert into public.audit_events (action, entity_type, entity_id, request_id, metadata)
      values ('maturity.auto_instruction_created', 'investment', r.id, p_request_id,
        jsonb_build_object('choice', 'reinvest_all', 'target_cycle_id', v_open_cycle.id,
          'assignment_basis', 'instruction_creation_time', 'applicable_timestamp', now(),
          'policy_version', 'auto_cycle_v1',
          'amount_basis', case when r.actual_return_bps is null then 'projected' else 'actual' end));
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
      'pending_followup', v_pending_followup, 'awaiting_actual_return', v_awaiting_actual_return));
  return jsonb_build_object('expired', v_expired, 'matured', v_matured, 'anonymized', v_anonymized,
    'maturity_emails', v_maturity_emails, 'auto_reinvested', v_auto_reinvested,
    'pending_followup', v_pending_followup, 'awaiting_actual_return', v_awaiting_actual_return);
end;
$function$;

notify pgrst, 'reload schema';
commit;
