begin;
-- One staleness rule for the job guard and the retirement below, so they
-- cannot drift: a confirmation is stale once its investment has no requested
-- or processing instruction, or is reported paid.
create function private.is_stale_maturity_confirmation(p_job public.jobs) returns boolean
language sql stable set search_path = '' as $$
  select p_job.kind = 'send_email' and p_job.entity_type = 'investment'
    and p_job.payload->>'template' = 'maturity_choice_confirmed'
    and not exists (
      select 1 from public.investments i
      join public.maturity_instructions m on m.investment_id = i.id
      where i.id = p_job.entity_id and i.payout_basis <> 'reported_paid'
        and m.status in ('requested','processing')
    );
$$;
revoke all on function private.is_stale_maturity_confirmation(public.jobs) from public, anon, authenticated;
-- The job guard runs with the writer's privileges; workers write as service_role.
grant execute on function private.is_stale_maturity_confirmation(public.jobs) to service_role;

-- Stale inserts and writes to running (claims, pre-send tracking) are still
-- skipped, so older deployed workers cannot send, and so are writes that would
-- revive a finished row (Retry, Authorize resend), which keeps its outcome.
-- Any other write that would keep a stale confirmation queued (failure,
-- deferral, lease recovery) retires it instead of leaving it stuck.
create or replace function private.guard_stale_maturity_confirmation_job() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status in ('pending','failed','running')
    and private.is_stale_maturity_confirmation(new) then
    -- A skipped claim returns no rows, so existing workers cannot send it.
    if tg_op = 'INSERT' or new.status = 'running'
      or old.status in ('succeeded','dead') then
      return null;
    end if;
    new.status := 'dead';
    new.locked_at := null;
    new.claim_token := null;
    new.lease_expires_at := null;
    new.last_error_code := 'STALE_MATURITY_CONFIRMATION_CANCELLED';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_stale_maturity_confirmation_job() from public, anon, authenticated;

-- Fulfilling or moving a request, or reporting its investment paid, retires
-- its unsent confirmations at once; a running one retires through the guard on
-- its worker's failure write or on lease recovery. Security definer: the
-- fulfilment, payout and maintenance callers' own job privileges must never
-- fail this cleanup or abort their transaction.
create function private.retire_stale_maturity_confirmation_jobs() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_investment_id uuid;
begin
  if tg_table_name = 'investments' then
    v_investment_id := new.id;
  else
    v_investment_id := old.investment_id;
  end if;
  update public.jobs j set status = 'dead', locked_at = null, claim_token = null,
    lease_expires_at = null, last_error_code = 'STALE_MATURITY_CONFIRMATION_CANCELLED'
  where j.entity_type = 'investment' and j.entity_id = v_investment_id
    and j.status in ('pending','failed') and private.is_stale_maturity_confirmation(j);
  return null;
end;
$$;
revoke all on function private.retire_stale_maturity_confirmation_jobs() from public, anon, authenticated;
create trigger retire_stale_maturity_confirmation_jobs
after update of status, investment_id on public.maturity_instructions
for each row when (old.status is distinct from new.status
  or old.investment_id is distinct from new.investment_id)
execute function private.retire_stale_maturity_confirmation_jobs();
create trigger retire_stale_maturity_confirmation_jobs
after update of payout_basis on public.investments
for each row when (old.payout_basis is distinct from new.payout_basis)
execute function private.retire_stale_maturity_confirmation_jobs();

-- Retire confirmations that went stale before these triggers, including
-- running rows without a live lease. Pre-lease running rows have none: the
-- guard skipped their lease backfill in 20261005115634. Audited like the
-- one-time email cancellations in 20261004042000.
with retired as (
  update public.jobs j set status = 'dead', locked_at = null, claim_token = null,
    lease_expires_at = null, last_error_code = 'STALE_MATURITY_CONFIRMATION_CANCELLED'
  where (j.status in ('pending','failed')
      or (j.status = 'running' and (j.lease_expires_at is null or j.lease_expires_at < now())))
    and private.is_stale_maturity_confirmation(j)
  returning j.id
)
insert into public.audit_events(action,entity_type,entity_id,request_id,metadata)
select 'email.stale_maturity_confirmation_cancelled','job',id,gen_random_uuid(),
  jsonb_build_object('reason','Maturity request no longer live or investment reported paid')
from retired;
commit;
