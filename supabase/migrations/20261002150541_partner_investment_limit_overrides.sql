begin;

alter table public.profiles add column investment_limit_ugx numeric;
alter table public.profiles add constraint profiles_investment_limit_valid check (
  investment_limit_ugx is null or (
    investment_limit_ugx > 50000000
    and investment_limit_ugx < 'Infinity'::numeric
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
    p_limit_ugx <= 50000000 or p_limit_ugx >= 'Infinity'::numeric
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
do $migration$
declare
  v_constraint text;
begin
  select pg_get_constraintdef(oid) into strict v_constraint from pg_constraint
    where conrelid = 'public.investments'::regclass and conname = 'investment_origin_fields';
  if position('(principal_ugx <= (50000000)::numeric)' in v_constraint) = 0 then
    raise exception 'Expected fixed placement cap not found';
  end if;
  v_constraint := replace(v_constraint, '(principal_ugx <= (50000000)::numeric)', 'true');
  alter table public.investments drop constraint investment_origin_fields;
  execute 'alter table public.investments add constraint investment_origin_fields ' || v_constraint;
end;
$migration$;

create function private.guard_partner_investment_limit() returns trigger
language plpgsql security invoker set search_path = '' as $function$
declare
  v_limit numeric;
  v_used numeric;
begin
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
create trigger partner_investment_limit_guard before insert on public.investments
  for each row execute function private.guard_partner_investment_limit();

-- Patch the currently installed definitions, retaining receipt, paid-maturity,
-- authorization and test-account changes added by preceding migrations.
do $migration$
declare
  v_definition text;
  v_updated text;
  v_old_guard text := $guard$  if p_principal_ugx < 125000 or p_principal_ugx > 50000000 or p_principal_ugx <> round(p_principal_ugx, 2) then
    raise exception using errcode = '22023', message = 'amount must be UGX 125,000–50,000,000 with at most two decimals';
  end if;
$guard$;
  v_new_guard text := $guard$
  if p_principal_ugx is null or p_principal_ugx < 125000
    or p_principal_ugx > coalesce(v_profile.investment_limit_ugx, 50000000)
    or p_principal_ugx <> round(p_principal_ugx, 2) then
    raise exception using errcode = '22023', message = 'amount must be at least UGX 125,000 and within your partner limit with at most two decimals';
  end if;
$guard$;
begin
  v_definition := pg_get_functiondef('public.request_investment(uuid,uuid,numeric,uuid,text,bytea)'::regprocedure);
  if position(v_old_guard in v_definition) = 0
    or position('if v_investor_principal + p_principal_ugx > 50000000 then' in v_definition) = 0 then
    raise exception 'Expected reservation guards not found';
  end if;
  v_updated := replace(v_definition, v_old_guard, '');
  v_updated := replace(v_updated,
    'select * into v_profile from public.profiles where id = p_investor_id for update;',
    'select * into v_profile from public.profiles where id = p_investor_id for update;' || v_new_guard);
  v_updated := replace(v_updated, 'if v_investor_principal + p_principal_ugx > 50000000 then',
    'if v_investor_principal + p_principal_ugx > coalesce(v_profile.investment_limit_ugx, 50000000) then');
  execute v_updated;

  v_definition := pg_get_functiondef('public.fulfill_maturity_instruction(uuid,uuid,numeric,text,text,boolean,uuid,boolean)'::regprocedure);
  if position('select * into v_profile from public.profiles where id = v_instruction.investor_id;' in v_definition) = 0
    or position('v_actual_reinvest > 50000000' in v_definition) = 0
    or position('v_investor_principal + v_actual_reinvest > 50000000' in v_definition) = 0 then
    raise exception 'Expected reinvestment guards not found';
  end if;
  v_updated := replace(v_definition,
    'select * into v_profile from public.profiles where id = v_instruction.investor_id;',
    'select * into v_profile from public.profiles where id = v_instruction.investor_id for update;');
  v_updated := replace(v_updated, 'v_actual_reinvest > 50000000',
    'v_actual_reinvest > coalesce(v_profile.investment_limit_ugx, 50000000)');
  v_updated := replace(v_updated, 'v_investor_principal + v_actual_reinvest > 50000000',
    'v_investor_principal + v_actual_reinvest > coalesce(v_profile.investment_limit_ugx, 50000000)');
  execute v_updated;
end;
$migration$;

commit;
