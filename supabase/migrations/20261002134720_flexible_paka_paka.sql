begin;

alter table public.maturity_instructions
  add column requested_withdrawal_ugx numeric(28,8),
  add constraint maturity_custom_withdrawal check (
    requested_withdrawal_ugx is null or (
      choice = 'withdraw_roi_reinvest_principal'
      and requested_withdrawal_ugx::text not in ('NaN', 'Infinity', '-Infinity')
      and requested_withdrawal_ugx > 0
      and requested_withdrawal_ugx = round(requested_withdrawal_ugx, 2)
      and requested_withdrawal_ugx = projected_payout_ugx
      and projected_reinvest_ugx between 125000 and 50000000
      and projected_reinvest_ugx = round(projected_reinvest_ugx, 2)
    )
  );
comment on column public.maturity_instructions.requested_withdrawal_ugx is
  'Partner-selected projected withdrawal. NULL on historical Paka Paka instructions retains ROI-only terms; actual custom amounts preserve the saved projected proportion.';

-- Transform the installed functions so intervening authorization, imported
-- investment eligibility, receipt, and payout-date fixes are retained.
-- One signature, with optional arguments, avoids ambiguous PostgREST overloads.
-- Older app versions omit both new args and retain their ROI-only contract.
-- The updated app sets p_custom_split=true, requiring a withdrawal for Paka Paka.
do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef('public.submit_maturity_instruction(uuid,uuid,public.maturity_choice,uuid,uuid,boolean,boolean,uuid,text,bytea)'::regprocedure)
    into v_definition;
  v_updated := replace(v_definition, 'p_ip_fingerprint bytea)',
    'p_ip_fingerprint bytea, p_requested_withdrawal_ugx numeric DEFAULT NULL::numeric, p_custom_split boolean DEFAULT false)');
  if v_updated = v_definition then raise exception 'Submission signature not found'; end if;
  v_definition := v_updated;
  v_updated := replace(v_definition,
    E'    v_payout := v_investment.projected_return_ugx;\n    v_reinvest := v_investment.principal_ugx;',
    $custom$
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
      if v_reinvest < 125000 or v_reinvest > 50000000 or v_reinvest <> round(v_reinvest, 2) then
        raise exception using errcode = '22023', message = 'reinvestment must be between UGX 125,000 and UGX 50,000,000 with up to two decimal places';
      end if;
    else
      v_payout := v_investment.projected_return_ugx;
      v_reinvest := v_investment.principal_ugx;
    end if;
    $custom$);
  if v_updated = v_definition then raise exception 'Submission split not found'; end if;
  v_updated := replace(v_updated, '      choice = p_choice,',
    E'      choice = p_choice,\n      requested_withdrawal_ugx = case when p_choice = ''withdraw_roi_reinvest_principal'' then p_requested_withdrawal_ugx else null end,');
  v_updated := replace(v_updated,
    'investment_id, investor_id, choice, projected_payout_ugx, projected_reinvest_ugx,',
    'investment_id, investor_id, choice, requested_withdrawal_ugx, projected_payout_ugx, projected_reinvest_ugx,');
  v_updated := replace(v_updated, 'p_investment_id, p_investor_id, p_choice, v_payout, v_reinvest,',
    'p_investment_id, p_investor_id, p_choice, case when p_choice = ''withdraw_roi_reinvest_principal'' then p_requested_withdrawal_ugx else null end, v_payout, v_reinvest,');
  v_updated := replace(v_updated, 'if found then return v_existing.id; end if;',
    $ownership$if found then
    if v_existing.investor_id is distinct from p_investor_id or v_existing.investment_id is distinct from p_investment_id then
      raise exception using errcode = '42501', message = 'request belongs to another investment or partner';
    end if;
    return v_existing.id;
  end if;$ownership$);
  v_updated := replace(v_updated, 'jsonb_build_object(''choice'', p_choice',
    'jsonb_build_object(''requested_withdrawal_ugx'', case when p_choice = ''withdraw_roi_reinvest_principal'' then p_requested_withdrawal_ugx else null end, ''choice'', p_choice');
  drop function public.submit_maturity_instruction(uuid,uuid,public.maturity_choice,uuid,uuid,boolean,boolean,uuid,text,bytea);
  execute v_updated;

  select pg_get_functiondef('public.fulfill_maturity_instruction(uuid,uuid,numeric,text,text,boolean,uuid,boolean)'::regprocedure)
    into v_definition;
  v_updated := replace(v_definition,
    E'    v_actual_payout := p_actual_roi_ugx;\n    v_actual_reinvest := v_investment.principal_ugx;',
    $actual$
    if v_instruction.requested_withdrawal_ugx is null then
      v_actual_payout := p_actual_roi_ugx;
      v_actual_reinvest := v_investment.principal_ugx;
    else
      v_actual_payout := round((v_investment.principal_ugx + p_actual_roi_ugx)
        * v_instruction.requested_withdrawal_ugx
        / (v_instruction.projected_payout_ugx + v_instruction.projected_reinvest_ugx), 2);
      v_actual_reinvest := v_investment.principal_ugx + p_actual_roi_ugx - v_actual_payout;
      -- An invalid revised split is held before asking for confirmation.
      if v_actual_payout <= 0 or v_actual_reinvest < 125000 or v_actual_reinvest > 50000000
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
    $actual$);
  if v_updated = v_definition then raise exception 'Actual split not found'; end if;
  v_updated := replace(v_updated, 'p_actual_roi_ugx is null or p_actual_roi_ugx < 0',
    'p_actual_roi_ugx is null or p_actual_roi_ugx::text in (''NaN'', ''Infinity'', ''-Infinity'') or p_actual_roi_ugx < 0');
  execute v_updated;

end;
$migration$;

revoke all on function public.submit_maturity_instruction(uuid,uuid,public.maturity_choice,uuid,uuid,boolean,boolean,uuid,text,bytea,numeric,boolean) from public, anon, authenticated;
grant execute on function public.submit_maturity_instruction(uuid,uuid,public.maturity_choice,uuid,uuid,boolean,boolean,uuid,text,bytea,numeric,boolean) to service_role;

notify pgrst, 'reload schema';
commit;
