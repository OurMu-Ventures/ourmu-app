begin;

create table public.maturity_email_settings (
  id boolean primary key default true check (id),
  contacts text[] not null default '{}',
  enabled boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  constraint maturity_email_contacts_required check (not enabled or cardinality(contacts) > 0)
);
insert into public.maturity_email_settings (id, contacts, enabled)
values (true, array['ssebudde@ourmu.co','bwojji@ourmu.co','tushabe@ourmu.co'], false);
alter table public.maturity_email_settings enable row level security;
revoke all on public.maturity_email_settings from public, anon, authenticated;
grant select on public.maturity_email_settings to authenticated;
grant all on public.maturity_email_settings to service_role;
create policy maturity_email_settings_admin_read on public.maturity_email_settings
  for select to authenticated using (private.is_admin());

-- The row lock, revision update and audit entry are one transaction.
create function public.update_maturity_email_settings(p_contacts text[], p_enabled boolean, p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_contacts text[];
  v_id uuid;
begin
  if v_actor is null or not private.is_admin(v_actor)
    or (auth.jwt()->>'aal') is distinct from 'aal2' then
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
  where id = true returning updated_by into v_id;
  if not found then raise exception 'maturity email settings missing'; end if;
  insert into public.audit_events(actor_id,action,entity_type,request_id,metadata)
  values(v_actor,'maturity_email_settings.updated','maturity_email_settings',p_request_id,
    jsonb_build_object('enabled',p_enabled,'contact_count',cardinality(v_contacts)));
end;
$$;
revoke all on function public.update_maturity_email_settings(text[],boolean,uuid) from public, anon;
grant execute on function public.update_maturity_email_settings(text[],boolean,uuid) to authenticated;

alter table public.jobs add column cc_review_required boolean not null default false;

-- Called only for maturity templates. Database selection and child insertion
-- share a transaction, so concurrent workers cannot choose different CC rows.
create function public.fan_out_maturity_email(p_job_id uuid, p_action_url text)
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
            to_jsonb(array(select c from unnest(v_settings.contacts) c where c <> r.email))
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
revoke all on function public.fan_out_maturity_email(uuid,text) from public, anon, authenticated;
grant execute on function public.fan_out_maturity_email(uuid,text) to service_role;

commit;
