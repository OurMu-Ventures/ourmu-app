begin;

-- Import-batch status is operational metadata. Investors must not be able to
-- browse batches, but their own imported rows need a safe way to establish
-- that the batch was accepted. This function is deliberately in the private
-- schema and has no arguments derived from user-controlled row data except the
-- row's foreign key.
create or replace function private.is_accepted_import_batch(check_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.import_batches batch
    where batch.id = check_batch_id
      and batch.status = 'accepted'
  );
$$;

revoke all on function private.is_accepted_import_batch(uuid) from public, anon;
grant execute on function private.is_accepted_import_batch(uuid) to authenticated, service_role;

drop policy investments_self_read on public.investments;
create policy investments_self_read on public.investments
for select to authenticated
using (
  investor_id = (select auth.uid())
  and (
    record_origin = 'portal'
    or private.is_accepted_import_batch(import_batch_id)
  )
);

drop policy legacy_partners_self_read on public.legacy_partner_identities;
create policy legacy_partners_self_read on public.legacy_partner_identities
for select to authenticated
using (
  profile_id = (select auth.uid())
  and private.is_accepted_import_batch(import_batch_id)
);

-- Imported investors start with KYC pending. They may read the cycle records
-- that belong to their own placements without gaining access to other cycles.
create policy cycles_investor_history_read on public.investment_cycles
for select to authenticated
using (
  exists (
    select 1
    from public.investments investment
    where investment.cycle_id = investment_cycles.id
      and investment.investor_id = (select auth.uid())
  )
);

commit;
