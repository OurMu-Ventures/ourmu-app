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

-- The original fan-out needs case-insensitive To/CC de-duplication.
do $$
declare v_definition text;
begin
  select pg_get_functiondef('public.fan_out_maturity_email(uuid,text)'::regprocedure) into v_definition;
  if position('where c <> r.email' in v_definition) = 0 then
    raise exception 'Expected CC comparison not found in fan-out function';
  end if;
  execute replace(v_definition, 'where c <> r.email', 'where c <> lower(r.email)');
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
