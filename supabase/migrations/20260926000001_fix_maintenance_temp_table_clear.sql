-- Keep maintenance compatible with production pg-safeupdate, which rejects
-- DELETE without WHERE. Only this per-transaction temporary table is cleared.

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
    where m.record_origin = 'portal' and m.investor_id is not null
    returning id
  ) select count(*) into v_maturity_emails from queued;

  select enabled into v_gate_enabled from public.maturity_policy_gates
  where name = 'current_agreement_auto_reinvest';
  select * into v_open_cycle from public.investment_cycles
  where status = 'open' and record_origin = 'portal' limit 1;

  for r in
    select i.id, i.investor_id, i.principal_ugx, i.projected_return_ugx
    from public.investments i
    where i.status = 'matured'
      and i.record_origin = 'portal'
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
        destination_confirmed, standing_authorization_id, request_id
      ) values (
        r.id, r.investor_id, 'reinvest_all', 0,
        r.principal_ugx + r.projected_return_ugx,
        v_open_cycle.id, v_open_cycle.agreement_version_id, true, false,
        v_auth_id, gen_random_uuid()
      );
      insert into public.audit_events (action, entity_type, entity_id, request_id, metadata)
      values ('maturity.auto_instruction_created', 'investment', r.id, p_request_id,
        jsonb_build_object('choice', 'reinvest_all', 'target_cycle_id', v_open_cycle.id));
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
