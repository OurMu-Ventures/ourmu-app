begin;
-- Follow-up: the recovery migration is already applied in production.
create or replace function private.guard_pending_email_duplicate() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind = 'send_email' and new.entity_id is not null
    and new.payload->>'template' is not null
    and new.payload->>'to' is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.entity_type || ':' || new.entity_id::text || ':' || (new.payload->>'template') || ':' || lower(new.payload->>'to'),0));
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
revoke all on function private.guard_pending_email_duplicate() from public, anon, authenticated;

comment on index public.jobs_email_dedupe_upsert_unique is
 'Full unique index supports PostgREST ON CONFLICT inference; retain the partial jobs_email_dedupe_unique for SQL callers naming its predicate.';
comment on index public.jobs_email_dedupe_unique is
 'Partial dedupe index retained for SQL callers with an explicit conflict predicate; paired full index supports PostgREST upsert.';
-- Incident recovery in the earlier migration intentionally cancelled only
-- maturity_choice_confirmed duplicates and reservation_created stale notices.
commit;
