begin;

-- Encryption happens in the authenticated production server action. Only the
-- envelope enters PostgreSQL; the account reference is never an RPC argument.
create function public.save_admin_maturity_payout_destination(
  p_admin_id uuid, p_admin_aal2 boolean, p_instruction_id uuid,
  p_request_id uuid, p_verification_method text, p_reference_source text,
  p_expected_profile_updated_at timestamptz, p_destination jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_instruction public.maturity_instructions%rowtype;
  v_destination public.payout_destinations%rowtype;
  v_profile public.profiles%rowtype;
  v_channel public.payout_channel;
  v_fingerprint bytea;
  v_ciphertext bytea;
  v_iv bytea;
  v_tag bytea;
  v_destination_id uuid;
  v_needs_resolution boolean;
begin
  if private.is_admin(p_admin_id) is distinct from true or p_admin_aal2 is distinct from true then
    raise exception using errcode='42501', message='Active administrator two-factor authentication required';
  end if;
  if p_verification_method is null or p_verification_method not in ('phone','email','in_person')
    or p_reference_source is null or p_reference_source not in ('manual','profile_phone') then
    raise exception using errcode='22023', message='Verification method and account reference source are required';
  end if;
  select * into v_instruction from public.maturity_instructions where id=p_instruction_id for update;
  if not found or v_instruction.status <> 'requested' or v_instruction.projected_payout_ugx <= 0 then
    raise exception using errcode='23514', message='Only a pending, unlocked payout request can receive a destination';
  end if;
  if not exists(select 1 from public.investments where id=v_instruction.investment_id
    and investor_id=v_instruction.investor_id and status='matured' and payout_basis <> 'reported_paid') then
    raise exception using errcode='23514', message='The source investment is not awaiting settlement';
  end if;
  select * into v_profile from public.profiles where id=v_instruction.investor_id for update;
  if not found or v_profile.access_status <> 'active' then
    raise exception using errcode='23514', message='The partner account is unavailable';
  end if;
  v_channel := (p_destination->>'channel')::public.payout_channel;
  if p_reference_source='profile_phone' and (v_channel is distinct from 'mobile_money'
    or p_expected_profile_updated_at is null or v_profile.updated_at is distinct from p_expected_profile_updated_at
    or nullif(trim(v_profile.phone),'') is null) then
    raise exception using errcode='23514', message='The phone on file changed or is unavailable; refresh and verify it again';
  end if;
  v_ciphertext := (p_destination->>'account_ref_ciphertext')::bytea;
  v_iv := (p_destination->>'account_ref_iv')::bytea;
  v_tag := (p_destination->>'account_ref_auth_tag')::bytea;
  v_fingerprint := (p_destination->>'account_ref_fingerprint')::bytea;
  if v_channel is null or coalesce(length(trim(p_destination->>'provider_label')),0) not between 2 and 80
    or coalesce(length(trim(p_destination->>'account_name')),0) not between 3 and 120
    or coalesce(octet_length(v_ciphertext),0) not between 3 and 64
    or coalesce(octet_length(v_iv),0) <> 12 or coalesce(octet_length(v_tag),0) <> 16
    or coalesce(octet_length(v_fingerprint),0) <> 32
    or coalesce(length(p_destination->>'account_last_four'),0) not between 1 and 4
    or (p_destination->>'key_version')::smallint is distinct from 1 then
    raise exception using errcode='22023', message='A complete encrypted payout destination is required';
  end if;
  select * into v_destination from public.payout_destinations
    where investor_id=v_instruction.investor_id and account_ref_fingerprint=v_fingerprint for update;
  if found then
    if not v_destination.is_active or v_destination.channel <> v_channel
      or v_destination.provider_label <> trim(p_destination->>'provider_label')
      or v_destination.account_name <> trim(p_destination->>'account_name') then
      raise exception using errcode='23514', message='This account reference already has different or inactive destination details';
    end if;
    v_destination_id := v_destination.id;
  end if;
  if v_instruction.payout_destination_id is not null then
    if v_instruction.payout_destination_id is distinct from v_destination_id then
      raise exception using errcode='23514', message='This request already has a payout destination; it cannot be replaced here';
    end if;
    return jsonb_build_object('destination_id',v_destination_id,'needs_resolution',v_instruction.needs_resolution);
  end if;
  if v_destination_id is null then
    insert into public.payout_destinations(investor_id,channel,provider_label,account_name,
      account_ref_ciphertext,account_ref_iv,account_ref_auth_tag,account_ref_fingerprint,account_last_four,key_version)
    values(v_instruction.investor_id,v_channel,trim(p_destination->>'provider_label'),trim(p_destination->>'account_name'),
      v_ciphertext,v_iv,v_tag,v_fingerprint,p_destination->>'account_last_four',1)
    returning id into v_destination_id;
  end if;
  -- Resolve only a documented missing-destination hold. Do not dismiss a
  -- fulfillment hold, or an unexplained hold, as a side effect of setup.
  v_needs_resolution := v_instruction.needs_resolution;
  if v_needs_resolution
    and exists(select 1 from public.audit_events where entity_id=v_instruction.id
      and entity_type='maturity_instruction'
      and (metadata->>'payout_destination_setup_pending'='true'
        or metadata->>'encrypted_destination_setup_pending'='true'))
    and not exists(select 1 from public.audit_events where entity_id=v_instruction.id
      and entity_type='maturity_instruction' and action='maturity_instruction.held') then
    v_needs_resolution := false;
  end if;
  update public.maturity_instructions set payout_destination_id=v_destination_id,
    destination_confirmed=true,destination_verified=true,destination_verified_at=now(),
    needs_resolution=v_needs_resolution,
    resolution_notes=concat_ws(E'\n',nullif(resolution_notes,''),
      'Payout destination setup completed and verified offline by an administrator. No payment or reinvestment was executed by this action.')
    where id=v_instruction.id;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,request_id,metadata)
  values(p_admin_id,'maturity_instruction.payout_destination_saved','maturity_instruction',v_instruction.id,p_request_id,
    jsonb_build_object('destination_id',v_destination_id,'verification_method',p_verification_method,
      'reference_source',p_reference_source,'offline_verified',true,'remaining_resolution_hold',v_needs_resolution));
  return jsonb_build_object('destination_id',v_destination_id,'needs_resolution',v_needs_resolution);
end;
$$;
revoke all on function public.save_admin_maturity_payout_destination(uuid,boolean,uuid,uuid,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.save_admin_maturity_payout_destination(uuid,boolean,uuid,uuid,text,text,timestamptz,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
