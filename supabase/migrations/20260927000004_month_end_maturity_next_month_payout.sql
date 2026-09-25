-- Cycles mature at month end; payout follows on the 15th of the next month.
create or replace function public.maturity_payout_date(p_maturity_date date)
returns date language sql immutable set search_path = '' as $$
  select (date_trunc('month', p_maturity_date)::date + interval '1 month 14 days')::date;
$$;

create or replace function private.guard_cycle_maturity_day() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.record_origin = 'portal'
    and new.maturity_date <> (date_trunc('month', new.maturity_date)::date + interval '1 month - 1 day')::date then
    raise exception using errcode = '23514',
      message = 'portal cycle maturity must fall on the last day of the month';
  end if;
  return new;
end;
$$;

-- Keep the fulfillment error aligned with the revised payout date. Rebuild
-- only this existing function so its permissions and processing logic stay put.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.fulfill_maturity_instruction(uuid,uuid,numeric,text,text,boolean,uuid,boolean)'::regprocedure
  ) into v_definition;
  if position('15th of the maturity month' in v_definition) = 0 then
    raise exception 'Expected payout message was not found in fulfillment function';
  end if;
  execute replace(v_definition,
    '15th of the maturity month', '15th of the month after maturity');
end;
$$;
