-- Run only after the imported-maturity investor pages are live. This queues
-- one parent notice for each linked September 2026 imported placement with a
-- verified recipient; the existing worker fans out to verified account emails.
-- The unmatched sixteenth placement is deliberately excluded.
begin;

do $$
declare
  v_eligible integer;
  v_inserted integer;
begin
  select count(*) into v_eligible
  from public.investments i
  where i.maturity_date = date '2026-09-30'
    and i.status = 'matured'
    and i.record_origin = 'legacy_import'
    and i.investor_id is not null
    and exists (
      select 1 from public.account_emails e
      where e.user_id = i.investor_id and e.verified_at is not null
    )
    and not exists (
      select 1 from public.jobs j
      where j.kind = 'send_email' and j.entity_type = 'investment'
        and j.entity_id = i.id and j.payload->>'template' = 'maturity_notice'
    );
  if v_eligible <> 15 then
    raise exception 'Expected 15 eligible, unsent maturity notices; found %', v_eligible;
  end if;

  with queued as (
    insert into public.jobs (kind, entity_type, entity_id, payload)
    select 'send_email', 'investment', i.id,
      jsonb_build_object('template', 'maturity_notice')
    from public.investments i
    where i.maturity_date = date '2026-09-30'
      and i.status = 'matured'
      and i.record_origin = 'legacy_import'
      and i.investor_id is not null
      and exists (
        select 1 from public.account_emails e
        where e.user_id = i.investor_id and e.verified_at is not null
      )
      and not exists (
        select 1 from public.jobs j
        where j.kind = 'send_email' and j.entity_type = 'investment'
          and j.entity_id = i.id and j.payload->>'template' = 'maturity_notice'
      )
    returning id
  ) select count(*) into v_inserted from queued;
  if v_inserted <> 15 then
    raise exception 'Expected to queue 15 maturity notices; queued %', v_inserted;
  end if;
end;
$$;

commit;
