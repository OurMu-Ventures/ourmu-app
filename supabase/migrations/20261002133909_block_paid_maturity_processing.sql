-- Stale instructions on historical paid records must not be processed or revised.
-- Retain those instructions for audit history; do not mark them falsely fulfilled.
create function private.guard_paid_maturity_instruction() returns trigger
language plpgsql set search_path = '' as $function$
begin
  if new.status <> 'fulfilled' and exists (
    select 1 from public.investments
    where id = new.investment_id and payout_basis = 'reported_paid'
  ) then
    raise exception using errcode = '23514',
      message = 'paid investments cannot be withdrawn or reinvested';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_paid_maturity_instruction() from public;
create trigger guard_paid_maturity_instruction
before insert or update on public.maturity_instructions
for each row execute function private.guard_paid_maturity_instruction();
