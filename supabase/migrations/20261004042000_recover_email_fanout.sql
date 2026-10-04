begin;
-- PostgREST upsert cannot infer a partial index without its predicate.
-- Keep the existing partial index for SQL callers that name the predicate.
create unique index jobs_email_dedupe_upsert_unique on public.jobs(email_dedupe_key);

create function private.guard_pending_email_duplicate() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind = 'send_email' and new.payload ? 'to' then
    perform pg_advisory_xact_lock(hashtextextended(new.entity_id::text || ':' || (new.payload->>'template') || ':' || lower(new.payload->>'to'),0));
    if exists(select 1 from public.jobs j where j.kind = 'send_email'
      and j.entity_type = new.entity_type and j.entity_id = new.entity_id
      and j.status in ('pending','failed','running')
      and j.payload - 'idempotencyKey' = new.payload - 'idempotencyKey') then
      return null;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_pending_email_duplicate() from public;
create trigger guard_pending_email_duplicate before insert on public.jobs
for each row execute function private.guard_pending_email_duplicate();

-- Retain the earliest identical unsent confirmation; preserve recovery in audit.
with ranked as (
 select id,row_number() over(partition by entity_type,entity_id,(payload-'idempotencyKey') order by created_at,id) as position
 from public.jobs where kind='send_email' and status in ('pending','failed')
 and payload->>'template'='maturity_choice_confirmed' and payload ? 'to'
 and first_send_attempt_at is null and provider_message_id is null
), changed as (
 update public.jobs j set status='dead',last_error_code='DUPLICATE_EMAIL_CANCELLED',locked_at=null,updated_at=now()
 from ranked r where r.id=j.id and r.position>1 returning j.id
)
insert into public.audit_events(action,entity_type,entity_id,request_id,metadata)
select 'email.duplicate_cancelled','job',id,gen_random_uuid(),jsonb_build_object('reason','Identical unsent confirmation; earliest queued copy retained') from changed;

with changed as (
 update public.jobs j set status='dead',last_error_code='STALE_RESERVATION_CANCELLED',locked_at=null,updated_at=now()
 from public.investments i where i.id=j.entity_id and j.entity_type='investment'
 and j.kind='send_email' and j.payload->>'template'='reservation_created'
 and j.status in ('pending','failed') and i.status<>'reserved' returning j.id
)
insert into public.audit_events(action,entity_type,entity_id,request_id,metadata)
select 'email.stale_reservation_cancelled','job',id,gen_random_uuid(),jsonb_build_object('reason','Investment is no longer reserved') from changed;

with changed as (
 update public.jobs set status='pending',attempts=0,available_at=now(),locked_at=null,last_error_code=null,updated_at=now()
 where kind='send_email' and status='failed' and last_error_code='EMAIL_FANOUT_FAILED'
 and first_send_attempt_at is null and provider_message_id is null returning id
)
insert into public.audit_events(action,entity_type,entity_id,request_id,metadata)
select 'email.fanout_recovered','job',id,gen_random_uuid(),jsonb_build_object('reason','Fixed upsert conflict index; no prior provider send') from changed;
commit;
