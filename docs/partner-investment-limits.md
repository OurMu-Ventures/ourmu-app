# Partner investment limits

Partners use UGX 50,000,000 per cycle unless their profile has a higher override.
The minimum remains UGX 125,000. Reserved and active placements count together,
including claimed legacy investments. Cycle capacity remains an independent limit.
Overrides apply immediately to new placements in all cycles and persist until changed.

Management has no UI. Use the SQL editor as a trusted operator or the backend
service-role client. Never expose the service key to browsers. The function requires
an active administrator ID, investor profile ID, reason and fresh request UUID;
it records every change in `audit_events`. Clients cannot write profile limits.

```sql
-- Replace the IDs with verified administrator and partner profile IDs.
-- Set UGX 100 million:
select public.set_partner_investment_limit(
  'PARTNER_UUID', 'ADMIN_UUID', 100000000,
  'Approved partner investment exception', gen_random_uuid());

-- Change to UGX 150 million:
select public.set_partner_investment_limit(
  'PARTNER_UUID', 'ADMIN_UUID', 150000000,
  'Approved increased allocation', gen_random_uuid());

-- Clear the override and return to UGX 50 million:
select public.set_partner_investment_limit(
  'PARTNER_UUID', 'ADMIN_UUID', null,
  'Exception ended', gen_random_uuid());
```

Values must exceed UGX 50 million and have at most two decimal places.
Clearing or reducing an override preserves existing reservations and investments,
including their later activation; new placements are blocked if cumulative
principal already exceeds the revised cap. Reinvestment uses the effective limit
at fulfillment time and retains the existing hold behavior when limits are exceeded.

## Rollout

After PR approval and merge, apply the migration before deploying the application.
No overrides are seeded. The existing form displays the effective maximum;
server validation and transactional database checks independently enforce it.
Unclaimed legacy identities require a linked investor profile before receiving an override.

## Local verification

Run `npm run check` and `supabase test db` against a migrated local database.
For race tests, prepare a disposable schema database named
`ourmu_partner_limits_test` in `supabase_db_ourmu-app`, apply the migration,
then run `node scripts/test-partner-limit-concurrency.mjs`. The script clones
that database, uses synthetic fixtures, and removes its clone afterward.
It checks cumulative partner caps, shared cycle capacity and override-change locking.

## Operator rules

Overrides have no business maximum beyond the database money representation;
this is intentional. The approving administrator chooses the permitted allocation.
Cycle capacity still caps real money; test accounts are exempt from shared cycle
capacity but still obey partner limits. Reasons must contain 3–1000 characters.
The helper treats malformed, non-finite or below-default runtime values as the default.
Reserved portal principal, ownership and cycle cannot be changed through UPDATE;
status changes remain allowed so existing reservations can activate after a cap reduction.
Custom Paka Paka submissions and fulfillment also use the partner override.
Run the manual Docker race harness with `npm run db:test:limit-races`;
it expects `supabase_db_ourmu-app` and the disposable template database described above.
