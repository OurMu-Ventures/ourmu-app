begin;

-- Imported placements may have no bank receipt or portal rollover instruction.
-- Acknowledge the recorded investment without inventing payment evidence.
alter table public.investment_receipts drop constraint receipt_source_links;
alter table public.investment_receipts add constraint receipt_source_links check (
  (source = 'bank_activation' and bank_receipt_id is not null
    and maturity_instruction_id is null and original_investment_id is null)
  or (source = 'reinvestment' and bank_receipt_id is null
    and maturity_instruction_id is not null and original_investment_id is not null)
  or (source = 'investment_record' and bank_receipt_id is null
    and maturity_instruction_id is null and original_investment_id is null)
);

-- Called only by the server after authenticating the investor. Lock the
-- investment just as activation/fulfillment do, so concurrent downloads reuse
-- one immutable receipt and number. No activation emails are queued here.
create or replace function public.ensure_investment_receipt(
  p_investor_id uuid,
  p_investment_id uuid
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_investment public.investments%rowtype;
  v_profile public.profiles%rowtype;
  v_bank public.bank_receipts%rowtype;
  v_rollover public.maturity_instructions%rowtype;
  v_receipt_id uuid;
  v_source public.receipt_source := 'investment_record';
  v_date date;
  v_description text;
begin
  select * into v_investment from public.investments
  where id = p_investment_id and investor_id = p_investor_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'investment not found';
  end if;
  select * into v_profile from public.profiles
  where id = p_investor_id and access_status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'active investor required';
  end if;

  select id into v_receipt_id from public.investment_receipts
  where investment_id = p_investment_id and investor_id = p_investor_id;
  if found then return v_receipt_id; end if;
  if v_investment.status <> 'active' then
    raise exception using errcode = '23514', message = 'only active investments can issue a missing receipt';
  end if;

  select * into v_bank from public.bank_receipts
  where investment_id = p_investment_id order by created_at, id limit 1;
  select * into v_rollover from public.maturity_instructions
  where fulfilled_investment_id = p_investment_id and status = 'fulfilled'
    and investor_id = p_investor_id order by fulfilled_at, id limit 1;

  v_date := (coalesce(v_investment.activated_at, v_investment.requested_at)
    at time zone 'Africa/Kampala')::date;
  v_description := 'Investment record — ' || v_profile.legal_name
    || ' — Investment reference: ' || v_investment.id::text;
  if v_rollover.id is not null then
    v_source := 'reinvestment';
    v_date := coalesce((v_rollover.fulfilled_at at time zone 'Africa/Kampala')::date, v_date);
    v_description := 'Accounts payable — ' || v_profile.legal_name;
  elsif v_bank.id is not null then
    v_source := 'bank_activation';
    v_date := v_bank.received_date;
    v_description := 'Accounts payable — ' || v_profile.legal_name;
  end if;

  insert into public.investment_receipts (
    investment_id, investor_id, source, bank_receipt_id, maturity_instruction_id,
    original_investment_id, receipt_number, is_test, partner_name, partner_phone,
    company_name, company_address, amount_ugx, transaction_date, account_description
  ) values (
    v_investment.id, p_investor_id, v_source,
    case when v_source = 'bank_activation' then v_bank.id end,
    case when v_source = 'reinvestment' then v_rollover.id end,
    case when v_source = 'reinvestment' then v_rollover.investment_id end,
    private.allocate_receipt_number(v_investment.is_test or v_profile.is_test),
    v_investment.is_test or v_profile.is_test, v_profile.legal_name, v_profile.phone,
    'OurMu Ventures Limited', 'Katabbi Town Council, Entebbe, Wakiso',
    v_investment.principal_ugx, v_date, v_description
  ) returning id into v_receipt_id;
  return v_receipt_id;
end;
$$;

revoke all on function public.ensure_investment_receipt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ensure_investment_receipt(uuid, uuid) to service_role;

commit;
