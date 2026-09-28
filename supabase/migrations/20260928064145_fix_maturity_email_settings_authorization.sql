begin;

drop function public.update_maturity_email_settings(text[],boolean,uuid);
create function public.update_maturity_email_settings(p_admin_id uuid, p_contacts text[], p_enabled boolean, p_request_id uuid, p_admin_aal2 boolean)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_actor uuid := p_admin_id;
  v_contacts text[];
begin
  if v_actor is null or not private.is_admin(v_actor)
    or not coalesce(p_admin_aal2, false) then
    raise exception using errcode = '42501', message = 'active administrator AAL2 required';
  end if;
  if p_enabled is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'settings input is incomplete';
  end if;
  select coalesce(array_agg(email order by first_position), '{}') into v_contacts
  from (
    select lower(trim(email)) email, min(ordinality) first_position
    from unnest(coalesce(p_contacts, '{}')) with ordinality as x(email, ordinality)
    where trim(email) <> ''
    group by lower(trim(email))
  ) distinct_contacts;
  if cardinality(v_contacts) > 10 or (p_enabled and cardinality(v_contacts) = 0)
    or exists (select 1 from unnest(v_contacts) email
      where email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$') then
    raise exception using errcode = '22023', message = 'invalid maturity email contacts';
  end if;
  update public.maturity_email_settings
  set contacts = v_contacts, enabled = p_enabled, revision = revision + 1,
      updated_at = now(), updated_by = v_actor
  where id = true;
  if not found then raise exception 'maturity email settings missing'; end if;
  insert into public.audit_events(actor_id,action,entity_type,request_id,metadata)
  values(v_actor,'maturity_email_settings.updated','maturity_email_settings',p_request_id,
    jsonb_build_object('enabled',p_enabled,'contact_count',cardinality(v_contacts)));
end;
$$;
revoke all on function public.update_maturity_email_settings(uuid,text[],boolean,uuid,boolean) from public, anon, authenticated;
grant execute on function public.update_maturity_email_settings(uuid,text[],boolean,uuid,boolean) to service_role;

-- Keep To/CC de-duplication case-insensitive even if the recipient's stored
-- email retains its original casing.
create or replace function public.fan_out_maturity_email(p_job_id uuid, p_action_url text)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_job public.jobs%rowtype;
  v_investor uuid;
  v_settings public.maturity_email_settings%rowtype;
  v_count integer := 0;
begin
  select * into v_job from public.jobs where id = p_job_id and kind = 'send_email' for update;
  if not found or v_job.entity_type <> 'investment'
    or v_job.payload->>'template' not in ('maturity_notice','maturity_choice_confirmed','maturity_action_needed','maturity_fulfilled') then
    raise exception using errcode = '22023', message = 'invalid maturity email job';
  end if;
  select investor_id into v_investor from public.investments where id = v_job.entity_id;
  if v_investor is null then raise exception using errcode = '22023', message = 'investment recipient missing'; end if;
  select * into v_settings from public.maturity_email_settings where id = true;
  if not found then raise exception 'maturity email settings missing'; end if;
  with recipients as (
    select id,email,row_number() over (order by is_primary desc,created_at,id) as ordinal
    from public.account_emails where user_id = v_investor and verified_at is not null
  ), inserted as (
    insert into public.jobs(kind,entity_type,entity_id,payload,email_dedupe_key)
    select 'send_email','investment',v_job.entity_id,
      jsonb_build_object('template',v_job.payload->>'template','to',r.email,
        'accountEmailId',r.id,'actionUrl',p_action_url,
        'idempotencyKey','job-'||v_job.id||'-'||r.id,
        'routing',jsonb_build_object('revision',v_settings.revision,
          'replyTo',case when v_settings.enabled then to_jsonb(v_settings.contacts) else '[]'::jsonb end,
          'cc',case when v_settings.enabled and r.ordinal=1 then
            to_jsonb(array(select c from unnest(v_settings.contacts) c where c <> lower(r.email)))
            else '[]'::jsonb end,
          'teamCopySelected',v_settings.enabled and r.ordinal=1)),
      v_job.id||':'||r.id
    from recipients r
    on conflict (email_dedupe_key) where kind = 'send_email' and email_dedupe_key is not null do nothing
    returning id
  ) select count(*) into v_count from inserted;
  if not exists(select 1 from public.account_emails where user_id=v_investor and verified_at is not null) then
    raise exception using errcode = '22023', message = 'investment recipient missing';
  end if;
  return v_count;
end;
$$;

-- Only service-role calls can resolve a missed CC after manual follow-up.
create function public.resolve_maturity_cc_review(p_admin_id uuid, p_job_id uuid, p_admin_aal2 boolean, p_request_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not private.is_admin(p_admin_id) or not coalesce(p_admin_aal2,false) then
    raise exception using errcode = '42501', message = 'active administrator AAL2 required';
  end if;
  update public.jobs set cc_review_required = false
  where id = p_job_id and cc_review_required = true;
  if not found then raise exception using errcode = 'P0002', message = 'CC review job not found'; end if;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,request_id)
  values(p_admin_id,'job.maturity_cc_review_resolved','job',p_job_id,p_request_id);
end;
$$;
revoke all on function public.resolve_maturity_cc_review(uuid,uuid,boolean,uuid) from public, anon, authenticated;
grant execute on function public.resolve_maturity_cc_review(uuid,uuid,boolean,uuid) to service_role;

commit;
