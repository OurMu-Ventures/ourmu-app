begin;

do $$
declare
  v_admin_id constant uuid := '5d1144ee-1a1d-420a-a5e0-4c1de479c8f4'::uuid;
  v_aaron_id constant uuid := 'b8c21802-4e87-424e-8fc3-1124e78c0e5f'::uuid;
  v_aaron_partner_id constant uuid := '3a6bc729-0c39-5fbf-831e-99a64044c3d3'::uuid;
  v_selebera_id constant uuid := '3ef92476-8bcb-4546-98b4-193010fc3ad4'::uuid;
  v_selebera_partner_id constant uuid := '4275ff74-7bfd-5033-982c-227ca2d4d792'::uuid;
  v_eleanor_id constant uuid := '4511c5a3-2ba0-4c6e-8bc3-a414dabd1c72'::uuid;
  v_eleanor_partner_id constant uuid := '68e43939-baad-5917-8e6e-a00d64d24a93'::uuid;
  v_july_cycle_id constant uuid := '625421a7-06de-57c8-857e-ccae50bd018e'::uuid;
  v_batch_id constant uuid := 'bf3ad5aa-a1d0-4336-99dd-86e64a7f115e'::uuid;
  v_eleanor_investment_id constant uuid := 'e97e49c6-affc-4923-8c5f-e3cd157a4351'::uuid;
  v_request_id constant uuid := 'de651f35-8e51-4387-9b02-0397fa388452'::uuid;
  v_source_sha constant text := '4c90614f05a04acdf6e7fb49a1e4a46320dd40eb2c855cfbb22f65c1f2ab2013';
  v_reassignment_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('ourmu_partner_import'));
  lock table public.investments in access exclusive mode;

  -- Fresh local/CI databases intentionally contain no production import data.
  if not exists (
    select 1 from public.investments
    where id = '43eed86a-cbd5-5a62-9aff-88b5f5260862'::uuid
  ) then
    raise notice 'Skipping production correction because the source import is absent';
    return;
  end if;

  if not private.is_admin(v_admin_id) then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = v_selebera_id and access_status = 'active' and kyc_status = 'verified'
  ) or not exists (
    select 1 from public.legacy_partner_identities
    where id = v_selebera_partner_id and profile_id = v_selebera_id
  ) then
    raise exception using errcode = '23514', message = 'destination partner identity is not eligible';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = v_eleanor_id and access_status = 'active' and kyc_status = 'verified'
  ) or not exists (
    select 1 from public.legacy_partner_identities
    where id = v_eleanor_partner_id and profile_id = v_eleanor_id
  ) then
    raise exception using errcode = '23514', message = 'July investment owner is not eligible';
  end if;
  if not exists (
    select 1 from public.investment_cycles
    where id = v_july_cycle_id and name = 'July 2026' and status = 'closed'
      and maturity_date = '2026-12-31' and record_origin = 'legacy_import'
  ) then
    raise exception using errcode = '23514', message = 'July cycle does not match the approved target';
  end if;
  if (select count(*) from public.investments
      where ((id = '43eed86a-cbd5-5a62-9aff-88b5f5260862'::uuid
          and cycle_id = '38474a4f-8ebc-5791-b318-9af1f39fbbad'::uuid
          and principal_ugx = 10000000 and status = 'matured')
        or (id = '4777be66-ae4c-516a-a6e9-9394f0d5039e'::uuid
          and cycle_id = '6c7ed234-4775-5970-8a5e-1fa322e46b16'::uuid
          and principal_ugx = 8500000 and status = 'active'))
        and investor_id = v_aaron_id and legacy_partner_id = v_aaron_partner_id
        and record_origin = 'legacy_import') <> 2 then
    raise exception using errcode = '23514', message = 'reassignment targets have changed';
  end if;
  if exists (
    select 1 from public.import_batches where id = v_batch_id or source_sha256 = v_source_sha
  ) or exists (
    select 1 from public.investments where id = v_eleanor_investment_id
      or source_key = 'a13d4ee84c582e5100a01fc4f49697608fc63e271de426121a232d9fa1127980'
  ) then
    raise exception using errcode = '23505', message = 'correction has already been applied';
  end if;

  insert into public.import_batches (id, source_filename, source_sha256, status, partner_count,
    profile_count, unclaimed_count, cycle_count, investment_count, monthly_summary_count,
    principal_total_ugx, return_total_ugx, payout_total_ugx, staged_by, accepted_by, accepted_at)
  values (v_batch_id, 'Approved production correction 2026-09-26', v_source_sha, 'accepted',
    0, 0, 0, 0, 1, 0, 1505964, 451789.20, 1957753.20,
    v_admin_id, v_admin_id, now());

  drop trigger investment_immutable_guard on public.investments;

  update public.investments
  set investor_id = v_selebera_id,
      legacy_partner_id = v_selebera_partner_id
  where id in (
    '43eed86a-cbd5-5a62-9aff-88b5f5260862'::uuid,
    '4777be66-ae4c-516a-a6e9-9394f0d5039e'::uuid
  ) and investor_id = v_aaron_id and legacy_partner_id = v_aaron_partner_id;
  get diagnostics v_reassignment_count = row_count;
  if v_reassignment_count <> 2 then
    raise exception using errcode = '23514', message = 'expected two investments to be reassigned';
  end if;

  insert into public.investments (id, investor_id, cycle_id, unit_price_ugx, principal_ugx,
    projected_return_bps, projected_return_ugx, projected_value_ugx, maturity_date,
    reservation_expires_at, status, requested_at, activated_at, record_origin, import_batch_id,
    legacy_partner_id, source_sheet, source_row, source_key, payout_basis)
  values (v_eleanor_investment_id, v_eleanor_id, v_july_cycle_id, 125000, 1505964,
    3000, 451789.20, 1957753.20, '2026-12-31', null, 'active',
    '2026-07-01 00:00:00 Africa/Kampala'::timestamptz,
    '2026-07-01 00:00:00 Africa/Kampala'::timestamptz,
    'legacy_import', v_batch_id, v_eleanor_partner_id,
    'Manual correction 2026-09-26', 2,
    'a13d4ee84c582e5100a01fc4f49697608fc63e271de426121a232d9fa1127980',
    'projected');

  create trigger investment_immutable_guard before update on public.investments
    for each row execute function private.guard_investment_immutable();

  if (select count(*) from public.investments
      where id in ('43eed86a-cbd5-5a62-9aff-88b5f5260862'::uuid,
        '4777be66-ae4c-516a-a6e9-9394f0d5039e'::uuid)
        and investor_id = v_selebera_id and legacy_partner_id = v_selebera_partner_id) <> 2
    or not exists (
      select 1 from public.investments
      where id = v_eleanor_investment_id and investor_id = v_eleanor_id
        and legacy_partner_id = v_eleanor_partner_id and cycle_id = v_july_cycle_id
        and principal_ugx = 1505964 and projected_return_ugx = 451789.20
        and projected_value_ugx = 1957753.20 and status = 'active'
    ) then
    raise exception using errcode = '23514', message = 'post-correction reconciliation failed';
  end if;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, request_id, metadata)
  values
    (v_admin_id, 'legacy_investments.reassigned', 'profile', v_selebera_id, v_request_id,
      jsonb_build_object('from_profile_id', v_aaron_id, 'to_profile_id', v_selebera_id,
        'investment_count', 2, 'principal_total_ugx', 18500000)),
    (v_admin_id, 'legacy_investment.added', 'investment', v_eleanor_investment_id, v_request_id,
      jsonb_build_object('import_batch_id', v_batch_id, 'cycle_id', v_july_cycle_id,
        'principal_ugx', 1505964, 'projected_return_ugx', 451789.20,
        'projected_value_ugx', 1957753.20));
end;
$$;

commit;
