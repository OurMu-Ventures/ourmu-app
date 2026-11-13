# Multiple investment accounts

One verified partner and login can own multiple named investment accounts. The
account switcher scopes the dashboard and investment list; All accounts combines
those records. Investment detail pages always show the investment's actual account.
Profile, KYC, next of kin, verified email contacts and payout destinations remain
shared by the legal owner.

## Behaviour

- The existing portfolio becomes Main Account. New profiles automatically receive
  a Main Account, including partners onboarding through legacy claims.
- Every claimed investment has an account owned by its investor. Unclaimed legacy
  records retain a null account until claimed; claiming assigns Main Account.
- Additional accounts can be opened and renamed. Active names are unique for each
  owner, ignoring surrounding whitespace and case.
- Account balances use the existing investment calculations scoped by account.
  Principal, projected/actual value and matured records remain distinct; this
  feature does not add a cash wallet or a withdrawable bank balance.
- Partner cycle limits, overrides, minimum investments and shared cycle capacity
  retain their existing scope. Opening accounts does not multiply the partner cap.
- A reservation submits an explicit account ID. Switching in another tab cannot
  change the account embedded in an already-open form. Server/database validation
  checks the selected account's owner and active status.
- Investments cannot move between accounts. Reinvestment inherits its source
  investment's account. Existing standing reinvestment permissions still apply
  across the partner's portal investments; no new authorization is inferred.
- Main Account cannot be archived. Additional accounts may archive only after
  reservations, active investments and unsettled maturities have been resolved.
  Archived history stays readable; archiving cannot remove financial records.
- Staff activation, investment and maturity views identify the account. Reservation,
  activation and maturity emails include the name when available. New agreements
  and receipts include a stable account ID; historic PDFs are not regenerated.

## Review and deployment order

This PR is for review. No production migration, deployment or feature enablement
is part of preparing it.

1. Review the database migration, ownership model and account lifecycle rules.
2. Back up the production database and apply the migration before deploying the
   account-aware app. It backfills Main Account and adds the ownership constraint
   without changing principal, investment IDs or signed agreement evidence.
3. Reconcile the count and sums of investments by owner before/after backfill.
   All claimed investments must have an account with the same owner. Verify
   unclaimed imports can subsequently be claimed into Main Account.
4. Deploy with `MULTIPLE_INVESTMENT_ACCOUNTS_ENABLED=false`. The previous
   reservation RPC remains available and defaults to Main Account for deployment
   overlap; account-aware reservations use a separate backend-only RPC.
5. After review and acceptance testing, set the server-only flag to true in the
   chosen test environment first. Exercise creation, switching, reservation,
   activation, maturity selection, payout and reinvestment with synthetic data.
6. Enable creation in production only after approval. Monitor failed reservations,
   worker retries and reconciliation totals during initial partner use.

To pause account creation, set the flag back to false. Existing account access,
settlement and management remain available. Once additional accounts hold real
investments, keep the account-aware application deployed: an older UI combines
accounts and cannot safely substitute for the reviewed account-aware experience.
Do not reverse the migration or delete accounts with financial history.

## Verification

`npm run check` covers lint, types, unit tests and production compilation.
`supabase test db` includes `investment_accounts.test.sql` and the existing
financial, security, import, receipt and maturity suites. The account tests cover
backend-only grants, RLS, separate principal, combined caps, account ownership,
archive restrictions, deployment overlap and reinvestment routing.

Two Docker harnesses clone an explicitly supplied disposable schema database and
delete their clone afterward:

```sh
OURMU_TEST_CONTAINER=<test-container> OURMU_TEST_TEMPLATE_DB=<migrated-empty-db> node scripts/test-investment-account-concurrency.mjs
OURMU_TEST_CONTAINER=<test-container> OURMU_TEST_TEMPLATE_DB=<pre-account-empty-db> node scripts/test-investment-account-migration.mjs
```

The first checks simultaneous reservations across accounts and an archive versus
reservation race. The second checks backfilling existing partners and investments
without changing aggregate principal or projected values. Use synthetic test
schema templates only.
