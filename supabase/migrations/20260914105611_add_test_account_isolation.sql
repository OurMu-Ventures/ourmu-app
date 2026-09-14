begin;

alter table public.profiles
  add column is_test boolean not null default false;

alter table public.investments
  add column is_test boolean not null default false;

create index investments_real_operational_idx
  on public.investments (cycle_id, status)
  where not is_test and status in ('reserved', 'active');

create or replace function private.set_investment_test_flag()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.investor_id is null then
    new.is_test := false;
  else
    select p.is_test into new.is_test
    from public.profiles p
    where p.id = new.investor_id;
    if not found then
      -- Leave referential and record-shape validation to the existing
      -- constraints so this trigger does not change their error semantics.
      new.is_test := false;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.set_investment_test_flag() from public, anon, authenticated;

create trigger investment_test_flag_guard
before insert or update of investor_id, is_test on public.investments
for each row execute function private.set_investment_test_flag();

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
  if p_principal_ugx < 125000 or p_principal_ugx > 62500000 or p_principal_ugx <> round(p_principal_ugx, 2) then
    raise exception using errcode = '22023', message = 'amount must be UGX 125,000–62,500,000 with at most two decimals';
  end if;
  select * into v_profile from public.profiles where id = p_investor_id for update;
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
  if v_investor_principal + p_principal_ugx > 62500000 then
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

revoke execute on function public.request_investment(uuid, uuid, numeric, uuid, text, bytea)
  from public, anon, authenticated;
grant execute on function public.request_investment(uuid, uuid, numeric, uuid, text, bytea)
  to service_role;

commit;
