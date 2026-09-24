begin;

-- Automatic investment receipts: one immutable receipt per activated
-- investment, covering bank-funded activations and completed reinvestments.
-- Payout-only fulfillment creates no receipt. No backfill: applies to
-- activations after rollout.

create type public.receipt_source as enum ('bank_activation', 'reinvestment');
create type public.receipt_status as enum ('generating', 'ready', 'failed');

create table public.receipt_counters (
  year integer primary key check (year between 2000 and 2100),
  last_seq integer not null default 0 check (last_seq >= 0)
);

create table public.investment_receipts (
  id uuid primary key default gen_random_uuid(),
  investment_id uuid not null unique references public.investments(id) on delete restrict,
  investor_id uuid not null references public.profiles(id) on delete restrict,
  source public.receipt_source not null,
  bank_receipt_id uuid references public.bank_receipts(id) on delete restrict,
  maturity_instruction_id uuid references public.maturity_instructions(id) on delete restrict,
  original_investment_id uuid references public.investments(id) on delete restrict,
  receipt_number text not null unique,
  is_test boolean not null default false,
  partner_name text not null,
  partner_phone text,
  company_name text not null,
  company_address text not null,
  amount_ugx numeric(28,8) not null check (amount_ugx > 0),
  transaction_date date not null,
  account_description text not null,
  template_version text not null default 'receipt-v1',
  pdf_status public.receipt_status not null default 'generating',
  pdf_path text,
  pdf_hash text,
  generated_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint receipt_source_links check (
    (source = 'bank_activation' and bank_receipt_id is not null
      and maturity_instruction_id is null and original_investment_id is null)
    or (source = 'reinvestment' and bank_receipt_id is null
      and maturity_instruction_id is not null and original_investment_id is not null)
  ),
  constraint receipt_pdf_ready check (
    (pdf_status = 'ready' and pdf_path is not null and pdf_hash is not null and generated_at is not null)
    or pdf_status <> 'ready'
  )
);
create index investment_receipts_investor_idx on public.investment_receipts (investor_id, created_at desc);
create index investment_receipts_number_idx on public.investment_receipts (receipt_number);
create index investment_receipts_status_idx on public.investment_receipts (pdf_status) where pdf_status <> 'ready';

-- Annual receipt numbering, transactional within the activation transaction.
-- Sequence gaps are acceptable; numbers are never reused. Test investments
-- use a separate visible TEST- prefix series.
create or replace function private.allocate_receipt_number(p_is_test boolean)
returns text language plpgsql set search_path = '' as $$
declare
  v_year integer := extract(year from (now() at time zone 'Africa/Kampala'))::integer;
  v_seq integer;
begin
  insert into public.receipt_counters (year, last_seq)
  values (v_year, 0)
  on conflict (year) do nothing;
  select last_seq into v_seq from public.receipt_counters
  where year = v_year for update;
  update public.receipt_counters set last_seq = last_seq + 1
  where year = v_year
  returning last_seq into v_seq;
  if p_is_test then
    return 'TEST-OURMU-' || v_year || '-' || lpad(v_seq::text, 6, '0');
  end if;
  return 'OURMU-' || v_year || '-' || lpad(v_seq::text, 6, '0');
end;
$$;

-- Business details are immutable once issued; only generation fields advance.
create or replace function private.guard_receipt_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
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
create trigger investment_receipts_immutable_guard before update on public.investment_receipts
  for each row execute function private.guard_receipt_immutable();

create trigger investment_receipts_touch_not_needed
  before update on public.investment_receipts for each row
  execute function private.touch_updated_at();

alter table public.investment_receipts enable row level security;
create policy investment_receipts_self_read on public.investment_receipts for select to authenticated
  using (investor_id = auth.uid());
create policy investment_receipts_admin_read on public.investment_receipts for select to authenticated
  using (private.is_admin());
alter table public.receipt_counters enable row level security;

revoke all on public.investment_receipts, public.receipt_counters from public, anon, authenticated;
grant select on public.investment_receipts to authenticated;
grant all on public.investment_receipts, public.receipt_counters to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on function private.allocate_receipt_number(boolean) from public, anon, authenticated;

-- Provider message id for idempotent delivery correlation (Resend email id).
alter table public.jobs add column if not exists provider_message_id text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy receipt_pdf_owner_read on storage.objects for select to authenticated
using (
  bucket_id = 'receipts'
  and exists (
    select 1 from public.investment_receipts r
    where r.investor_id = auth.uid() and r.pdf_path = name and r.pdf_status = 'ready'
  )
);
create policy receipt_pdf_admin_read on storage.objects for select to authenticated
using (bucket_id = 'receipts' and private.is_admin());

-- Bank activation now issues a receipt record and queues its generation in
-- the same transaction. The activation email is queued only after the PDF is
-- ready (by the receipt worker), avoiding a second activation notification.
-- Agreement generation stays independent.
create or replace function public.activate_investment(
  p_admin_id uuid,
  p_investment_id uuid,
  p_bank_reference text,
  p_received_amount_ugx numeric,
  p_received_date date,
  p_confirmation text,
  p_admin_aal2 boolean,
  p_request_id uuid
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_investment public.investments%rowtype;
  v_profile public.profiles%rowtype;
  v_bank_receipt_id uuid;
  v_receipt_id uuid;
  v_receipt_number text;
  v_company_name text := 'OURMU Ventures';
  v_company_address text := 'Kampala, Uganda';
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
  if v_investment.status <> 'reserved' or v_investment.reservation_expires_at <= now() then
    raise exception using errcode = '23514', message = 'only an unexpired reservation can be activated';
  end if;
  if p_received_amount_ugx <> v_investment.principal_ugx then
    raise exception using errcode = '23514', message = 'received amount must exactly match expected principal';
  end if;
  insert into public.bank_receipts (investment_id, bank_reference, received_amount_ugx, received_date, recorded_by, activated_at)
  values (p_investment_id, trim(p_bank_reference), p_received_amount_ugx, p_received_date, p_admin_id, now())
  returning id into v_bank_receipt_id;
  update public.investments set status = 'active', activated_at = now() where id = p_investment_id;
  update public.investment_agreements set pdf_status = 'generating' where investment_id = p_investment_id;
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
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_admin_id, 'investment.activated', 'investment', p_investment_id, p_request_id,
    jsonb_build_object('received_amount_ugx', p_received_amount_ugx, 'received_date', p_received_date,
      'receipt_id', v_receipt_id, 'receipt_number', v_receipt_number));
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

revoke all on function public.activate_investment(uuid, uuid, text, numeric, date, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.activate_investment(uuid, uuid, text, numeric, date, text, boolean, uuid) to service_role;

commit;
