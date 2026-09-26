begin;

create table public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_key text not null unique check (campaign_key = 'partner_portal_welcome_2026'),
  status text not null default 'draft'
    check (status in ('draft', 'test_sent', 'released')),
  test_sent_at timestamptz,
  test_provider_message_id text,
  created_by uuid references public.profiles(id) on delete restrict,
  released_by uuid references public.profiles(id) on delete restrict,
  released_at timestamptz,
  recipient_count integer check (recipient_count is null or recipient_count >= 0),
  partner_count integer check (partner_count is null or partner_count >= 0),
  admin_count integer check (admin_count is null or admin_count >= 0),
  created_at timestamptz not null default now(),
  constraint email_campaign_state_shape check (
    (status = 'draft' and test_sent_at is null and released_at is null)
    or (status = 'test_sent' and test_sent_at is not null and released_at is null)
    or (status = 'released' and test_sent_at is not null and released_at is not null
      and recipient_count is not null and partner_count is not null and admin_count is not null)
  )
);

alter table public.email_campaigns enable row level security;
create policy email_campaigns_admin_read on public.email_campaigns
  for select to authenticated using (private.is_admin());
revoke all on public.email_campaigns from public, anon, authenticated;
grant select on public.email_campaigns to authenticated;
grant all on public.email_campaigns to service_role;

create or replace function public.mark_partner_portal_welcome_test_sent(
  p_admin_id uuid,
  p_provider_message_id text,
  p_admin_aal2 boolean,
  p_request_id uuid
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_campaign_id uuid;
begin
  if not private.is_admin(p_admin_id) or not p_admin_aal2 then
    raise exception using errcode = '42501', message = 'active administrator MFA required';
  end if;
  if coalesce(trim(p_provider_message_id), '') = '' then
    raise exception using errcode = '22023', message = 'provider message id is required';
  end if;
  insert into public.email_campaigns (campaign_key, status, test_sent_at,
    test_provider_message_id, created_by)
  values ('partner_portal_welcome_2026', 'test_sent', now(), p_provider_message_id, p_admin_id)
  on conflict (campaign_key) do update
    set status = 'test_sent', test_sent_at = now(),
      test_provider_message_id = excluded.test_provider_message_id
    where public.email_campaigns.status = 'draft'
  returning id into v_campaign_id;
  if v_campaign_id is null then
    raise exception using errcode = '55000', message = 'campaign test already recorded or campaign released';
  end if;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_admin_id, 'email_campaign.test_sent', 'email_campaign', v_campaign_id, p_request_id,
    jsonb_build_object('campaign_key', 'partner_portal_welcome_2026'));
  return v_campaign_id;
end;
$$;

create or replace function public.release_partner_portal_welcome_campaign(
  p_admin_id uuid,
  p_admin_aal2 boolean,
  p_expected_count integer,
  p_request_id uuid
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_campaign public.email_campaigns%rowtype;
  v_total integer;
  v_partners integer;
  v_admins integer;
  v_queued integer;
begin
  if not private.is_admin(p_admin_id) or not p_admin_aal2 then
    raise exception using errcode = '42501', message = 'active administrator MFA required';
  end if;
  select * into v_campaign from public.email_campaigns
    where campaign_key = 'partner_portal_welcome_2026' for update;
  if not found or v_campaign.status <> 'test_sent' then
    raise exception using errcode = '55000', message = 'send and record a test before release';
  end if;

  select count(*)::integer,
    count(*) filter (where p.role = 'investor')::integer,
    count(*) filter (where p.role = 'admin')::integer
  into v_total, v_partners, v_admins
  from public.account_emails ae
  join public.profiles p on p.id = ae.user_id
  where ae.is_primary and ae.verified_at is not null
    and p.access_status = 'active' and p.is_test = false
    and p.role in ('investor', 'admin');
  if v_total = 0 or v_total <> p_expected_count then
    raise exception using errcode = '40001', message = 'recipient count changed; refresh campaign preview';
  end if;

  insert into public.jobs (kind, entity_type, entity_id, payload, email_dedupe_key)
  select 'send_email', 'email_campaign', v_campaign.id,
    jsonb_build_object(
      'to', ae.email,
      'template', 'portal_announcement',
      'idempotencyKey', 'ourmu-portal-launch-v1-' || md5(lower(ae.email))
    ),
    'ourmu-portal-launch-v1:' || md5(lower(ae.email))
  from public.account_emails ae
  join public.profiles p on p.id = ae.user_id
  where ae.is_primary and ae.verified_at is not null
    and p.access_status = 'active' and p.is_test = false
    and p.role in ('investor', 'admin');
  get diagnostics v_queued = row_count;
  if v_queued <> v_total then
    raise exception using errcode = '23505', message = 'one or more campaign jobs already exist';
  end if;

  update public.email_campaigns set status = 'released', released_by = p_admin_id,
    released_at = now(), recipient_count = v_total, partner_count = v_partners,
    admin_count = v_admins
  where id = v_campaign.id;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_admin_id, 'email_campaign.released', 'email_campaign', v_campaign.id, p_request_id,
    jsonb_build_object('recipient_count', v_total, 'partner_count', v_partners,
      'admin_count', v_admins, 'campaign_key', 'partner_portal_welcome_2026'));
  return jsonb_build_object('campaign_id', v_campaign.id, 'recipient_count', v_total,
    'partner_count', v_partners, 'admin_count', v_admins);
end;
$$;

revoke all on function public.mark_partner_portal_welcome_test_sent(uuid, text, boolean, uuid)
  from public, anon, authenticated;
revoke all on function public.release_partner_portal_welcome_campaign(uuid, boolean, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.mark_partner_portal_welcome_test_sent(uuid, text, boolean, uuid)
  to service_role;
grant execute on function public.release_partner_portal_welcome_campaign(uuid, boolean, integer, uuid)
  to service_role;

commit;
