-- Existing placements are preserved. New reservations and reinvestments must
-- fit within UGX 50,000,000 per placement and per investor in a cycle.
alter table public.investments
  drop constraint investment_origin_fields,
  add constraint investment_origin_fields check (
    (record_origin = 'portal' and investor_id is not null and legacy_partner_id is null
      and import_batch_id is null and source_sheet is null and source_row is null
      and source_key is null and projected_return_bps = 3000
      and principal_ugx between 125000 and 50000000
      and principal_ugx = round(principal_ugx, 2) and reservation_expires_at is not null)
    or (record_origin = 'legacy_import' and legacy_partner_id is not null
      and import_batch_id is not null and source_sheet is not null and source_row >= 2
      and source_key is not null and projected_return_bps in (3000, 3500)
      and principal_ugx >= 125000 and reservation_expires_at is null
      and status in ('active', 'matured'))
  );

-- Both entry paths enforce the same cap: partner reservations and fulfillment
-- of a maturity instruction into a new investment cycle.
do $$
declare
  v_function regprocedure;
  v_definition text;
begin
  foreach v_function in array array[
    'public.request_investment(uuid,uuid,numeric,uuid,text,bytea)'::regprocedure,
    'public.fulfill_maturity_instruction(uuid,uuid,numeric,text,text,boolean,uuid,boolean)'::regprocedure
  ] loop
    v_definition := pg_get_functiondef(v_function);
    if position('62500000' in v_definition) = 0 then
      raise exception 'Expected investment limit was not found in %', v_function;
    end if;
    execute replace(replace(v_definition, '62500000', '50000000'),
      '62,500,000', '50,000,000');
  end loop;
end;
$$;
