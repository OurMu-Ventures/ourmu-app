-- Only the trusted server may call these RPCs. Keep private outside PostgREST.
-- SECURITY INVOKER retains service_role's existing table privileges and RLS behavior.
create function public.submit_partner_application(
  p_token_hash bytea, p_application jsonb, p_identity jsonb
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_invitation public.application_invitations%rowtype;
  v_id uuid := (p_application->>'id')::uuid;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_invitation from public.application_invitations
    where token_hash = p_token_hash for update;
  if not found or v_invitation.used_at is not null or v_invitation.revoked_at is not null
    or v_invitation.expires_at <= clock_timestamp()
    or v_invitation.invited_email is distinct from p_application->>'email' then
    raise exception 'Application link unavailable' using errcode = 'P0001';
  end if;
  insert into public.investor_applications
    (id, invitation_id, legal_name, email, phone, date_of_birth, address, district,
     country, privacy_policy_version, privacy_consented_at)
  values (v_id, v_invitation.id, p_application->>'legal_name', p_application->>'email',
    p_application->>'phone', (p_application->>'date_of_birth')::date,
    p_application->>'address', p_application->>'district', p_application->>'country',
    p_application->>'privacy_policy_version', v_now);
  insert into private.investor_identities
    (application_id, nin_ciphertext, nin_iv, nin_auth_tag, nin_fingerprint, nin_last_four, key_version)
  values (v_id, (p_identity->>'nin_ciphertext')::bytea, (p_identity->>'nin_iv')::bytea,
    (p_identity->>'nin_auth_tag')::bytea, (p_identity->>'nin_fingerprint')::bytea,
    p_identity->>'nin_last_four', (p_identity->>'key_version')::smallint);
  update public.application_invitations set used_at = v_now where id = v_invitation.id;
end;
$$;
revoke all on function public.submit_partner_application(bytea,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.submit_partner_application(bytea,jsonb,jsonb) to service_role;

create function public.review_partner_application(
  p_application_id uuid, p_admin_id uuid, p_decision text,
  p_user_id uuid, p_reference text, p_notes text
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_application public.investor_applications%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if private.is_admin(p_admin_id) is distinct from true or nullif(trim(p_reference), '') is null then
    raise exception 'Invalid application reviewer or reference';
  end if;
  select * into v_application from public.investor_applications
    where id = p_application_id for update;
  if not found or v_application.status <> 'submitted' then
    raise exception 'Application is not awaiting review';
  end if;
  if p_decision = 'approved' and p_user_id is not null then
    update private.investor_identities set user_id = p_user_id
      where application_id = p_application_id and erased_at is null;
  elsif p_decision = 'rejected' then
    update private.investor_identities set nin_ciphertext = null, nin_iv = null,
      nin_auth_tag = null, nin_fingerprint = null, erased_at = v_now
      where application_id = p_application_id and erased_at is null;
  else
    raise exception 'Invalid application decision';
  end if;
  if not found then raise exception 'Application identity unavailable'; end if;
  update public.investor_applications set
    status = p_decision::public.application_status,
    auth_user_id = case when p_decision = 'approved' then p_user_id else auth_user_id end,
    kyc_verification_reference = p_reference, kyc_notes = p_notes,
    reviewed_by = p_admin_id, reviewed_at = v_now
    where id = p_application_id;
end;
$$;
revoke all on function public.review_partner_application(uuid,uuid,text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.review_partner_application(uuid,uuid,text,uuid,text,text) to service_role;
