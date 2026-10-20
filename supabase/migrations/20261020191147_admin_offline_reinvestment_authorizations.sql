begin;

-- Production already carries this exclusion field; keep clean installs aligned.
alter table public.investments add column if not exists administratively_archived_at timestamptz;

-- Offline authority is a distinct provenance record. No auth user, email,
-- browser IP, standing authorization, or online agreement acceptance is invented.
create table public.offline_reinvestment_authorizations (
  id uuid primary key default gen_random_uuid(),
  investment_id uuid not null references public.investments(id) on delete restrict,
  legacy_partner_id uuid not null references public.legacy_partner_identities(id) on delete restrict,
  target_cycle_id uuid not null references public.investment_cycles(id) on delete restrict,
  agreement_version_id uuid not null references public.agreement_versions(id) on delete restrict,
  target_maturity_date date not null,
  target_return_bps integer not null check (target_return_bps=3000),
  agreement_hash text not null check (agreement_hash ~ '^[a-fA-F0-9]{64}$'),
  principal_ugx numeric(28,8) not null check (principal_ugx > 0),
  actual_roi_ugx numeric(28,8) not null check (actual_roi_ugx >= 0),
  amount_ugx numeric(28,8) not null check (amount_ugx >= 125000 and amount_ugx = round(amount_ugx,2)),
  authorized_on date not null,
  method text not null check (method in ('signed_document','recorded_call','in_person')),
  evidence_reference text not null check (length(trim(evidence_reference)) between 5 and 500),
  verification_notes text not null check (length(trim(verification_notes)) between 10 and 2000),
  identity_verified boolean not null check (identity_verified),
  settlement_checked boolean not null check (settlement_checked),
  agreement_accepted_offline boolean not null check (agreement_accepted_offline),
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  request_id uuid not null unique,
  status text not null default 'recorded' check (status in ('recorded','fulfilled','revoked')),
  fulfilled_investment_id uuid unique references public.investments(id) on delete restrict,
  fulfilled_by uuid references public.profiles(id) on delete restrict,
  fulfilled_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete restrict,
  revoked_at timestamptz,
  revocation_reason text,
  constraint offline_full_amount check (amount_ugx = principal_ugx + actual_roi_ugx),
  constraint offline_completion_fields check (
    (status in ('recorded','revoked') and fulfilled_investment_id is null and fulfilled_by is null and fulfilled_at is null)
    or (status='fulfilled' and fulfilled_investment_id is not null and fulfilled_by is not null and fulfilled_at is not null)
  ),
  constraint offline_revocation_fields check (
    (status='revoked' and revoked_by is not null and revoked_at is not null and length(trim(revocation_reason)) between 10 and 2000)
    or (status<>'revoked' and revoked_by is null and revoked_at is null and revocation_reason is null)
  )
);
create unique index offline_unsettled_source on public.offline_reinvestment_authorizations(investment_id) where status<>'revoked';
alter table public.offline_reinvestment_authorizations enable row level security;
create policy offline_reinvestment_admin_read on public.offline_reinvestment_authorizations
  for select to authenticated using (private.is_admin());
revoke all on public.offline_reinvestment_authorizations from public,anon,authenticated;
grant select on public.offline_reinvestment_authorizations to authenticated;
grant select,insert,update on public.offline_reinvestment_authorizations to service_role;

alter table public.investments add column offline_authorization_id uuid unique
  references public.offline_reinvestment_authorizations(id) on delete restrict;
-- Non-sensitive settlement marker keeps later claimed portfolios from
-- offering a second maturity choice, without exposing offline evidence.
alter table public.investments add column offline_settlement_id uuid unique
  references public.offline_reinvestment_authorizations(id) on delete restrict;
create function private.guard_offline_source_marker() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and old.offline_settlement_id is not null
    and new.offline_settlement_id is distinct from old.offline_settlement_id then
    raise exception using errcode='55000',message='Offline settlement marker is immutable';
  end if;
  if new.offline_settlement_id is not null and not exists(
    select 1 from public.offline_reinvestment_authorizations a
      where a.id=new.offline_settlement_id and a.investment_id=new.id and a.status='fulfilled'
  ) then raise exception using errcode='23514',message='Source settlement marker requires completed offline authority'; end if;
  return new;
end;
$$;
create trigger offline_source_marker before insert or update on public.investments
  for each row execute function private.guard_offline_source_marker();
revoke all on function private.guard_offline_source_marker() from public,anon,authenticated;
grant execute on function private.guard_offline_source_marker() to service_role;
-- Hybrid placements carry an imported identity and fresh, explicit offline
-- authority. They are new investments, never rows fabricated in an import.
alter table public.investments drop constraint investment_origin_fields;
alter table public.investments add constraint investment_origin_fields check (
  (record_origin='portal' and investor_id is not null and legacy_partner_id is null
    and import_batch_id is null and source_sheet is null and source_row is null and source_key is null
    and projected_return_bps=3000 and principal_ugx>=125000 and principal_ugx=round(principal_ugx,2)
    and offline_authorization_id is null)
  or (record_origin='legacy_import' and legacy_partner_id is not null and import_batch_id is not null
    and source_sheet is not null and source_row>=2 and source_key is not null
    and projected_return_bps in (3000,3500) and principal_ugx>=125000
    and reservation_expires_at is null and status in ('active','matured') and offline_authorization_id is null)
  or (record_origin='hybrid' and legacy_partner_id is not null and import_batch_id is null
    and source_sheet is null and source_row is null and source_key is null
    and projected_return_bps=3000 and principal_ugx>=125000 and principal_ugx=round(principal_ugx,2)
    and reservation_expires_at is null and status in ('active','matured') and offline_authorization_id is not null)
);
alter table public.investments drop constraint investment_return_math_decimal;
alter table public.investments add constraint investment_return_math_decimal check (
  (record_origin in ('portal','hybrid') and projected_return_ugx=round(principal_ugx*projected_return_bps/10000,8))
  or (record_origin='legacy_import' and abs(projected_return_ugx-principal_ugx*projected_return_bps/10000)<=0.0000001)
);
alter table public.investments drop constraint investment_value_math_decimal;
alter table public.investments add constraint investment_value_math_decimal check (
  (record_origin in ('portal','hybrid') and projected_value_ugx=principal_ugx+projected_return_ugx)
  or (record_origin='legacy_import' and abs(projected_value_ugx-principal_ugx-projected_return_ugx)<=0.0000001)
);

-- A new offline placement belongs to its real owner after a verified claim;
-- it is not a member of the immutable historical import batch.
drop policy investments_self_read on public.investments;
create policy investments_self_read on public.investments for select to authenticated using (
  investor_id=(select auth.uid()) and (record_origin in ('portal','hybrid') or private.is_accepted_import_batch(import_batch_id))
);

-- Lock the source in both entry paths: an offline authority cannot coexist
-- with a portal maturity instruction, even during concurrent submissions.
create function private.guard_offline_settlement() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.investments where id=new.investment_id for update;
  if exists(select 1 from public.offline_reinvestment_authorizations where investment_id=new.investment_id and status<>'revoked') then
    raise exception using errcode='23514',message='This investment already has an offline reinvestment authorization';
  end if;
  return new;
end;
$$;
create trigger maturity_offline_settlement_guard before insert or update of investment_id
  on public.maturity_instructions for each row execute function private.guard_offline_settlement();

create function private.guard_offline_authorization_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then
    raise exception using errcode='55000',message='Offline authorization evidence is immutable';
  end if;
  if (to_jsonb(new)-array['status','fulfilled_investment_id','fulfilled_by','fulfilled_at','revoked_by','revoked_at','revocation_reason'])
    is distinct from (to_jsonb(old)-array['status','fulfilled_investment_id','fulfilled_by','fulfilled_at','revoked_by','revoked_at','revocation_reason'])
    or old.status<>'recorded' or new.status not in ('fulfilled','revoked') then
    raise exception using errcode='55000',message='Offline authorization evidence is immutable';
  end if;
  return new;
end;
$$;
create trigger offline_authorization_immutable before update or delete
  on public.offline_reinvestment_authorizations for each row execute function private.guard_offline_authorization_immutable();

alter table public.investment_receipts alter column investor_id drop not null;
alter table public.investment_receipts add column offline_authorization_id uuid unique
  references public.offline_reinvestment_authorizations(id) on delete restrict;
alter table public.investment_receipts add constraint receipt_offline_owner check (investor_id is not null or offline_authorization_id is not null);
alter table public.investment_receipts drop constraint receipt_source_links;
alter table public.investment_receipts add constraint receipt_source_links check (
  (source='bank_activation' and bank_receipt_id is not null and maturity_instruction_id is null and original_investment_id is null and offline_authorization_id is null)
  or (source='investment_record' and bank_receipt_id is null and maturity_instruction_id is null and original_investment_id is null and offline_authorization_id is null)
  or (source='reinvestment' and bank_receipt_id is null and original_investment_id is not null
    and ((maturity_instruction_id is not null and offline_authorization_id is null)
      or (maturity_instruction_id is null and offline_authorization_id is not null)))
);
create function private.guard_offline_links() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and new.offline_authorization_id is distinct from old.offline_authorization_id then
    raise exception using errcode='55000',message='Offline authorization link is immutable';
  end if;
  if new.offline_authorization_id is not null then
    if tg_table_name='investments' then
      if not exists(select 1 from public.offline_reinvestment_authorizations a
        where a.id=new.offline_authorization_id and a.legacy_partner_id=new.legacy_partner_id
          and a.target_cycle_id=new.cycle_id and a.amount_ugx=new.principal_ugx) then
        raise exception using errcode='23514',message='Offline investment does not match its authority';
      end if;
    else
      if not exists(select 1 from public.offline_reinvestment_authorizations a
        join public.investments i on i.offline_authorization_id=a.id
        where a.id=new.offline_authorization_id and i.id=new.investment_id
          and a.investment_id=new.original_investment_id and a.amount_ugx=new.amount_ugx) then
        raise exception using errcode='23514',message='Offline receipt does not match its authority';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger offline_investment_link before insert or update on public.investments
  for each row execute function private.guard_offline_links();
create trigger offline_receipt_link before insert or update on public.investment_receipts
  for each row execute function private.guard_offline_links();

create function public.record_offline_reinvestment(
  p_admin_id uuid,p_admin_aal2 boolean,p_request_id uuid,p_investment_id uuid,p_cycle_id uuid,
  p_agreement_hash text,p_amount numeric,p_authorized_on date,p_method text,
  p_evidence_reference text,p_verification_notes text,p_target_maturity_date date,p_target_return_bps integer,p_identity_verified boolean,p_settlement_checked boolean,p_agreement_accepted boolean
) returns uuid language plpgsql security invoker set search_path='' as $$
declare
  v_source public.investments%rowtype;
  v_cycle public.investment_cycles%rowtype;
  v_partner public.legacy_partner_identities%rowtype;
  v_agreement public.agreement_versions%rowtype;
  v_existing public.offline_reinvestment_authorizations%rowtype;
  v_roi numeric;
  v_id uuid;
begin
  if not private.is_admin(p_admin_id) or p_admin_aal2 is distinct from true then
    raise exception using errcode='42501',message='Active administrator two-factor authentication required';
  end if;
  if p_identity_verified is distinct from true or p_settlement_checked is distinct from true or p_agreement_accepted is distinct from true then
    raise exception using errcode='22023',message='Confirm identity, prior settlement checks, and offline agreement acceptance';
  end if;
  if p_request_id is null or p_authorized_on is null or p_authorized_on>(now() at time zone 'Africa/Kampala')::date
    or p_method is null or p_method not in ('signed_document','recorded_call','in_person')
    or coalesce(length(trim(p_evidence_reference)),0) not between 5 and 500
    or coalesce(length(trim(p_verification_notes)),0) not between 10 and 2000 then
    raise exception using errcode='22023',message='Dated offline evidence and verification notes are required';
  end if;
  -- Consistent order with linking: identity, source, then cycle.
  select l.* into v_partner from public.legacy_partner_identities l
    join public.investments i on i.legacy_partner_id=l.id where i.id=p_investment_id for update of l;
  select * into v_source from public.investments where id=p_investment_id for update;
  if v_partner.id is null or v_partner.profile_id is not null or v_source.investor_id is not null
    or v_source.status<>'matured' or v_source.payout_basis='reported_paid'
    or v_source.administratively_archived_at is not null
    or not private.is_accepted_import_batch(v_partner.import_batch_id) then
    raise exception using errcode='23514',message='An unclaimed, unpaid matured legacy investment is required';
  end if;
  select * into v_existing from public.offline_reinvestment_authorizations where request_id=p_request_id or (investment_id=p_investment_id and status<>'revoked')
    order by (request_id=p_request_id) desc limit 1;
  if found then
    if v_existing.investment_id=p_investment_id and v_existing.recorded_by=p_admin_id and v_existing.request_id=p_request_id
      and v_existing.target_maturity_date=p_target_maturity_date and v_existing.target_return_bps=p_target_return_bps
      and v_existing.target_cycle_id=p_cycle_id and v_existing.agreement_hash=p_agreement_hash
      and v_existing.amount_ugx=p_amount and v_existing.authorized_on=p_authorized_on
      and v_existing.method=p_method and v_existing.evidence_reference=trim(p_evidence_reference)
      and v_existing.verification_notes=trim(p_verification_notes) then return v_existing.id; end if;
    raise exception using errcode='23514',message='An offline authorization already exists; review the recorded evidence';
  end if;
  if exists(select 1 from public.maturity_instructions where investment_id=p_investment_id) then
    raise exception using errcode='23514',message='A maturity instruction already exists';
  end if;
  select * into v_cycle from public.investment_cycles where id=p_cycle_id for share;
  if not found or v_cycle.status<>'open' or v_cycle.record_origin<>'portal'
    or now()<v_cycle.opens_at or now()>=v_cycle.closes_at
    or p_authorized_on<(v_cycle.opens_at at time zone 'Africa/Kampala')::date
    or p_authorized_on<v_source.maturity_date then
    raise exception using errcode='23514',message='Record authorization within the open destination enrollment window';
  end if;
  if v_cycle.maturity_date is distinct from p_target_maturity_date or v_cycle.projected_return_bps is distinct from p_target_return_bps then
    raise exception using errcode='23514',message='Destination maturity or projected return changed; review the terms again';
  end if;
  select * into v_agreement from public.agreement_versions where id=v_cycle.agreement_version_id for share;
  if not found or not v_agreement.is_legally_approved or v_agreement.published_at is null
    or v_agreement.content_hash is distinct from p_agreement_hash
    or p_authorized_on<(v_agreement.published_at at time zone 'Africa/Kampala')::date then
    raise exception using errcode='23514',message='The accepted destination agreement is unavailable or changed';
  end if;
  select private.cycle_actual_return_ugx(v_source.principal_ugx,actual_return_bps) into v_roi
    from public.investment_cycles where id=v_source.cycle_id and actual_return_bps is not null for share;
  if v_roi is null or p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity')
    or p_amount is distinct from v_source.principal_ugx+v_roi or p_amount<>round(p_amount,2) then
    raise exception using errcode='23514',message='The recorded actual return and authorized full amount must match';
  end if;
  insert into public.offline_reinvestment_authorizations(investment_id,legacy_partner_id,target_cycle_id,
    agreement_version_id,agreement_hash,target_maturity_date,target_return_bps,principal_ugx,actual_roi_ugx,amount_ugx,authorized_on,method,
    evidence_reference,verification_notes,identity_verified,settlement_checked,agreement_accepted_offline,recorded_by,request_id)
  values(p_investment_id,v_partner.id,p_cycle_id,v_agreement.id,v_agreement.content_hash,v_cycle.maturity_date,v_cycle.projected_return_bps,
    v_source.principal_ugx,v_roi,p_amount,p_authorized_on,p_method,trim(p_evidence_reference),trim(p_verification_notes),true,true,true,p_admin_id,p_request_id)
  returning id into v_id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,request_id,metadata)
    values(p_admin_id,'offline_reinvestment.authorized','investment',p_investment_id,p_request_id,
      jsonb_build_object('authorization_id',v_id,'amount_ugx',p_amount,'target_cycle_id',p_cycle_id,
        'agreement_version_id',v_agreement.id,'agreement_hash',p_agreement_hash,'authorized_on',p_authorized_on,
        'method',p_method,'evidence_reference',trim(p_evidence_reference),
        'identity_verified',true,'settlement_checked',true,'agreement_accepted_offline',true));
  return v_id;
end;
$$;

create function public.complete_offline_reinvestment(
  p_admin_id uuid,p_admin_aal2 boolean,p_request_id uuid,p_authorization_id uuid,p_confirmation text
) returns uuid language plpgsql security invoker set search_path='' as $$
declare
  a public.offline_reinvestment_authorizations%rowtype;
  s public.investments%rowtype;
  c public.investment_cycles%rowtype;
  l public.legacy_partner_identities%rowtype;
  v_roi numeric; v_used numeric; v_partner_used numeric;
  v_id uuid:=gen_random_uuid(); v_receipt uuid; v_number text; v_return numeric;
begin
  if not private.is_admin(p_admin_id) or p_admin_aal2 is distinct from true then
    raise exception using errcode='42501',message='Active administrator two-factor authentication required';
  end if;
  if p_confirmation is distinct from 'REINVEST' or p_request_id is null then
    raise exception using errcode='22023',message='Type REINVEST to complete';
  end if;
  select * into a from public.offline_reinvestment_authorizations where id=p_authorization_id;
  if not found then raise exception using errcode='P0002',message='Offline authorization not found'; end if;
  select * into l from public.legacy_partner_identities where id=a.legacy_partner_id for update;
  select * into s from public.investments where id=a.investment_id for update;
  select * into a from public.offline_reinvestment_authorizations where id=p_authorization_id for update;
  if a.status='fulfilled' then return a.fulfilled_investment_id; end if;
  if a.status='revoked' then raise exception using errcode='23514',message='Offline authorization was revoked'; end if;
  if l.profile_id is not null or s.investor_id is not null or s.status<>'matured'
    or s.payout_basis='reported_paid' or s.administratively_archived_at is not null
    or not private.is_accepted_import_batch(l.import_batch_id)
    or exists(select 1 from public.maturity_instructions where investment_id=s.id) then
    raise exception using errcode='23514',message='Source ownership or settlement changed; review before completing';
  end if;
  if (now() at time zone 'Africa/Kampala')::date<public.maturity_payout_date(s.maturity_date) then
    raise exception using errcode='23514',message='Settlement is not due yet';
  end if;
  select private.cycle_actual_return_ugx(s.principal_ugx,actual_return_bps) into v_roi
    from public.investment_cycles where id=s.cycle_id and actual_return_bps is not null for share;
  if v_roi is null or v_roi is distinct from a.actual_roi_ugx or s.principal_ugx is distinct from a.principal_ugx then
    raise exception using errcode='23514',message='Source return changed; the offline authorization must be reviewed';
  end if;
  select * into c from public.investment_cycles where id=a.target_cycle_id for update;
  if c.status not in ('open','closed') or c.capacity_ugx is null
    or a.recorded_at<c.opens_at or a.recorded_at>=c.closes_at
    or c.maturity_date<=(now() at time zone 'Africa/Kampala')::date then
    raise exception using errcode='23514',message='Destination cycle is unavailable';
  end if;
  if c.maturity_date is distinct from a.target_maturity_date or c.projected_return_bps is distinct from a.target_return_bps then
    raise exception using errcode='23514',message='Destination maturity or projected return changed; review the offline authorization';
  end if;
  if c.agreement_version_id is distinct from a.agreement_version_id or not exists(
    select 1 from public.agreement_versions where id=a.agreement_version_id
      and content_hash=a.agreement_hash and is_legally_approved and published_at is not null) then
    raise exception using errcode='23514',message='Destination agreement changed; review the offline authorization';
  end if;
  select coalesce(sum(principal_ugx),0) into v_used from public.investments
    where cycle_id=c.id and status in ('reserved','active') and not is_test;
  if not s.is_test and v_used+a.amount_ugx>c.capacity_ugx then
    raise exception using errcode='23514',message='Destination cycle capacity exceeded';
  end if;
  select coalesce(sum(principal_ugx),0) into v_partner_used from public.investments
    where cycle_id=c.id and legacy_partner_id=l.id and status in ('reserved','active');
  if v_partner_used+a.amount_ugx>50000000 then
    raise exception using errcode='23514',message='Partner cycle limit exceeded';
  end if;
  v_return:=round(a.amount_ugx*c.projected_return_bps/10000,8);
  insert into public.investments(id,cycle_id,legacy_partner_id,offline_authorization_id,
    unit_price_ugx,principal_ugx,projected_return_bps,projected_return_ugx,projected_value_ugx,
    maturity_date,status,requested_at,activated_at,record_origin,is_test)
  values(v_id,c.id,l.id,a.id,c.unit_price_ugx,a.amount_ugx,c.projected_return_bps,
    v_return,a.amount_ugx+v_return,c.maturity_date,'active',now(),now(),'hybrid',s.is_test);
  v_number:=private.allocate_receipt_number(s.is_test);
  insert into public.investment_receipts(investment_id,source,offline_authorization_id,original_investment_id,
    receipt_number,is_test,partner_name,partner_phone,company_name,company_address,amount_ugx,transaction_date,account_description)
  values(v_id,'reinvestment',a.id,s.id,v_number,s.is_test,l.canonical_name,l.normalized_phone,
    'OurMu Ventures Limited','Katabbi Town Council, Entebbe, Wakiso',a.amount_ugx,
    (now() at time zone 'Africa/Kampala')::date,'Offline-authorized reinvestment — '||l.canonical_name)
  returning id into v_receipt;
  update public.offline_reinvestment_authorizations set status='fulfilled',fulfilled_by=p_admin_id,
    fulfilled_at=now(),fulfilled_investment_id=v_id where id=a.id;
  update public.investments set offline_settlement_id=a.id where id=s.id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,request_id,metadata)
    values(p_admin_id,'offline_reinvestment.fulfilled','investment',s.id,p_request_id,
      jsonb_build_object('authorization_id',a.id,'reinvestment_id',v_id,'amount_ugx',a.amount_ugx,
        'target_cycle_id',c.id,'receipt_id',v_receipt,'receipt_number',v_number));
  insert into public.jobs(kind,entity_type,entity_id,payload)
    values('generate_receipt_pdf','investment_receipt',v_receipt,'{}');
  return v_id;
end;
$$;

create function public.revoke_offline_reinvestment(p_admin_id uuid,p_admin_aal2 boolean,p_request_id uuid,p_authorization_id uuid,p_reason text)
returns void language plpgsql security invoker set search_path='' as $$
declare a public.offline_reinvestment_authorizations%rowtype;
begin
  if not private.is_admin(p_admin_id) or p_admin_aal2 is distinct from true then
    raise exception using errcode='42501',message='Active administrator two-factor authentication required';
  end if;
  if p_request_id is null or coalesce(length(trim(p_reason)),0) not between 10 and 2000 then
    raise exception using errcode='22023',message='A revocation reason is required';
  end if;
  select * into a from public.offline_reinvestment_authorizations where id=p_authorization_id;
  if not found then raise exception using errcode='P0002',message='Offline authorization not found'; end if;
  perform 1 from public.legacy_partner_identities where id=a.legacy_partner_id for update;
  perform 1 from public.investments where id=a.investment_id for update;
  select * into a from public.offline_reinvestment_authorizations where id=p_authorization_id for update;
  if a.status='revoked' then return; end if;
  if a.status<>'recorded' then raise exception using errcode='23514',message='Completed reinvestment cannot be revoked'; end if;
  update public.offline_reinvestment_authorizations set status='revoked',revoked_by=p_admin_id,
    revoked_at=now(),revocation_reason=trim(p_reason) where id=a.id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,request_id,metadata)
    values(p_admin_id,'offline_reinvestment.revoked','investment',a.investment_id,p_request_id,
      jsonb_build_object('authorization_id',a.id,'reason',trim(p_reason)));
end;
$$;
revoke all on function public.revoke_offline_reinvestment(uuid,boolean,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.revoke_offline_reinvestment(uuid,boolean,uuid,uuid,text) to service_role;

revoke all on function public.record_offline_reinvestment(uuid,boolean,uuid,uuid,uuid,text,numeric,date,text,text,text,date,integer,boolean,boolean,boolean) from public,anon,authenticated;
revoke all on function public.complete_offline_reinvestment(uuid,boolean,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_offline_reinvestment(uuid,boolean,uuid,uuid,uuid,text,numeric,date,text,text,text,date,integer,boolean,boolean,boolean) to service_role;
grant execute on function public.complete_offline_reinvestment(uuid,boolean,uuid,uuid,text) to service_role;
revoke all on function private.guard_offline_settlement(),private.guard_offline_authorization_immutable(),private.guard_offline_links() from public,anon,authenticated;
grant execute on function private.guard_offline_settlement(),private.guard_offline_authorization_immutable(),private.guard_offline_links() to service_role;

create or replace function private.guard_investment_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_setting('ourmu.september_import_correction', true) =
      '8294d9ae9efb07c90fb27af79f3db98ccecc04d0b6c554207c4e58cf728e12a0'
    and old.id = '73a7f123-cdb8-5359-9075-f36604131850'::uuid
    and old.record_origin = 'legacy_import'
    and old.principal_ugx = 16250000
    and new.principal_ugx = 12500000
    and new.projected_return_ugx = 3750000
    and new.projected_value_ugx = 16250000
    and row(new.investor_id, new.cycle_id, new.unit_price_ugx, new.projected_return_bps,
      new.maturity_date, new.reservation_expires_at, new.status, new.record_origin,
      new.import_batch_id, new.legacy_partner_id, new.source_sheet, new.source_row,
      new.source_key, new.payout_basis, new.reported_return_ugx, new.reported_payout_ugx) is not distinct from
    row(old.investor_id, old.cycle_id, old.unit_price_ugx, old.projected_return_bps,
      old.maturity_date, old.reservation_expires_at, old.status, old.record_origin,
      old.import_batch_id, old.legacy_partner_id, old.source_sheet, old.source_row,
      old.source_key, old.payout_basis, old.reported_return_ugx, old.reported_payout_ugx) then
    return new;
  end if;
  if old.record_origin in ('legacy_import','hybrid') and old.investor_id is null and new.investor_id is not null
    and row(new.cycle_id, new.unit_price_ugx, new.principal_ugx, new.projected_return_bps,
      new.projected_return_ugx, new.projected_value_ugx, new.maturity_date,
      new.reservation_expires_at, new.record_origin, new.import_batch_id, new.legacy_partner_id,
      new.source_sheet, new.source_row, new.source_key, new.payout_basis,
      new.reported_return_ugx, new.reported_payout_ugx) is not distinct from
    row(old.cycle_id, old.unit_price_ugx, old.principal_ugx, old.projected_return_bps,
      old.projected_return_ugx, old.projected_value_ugx, old.maturity_date,
      old.reservation_expires_at, old.record_origin, old.import_batch_id, old.legacy_partner_id,
      old.source_sheet, old.source_row, old.source_key, old.payout_basis,
      old.reported_return_ugx, old.reported_payout_ugx) then
    return new;
  end if;
  if old.status in ('active', 'matured') and row(new.investor_id, new.cycle_id, new.unit_price_ugx,
    new.principal_ugx, new.projected_return_bps, new.projected_return_ugx, new.projected_value_ugx,
    new.maturity_date, new.reservation_expires_at, new.record_origin, new.import_batch_id,
    new.legacy_partner_id, new.source_sheet, new.source_row, new.source_key, new.payout_basis,
    new.reported_return_ugx, new.reported_payout_ugx) is distinct from
    row(old.investor_id, old.cycle_id, old.unit_price_ugx, old.principal_ugx,
    old.projected_return_bps, old.projected_return_ugx, old.projected_value_ugx, old.maturity_date,
    old.reservation_expires_at, old.record_origin, old.import_batch_id, old.legacy_partner_id,
    old.source_sheet, old.source_row, old.source_key, old.payout_basis, old.reported_return_ugx,
    old.reported_payout_ugx) then
    raise exception using errcode = '55000', message = 'activated investment terms are immutable';
  end if;
  return new;
end;
$$;


create or replace function private.guard_receipt_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.offline_authorization_id is not null and old.investor_id is null and new.investor_id is not null
    and (to_jsonb(new)-array['investor_id','updated_at']) is not distinct from (to_jsonb(old)-array['investor_id','updated_at'])
    and exists(select 1 from public.investments i where i.id=new.investment_id and i.investor_id=new.investor_id
      and i.offline_authorization_id=new.offline_authorization_id) then return new; end if;
  if row(new.investment_id, new.investor_id, new.source, new.bank_receipt_id,
      new.maturity_instruction_id, new.original_investment_id, new.receipt_number,
      new.is_test, new.partner_name, new.partner_phone, new.company_name,
      new.company_address, new.amount_ugx, new.transaction_date,
      new.account_description, new.template_version)
    is distinct from
    row(old.investment_id, old.investor_id, old.source, old.bank_receipt_id,
      old.maturity_instruction_id, old.original_investment_id, old.receipt_number,
      old.is_test, old.partner_name, old.partner_phone, old.company_name,
      old.company_address, old.amount_ugx, old.transaction_date,
      old.account_description, old.template_version) then
    raise exception using errcode = '55000', message = 'issued receipt details are immutable';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create function private.claim_offline_receipt() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if old.investor_id is null and new.investor_id is not null and new.offline_authorization_id is not null then
    update public.investment_receipts set investor_id=new.investor_id where investment_id=new.id and investor_id is null;
  end if;
  return new;
end;
$$;
create trigger claim_offline_receipt after update of investor_id on public.investments for each row execute function private.claim_offline_receipt();
revoke all on function private.claim_offline_receipt() from public,anon,authenticated;
grant execute on function private.claim_offline_receipt() to service_role;

-- Shared settlement readers must recognize offline authority too. Pending
-- evidence remains in financial totals; only completed settlement excludes
-- the source, matching the existing portal-instruction behavior.
create or replace function private.cycle_settlement_started(p_cycle_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.maturity_instructions mi
    join public.investments i on i.id = mi.investment_id
    where i.cycle_id = p_cycle_id and mi.status = 'fulfilled'
  ) or exists (
    select 1 from public.offline_reinvestment_authorizations a
    join public.investments i on i.id = a.investment_id
    where i.cycle_id = p_cycle_id and a.status = 'fulfilled'
  );
$$;

-- Included: funded (active) and unpaid matured investments, imported ones
-- too. Excluded: reservations, expired/cancelled, reported-paid history and
-- already-fulfilled maturities. Test placements are counted separately and
-- kept out of financial totals.
create or replace function private.cycle_return_totals(p_cycle_id uuid, p_actual_return_bps integer)
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
      and not exists (
        select 1 from public.offline_reinvestment_authorizations a
        where a.investment_id = i.id and a.status = 'fulfilled'
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


-- Never reinterpret a recorded or fulfilled offline authorization as an
-- unanswered maturity after a later verified legacy-account claim. Revoked
-- authority releases the source back to the normal unanswered workflow.
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
      and not exists (
        select 1 from public.offline_reinvestment_authorizations a
        where a.investment_id = i.id and a.status <> 'revoked'
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

commit;
