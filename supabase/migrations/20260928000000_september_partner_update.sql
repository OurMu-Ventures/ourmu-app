begin;

create or replace function private.guard_investment_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_setting('ourmu.september_import_correction', true) =
      '8294d9ae9efb07c90fb27af79f3db98ccecc04d0b6c554207c4e58cf728e12a0'
    and old.id = '73a7f123-cdb8-5359-9075-f36604131850'::uuid
    and old.record_origin = 'legacy_import'
    and old.principal_ugx = 16250000
    and new.principal_ugx = 12500000
    and new.projected_return_ugx = 3750000
    and new.projected_value_ugx = 16250000
    and row(new.investor_id, new.cycle_id, new.unit_price_ugx, new.projected_return_bps,
      new.maturity_date, new.reservation_expires_at, new.status, new.record_origin,
      new.import_batch_id, new.legacy_partner_id, new.source_sheet, new.source_row,
      new.source_key, new.payout_basis, new.reported_return_ugx, new.reported_payout_ugx) is not distinct from
    row(old.investor_id, old.cycle_id, old.unit_price_ugx, old.projected_return_bps,
      old.maturity_date, old.reservation_expires_at, old.status, old.record_origin,
      old.import_batch_id, old.legacy_partner_id, old.source_sheet, old.source_row,
      old.source_key, old.payout_basis, old.reported_return_ugx, old.reported_payout_ugx) then
    return new;
  end if;
  if old.record_origin = 'legacy_import' and old.investor_id is null and new.investor_id is not null
    and row(new.cycle_id, new.unit_price_ugx, new.principal_ugx, new.projected_return_bps,
      new.projected_return_ugx, new.projected_value_ugx, new.maturity_date,
      new.reservation_expires_at, new.record_origin, new.import_batch_id, new.legacy_partner_id,
      new.source_sheet, new.source_row, new.source_key, new.payout_basis,
      new.reported_return_ugx, new.reported_payout_ugx) is not distinct from
    row(old.cycle_id, old.unit_price_ugx, old.principal_ugx, old.projected_return_bps,
      old.projected_return_ugx, old.projected_value_ugx, old.maturity_date,
      old.reservation_expires_at, old.record_origin, old.import_batch_id, old.legacy_partner_id,
      old.source_sheet, old.source_row, old.source_key, old.payout_basis,
      old.reported_return_ugx, old.reported_payout_ugx) then
    return new;
  end if;
  if old.status in ('active', 'matured') and row(new.investor_id, new.cycle_id, new.unit_price_ugx,
    new.principal_ugx, new.projected_return_bps, new.projected_return_ugx, new.projected_value_ugx,
    new.maturity_date, new.reservation_expires_at, new.record_origin, new.import_batch_id,
    new.legacy_partner_id, new.source_sheet, new.source_row, new.source_key, new.payout_basis,
    new.reported_return_ugx, new.reported_payout_ugx) is distinct from
    row(old.investor_id, old.cycle_id, old.unit_price_ugx, old.principal_ugx,
    old.projected_return_bps, old.projected_return_ugx, old.projected_value_ugx, old.maturity_date,
    old.reservation_expires_at, old.record_origin, old.import_batch_id, old.legacy_partner_id,
    old.source_sheet, old.source_row, old.source_key, old.payout_basis, old.reported_return_ugx,
    old.reported_payout_ugx) then
    raise exception using errcode = '55000', message = 'activated investment terms are immutable';
  end if;
  return new;
end;
$$;

create or replace function public.apply_september_partner_update(
  p_admin_id uuid,
  p_manifest jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_batch_id uuid := (p_manifest->>'batch_id')::uuid;
  v_cycle_id constant uuid := 'f1ed41cd-7e87-5795-9943-605d64b1298e'::uuid;
  v_herbert_id constant uuid := '73a7f123-cdb8-5359-9075-f36604131850'::uuid;
  v_existing public.import_batches%rowtype;
  v_principal numeric(28,8);
  v_return numeric(28,8);
  v_payout numeric(28,8);
begin
  perform pg_advisory_xact_lock(hashtext('ourmu_partner_import'));
  if not private.is_admin(p_admin_id) then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;
  if p_manifest->>'source_sha256' <>
      '8294d9ae9efb07c90fb27af79f3db98ccecc04d0b6c554207c4e58cf728e12a0' then
    raise exception using errcode = '22023', message = 'source workbook checksum is not approved';
  end if;
  if jsonb_array_length(p_manifest->'profiles') <> 3
    or jsonb_array_length(p_manifest->'partners') <> 3
    or jsonb_array_length(p_manifest->'investments') <> 9 then
    raise exception using errcode = '22023', message = 'manifest record counts do not reconcile';
  end if;

  select * into v_existing from public.import_batches where id = v_batch_id;
  if found then
    if v_existing.status <> 'accepted' or v_existing.source_sha256 <> p_manifest->>'source_sha256' then
      raise exception using errcode = '23514', message = 'existing import batch is inconsistent';
    end if;
    return jsonb_build_object('batch_id', v_batch_id, 'already_applied', true);
  end if;

  if not exists (
    select 1 from public.investment_cycles
    where id = v_cycle_id and name = 'September 2026' and status = 'closed'
      and capacity_ugx = 250000000 and maturity_date = '2027-02-28'
  ) then
    raise exception using errcode = '23514', message = 'September cycle does not match the approved target';
  end if;
  if (select count(*) from public.investments
      where cycle_id = v_cycle_id and record_origin = 'legacy_import') <> 9
    or (select coalesce(sum(principal_ugx), 0) from public.investments
      where cycle_id = v_cycle_id and record_origin = 'legacy_import') <> 69180735 then
    raise exception using errcode = '23514', message = 'existing September snapshot has changed';
  end if;

  insert into public.import_batches (id, source_filename, source_sha256, status, partner_count,
    profile_count, unclaimed_count, cycle_count, investment_count, monthly_summary_count,
    principal_total_ugx, return_total_ugx, payout_total_ugx, staged_by, accepted_by, accepted_at)
  values (v_batch_id, p_manifest->>'source_filename', p_manifest->>'source_sha256', 'accepted',
    3, 3, 0, 0, 9, 0, 134079000, 40223700, 174302700,
    p_admin_id, p_admin_id, now());

  insert into public.profiles (id, role, access_status, legal_name, email, country,
    kyc_status, kyc_verified_at, import_batch_id)
  select (x->>'id')::uuid, 'investor', 'active', x->>'legal_name', lower(trim(x->>'email')),
    'Uganda', 'verified', now(), v_batch_id
  from jsonb_array_elements(p_manifest->'profiles') x;

  insert into public.legacy_partner_identities (id, import_batch_id, profile_id, canonical_name,
    normalized_email, source_aliases, source_rows)
  select (x->>'id')::uuid, v_batch_id, (x->>'profile_id')::uuid, x->>'canonical_name',
    lower(trim(x->>'email')), coalesce(x->'aliases', '[]'::jsonb),
    coalesce(x->'source_rows', '[]'::jsonb)
  from jsonb_array_elements(p_manifest->'partners') x;

  perform set_config('ourmu.september_import_correction', p_manifest->>'source_sha256', true);
  update public.investments
  set principal_ugx = 12500000,
      projected_return_ugx = 3750000,
      projected_value_ugx = 16250000
  where id = v_herbert_id and cycle_id = v_cycle_id and record_origin = 'legacy_import';
  if not found then
    raise exception using errcode = '23514', message = 'approved correction target is missing';
  end if;

  insert into public.investments (id, investor_id, cycle_id, unit_price_ugx, principal_ugx,
    projected_return_bps, projected_return_ugx, projected_value_ugx, maturity_date,
    reservation_expires_at, status, requested_at, activated_at, record_origin, import_batch_id,
    legacy_partner_id, source_sheet, source_row, source_key, payout_basis)
  select (x->>'id')::uuid, (x->>'investor_id')::uuid, v_cycle_id, 125000,
    (x->>'principal_ugx')::numeric, 3000, (x->>'return_ugx')::numeric,
    (x->>'payout_ugx')::numeric, '2027-02-28', null, 'active',
    '2026-09-01 00:00:00 Africa/Kampala'::timestamptz,
    '2026-09-01 00:00:00 Africa/Kampala'::timestamptz,
    'legacy_import', v_batch_id, (x->>'legacy_partner_id')::uuid,
    'September 2026', (x->>'source_row')::integer, x->>'source_key', 'projected'
  from jsonb_array_elements(p_manifest->'investments') x;

  select sum(principal_ugx), sum(projected_return_ugx), sum(projected_value_ugx)
  into v_principal, v_return, v_payout
  from public.investments
  where cycle_id = v_cycle_id and record_origin = 'legacy_import' and status = 'active';
  if (select count(*) from public.investments
      where cycle_id = v_cycle_id and record_origin = 'legacy_import' and status = 'active') <> 18
    or v_principal <> 199509735 or v_return <> 59852920.5 or v_payout <> 259362655.5 then
    raise exception using errcode = '23514', message = 'final September reconciliation failed';
  end if;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values (p_admin_id, 'partner_import.september_update_applied', 'import_batch', v_batch_id,
    p_request_id, jsonb_build_object('source_sha256', p_manifest->>'source_sha256',
      'profiles_created', 3, 'investments_added', 9, 'investments_corrected', 1,
      'cycle_investments', 18, 'cycle_principal_ugx', 199509735));

  return jsonb_build_object('batch_id', v_batch_id, 'profiles_created', 3,
    'investments_added', 9, 'investments_corrected', 1,
    'cycle_investments', 18, 'cycle_principal_ugx', v_principal,
    'cycle_return_ugx', v_return, 'cycle_payout_ugx', v_payout,
    'remaining_capacity_ugx', 250000000 - v_principal);
end;
$$;

revoke all on function public.apply_september_partner_update(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_september_partner_update(uuid, jsonb, uuid) to service_role;

commit;
