begin;
-- Reject stale confirmation inserts and claims, including older deployed workers.
create function private.guard_stale_maturity_confirmation_job() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind = 'send_email' and new.entity_type = 'investment'
    and new.payload->>'template' = 'maturity_choice_confirmed'
    and new.status in ('pending','failed','running')
    and not exists (
      select 1 from public.investments i
      join public.maturity_instructions m on m.investment_id = i.id
      where i.id = new.entity_id and i.payout_basis <> 'reported_paid'
        and m.status in ('requested','processing')
    ) then
    -- A skipped claim returns no rows, so existing workers cannot send it.
    return null;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_stale_maturity_confirmation_job() from public;
create trigger guard_stale_maturity_confirmation_job
before insert or update on public.jobs
for each row execute function private.guard_stale_maturity_confirmation_job();

-- Removing a request also retires its unsent confirmation jobs.
create function private.cancel_removed_maturity_confirmation_jobs() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.jobs set status = 'dead', locked_at = null,
    last_error_code = 'STALE_MATURITY_CONFIRMATION_CANCELLED', updated_at = now()
  where entity_type = 'investment' and entity_id = old.investment_id
    and kind = 'send_email' and payload->>'template' = 'maturity_choice_confirmed'
    and status in ('pending','failed');
  return old;
end;
$$;
revoke all on function private.cancel_removed_maturity_confirmation_jobs() from public;
create trigger cancel_removed_maturity_confirmation_jobs
 after delete on public.maturity_instructions
 for each row execute function private.cancel_removed_maturity_confirmation_jobs();
commit;
